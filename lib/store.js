'use strict';
// Storage for everything that changes after launch: accounts, edited people,
// suggestions and uploaded files. Production keeps them in a Neon Postgres
// database (table cuffe.kv). With no DATABASE_URL (local testing only) it
// falls back to a folder.
const fs = require('fs');
const path = require('path');

const LOCAL = !process.env.DATABASE_URL;
const LOCAL_DIR = process.env.LOCAL_DATA_DIR || path.join(process.cwd(), '.localdata');

function conflict() { const e = new Error('precondition'); e.name = 'BlobPreconditionFailedError'; return e; }

// ---------- Neon ----------
let sqlFn, ready;
function sql() {
  if (!sqlFn) sqlFn = require('@neondatabase/serverless').neon(process.env.DATABASE_URL);
  return sqlFn;
}
const q = (text, params) => sql().query(text, params || []);
function init() {
  return ready || (ready = (async () => {
    await q('CREATE SCHEMA IF NOT EXISTS cuffe');
    await q('CREATE TABLE IF NOT EXISTS cuffe.kv (name text PRIMARY KEY, body text NOT NULL, content_type text NOT NULL, version bigint NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now())');
  })().catch((e) => { ready = null; throw e; }));
}

// ---------- local folder (tests only) ----------
function localPath(name) {
  const p = path.join(LOCAL_DIR, name.replace(/[^a-zA-Z0-9._/-]/g, '_'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}

async function readRaw(name) {
  if (LOCAL) {
    const p = localPath(name);
    if (!fs.existsSync(p)) return null;
    const buf = fs.readFileSync(p);
    const meta = fs.existsSync(p + '.meta') ? JSON.parse(fs.readFileSync(p + '.meta', 'utf8')) : {};
    return { buf, etag: String(fs.statSync(p).mtimeMs), contentType: meta.contentType || 'application/octet-stream' };
  }
  await init();
  const rows = await q('SELECT body, content_type, version FROM cuffe.kv WHERE name = $1', [name]);
  if (!rows.length) return null;
  return { buf: Buffer.from(rows[0].body, 'base64'), etag: String(rows[0].version), contentType: rows[0].content_type };
}

// With an etag: replace only if nobody changed it since it was read.
// Without one: create only if it does not exist yet.
async function writeRaw(name, buf, contentType, etag) {
  if (LOCAL) {
    const p = localPath(name);
    if (etag && fs.existsSync(p) && String(fs.statSync(p).mtimeMs) !== etag) throw conflict();
    fs.writeFileSync(p, buf);
    fs.writeFileSync(p + '.meta', JSON.stringify({ contentType }));
    return;
  }
  await init();
  const body = buf.toString('base64');
  const rows = etag
    ? await q('UPDATE cuffe.kv SET body = $2, content_type = $3, version = version + 1, updated_at = now() WHERE name = $1 AND version = $4 RETURNING version', [name, body, contentType, etag])
    : await q('INSERT INTO cuffe.kv (name, body, content_type) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING RETURNING version', [name, body, contentType]);
  if (!rows.length) throw conflict();
}

async function removeRaw(name) {
  if (LOCAL) { const p = localPath(name); if (fs.existsSync(p)) fs.unlinkSync(p); return; }
  await init();
  await q('DELETE FROM cuffe.kv WHERE name = $1', [name]);
}

async function readJson(name, fallback) {
  const r = await readRaw(name);
  if (!r) return { data: typeof fallback === 'function' ? await fallback() : fallback, etag: null };
  return { data: JSON.parse(r.buf.toString('utf8')), etag: r.etag };
}

// Read, change in place, write back. Retries if someone else wrote in between.
async function update(name, fallback, fn) {
  for (let i = 0; i < 6; i++) {
    const { data, etag } = await readJson(name, fallback);
    const out = await fn(data);
    try {
      await writeRaw(name, Buffer.from(JSON.stringify(data)), 'application/json', etag);
      return out;
    } catch (e) {
      if (e && e.name === 'BlobPreconditionFailedError') continue;
      throw e;
    }
  }
  throw new Error('The archive is busy. Please try again.');
}

module.exports = { readRaw, writeRaw, removeRaw, readJson, update, LOCAL };
