'use strict';
// Local dev server: serves public/ and runs the API handler. Not deployed.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'local-dev-secret-local-dev-secret-1234';
process.env.ADMIN_SETUP_CODE = process.env.ADMIN_SETUP_CODE || 'letmein-setup';
process.env.LOCAL_DATA_DIR = process.env.LOCAL_DATA_DIR || require('path').join(__dirname, '..', '.localdata');
const http = require('http'), fs = require('fs'), path = require('path');
const handler = require('../api/index.js');
const PUB = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (e) { req.body = {}; }
      Promise.resolve(handler(req, res)).catch(e => { console.error(e); res.statusCode = 500; res.end('{}'); });
    });
    return;
  }
  let f = path.join(PUB, path.normalize(u.pathname));
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUB, 'index.html');
  res.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream');
  res.end(fs.readFileSync(f));
}).listen(process.env.PORT || 3111, () => console.log('http://localhost:' + (process.env.PORT || 3111)));
