'use strict';
const fs = require('fs');
const path = require('path');
const { readJson, writeRaw } = require('./store');

const seed = () => JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'people.json'), 'utf8'));

// data/people.json is only the starting point. It is copied into the Neon
// database the first time the site runs. If the file is later replaced with a
// newer version, the database copy is refreshed from it, unless an admin has
// already edited records there (those edits are never overwritten).
async function load() {
  const r = await readJson('people.json', null);
  const file = seed();
  if (r.data && (r.data.edited || r.data.version === file.version)) return r.data;
  try { await writeRaw('people.json', Buffer.from(JSON.stringify(file)), 'application/json', r.etag); } catch (e) { /* another request got there first */ }
  return file;
}

const parOf = (p) => [p.fa, p.mo].filter(Boolean);

const yearOf = (s) => { const m = /(1[5-9]\d\d|20\d\d)/.exec(s || ''); return m ? +m[1] : null; };

function generations(doc) {
  const kids = new Map();
  doc.people.forEach((p) => parOf(p).forEach((a) => { if (!kids.has(a)) kids.set(a, []); kids.get(a).push(p.id); }));
  const gen = new Map([[doc.root, 0]]);
  const q = [doc.root];
  while (q.length) {
    const a = q.shift();
    (kids.get(a) || []).forEach((c) => { if (!gen.has(c)) { gen.set(c, gen.get(a) + 1); q.push(c); } });
  }
  doc.people.forEach((p) => {
    if (!gen.has(p.id)) { const s = (p.sp || []).find((x) => gen.has(x)); if (s != null) gen.set(p.id, gen.get(s)); }
  });
  return gen;
}

// A person is treated as living, and hidden from the public, when there is no
// death date and they were born in 1920 or later (or are four or more
// generations down with no birth year). An admin can force either way.
function livingFlags(doc) {
  const gen = generations(doc);
  const out = new Map();
  doc.people.forEach((p) => {
    let living;
    if (p.privacy === 'public') living = false;
    else if (p.privacy === 'private') living = true;
    else if (p.died) living = false;
    else {
      const y = yearOf(p.born);
      if (y != null) living = y >= 1920;
      else { const g = gen.get(p.id); living = g != null && g >= 4; }
    }
    out.set(p.id, living);
  });
  return out;
}

function view(doc, canSeeAll) {
  const living = livingFlags(doc);
  const people = doc.people.map((p) => {
    const lv = living.get(p.id);
    const base = { id: p.id, sp: p.sp || [], par: parOf(p), fa: p.fa || null, mo: p.mo || null };
    if (lv && !canSeeAll) {
      return { ...base, first: 'Living relative', sur: '', born: '', died: '', bplace: '', dplace: '', place: '', dna: false, usa: false, notes: '', private: true };
    }
    const o = { ...base, first: p.first || '', sur: p.sur || '', born: p.born || '', died: p.died || '', bplace: p.bplace || '', dplace: p.dplace || '', place: p.place || '', burial: p.burial || '', marr: p.marr || [], mod: p.mod || '' };
    if (canSeeAll) { o.dna = !!p.dna; o.usa = !!p.usa; o.notes = p.notes || ''; o.living = lv; o.privacy = p.privacy || 'auto'; }
    else { o.dna = false; o.usa = false; o.notes = ''; }
    return o;
  });
  return { name: doc.name, root: doc.root, updated: doc.updated || '', people, hidden: canSeeAll ? 0 : [...living.values()].filter(Boolean).length };
}

// Marriage details are kept on both partners. Set them on the first spouse's marriage.
function setMarriage(doc, p, date, place) {
  const sp = (p.sp || [])[0];
  const other = sp ? doc.people.find((x) => x.id === sp) : null;
  [p, other].forEach((x) => {
    if (!x) return;
    const to = x === p ? sp : p.id;
    const old = (x.marr || []).find((m) => m.sp === to);
    x.marr = (x.marr || []).filter((m) => m.sp !== to);
    if (date || place) x.marr.push({ ...(to ? { sp: to } : {}), ...(date ? { date } : {}), ...(place ? { place } : {}), ...(old && old.wit ? { wit: old.wit } : {}) });
    if (!x.marr.length) delete x.marr;
  });
}

// Set (or add) the marriage between p and o, on both partners, keeping the order of existing marriages.
function setMarriageTo(doc, p, o, date, place, wit) {
  [[p, o], [o, p]].forEach((pair) => {
    const x = pair[0], y = pair[1];
    x.sp = x.sp || [];
    if (!x.sp.includes(y.id)) x.sp.push(y.id);
    x.marr = x.marr || [];
    const e = { sp: y.id };
    if (date) e.date = date; if (place) e.place = place; if (wit) e.wit = wit;
    const i = x.marr.findIndex((m) => m.sp === y.id);
    if (i >= 0) x.marr[i] = e; else x.marr.push(e);
  });
}

module.exports = { load, view, yearOf, setMarriage, setMarriageTo, seedCopy: seed };
