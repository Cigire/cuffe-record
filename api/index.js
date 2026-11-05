'use strict';
const crypto = require('crypto');
const store = require('../lib/store');
const auth = require('../lib/auth');
const people = require('../lib/people');

const MAX_FILE = 3 * 1024 * 1024;
const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/plain'];
const KINDS = ['photo', 'newspaper', 'research', 'other'];

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const send = (res, status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
const uid = () => crypto.randomBytes(9).toString('base64url');
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, status: u.status, role: u.role, note: u.note || '', createdAt: u.createdAt });

async function currentUser(req) {
  const t = auth.readToken(auth.cookies(req)[auth.COOKIE]);
  if (!t) return null;
  const { data } = await store.readJson('users.json', { users: [] });
  const u = data.users.find((x) => x.id === t.uid);
  if (!u || (u.pwv || 0) !== (t.pwv || 0)) return null;
  return u;
}
const isApproved = (u) => !!u && (u.status === 'approved' || u.role === 'admin');
const isAdmin = (u) => !!u && u.role === 'admin' && u.status === 'approved';
const needApproved = (u) => { if (!u) fail(401, 'Please log in first.'); if (!isApproved(u)) fail(403, 'Your account has not been approved yet.'); };
const needAdmin = (u) => { if (!u) fail(401, 'Please log in first.'); if (!isAdmin(u)) fail(403, 'Administrators only.'); };

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  // vercel.json rewrites /api/<anything> to /api/index?p=<anything>, so every depth reaches this one function.
  const routed = url.searchParams.get('p');
  const rawPath = routed != null && /^\/api\/index\/?$/.test(url.pathname) ? routed : url.pathname.replace(/^\/api\/?/, '');
  const parts = rawPath.split('/').filter(Boolean).map(decodeURIComponent);
  const method = req.method;
  const body = req.body && typeof req.body === 'object' ? req.body : {};

  if (method !== 'GET' && method !== 'HEAD') {
    const origin = req.headers.origin;
    if (origin) { let host = ''; try { host = new URL(origin).host; } catch (e) { /* bad origin */ } if (host !== req.headers.host) fail(403, 'Request blocked.'); }
  }

  const user = await currentUser(req);
  const [a, b, c, d] = parts;

  // ---- session ----
  if (a === 'me' && method === 'GET') {
    return send(res, 200, { user: user ? publicUser(user) : null, approved: isApproved(user), admin: isAdmin(user) });
  }

  if (a === 'register' && method === 'POST') {
    const name = str(body.name, 80), email = str(body.email, 120).toLowerCase(), pw = String(body.password || '');
    if (name.length < 2) fail(400, 'Please enter your name.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Please enter a valid email address.');
    if (pw.length < 8 || pw.length > 200) fail(400, 'Choose a password of at least 8 characters.');
    const setup = process.env.ADMIN_SETUP_CODE;
    const hash = auth.hashPassword(pw);
    const made = await store.update('users.json', { users: [] }, (d) => {
      if (d.users.some((u) => u.email === email)) fail(409, 'An account with that email already exists. Try logging in.');
      const first = setup && String(body.setupCode || '') === setup && !d.users.some((u) => u.role === 'admin');
      const u = { id: uid(), name, email, hash, pwv: 1, status: first ? 'approved' : 'pending', role: first ? 'admin' : 'member', note: str(body.note, 500), createdAt: new Date().toISOString(), fails: 0, lockUntil: 0 };
      d.users.push(u);
      return u;
    });
    auth.setCookie(res, auth.makeToken(made.id, made.pwv));
    return send(res, 201, { user: publicUser(made), approved: isApproved(made), admin: isAdmin(made) });
  }

  if (a === 'login' && method === 'POST') {
    const email = str(body.email, 120).toLowerCase(), pw = String(body.password || '');
    const bad = 'That email and password do not match.';
    const result = await store.update('users.json', { users: [] }, (d) => {
      const u = d.users.find((x) => x.email === email);
      if (!u) return { error: bad };
      if (u.lockUntil && u.lockUntil > Date.now()) return { error: 'Too many attempts. Please wait a few minutes and try again.' };
      if (!auth.verifyPassword(pw, u.hash)) {
        u.fails = (u.fails || 0) + 1;
        if (u.fails >= 8) { u.lockUntil = Date.now() + 15 * 60 * 1000; u.fails = 0; }
        return { error: bad };
      }
      u.fails = 0; u.lockUntil = 0;
      return { user: u };
    });
    if (result.error) fail(401, result.error);
    auth.setCookie(res, auth.makeToken(result.user.id, result.user.pwv));
    return send(res, 200, { user: publicUser(result.user), approved: isApproved(result.user), admin: isAdmin(result.user) });
  }

  if (a === 'logout' && method === 'POST') { auth.setCookie(res, ''); return send(res, 200, { ok: true }); }

  if (a === 'password' && method === 'POST') {
    if (!user) fail(401, 'Please log in first.');
    const next = String(body.next || '');
    if (next.length < 8 || next.length > 200) fail(400, 'Choose a new password of at least 8 characters.');
    const r = await store.update('users.json', { users: [] }, (d) => {
      const u = d.users.find((x) => x.id === user.id);
      if (!u || !auth.verifyPassword(String(body.current || ''), u.hash)) return null;
      u.hash = auth.hashPassword(next); u.pwv = (u.pwv || 1) + 1;
      return u;
    });
    if (!r) fail(400, 'Your current password is not right.');
    auth.setCookie(res, auth.makeToken(r.id, r.pwv));
    return send(res, 200, { ok: true });
  }

  // ---- people ----
  if (a === 'people' && method === 'GET') {
    const doc = await people.load();
    return send(res, 200, people.view(doc, isApproved(user)));
  }

  // ---- archive ----
  if (a === 'archive' && !b && method === 'GET') {
    const { data } = await store.readJson('archive.json', { items: [] });
    const counts = {};
    data.items.forEach((i) => { const k = i.personId == null ? 'all' : i.personId; counts[k] = counts[k] || {}; counts[k][i.kind] = (counts[k][i.kind] || 0) + 1; counts[k].total = (counts[k].total || 0) + 1; });
    return send(res, 200, { locked: !isApproved(user), counts, items: isApproved(user) ? data.items : [] });
  }

  if (a === 'archive' && !b && method === 'POST') {
    needAdmin(user);
    const kind = KINDS.includes(body.kind) ? body.kind : 'other';
    const type = str(body.contentType, 80);
    if (!FILE_TYPES.includes(type)) fail(400, 'Use a JPG, PNG, WebP, GIF, PDF or plain text file.');
    const buf = Buffer.from(String(body.data || ''), 'base64');
    if (!buf.length) fail(400, 'That file is empty.');
    if (buf.length > MAX_FILE) fail(413, 'Files can be up to 3 MB each.');
    const id = uid();
    const personId = body.personId === '' || body.personId == null ? null : Number(body.personId);
    const item = { id, kind, title: str(body.title, 120) || str(body.filename, 120) || 'Untitled', caption: str(body.caption, 400), personId, filename: str(body.filename, 120), contentType: type, size: buf.length, uploadedBy: user.name, uploadedAt: new Date().toISOString() };
    await store.writeRaw('files/' + id, buf, type, null, false);
    await store.update('archive.json', { items: [] }, (d) => { d.items.push(item); });
    return send(res, 201, { item });
  }

  if (a === 'archive' && b && method === 'DELETE') {
    needAdmin(user);
    const gone = await store.update('archive.json', { items: [] }, (d) => { const i = d.items.findIndex((x) => x.id === b); if (i < 0) return false; d.items.splice(i, 1); return true; });
    if (!gone) fail(404, 'That item is already gone.');
    try { await store.removeRaw('files/' + b); } catch (e) { /* metadata is gone; leftover file is harmless */ }
    return send(res, 200, { ok: true });
  }

  if (a === 'file' && b && method === 'GET') {
    needApproved(user);
    const { data } = await store.readJson('archive.json', { items: [] });
    const item = data.items.find((x) => x.id === b);
    if (!item) fail(404, 'File not found.');
    const f = await store.readRaw('files/' + b);
    if (!f) fail(404, 'File not found.');
    res.statusCode = 200;
    res.setHeader('Content-Type', item.contentType);
    res.setHeader('Content-Length', f.buf.length);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline; filename="' + (item.filename || 'file').replace(/[^\w.\- ]/g, '_') + '"');
    return res.end(f.buf);
  }

  // ---- suggestions (members) ----
  if (a === 'suggest' && method === 'POST') {
    needApproved(user);
    const text = str(body.text, 1000);
    if (text.length < 5) fail(400, 'Please describe the correction.');
    const personId = Number(body.personId);
    const doc = await people.load();
    if (!doc.people.some((p) => p.id === personId)) fail(400, 'Unknown person.');
    await store.update('suggestions.json', { items: [] }, (d) => { d.items.push({ id: uid(), personId, userId: user.id, userName: user.name, text, status: 'open', createdAt: new Date().toISOString() }); });
    return send(res, 201, { ok: true });
  }

  // ---- admin ----
  if (a === 'admin') {
    needAdmin(user);

    if (b === 'users' && !c && method === 'GET') {
      const { data } = await store.readJson('users.json', { users: [] });
      return send(res, 200, { users: data.users.map(publicUser) });
    }
    if (b === 'users' && c && method === 'POST') {
      const action = str(body.action, 20);
      const r = await store.update('users.json', { users: [] }, (d) => {
        const u = d.users.find((x) => x.id === c); if (!u) return 'missing';
        const admins = d.users.filter((x) => x.role === 'admin' && x.status === 'approved');
        if (action === 'approve') u.status = 'approved';
        else if (action === 'deny') { if (u.id === user.id) return 'self'; u.status = 'denied'; if (u.role === 'admin') u.role = 'member'; }
        else if (action === 'makeAdmin') { u.role = 'admin'; u.status = 'approved'; }
        else if (action === 'removeAdmin') { if (admins.length < 2 && u.role === 'admin') return 'last'; u.role = 'member'; }
        else return 'bad';
        return 'ok';
      });
      if (r === 'missing') fail(404, 'No such account.');
      if (r === 'self') fail(400, 'You cannot deny your own account.');
      if (r === 'last') fail(400, 'There must be at least one administrator.');
      if (r === 'bad') fail(400, 'Unknown action.');
      return send(res, 200, { ok: true });
    }

    if (b === 'suggestions' && !c && method === 'GET') {
      const { data } = await store.readJson('suggestions.json', { items: [] });
      return send(res, 200, { items: data.items });
    }
    if (b === 'suggestions' && c && method === 'POST') {
      const status = body.status === 'dismissed' ? 'dismissed' : 'done';
      await store.update('suggestions.json', { items: [] }, (d) => { const s = d.items.find((x) => x.id === c); if (s) s.status = status; });
      return send(res, 200, { ok: true });
    }

    const coord = (v, lim) => { const n = parseFloat(v); return Number.isFinite(n) && Math.abs(n) <= lim ? Math.round(n * 1e6) / 1e6 : null; };
    if (b === 'person' && c && d === 'event' && method === 'POST') {
      const id = Number(c), type = body.type;
      if (!['birth', 'death', 'burial'].includes(type)) fail(400, 'Unknown event.');
      const date = str(body.date, 60), place = str(body.place, 120);
      const lat = coord(body.lat, 90), lng = coord(body.lng, 180);
      await people.load();
      const result = await store.update('people.json', people.seedCopy, (doc) => {
        const t = doc.people.find((p) => p.id === id);
        if (!t) return { error: 'No such person.' };
        const set = (k, v) => { if (v != null && v !== '') t[k] = v; else delete t[k]; };
        const keys = { birth: ['born', 'bplace', 'blat', 'blng'], death: ['died', 'dplace', 'dlat', 'dlng'], burial: ['kdate', 'burial', 'klat', 'klng'] }[type];
        set(keys[0], date); set(keys[1], place);
        if (lat != null && lng != null) { set(keys[2], lat); set(keys[3], lng); } else { set(keys[2], null); set(keys[3], null); }
        t.mod = new Date().toISOString().slice(0, 10); doc.edited = true;
        return { id };
      });
      if (result.error) fail(404, result.error);
      return send(res, 200, result);
    }
    if (b === 'person' && c && d === 'marriage' && method === 'POST') {
      const id = Number(c), sp = Number(body.sp);
      const lat = coord(body.lat, 90), lng = coord(body.lng, 180);
      await people.load();
      const result = await store.update('people.json', people.seedCopy, (doc) => {
        const t = doc.people.find((p) => p.id === id), o = doc.people.find((p) => p.id === sp);
        if (!t) return { error: 'No such person.' };
        if (!o || o.id === t.id) return { error: 'Choose a spouse.' };
        if (body.remove) people.removeMarriage(doc, t, o);
        else people.setMarriageTo(doc, t, o, str(body.date, 60), str(body.place, 120), str(body.wit, 200), lat, lng);
        t.mod = o.mod = new Date().toISOString().slice(0, 10); doc.edited = true;
        return { id };
      });
      if (result.error) fail(400, result.error);
      return send(res, 200, result);
    }

    if (b === 'person' && !d && method === 'POST') {
      // create (no id) or edit (id) a person
      const id = c ? Number(c) : null;
      const clean = {
        first: str(body.first, 80), sur: str(body.sur, 80), born: str(body.born, 60), died: str(body.died, 60),
        bplace: str(body.bplace, 120), dplace: str(body.dplace, 120), place: str(body.place, 120), burial: str(body.burial, 120), notes: str(body.notes, 1000), dna: !!body.dna, usa: !!body.usa,
        privacy: ['auto', 'private', 'public'].includes(body.privacy) ? body.privacy : 'auto'
      };
      const mdate = str(body.mdate, 60), mplace = str(body.mplace, 120);
      const ids = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => Number(String(x).trim())).filter((x) => Number.isInteger(x) && x > 0);
      await people.load(); // makes sure the database copy is current before it is changed
      const today = new Date().toISOString().slice(0, 10);
      const result = await store.update('people.json', people.seedCopy, (doc) => {
        const known = new Set(doc.people.map((p) => p.id));
        const one = (v, self) => { const n = ids(v)[0]; return n && known.has(n) && n !== self ? n : null; };
        let target;
        if (id) {
          target = doc.people.find((p) => p.id === id);
          if (!target) return { error: 'No such person.' };
          [['bplace', 'blat', 'blng'], ['dplace', 'dlat', 'dlng'], ['burial', 'klat', 'klng']].forEach((k) => { if (body[k[0]] !== undefined && (target[k[0]] || '') !== clean[k[0]]) { delete target[k[1]]; delete target[k[2]]; } });
          // only fields actually sent are changed, so a partial request can never blank a record
          Object.keys(clean).forEach((k) => { if (body[k] !== undefined) target[k] = clean[k]; });
          ['fa', 'mo'].forEach((k) => { if (body[k] === undefined) return; const n = one(body[k], id); if (n) target[k] = n; else delete target[k]; });
        } else {
          const sp = ids(body.sp).filter((x) => known.has(x)).slice(0, 2);
          target = { id: Math.max(...doc.people.map((p) => p.id)) + 1, ...clean, sp };
          const fa = one(body.fa), mo = one(body.mo);
          if (fa) target.fa = fa;
          if (mo) target.mo = mo;
          doc.people.push(target);
          sp.forEach((s) => { const o = doc.people.find((p) => p.id === s); if (o && !(o.sp || []).includes(target.id) && (o.sp || []).length < 2) (o.sp = o.sp || []).push(target.id); });
        }
        Object.keys(clean).forEach((k) => { if ((id ? body[k] !== undefined : true) && (clean[k] === '' || clean[k] === false || (k === 'privacy' && clean[k] === 'auto'))) delete target[k]; });
        if (body.mdate !== undefined || body.mplace !== undefined) people.setMarriage(doc, target, mdate, mplace);
        target.mod = today;
        doc.edited = true;
        return { id: target.id };
      });
      if (result.error) fail(404, result.error);
      return send(res, 200, result);
    }
  }

  fail(404, 'Not found.');
}

module.exports = async (req, res) => {
  try { await handle(req, res); }
  catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e && e.stack || e);
    send(res, 500, { error: 'Something went wrong. Please try again.' });
  }
};
