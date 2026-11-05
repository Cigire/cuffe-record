'use strict';
const crypto = require('crypto');

const COOKIE = 'cr_session';
const DAYS = 30;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 24) throw new Error('SESSION_SECRET is not set');
  return s;
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return 's1:' + salt.toString('hex') + ':' + hash.toString('hex');
}

function verifyPassword(pw, stored) {
  const [v, saltHex, hashHex] = String(stored || '').split(':');
  if (v !== 's1' || !saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, 'hex');
  const got = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), want.length, { N: 16384, r: 8, p: 1 });
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

const b64 = (b) => Buffer.from(b).toString('base64url');

function makeToken(uid, pwv) {
  const body = b64(JSON.stringify({ uid, pwv, exp: Date.now() + DAYS * 864e5 }));
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + sig;
}

function readToken(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const want = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return d.exp > Date.now() ? d : null;
  } catch (e) { return null; }
}

function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}

function setCookie(res, token) {
  const secure = process.env.NODE_ENV === 'test' || process.env.LOCAL_DATA_DIR ? '' : '; Secure';
  const age = token ? DAYS * 86400 : 0;
  res.setHeader('Set-Cookie', COOKIE + '=' + (token || '') + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + age + secure);
}

module.exports = { COOKIE, hashPassword, verifyPassword, makeToken, readToken, cookies, setCookie };
