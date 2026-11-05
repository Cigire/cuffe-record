'use strict';
(function () {
  /* ---------- state ---------- */
  var S = {
    viewer: { user: null, approved: false, admin: false },
    doc: null, arch: { locked: true, counts: {}, items: [] },
    pq: '',
    sort: { key: 'name', dir: 1 }, q: '', filter: 'all',
    by: new Map(), kids: new Map(), gen: new Map(), dc: new Map(),
    admin: { users: [], suggestions: [], msg: '', err: false }
  };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch('/api/' + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
        return j;
      });
    });
  }

  /* ---------- data helpers ---------- */
  function index() {
    var d = S.doc;
    S.by = new Map(d.people.map(function (p) { return [p.id, p]; }));
    S.kids = new Map();
    d.people.forEach(function (p) { p.par.forEach(function (a) { if (!S.kids.has(a)) S.kids.set(a, []); S.kids.get(a).push(p.id); }); });
    S.kids.forEach(function (v, k) { S.kids.set(k, Array.from(new Set(v)).sort(byBirth)); });
    S.gen = new Map([[d.root, 0]]);
    var q = [d.root];
    while (q.length) { var a = q.shift(); kidsOf(a).forEach(function (c) { if (!S.gen.has(c)) { S.gen.set(c, S.gen.get(a) + 1); q.push(c); } }); }
    S.dc = new Map();
  }
  function year(p) { var m = /(1[5-9]\d\d|20\d\d)/.exec(p.born || ''); return m ? +m[1] : null; }
  function byBirth(a, b) {
    var pa = S.by.get(a), pb = S.by.get(b), ya = year(pa), yb = year(pb);
    return ((ya == null ? 9999 : ya) - (yb == null ? 9999 : yb)) || a - b;
  }
  function kidsOf(id) { return S.kids.get(id) || []; }
  function dcount(id) {
    if (S.dc.has(id)) return S.dc.get(id);
    var n = 0; kidsOf(id).forEach(function (c) { n += 1 + dcount(c); });
    S.dc.set(id, n); return n;
  }
  function nm(p) {
    if (p.private) return 'Living relative';
    if (p.first && p.sur) return p.first + ' ' + p.sur;
    if (p.first) return p.first;
    if (p.sur) return p.sur + ' (first name not shown)';
    return 'Unnamed';
  }
  function dn(p) {
    if (p.private) return 'Living relative';
    if (p.sur && p.first) return p.sur + ', ' + p.first;
    if (p.first) return p.first + ' (surname not shown)';
    if (p.sur) return p.sur + ', (first name not shown)';
    return 'Unnamed';
  }
  function yrs(p) {
    if (p.private) return 'Living';
    if (p.born && p.died) return p.born + ' – ' + p.died;
    if (p.born) return 'b. ' + p.born;
    if (p.died) return 'd. ' + p.died;
    return 'dates not recorded';
  }
  function docs(id) { var c = S.arch.counts[id]; return c ? c.total : 0; }
  function link(p) { return '<a href="/person/' + p.id + '" class="name">' + esc(nm(p)) + '</a>'; }
  function dlink(p) { return '<a href="/person/' + p.id + '">' + esc(dn(p)) + '</a>'; }
  function plink(p) { return '<a href="/person/' + p.id + '">' + esc(nm(p)) + '</a>'; }
  function details(p) { return [p.born, p.died, p.place, p.sp.length ? 'x' : ''].filter(Boolean).length; }
  function hasMarr(p) { return !!(p.marr && p.marr.some(function (m) { return m.date || m.place; })); }
  function vcount(p) { if (p.private) return 0; return ((p.born || p.bplace) ? 1 : 0) + (hasMarr(p) ? 1 : 0) + ((p.died || p.dplace) ? 1 : 0) + (p.burial ? 1 : 0); }
  function longDate(iso) {
    var m = /^(\d{4})-(\d\d)-(\d\d)/.exec(iso || ''); if (!m) return '';
    return (+m[3]) + ' ' + ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+m[2] - 1] + ' ' + m[1];
  }
  function parentCell(id) { var q = id ? S.by.get(id) : null; return q ? '<a href="/person/' + q.id + '">' + esc(dn(q)) + '</a>' : 'unknown'; }
  /* maps: the place name is looked up in the visitor's browser on OpenStreetMap and remembered there */
  function mapBox(place, lat, lng) {
    var has = lat != null && lng != null;
    if (!has && (!place || /[;\d]/.test(place) && /born|died/i.test(place))) return '';
    return '<div class="map-slot" data-place="' + esc(place || '') + '"' + (has ? ' data-lat="' + lat + '" data-lng="' + lng + '"' : '') + '></div>';
  }
  var geoCache = {};
  try { geoCache = JSON.parse(localStorage.getItem('cr_geo') || '{}'); } catch (e) { geoCache = {}; }
  function geoSave() { try { localStorage.setItem('cr_geo', JSON.stringify(geoCache)); } catch (e) { /* storage unavailable */ } }
  function geoQueries(place) {
    var clean = place.replace(/\bParish\b/gi, '').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
    var abroad = /\b(USA|UK|England|Spain|Scotland|Wales)\b/i.test(clean);
    var parts = clean.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    var out = [], tail = abroad ? '' : ', Ireland';
    out.push(clean + tail);
    if (parts.length > 1) out.push(parts[parts.length - 1] + tail);
    return out;
  }
  function geocode(place) {
    if (Object.prototype.hasOwnProperty.call(geoCache, place)) return Promise.resolve(geoCache[place]);
    var qs = geoQueries(place);
    var run = function (i) {
      if (i >= qs.length) return Promise.resolve(null);
      return fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(qs[i]))
        .then(function (r) { return r.json(); })
        .then(function (j) { return j && j[0] ? { lat: +j[0].lat, lon: +j[0].lon } : new Promise(function (ok) { setTimeout(ok, 1100); }).then(function () { return run(i + 1); }); });
    };
    return run(0).then(function (g) { geoCache[place] = g; geoSave(); return g; }).catch(function () { return null; });
  }
  function drawMap(el, g) {
    var d = 0.04, b = [g.lon - d * 1.6, g.lat - d, g.lon + d * 1.6, g.lat + d].map(function (x) { return x.toFixed(5); }).join(',');
    el.innerHTML = '<iframe class="event-map" title="Map of ' + esc(el.dataset.place) + '" loading="lazy" referrerpolicy="no-referrer" src="https://www.openstreetmap.org/export/embed.html?bbox=' + b + '&layer=mapnik&marker=' + g.lat.toFixed(5) + ',' + g.lon.toFixed(5) + '"></iframe>' +
      '<a class="map-link" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=' + g.lat.toFixed(5) + '&mlon=' + g.lon.toFixed(5) + '#map=13/' + g.lat.toFixed(5) + '/' + g.lon.toFixed(5) + '">View larger map \u2192</a>';
  }
  function afterMaps() {
    var els = Array.prototype.slice.call(document.querySelectorAll('.map-slot'));
    var chain = Promise.resolve();
    els.forEach(function (el) {
      chain = chain.then(function () {
        if (!el.isConnected) return null;
        if (el.dataset.lat) { drawMap(el, { lat: +el.dataset.lat, lon: +el.dataset.lng }); return null; }
        var cached = Object.prototype.hasOwnProperty.call(geoCache, el.dataset.place);
        return geocode(el.dataset.place).then(function (g) {
          if (!el.isConnected) return;
          if (g) drawMap(el, g); else el.remove();
          return cached ? null : new Promise(function (ok) { setTimeout(ok, 1100); });
        });
      });
    });
  }
  function lineParent(p) { var id = p.par.find(function (i) { return S.gen.has(i); }); return id == null ? null : S.by.get(id); }

  /* ---------- shell ---------- */
  var KIND_LABEL = { newspaper: 'Newspaper Articles', photo: 'Photos', research: 'Research Notes', other: 'Other Records' };
  function path() { var p = location.pathname.replace(/\/+$/, ''); return p || '/'; }

  function shell(active) {
    var v = S.viewer, tabs = [['/', 'Overview'], ['/tree', 'Family Tree'], ['/archive', 'Archive']];
    if (v.approved || v.admin) tabs.push(['/photos', 'Photos']);
    tabs.push(['/membership', v.user ? 'My Account' : 'Login / Register'], ['/help', 'Help']);
    if (v.admin) tabs.push(['/admin', 'Admin']);
    $('#tabs').innerHTML = tabs.map(function (t) { return '<a href="' + t[0] + '"' + (t[0] === active ? ' class="active"' : '') + '>' + t[1] + '</a>'; }).join('');
    var label = 'Guest', dot = 'guest';
    if (v.user) {
      if (v.admin) { label = 'Admin'; dot = 'approved'; }
      else if (v.approved) { label = 'Approved member'; dot = 'approved'; }
      else if (v.user.status === 'denied') { label = 'Access denied'; dot = 'denied'; }
      else { label = 'Pending approval'; dot = 'pending'; }
    }
    $('#pill').innerHTML = '<span class="dot ' + dot + '"></span> ' + esc(label);
    $('#foot-email').textContent = v.user ? v.user.email : 'not signed in';
  }

  function activeTab(p) {
    if (p === '/' || p === '') return '/';
    if (p.indexOf('/person/') === 0) return '/archive';
    if (p.indexOf('/tree/') === 0) return '/tree';
    if (p.indexOf('/membership/') === 0) return '/membership';
    return p;
  }

  function render() {
    var p = path(), v = $('#view');
    if (!S.doc) { v.innerHTML = '<p class="empty-note">Loading the archive…</p>'; return; }
    if (p === '/tree') { history.replaceState(null, '', '/tree/' + S.doc.root); p = path(); }
    if ((p === '/membership/login' || p === '/membership/register') && S.viewer.user) { history.replaceState(null, '', '/membership'); p = '/membership'; }
    shell(activeTab(p));
    var m = /^\/person\/(\d+)$/.exec(p), tm = /^\/tree\/(\d+)$/.exec(p);
    var em = /^\/person\/(\d+)\/events\/(birth|death|burial)\/edit$/.exec(p), mm = /^\/person\/(\d+)\/marriages\/(add|\d+\/edit)$/.exec(p);
    var html, picker = false;
    if ((em || mm) && (!S.viewer.admin || !S.by.get(+(em || mm)[1]))) { history.replaceState(null, '', '/person/' + (em || mm)[1]); p = path(); m = /^\/person\/(\d+)$/.exec(p); em = mm = null; }
    if (em) { html = pageEventEdit(+em[1], em[2]); picker = true; }
    else if (mm) { html = pageMarriageEdit(+mm[1], mm[2] === 'add' ? null : +mm[2].split('/')[0]); picker = true; }
    else if (m) html = pagePerson(+m[1]);
    else if (tm) html = pageTree(+tm[1]);
    else if (p === '/membership/login') html = pageLogin();
    else if (p === '/membership/register') html = pageRegister();
    else if (p === '/archive') html = pageArchive();
    else if (p === '/photos') html = pagePhotos();
    else if (p === '/membership') html = pageMembership();
    else if (p === '/help') html = pageHelp();
    else if (p === '/admin') html = pageAdmin();
    else html = pageHome();
    v.innerHTML = html;
    document.title = (m && S.by.get(+m[1]) ? nm(S.by.get(+m[1])) + ' · ' : '') + 'The Cuffe Record';
    if (m) afterMaps();
    if (picker) afterPicker();
    if (p === '/archive') afterArchive();
    if (p === '/admin') afterAdmin();
  }

  function go(to, replace) {
    if (to === path() + location.search) { render(); return; }
    history[replace ? 'replaceState' : 'pushState'](null, '', to);
    render(); window.scrollTo(0, 0);
  }

  /* ---------- overview ---------- */
  function banner() {
    var v = S.viewer;
    if (v.approved) return '';
    var msg = "You're viewing the public preview. Document scans are visible to approved members only.", act = '<a class="linklike" href="/membership">Request access →</a>';
    if (v.user && v.user.status === 'pending') { msg = 'Your access request is awaiting admin review.'; act = ''; }
    else if (v.user) { msg = 'Your access request was not approved.'; act = '<a class="linklike" href="/membership">See details</a>'; }
    return '<div class="banner"><span>' + msg + '</span>' + act + '</div>';
  }

  function yearsLabel(p) { return p.private ? 'Living' : 'b. ' + (p.born ? p.born : '—'); }
  function lifeFlag(p) {
    var y = year(p);
    if (p.died || p.dplace || p.burial || (y != null && y < 1920)) return ' · deceased';
    return y != null ? ' · living' : '';
  }

  function personCard(p) {
    var kids = kidsOf(p.id).length, v = vcount(p), n = docs(p.id), tags = [];
    if (kids) tags.push(kids + (kids === 1 ? ' child' : ' children'));
    if (v) tags.push(v + '/4 vital events');
    var c = S.arch.counts[p.id] || {};
    Object.keys(KIND_LABEL).forEach(function (k) { if (c[k]) tags.push(KIND_LABEL[k] + ' (' + c[k] + ')'); });
    var sub = yearsLabel(p) + (p.id === S.doc.root ? ' · the root of the tree' : '');
    return '<a class="person-card-link" href="/person/' + p.id + '"><div class="person-card"><span class="stamp">' + n + ' docs</span><h3>' + esc(dn(p)) + '</h3><div class="years">' + esc(sub) + '</div><div class="tagrow">' +
      (tags.length ? tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') : '<span class="tag" style="opacity:.5">No records yet</span>') + '</div><span class="open">View record →</span></div></a>';
  }

  function pageHome() {
    var d = S.doc;
    var total = Object.keys(S.arch.counts).reduce(function (a, k) { return a + S.arch.counts[k].total; }, 0);
    var cards = [S.by.get(d.root)].concat(kidsOf(d.root).map(function (i) { return S.by.get(i); }));
    return '<div class="home-hero"><div class="eyebrow">Welcome</div><h1>The story of the Cuffe family, kept for those who come next</h1>' +
      '<p class="welcome-copy">This is a family archive for the descendants of the Cuffes of Clonruff, the earliest of whom was born in 1790. Whether you’re tracing a great-grandparent’s townland, looking for a relative’s marriage date, or just curious how you connect to everyone else here, this site is built for you to browse, explore and add to over time.</p>' +
      '<div class="aims-grid">' +
      '<div class="aim"><h4>Record</h4><p>Capture each person’s birth, marriage, death and burial — with place, date and a map wherever it can be traced.</p></div>' +
      '<div class="aim"><h4>Preserve</h4><p>Keep newspaper clippings, photographs and research notes safe in one place, linked to the person they belong to.</p></div>' +
      '<div class="aim"><h4>Connect</h4><p>Show real father, mother and spouse relationships, so it’s clear exactly how every name fits into the wider family.</p></div>' +
      '<div class="aim"><h4>Share</h4><p>Keep the family tree open for anyone to browse, while document scans stay visible to approved family members only.</p></div></div></div>' +
      '<div class="page-title"><h2>The archive so far</h2><span class="meta">' + total + ' records catalogued · ' + d.people.length + ' people</span></div>' +
      banner() +
      '<div class="card-grid">' + cards.map(personCard).join('') + '</div>';
  }

  /* ---------- family tree: one person at a time, laid out as in the Finlay Record ---------- */
  var TW = 180, TH = 96, FW = 212, FH = 100, TIER = 150, SGAP = 26, CGAP = 18;
  function tbox(q, label, x, y, focal) {
    var w = focal ? FW : TW, h = focal ? FH : TH;
    return '<g class="tnode' + (focal ? ' root' : '') + '" transform="translate(' + (x - w / 2) + ',' + (y - h / 2) + ')"' + (q ? ' data-go="' + (focal ? '/person/' : '/tree/') + q.id + '"' : '') + '>' +
      '<rect width="' + w + '" height="' + h + '" rx="2"/><foreignObject x="0" y="0" width="' + w + '" height="' + h + '"><div class="tnode-body"><div class="name">' + esc(q ? dn(q) : (label || 'unknown')) + '</div>' +
      (q ? '<div class="years">' + esc(yearsLabel(q)) + '</div>' : '') + (q && !focal && !q.private && kidsOf(q.id).length ? '<div class="gcount">' + kidsOf(q.id).length + ' child' + (kidsOf(q.id).length > 1 ? 'ren' : '') + ' on file</div>' : '') + '</div></foreignObject></g>';
  }
  function tcurve(x1, y1, x2, y2) { return '<path class="tlink" d="M' + x1 + ',' + y1 + ' C ' + x1 + ',' + (y1 + y2) / 2 + ' ' + x2 + ',' + (y1 + y2) / 2 + ' ' + x2 + ',' + y2 + '"/>'; }
  function pageTree(id) {
    var p = S.by.get(id);
    if (!p) return '<a class="back-link" href="/tree">← Whole tree</a><p class="empty-note">That person is not in the record.</p>';
    var unlocked = !p.private;
    var father = p.fa ? S.by.get(p.fa) : null, mother = p.mo ? S.by.get(p.mo) : null;
    var all = unlocked ? kidsOf(id).map(function (i) { return S.by.get(i); }) : [];
    var sids = [];
    if (unlocked) p.sp.concat((p.marr || []).map(function (m) { return m.sp; })).forEach(function (s) { if (s && S.by.get(s) && sids.indexOf(s) < 0) sids.push(s); });
    var used = {};
    var groups = sids.map(function (sid) {
      var ks = all.filter(function (c) { return (c.fa === id ? c.mo : c.fa) === sid; });
      ks.forEach(function (c) { used[c.id] = 1; });
      return { box: true, person: S.by.get(sid), kids: ks };
    });
    var rest = all.filter(function (c) { return !used[c.id]; });
    if (rest.length) groups.unshift({ box: false, person: null, kids: rest });
    var hasF = !!father, hasM = !!mother, hasP = hasF || hasM;
    var nSp = groups.filter(function (g) { return g.box; }).length;
    var flat = [];
    groups.forEach(function (g) { g.kids.forEach(function (c) { flat.push({ c: c, g: g }); }); });
    var n = flat.length;
    var spouseRowW = FW + nSp * (SGAP + TW);
    var childrenRowW = n ? n * TW + (n - 1) * CGAP + 120 : 0;
    var width = Math.max(640, childrenRowW, spouseRowW), cx = width / 2;
    var y = 40, parentsY = null, childrenY = null;
    if (hasP) { parentsY = y + TH / 2; y += TIER; }
    var focalY = y + FH / 2; y += TIER;
    if (n) { childrenY = y + TH / 2; y += TIER - 40; }
    var height = y + 30;
    var pairLeft = cx - spouseRowW / 2, focalX = pairLeft + FW / 2, cursor = pairLeft + FW;
    groups.forEach(function (g) {
      if (!g.box) { g.ax = focalX; return; }
      cursor += SGAP; g.bx = cursor + TW / 2; g.ax = g.bx; cursor += TW;
    });
    var pairW = TW + (hasF && hasM ? 20 + TW : 0), pairL = cx - pairW / 2;
    var fx = hasM ? pairL + TW / 2 : cx, mx = hasF ? pairL + TW + 20 + TW / 2 : cx;
    var spacing = TW + CGAP, left = cx - (n * TW + (n - 1) * CGAP) / 2;
    var out = [];
    if (hasF) out.push(tcurve(fx, parentsY + TH / 2, focalX, focalY - FH / 2));
    if (hasM) out.push(tcurve(mx, parentsY + TH / 2, focalX, focalY - FH / 2));
    flat.forEach(function (k, i) { out.push(tcurve(k.g.ax, focalY + FH / 2, left + spacing * i + TW / 2, childrenY - TH / 2)); });
    if (hasF) out.push(tbox(father, '', fx, parentsY, false));
    if (hasM) out.push(tbox(mother, '', mx, parentsY, false));
    out.push(tbox(p, '', focalX, focalY, true));
    groups.forEach(function (g) { if (g.box) out.push(tbox(g.person, '', g.bx, focalY, false)); });
    flat.forEach(function (k, i) { out.push(tbox(k.c, '', left + spacing * i + TW / 2, childrenY, false)); });
    return '<a class="back-link" href="/tree">← Whole tree</a>' +
      '<div class="page-title"><h2>Family tree</h2><span class="meta">' + esc(dn(p)) + ' (' + esc(yearsLabel(p)) + ')' + (unlocked ? ' &amp; ' + n + ' children' : '') + '</span></div>' +
      '<div style="margin:6px 0 10px"><button class="btn small ghost" data-act="tree-preview" type="button">Preview &amp; save as PDF</button></div>' +
      '<p class="lede">Click the highlighted box to open ' + esc(dn(p)) + '’s full record — click any other name to re-centre the tree there.</p>' +
      (!unlocked ? '<p class="lede">' + esc(dn(p)) + ' is a living family member, so their marriages and children are visible to approved members only.</p>' : '') +
      '<div class="tree-wrap"><svg class="tree-svg" viewBox="0 0 ' + width + ' ' + height + '" width="100%" style="display:block" role="img" aria-label="Family tree">' + out.join('') + '</svg></div>';
  }

  /* ---------- archive (people table) ---------- */
  function pageArchive() {
    return '<div class="page-title"><h2>Browse the archive</h2><span class="meta" id="acount"></span></div>' +
      '<div class="archive-search field"><label for="aq">Search by name</label><input type="search" id="aq" placeholder="e.g. Bridget, Thomas\u2026" autocomplete="off" value="' + esc(S.q) + '"></div>' +
      '<div class="table-scroll"><table class="archive-table"><thead><tr>' + th('name', 'Name') + th('born', 'Birth') + th('father', 'Father') + th('mother', 'Mother') + th('vital', 'Vital events') + th('docs', 'Documents') + '<th></th></tr></thead><tbody id="abody"></tbody></table></div>';
  }
  function th(k, label) {
    var on = S.sort.key === k;
    return '<th aria-sort="' + (on ? (S.sort.dir > 0 ? 'ascending' : 'descending') : 'none') + '"><button type="button" class="sort-link' + (on ? ' active' : '') + '" data-sort="' + k + '">' + label + ' <span class="sort-arrow">' + (on ? (S.sort.dir < 0 ? '\u25bc' : '\u25b2') : '\u2195') + '</span></button></th>';
  }
  function afterArchive() { fillArchive(); }
  function parentName(id) { var q = id ? S.by.get(id) : null; return q ? dn(q).toLowerCase() : '\uffff'; }
  function fillArchive() {
    var q = S.q.trim().toLowerCase();
    var rows = S.doc.people.filter(function (p) {
      return !q || (nm(p) + ' ' + dn(p) + ' ' + (p.private ? '' : p.place || '')).toLowerCase().indexOf(q) >= 0;
    });
    var key = S.sort.key, dir = S.sort.dir;
    var bySur = function (p) { return p.private ? '\uffff' : ((p.sur || '\uffff') + '|' + (p.first || '').toLowerCase()).toLowerCase(); };
    var val = {
      name: bySur, born: function (p) { var y = p.private ? null : year(p); return y == null ? 99999 : y; },
      father: function (p) { return parentName(p.fa); }, mother: function (p) { return parentName(p.mo); },
      vital: function (p) { return -vcount(p); }, docs: function (p) { return -docs(p.id); }
    }[key];
    rows.sort(function (a, b) {
      var x = val(a), y = val(b);
      if (x < y) return -dir; if (x > y) return dir;
      var x2 = bySur(a), y2 = bySur(b);
      return (x2 < y2 ? -1 : x2 > y2 ? 1 : (year(a) || 9999) - (year(b) || 9999) || a.id - b.id);
    });
    $('#acount').textContent = (rows.length === S.doc.people.length ? rows.length : rows.length + ' of ' + S.doc.people.length) + ' people documented';
    $('#abody').innerHTML = rows.map(function (p) {
      return '<tr><td><a class="name" href="/person/' + p.id + '">' + esc(dn(p)) + '</a></td><td>' + (p.private ? '<span class="vt-empty">Living</span>' : (p.born ? esc(p.born) : '<span class="vt-empty">\u2014</span>')) + '</td><td class="parents">' + parentCell(p.fa) + '</td><td class="parents">' + parentCell(p.mo) + '</td><td class="muted-cell">' + vcount(p) + '/4</td><td class="muted-cell">' + docs(p.id) + '</td><td><a class="view-link" href="/person/' + p.id + '">View record \u2192</a></td></tr>';
    }).join('') || '<tr><td colspan="7" class="empty-note">Nobody matches. Clear the search to see everyone.</td></tr>';
  }

  /* ---------- photos ---------- */
  function locked(text) {
    return '<div class="locked-block"><span class="lock-icon" aria-hidden="true">\u{1F512}</span><p>' + text + '</p>' +
      (S.viewer.user ? '' : '<a class="btn small" href="/membership">Login / Register</a>') + '</div>';
  }
  function photoParams() { var sp = new URLSearchParams(location.search); return { q: sp.get('q') || '', photo: sp.get('photo') || '' }; }
  function photoHref(id, q) { var ps = []; if (q) ps.push('q=' + encodeURIComponent(q)); if (id) ps.push('photo=' + encodeURIComponent(id)); return '/photos' + (ps.length ? '?' + ps.join('&') : ''); }
  function photoOwner(i) { return i.personId != null && S.by.get(i.personId) ? dn(S.by.get(i.personId)) : i.title; }
  function photoList() {
    var q = (S.pq || '').trim().toLowerCase();
    return S.arch.items.filter(function (i) { return i.kind === 'photo' && (!q || photoOwner(i).toLowerCase().indexOf(q) >= 0); });
  }
  function photoGrid() {
    var list = photoList();
    if (!list.length) return '<p class="empty-note">' + (S.pq.trim() ? 'No photos match “' + esc(S.pq.trim()) + '”.' : 'No photos have been added yet.') + '</p>';
    return '<ul class="photo-grid">' + list.map(function (i) {
      return '<li><a class="photo-thumb" href="' + photoHref(i.id, S.pq.trim()) + '"><img src="/api/file/' + i.id + '" alt="' + esc(i.title) + '" loading="lazy"><span class="cap">' + esc(photoOwner(i)) + '</span><span class="kind">Photo</span></a></li>';
    }).join('') + '</ul>';
  }
  function fillPhotos() { var g = $('#pgrid'); if (g) g.innerHTML = photoGrid(); }
  function photoViewer(list, idx) {
    var i = list[idx], q = S.pq.trim(), p = i.personId != null ? S.by.get(i.personId) : null;
    var close = photoHref(null, q), prev = idx > 0 ? photoHref(list[idx - 1].id, q) : '', next = idx < list.length - 1 ? photoHref(list[idx + 1].id, q) : '';
    var nav = (prev ? '<a class="btn ghost small" href="' + prev + '">‹ Previous</a>' : '<span class="btn ghost small" aria-disabled="true">‹ Previous</span>') +
      (next ? '<a class="btn ghost small" href="' + next + '">Next ›</a>' : '<span class="btn ghost small" aria-disabled="true">Next ›</span>');
    var added = longDate(i.createdAt);
    var info = '<div class="doc-section"><h4>Photo details</h4><table class="vitals-table"><tbody><tr><th>Title</th><td>' + esc(i.title) + '</td></tr><tr><th>Type</th><td>Photo</td></tr>' +
      '<tr><th>Added</th><td>' + (added ? esc(added) : '<span class="vt-empty">Original archive</span>') + '</td></tr><tr><th>File</th><td><a href="/api/file/' + i.id + '" target="_blank" rel="noopener">Open full size →</a></td></tr></tbody></table></div>';
    if (p) {
      var row = function (k, v) { return '<tr><th>' + k + '</th><td>' + v + '</td></tr>'; };
      var fa = p.fa ? S.by.get(p.fa) : null, mo = p.mo ? S.by.get(p.mo) : null;
      var ev = function (pl, d) { return (pl ? esc(pl) : '<span class="vt-empty">Location unknown</span>') + ' · ' + (d ? esc(d) : '<span class="vt-empty">date unknown</span>'); };
      info += '<div class="doc-section"><h4>Person</h4><table class="vitals-table"><tbody>' + row('Name', '<a href="/person/' + p.id + '">' + esc(dn(p)) + '</a>') +
        row('Born', (p.born ? esc(p.born) : '<span class="vt-empty">—</span>') + lifeFlag(p)) + row('Father', parentCell(p.fa)) + row('Mother', parentCell(p.mo)) +
        ((p.born || p.bplace) ? row('Birth', ev(p.bplace, p.born)) : '') + ((p.died || p.dplace) ? row('Death', ev(p.dplace, p.died)) : '') + (p.burial ? row('Burial', ev(p.burial, '')) : '') +
        '</tbody></table><a href="/person/' + p.id + '" class="view-link" style="display:inline-block;margin-top:10px">View full record →</a></div>';
    }
    return '<div class="photo-viewer" role="dialog" aria-modal="true" aria-label="' + esc(i.title) + '" data-close="' + close + '" data-prev="' + prev + '" data-next="' + next + '">' +
      '<div class="viewer-bar"><a class="btn ghost small" href="' + close + '">← Back to photos</a><span class="viewer-pos">' + (idx + 1) + ' of ' + list.length + '</span><span class="viewer-nav">' + nav + '</span></div>' +
      '<div class="viewer-row"><a href="/api/file/' + i.id + '" target="_blank" rel="noopener" title="Open full size" class="viewer-photo"><img src="/api/file/' + i.id + '" alt="' + esc(i.title) + '"></a>' +
      '<div class="viewer-info"><div class="viewer-info-inner">' + info + '</div></div></div></div>';
  }
  function pagePhotos() {
    if (S.arch.locked) return '<div class="page-title"><h2>Photos</h2></div><div class="locked-block"><span class="lock-icon" aria-hidden="true">\u{1F512}</span><div style="font-family:var(--display);font-size:19px">The photo collection is for approved members</div><p>Family photographs and portraits are visible to approved members only.</p><a href="/membership" class="btn">' + (S.viewer.user ? 'Membership status' : 'Request access') + '</a></div>';
    var pp = photoParams(); S.pq = pp.q;
    var all = S.arch.items.filter(function (i) { return i.kind === 'photo'; });
    var list = photoList(), idx = -1;
    list.forEach(function (i, k) { if (i.id === pp.photo) idx = k; });
    return '<div class="page-title"><h2>Photos</h2><span class="meta">' + all.length + ' photo' + (all.length === 1 ? '' : 's') + ' in the archive</span></div>' +
      '<div class="field" style="max-width:340px;margin-bottom:6px"><label for="pq">Filter by person</label><input type="search" id="pq" placeholder="e.g. Bridget, Thomas…" autocomplete="off" value="' + esc(pp.q) + '"></div>' +
      '<div id="pgrid">' + photoGrid() + '</div>' + (idx >= 0 ? photoViewer(list, idx) : '');
  }

  /* ---------- person ---------- */
  function table(list) {
    if (!list.length) return '';
    return '<table class="children-table"><thead><tr><th></th><th>Name</th><th>Birth</th><th>Vital events</th><th>Documents</th><th></th></tr></thead><tbody>' + list.map(function (p, i) {
      return '<tr><td class="idx">' + (i + 1) + '.</td><td><a class="name" href="/person/' + p.id + '">' + esc(dn(p)) + '</a></td><td>' + (p.private ? '<span class="vt-empty">Living</span>' : (p.born ? esc(p.born) : '<span class="vt-empty">—</span>')) + '</td><td class="muted-cell">' + vcount(p) + '/4</td><td class="muted-cell">' + docs(p.id) + '</td><td><a class="view-link" href="/person/' + p.id + '">View record →</a></td></tr>';
    }).join('') + '</tbody></table>';
  }
  var ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
  var BUCKETS = [['newspaper', 'Newspaper Articles (Scanned)'], ['photo', 'Photos'], ['research', 'Research Notes'], ['other', 'Other Records']];
  function pagePerson(id) {
    var p = S.by.get(id);
    if (!p) return '<a class="back-link" href="/archive">← Back to archive</a><p class="empty-note">That person is not in the record.</p>';
    var head = 'font-family:var(--display);font-size:34px;margin:0';
    if (p.private) {
      return '<a class="back-link" href="/archive">← Back to archive</a><div class="profile-head"><div class="profile-photo placeholder" aria-hidden="true">?</div><div><div class="breadcrumb">Family archive</div>' +
        '<h2 style="' + head + '">Living relative</h2><div class="years" style="font-family:var(--mono);font-size:12px;color:var(--ink-soft)">Living</div></div></div>' +
        '<div class="locked-block"><span class="lock-icon" aria-hidden="true">\u{1F512}</span><div style="font-family:var(--display);font-size:19px">This record is for a living person</div><p>To protect their privacy, details of living family members are visible to approved members only.</p><a href="/membership" class="btn">' + (S.viewer.user ? 'Membership status' : 'Request access') + '</a></div>';
    }
    var kids = kidsOf(id).map(function (i) { return S.by.get(i); });
    var sibIds = Array.from(new Set([].concat.apply([], p.par.map(kidsOf)))).filter(function (i) { return i !== id; }).sort(byBirth);
    var sibs = sibIds.map(function (i) { return S.by.get(i); });
    var initial = ((p.first || '').charAt(0) + (p.sur || '').charAt(0)).toUpperCase() || '?';
    var row = function (k, v) { return '<tr><th>' + k + '</th><td>' + v + '</td></tr>'; };
    var none = '<div class="vt-detail"><span class="vt-empty">Not recorded yet</span></div>';
    var nDocs = docs(id);
    var unk = function (t, w) { return t ? esc(t) : '<span class="vt-empty">' + w + '</span>'; };
    var admin = S.viewer.admin, member = S.viewer.approved && !admin;
    var evBtn = function (type, label, has) {
      if (admin) return '<a class="btn ghost small" href="/person/' + id + '/events/' + type + '/edit">' + (has ? 'Edit' : '+ Add') + '</a>';
      if (member) return '<button class="btn ghost small" data-act="suggest" data-id="' + id + '" data-ctx="' + label + '" type="button">' + (has ? 'Suggest edit' : '+ Add') + '</button>';
      return '';
    };
    var ev = function (place, date, type, label, lat, lng) {
      if (!place && !date && lat == null) return '<div class="vt-detail"><span class="vt-empty">Not recorded yet</span>' + evBtn(type, label, false) + '</div>';
      return '<div class="vt-event"><div class="vt-detail"><span>' + unk(place, 'Location unknown') + ' \u00b7 ' + unk(date, 'date unknown') + '</span>' + evBtn(type, label, true) + '</div>' + mapBox(place, lat, lng) + '</div>';
    };
    var vit = row('Name', esc(dn(p))) + row('Father', parentCell(p.fa)) + row('Mother', parentCell(p.mo)) +
      row('Birth', ev(p.bplace, p.born, 'birth', 'Birth', p.blat, p.blng)) + row('Death', ev(p.dplace, p.died, 'death', 'Death', p.dlat, p.dlng)) + row('Burial', ev(p.burial, p.kdate, 'burial', 'Burial', p.klat, p.klng));
    if (p.place) vit += row('Lived at', '<div class="vt-event"><div class="vt-detail"><span>' + esc(p.place) + '</span></div>' + mapBox(p.place) + '</div>');
    vit += row('Documents', nDocs + ' on file' + (S.arch.locked ? ' (' + (S.viewer.user ? 'available once an admin approves your account' : 'sign in as an approved member to view') + ')' : ''));
    if (S.viewer.approved) {
      if (p.dna) vit += row('DNA', 'Tested and matched');
      if (p.usa) vit += row('USA', 'Lived in the United States');
      if (p.notes) vit += row('Notes', esc(p.notes));
    }
    vit += row('Last Modified', esc(longDate(p.mod || S.doc.updated)) || '<span class="vt-empty">—</span>');
    /* marriages: each recorded marriage, plus any spouse with no marriage details yet */
    var ms = (p.marr || []).filter(function (m) { return m.sp || m.date || m.place; }).map(function (m) { return m; });
    p.sp.forEach(function (s) { if (S.by.get(s) && !ms.some(function (m) { return m.sp === s; })) ms.push({ sp: s, date: '', place: '', wit: '' }); });
    var marrHtml;
    if (ms.length) {
      marrHtml = '<table class="vitals-table"><tbody>' + ms.map(function (m, i) {
        var sp = m.sp ? S.by.get(m.sp) : null;
        var who = sp ? '<a href="/person/' + sp.id + '">' + esc(dn(sp)) + '</a>' : '<span class="vt-empty">Not recorded yet</span>';
        return '<tr><th>' + (ORD[i] || (i + 1) + 'th') + ' marriage</th><td><div class="vt-detail"><span>' + who + ((m.date || m.place) ? ' \u00b7 ' + unk(m.place, 'location unknown') + ' \u00b7 ' + unk(m.date, 'date unknown') : '') + '</span>' +
          (admin ? '<a class="btn ghost small" href="/person/' + id + '/marriages/' + (m.sp || 0) + '/edit">Edit</a>' : member ? '<button class="btn ghost small" data-act="suggest" data-id="' + id + '" data-ctx="Marriage" type="button">Suggest edit</button>' : '') + '</div>' +
          (m.wit && S.viewer.approved ? '<div class="vt-sub">Witnesses: ' + esc(m.wit) + '</div>' : '') + mapBox(m.place, m.lat, m.lng) +
          '</td></tr>';
      }).join('') + '</tbody></table>';
    } else marrHtml = '<p class="empty-note" style="padding:6px 0">No marriages recorded yet.</p>';
    marrHtml += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' + (admin ? '<a class="btn ghost small" href="/person/' + id + '/marriages/add">+ Add marriage</a>' : member ? '<button class="btn ghost small" data-act="suggest" data-id="' + id + '" data-ctx="Marriage" type="button">+ Add marriage</button>' : '') + '</div>';
    var docHtml;
    if (S.arch.locked) docHtml = '<div class="locked-block"><span class="lock-icon" aria-hidden="true">\u{1F512}</span><div style="font-family:var(--display);font-size:19px">' + nDocs + ' document' + (nDocs === 1 ? '' : 's') + ' on file for ' + esc(dn(p)) + '</div><p>Newspaper clippings, photos and research notes are visible to approved members.</p><a href="/membership" class="btn">Request access</a></div>';
    else {
      var mine = S.arch.items.filter(function (i) { return i.personId === id; });
      docHtml = BUCKETS.map(function (b) {
        var its = mine.filter(function (i) { return i.kind === b[0]; });
        return '<div class="doc-section"><h4>' + b[1] + ' <span style="opacity:.55">(' + its.length + ')</span></h4>' + (its.length ? '<ul class="doc-list">' + its.map(function (i) {
          return '<li><a class="doclink" href="/api/file/' + i.id + '" target="_blank" rel="noopener"><span class="fname">\u{1F4C4} ' + esc(i.title) + '</span></a><span class="ftype">view scan</span></li>';
        }).join('') + '</ul>' : '<p class="empty-note" style="padding:8px 0">None catalogued yet.</p>') + (admin ? '<button class="btn ghost small" data-act="doc-add" data-id="' + id + '" data-kind="' + b[0] + '" type="button" style="margin-top:4px">+ Add to ' + b[1].replace(' (Scanned)', '') + '</button>' : '') + '</div>';
      }).join('');
    }
    var actions = '';
    if (S.viewer.admin) actions = '<a class="btn ghost small" href="/admin?edit=' + id + '">Edit</a>';
    else if (S.viewer.approved) actions = '<button class="btn ghost small" data-act="suggest" data-id="' + id + '" type="button">Suggest an edit</button>';
    return '<a class="back-link" href="/archive">← Back to archive</a>' +
      '<div class="profile-head"><div class="profile-photo placeholder" aria-hidden="true">' + esc(initial) + '</div><div><div class="breadcrumb">' + (id === S.doc.root ? 'Root of the tree' : 'Family archive') + '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h2 style="' + head + '">' + esc(dn(p)) + '</h2>' + actions + '</div>' +
      '<div class="years" style="font-family:var(--mono);font-size:12px;color:var(--ink-soft)">b. ' + (p.born ? esc(p.born) : '—') + lifeFlag(p) + '</div></div></div>' +
      '<div class="doc-section"><h4>Vital records</h4><table class="vitals-table"><tbody>' + vit + '</tbody></table></div>' +
      '<div class="doc-section"><h4>Marriages' + (ms.length ? ' <span style="opacity:.55">(' + ms.length + ')</span>' : '') + '</h4>' + marrHtml + '</div>' +
      docHtml +
      '<div class="doc-section"><h4>Children' + (kids.length ? ' <span style="opacity:.55">(' + kids.length + ')</span>' : '') + '</h4>' + (kids.length ? table(kids) : '<p class="empty-note" style="padding:6px 0">No children linked yet.</p>') +
      (admin ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn ghost small" data-act="child-add" data-id="' + id + '" data-role="fa" type="button">+ Add child (as father)</button><button class="btn ghost small" data-act="child-add" data-id="' + id + '" data-role="mo" type="button">+ Add child (as mother)</button></div>' : '') + '</div>' +
      (sibs.length ? '<details class="branch-box"><summary>Brothers and sisters <span class="cnt">' + sibs.length + '</span></summary>' + table(sibs) + '</details>' : '');
  }

  function pageMembership() {
    var v = S.viewer;
    var lede = '<p class="lede">Notes, document scans, photographs and living relatives are restricted to approved family members. Anyone can browse the tree and see who’s documented; an admin approves access to the records themselves.</p>';
    if (v.user) {
      var u = v.user, role = v.admin ? 'admin' : u.status;
      var st = {
        pending: ['pending', 'Pending approval', 'Your request is awaiting admin review. You can still browse the tree in the meantime — document scans and corrections unlock once you’re approved.'],
        denied: ['denied', 'Access not approved', 'Your access request was not approved. Contact an admin if you think this is a mistake.'],
        approved: ['approved', 'Approved member', 'Full record scans are unlocked and you can suggest corrections to any entry.'],
        admin: ['approved', 'Admin', 'You can review requests and edit records directly.']
      }[role] || ['pending', 'Pending approval', ''];
      return '<div class="page-title"><h2>My Account</h2></div>' + lede +
        '<div class="account-card"><div class="account-status-row"><span class="dot ' + st[0] + '"></span><div><h3 style="margin:0">' + st[1] + '</h3><p class="sub-copy" style="margin:4px 0 0">Signed in as ' + esc(u.email) + '</p></div></div>' +
        '<p style="margin-bottom:0">' + st[2] + '</p>' + (v.admin ? '<p style="margin-bottom:0">Head to the <a href="/admin" class="linklike">Admin page</a> to review requests, or open any person’s page to edit records.</p>' : '') +
        '<div style="margin-top:18px"><button class="btn ghost small" data-act="logout" type="button">Log out</button></div></div>' +
        '<div class="account-card" style="margin-top:20px;max-width:420px"><h3 style="margin-top:0">Change password</h3><form data-form="password" autocomplete="off"><div class="field"><label for="pw-cur">Current password</label><input id="pw-cur" name="current" type="password" autocomplete="current-password" required></div>' +
        '<div class="field"><label for="pw-new">New password</label><input id="pw-new" name="next" type="password" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters"></div><button class="btn" type="submit">Update password</button><div class="status-line" id="pw-msg" role="status"></div></form></div>';
    }
    return '<div class="page-title"><h2>Login / Register</h2></div>' + lede +
      '<div class="account-card"><h3 style="margin-top:0">Sign in or create an account</h3><p class="sub-copy">New here? Create an account and request access. Already registered? Log in.</p>' +
      '<div style="display:flex;gap:8px"><a href="/membership/register" class="btn small">Create account</a><a href="/membership/login" class="btn small ghost">Log in</a></div></div>';
  }
  function pageLogin() {
    return '<a class="back-link" href="/membership">← Back to Login / Register</a><div class="page-title"><h2>Log in</h2></div>' +
      '<div class="account-card" style="max-width:420px"><form data-form="login"><div class="field"><label for="li-email">Email</label><input id="li-email" name="email" type="email" autocomplete="email" required></div>' +
      '<div class="field"><label for="li-pw">Password</label><input id="li-pw" name="password" type="password" autocomplete="current-password" required></div><button class="btn" type="submit">Log in</button><div class="status-line err" id="li-msg" role="alert"></div></form>' +
      '<p class="sub-copy" style="margin-bottom:0">New here? <a href="/membership/register" class="linklike">Create an account</a></p></div>';
  }
  function pageRegister() {
    return '<a class="back-link" href="/membership">← Back to Login / Register</a><div class="page-title"><h2>Create account</h2></div>' +
      '<p class="lede">Register and request access. An admin reviews each request before document scans and living people’s details are unlocked; you can browse the tree in the meantime.</p>' +
      '<div class="account-card" style="max-width:420px"><form data-form="register"><div class="field"><label for="rg-name">Name</label><input id="rg-name" name="name" autocomplete="name" required placeholder="Your full name"></div>' +
      '<div class="field"><label for="rg-email">Email</label><input id="rg-email" name="email" type="email" autocomplete="email" required placeholder="you@example.com"></div>' +
      '<div class="field"><label for="rg-pw">Password</label><input id="rg-pw" name="password" type="password" minlength="8" autocomplete="new-password" required placeholder="At least 8 characters"></div>' +
      '<div class="field"><label for="rg-note">How are you connected? (optional)</label><textarea id="rg-note" name="note" maxlength="500" placeholder="e.g. Grandson of Tom and Mary Cuffe"></textarea></div>' +
      '<details style="margin-bottom:14px"><summary class="muted" style="cursor:pointer;font-family:var(--mono);font-size:13px">Administrator setup code</summary><div class="field" style="margin-top:8px"><label for="rg-code">Setup code</label><input id="rg-code" name="setupCode" autocomplete="off"></div></details>' +
      '<button class="btn" type="submit">Create account &amp; request access</button><div class="status-line err" id="rg-msg" role="alert"></div></form>' +
      '<p class="sub-copy" style="margin-bottom:0">Already registered? <a href="/membership/login" class="linklike">Log in</a></p></div>';
  }

  /* ---------- help ---------- */
  function pageHelp() {
    var toc = [['access-levels', 'Accounts & access levels'], ['getting-started', 'Getting started'], ['getting-around', 'Finding your way around'], ['reading-a-record', 'Reading a person’s record'], ['photos', 'The photo collection'], ['maps', 'Places, dates & the map'], ['contributing', 'Contributing as a member'], ['administering', 'Administering the archive'], ['faq', 'Questions & troubleshooting']];
    var no = '<td class="muted-cell">no</td>';
    var rowA = function (cls, label, cells) { return '<tr><td><span class="status-badge ' + cls + '">' + label + '</span></td>' + cells + '</tr>'; };
    var live = '<td>yes</td><td>yes</td>' + no + no + no + no;
    var sec = function (id, n, title, body) { return '<div class="doc-section" id="' + id + '"><h4>' + n + ' · ' + title + '</h4>' + body + '</div>'; };
    var dl = function (rows) { return '<dl class="manual-anatomy">' + rows.map(function (r) { return '<div class="row"><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>'; }).join('') + '</dl>'; };
    var steps = function (rows) { return '<ol class="manual-steps">' + rows.map(function (r) { return '<li><div><h4>' + r[0] + '</h4><p>' + r[1] + '</p></div></li>'; }).join('') + '</ol>'; };
    var qa = function (q, a) { return '<p><b>' + q + '</b><br>' + a + '</p>'; };
    return '<div class="page-title"><h2>User manual</h2><span class="meta">browsing, contributing &amp; administering</span></div>' +
      '<p class="lede">How to read the tree, understand what’s public versus locked, send a correction as a member, and — for admins — how to run the archive day to day.</p>' +
      '<ul class="manual-toc">' + toc.map(function (t, i) { return '<li><a href="#' + t[0] + '"><span class="n">0' + (i + 1) + '</span>' + t[1].replace('&', '&amp;') + '</a></li>'; }).join('') + '</ul>' +
      sec('access-levels', '01', 'Accounts &amp; access levels',
        '<p>Everything you can see and do is governed by one of five account states. Everyone registers the same way, and an admin decides what happens next.</p>' +
        '<div class="table-scroll"><table class="archive-table"><thead><tr><th>Status</th><th>Browse tree &amp; archive</th><th>Deceased people’s details</th><th>Living people’s details</th><th>Notes, documents &amp; Photos tab</th><th>Suggest corrections</th><th>Edit records</th></tr></thead><tbody>' +
        rowA('guest', 'Not signed in', '<td>yes</td><td>yes</td>' + no + no + no + no) + rowA('pending', 'Pending', '<td>yes</td><td>yes</td>' + no + no + no + no) + rowA('denied', 'Denied', '<td>yes</td><td>yes</td>' + no + no + no + no) +
        rowA('approved', 'Approved', '<td>yes</td><td>yes</td><td>yes</td><td>yes</td><td>yes</td>' + no) + rowA('admin', 'Admin', '<td>yes</td><td>yes</td><td>yes</td><td>yes</td><td class="muted-cell">edits directly instead</td><td>yes</td>') + '</tbody></table></div>' +
        '<div class="tip-note"><b>Note</b> — for people who have died, the name, parents, spouse and their birth, marriage, death and burial dates, places and maps are visible to everyone, signed in or not. <i>Living</i> people are different: they appear as “Living relative”, and their record is visible to approved members only. Notes, DNA and USA flags, the <i>document scans</i> (newspaper clippings, photos, research notes and other records) and the Photos tab are also for approved members only.</div>') +
      sec('getting-started', '02', 'Getting started', steps([
        ['Register on the Login / Register page', 'Press “Create account” and give your name, email, a password of at least 8 characters, and — optionally — a line on how you connect to the family. That note is what the admin sees when deciding whether to approve you.'],
        ['Wait for review', 'New accounts start as Pending. You can still browse the tree while you wait — you just won’t see document scans or be able to send corrections until an admin approves you.'],
        ['Sign in', 'On later visits, press “Log in” on the same Login / Register page. Your status is shown on My Account once you’re signed in.'],
        ['Change your password any time', 'From My Account, enter your current password and a new one (8 characters minimum). There is no self-service “forgot password” — if you’re locked out, ask an admin.']]) +
        '<div class="tip-note"><b>First account on a fresh install</b> — the first person to register with the administrator setup code becomes an admin, so the archive always has someone able to approve everyone else. Every other registration starts pending.</div>') +
      sec('getting-around', '03', 'Finding your way around', dl([
        ['Overview', 'The homepage — an introduction to the archive, the root of the tree and the first generation, with the record and people counts so far.'],
        ['Family Tree', 'A visual chart centred on one person: their parents above, themselves and their spouses in the middle, their children below. Click any name to re-centre the tree there; click the highlighted box to open that person’s record.'],
        ['Archive', 'A searchable table of everyone in the archive — name (surname first), birth, parents, how many of the vital events (birth, marriage, death, burial) are on file, and document count. Click any column heading to sort by it; click it again to reverse the order.'],
        ['Photos <span class="muted">(approved members)</span>', 'Every photograph in the archive in one grid — see <a href="#photos" class="linklike">The photo collection</a> below.'],
        ['Login / Register', 'Register, log in, log out, change your password, and see your current approval status. Once you’re signed in this tab is labelled “My Account”.'],
        ['Help', 'This manual.'],
        ['Admin <span class="muted">(admins only)</span>', 'Approve or deny access requests, handle corrections, edit people and file documents and photographs.']])) +
      sec('reading-a-record', '04', 'Reading a person’s record',
        '<p>Every name in the tree or the Archive table links to a record page, built from the same sections top to bottom:</p>' + dl([
          ['Vital records', 'Name, father, mother (each links to their own page when known), plus birth, death and burial — each with place, date and a small map when the place can be found. “Lived at” is the place noted on the original family tree.'],
          ['Marriages', 'Every marriage on file for this person — spouse, place and date, with the children of that union listed beneath it. Witnesses are shown to approved members.'],
          ['Document sections', 'Newspaper Articles, Photos, Research Notes, Other Records — four groups of catalogued material. Entries open the scan in a new tab.'],
          ['Children', 'Everyone linked to this person as a parent, with the same birth / events / documents summary as the Archive table. Brothers and sisters are listed beneath it.']]) +
        '<p>If you haven’t been approved yet, the document sections are replaced with a lock notice — the vital records table above it is still fully visible. For a living person the whole page is replaced with a notice that the record is for approved members only; the tree and archive show them as “Living relative”.</p>') +
      sec('photos', '05', 'The photo collection',
        '<p>The Photos tab, visible to approved members, gathers every photograph in the archive into one grid of thumbnails.</p>' + dl([
          ['Filter by person', 'Type part of a name to show only that person’s photos.'],
          ['Open a photo', 'Click a thumbnail to open it full screen, with the photo’s details and the person’s details (parents, birth, death, burial) beside it, and a link to their full record. Click the photo itself to open it full size in a new tab.'],
          ['Move between photos', 'Previous / Next, or the left and right arrow keys. “Back to photos”, Esc, or the browser’s back button return to the grid.']])) +
      sec('maps', '06', 'Places, dates &amp; the map',
        '<p>Births, marriages, deaths, burials and “Lived at” places are typed in as plain text — a townland, parish or town, with the county or country if you can. Your browser looks the place up on OpenStreetMap and shows a small map under it; “View larger map” opens the full map. If a place can’t be found, no map is shown.</p>' +
        '<p>Dates are free text on purpose — write <code>19 Aug 1882</code>, <code>c.1890</code>, or whatever precision the record actually supports.</p>') +
      sec('contributing', '07', 'Contributing as a member',
        '<p>Approved members can see everything, and can tell the administrator about anything that looks wrong or missing.</p>' + dl([
          ['Suggest an edit', 'On a person’s page, “Suggest an edit” opens a short form — say what should change and, if you can, where the information comes from. It goes to the admin’s review list.'],
          ['What happens next', 'An admin reads it, makes the change if it holds up, and marks it done or dismisses it. Members can’t change or delete records themselves.']])) +
      sec('administering', '08', 'Administering the archive',
        '<p>Admins see an “Edit” link on records instead of “Suggest an edit”, plus the Admin tab.</p>' + dl([
          ['Access requests', 'Pending requests are listed with the note on how the person connects to the family. Approve or Deny with one click; approved members can also be made admins.'],
          ['Suggested corrections', 'Every correction members have sent, newest first, with a link to the record. “Mark done” once you have dealt with it, or “Dismiss”.'],
          ['People', 'Edit or add a person: names, dates, birth / death / burial / lived-at places, first marriage, father, mother, notes, DNA and USA flags. Each place shows on a map on the person page.'],
          ['Privacy', 'Each person’s visibility can be left on Automatic (people born in 1920 or later with no death date are hidden as living), always hidden, or always shown.'],
          ['Documents &amp; photos', 'File a scan (JPEG, PNG, WebP, GIF, PDF or text, up to 3 MB) under Newspaper, Photo, Research or Other and link it to a person. Delete an entry from the list below the form.']])) +
      sec('faq', '09', 'Questions &amp; troubleshooting',
        qa('I registered but can’t see any documents.', 'New accounts start as Pending. Browsing the tree, names and dates works right away; document scans unlock once an admin approves you.') +
        qa('Why does someone show as “Living relative” with no details?', 'Living family members’ details are visible to approved members only, to protect their privacy. If they have in fact died, ask an admin to change their visibility.') +
        qa('Where’s the Photos tab?', 'It appears in the menu once you’re signed in as an approved member.') +
        qa('I forgot my password.', 'There’s no self-service reset. Ask an admin for help.') +
        qa('Why can I see someone’s birth date but not their newspaper clipping?', 'By design: the tree and the vital facts of people who have died are public so anyone can browse the family’s shape; the scanned material behind those facts is reserved for approved members.') +
        qa('Why is the very first account an admin?', 'So a brand-new archive always has someone who can approve everyone else. It only applies to the first registration made with the setup code.') +
        qa('Some names look incomplete.', 'Where the original tree showed only a first name, the surname has been taken from the father, and a few people are still listed by first name only. If you can fill a gap, use Suggest an edit.'));
  }

  /* ---------- family tree preview and PDF ---------- */
  function treePreview() {
    var wrap = $('.tree-wrap'), tm = /^\/tree\/(\d+)$/.exec(path());
    if (!wrap || !tm) return;
    var p = S.by.get(+tm[1]), svg = wrap.querySelector('svg').cloneNode(true);
    svg.removeAttribute('style'); svg.setAttribute('width', '100%');
    var ov = document.createElement('div'); ov.className = 'tree-preview'; ov.dataset.name = dn(p);
    ov.innerHTML = '<div class="tp-bar"><span class="tp-hint">Preview \u2014 this is how the page will print.</span><span><button class="btn small" data-act="tp-print" type="button">Save as PDF</button> <button class="btn small ghost" data-act="tp-close" type="button">Close</button></span></div>' +
      '<div class="tp-page"><div class="tp-head"><div class="tp-eyebrow">The Cuffe Record</div><h2>Family tree: ' + esc(dn(p)) + '</h2><div class="tp-sub">' + esc(yearsLabel(p)) + '</div></div><div class="tp-svg"></div>' +
      '<div class="tp-foot">The Cuffe Record \u00b7 printed ' + esc(new Date().toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' })) + '</div></div>';
    ov.querySelector('.tp-svg').appendChild(svg);
    document.body.appendChild(ov); document.body.classList.add('tp-open');
  }
  function closePreview() { var o = $('.tree-preview'); if (o) o.remove(); document.body.classList.remove('tp-open'); }
  function printPreview() {
    var o = $('.tree-preview'), old = document.title;
    document.title = 'Cuffe family tree - ' + (o ? o.dataset.name : '');
    var back = function () { document.title = old; window.removeEventListener('afterprint', back); };
    window.addEventListener('afterprint', back);
    window.print();
  }

  /* ---------- event / marriage edit pages (location picker with a map) ---------- */
  var MP = { map: null, marker: null };
  function pickerHtml(loc, lat, lng, date, label) {
    return '<div class="field"><label for="mp-loc">Location</label><input id="mp-loc" name="location" type="text" maxlength="120" value="' + esc(loc || '') + '" placeholder="e.g. Clonruff, Ballymoe, Co. Galway, Ireland"></div>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><button type="button" class="btn ghost small" data-act="mp-search">Search this location</button><span id="mp-status" style="font-family:var(--mono);font-size:10.5px;color:var(--ink-soft)">Click the map to drop a pin.</span></div>' +
      '<div id="mp-map" class="map-picker"></div>' +
      '<div style="display:flex;gap:10px"><div class="field" style="flex:1"><label for="mp-lat">Latitude</label><input id="mp-lat" name="lat" type="text" readonly value="' + (lat != null ? lat : '') + '" placeholder="53.7000"></div>' +
      '<div class="field" style="flex:1"><label for="mp-lng">Longitude</label><input id="mp-lng" name="lng" type="text" readonly value="' + (lng != null ? lng : '') + '" placeholder="-8.4000"></div></div>' +
      '<div class="field"><label for="mp-date">Date</label><input id="mp-date" name="date" type="text" maxlength="60" value="' + esc(date || '') + '" placeholder="e.g. 19 Aug 1882, or c.1890"></div>';
  }
  function pageEventEdit(id, key) {
    var p = S.by.get(id);
    var f = { birth: ['Birth', p.bplace, p.blat, p.blng, p.born], death: ['Death', p.dplace, p.dlat, p.dlng, p.died], burial: ['Burial', p.burial, p.klat, p.klng, p.kdate] }[key];
    return '<div class="page-title"><h2>' + f[0] + ' record</h2><span class="meta">' + esc(dn(p)) + '</span></div>' +
      '<form data-form="evpage" data-id="' + id + '" data-type="' + key + '" style="max-width:480px">' + pickerHtml(f[1], f[2], f[3], f[4]) +
      '<div class="modal-actions" style="justify-content:flex-start"><button class="btn" type="submit">Save</button></div><div class="status-line err" id="ep-msg" role="alert"></div></form>';
  }
  function pageMarriageEdit(id, sp) {
    var p = S.by.get(id), cur = sp ? ((p.marr || []).filter(function (x) { return x.sp === sp; })[0] || { sp: sp }) : {};
    var opts = '<option value="">Choose a spouse\u2026</option>' + S.doc.people.filter(function (x) { return x.id !== id; }).sort(function (x, y) { return dn(x).localeCompare(dn(y)); }).map(function (x) { return '<option value="' + x.id + '"' + (x.id === sp ? ' selected' : '') + '>' + esc(dn(x)) + ' (' + x.id + ')</option>'; }).join('');
    return '<div class="page-title"><h2>' + (sp ? 'Edit marriage' : 'Add marriage') + '</h2><span class="meta">' + esc(dn(p)) + '</span></div>' +
      '<form data-form="marrpage" data-id="' + id + '" style="max-width:480px"><div class="field"><label for="mg-sp">Spouse</label><select id="mg-sp" name="sp"' + (sp ? ' disabled' : '') + '>' + opts + '</select></div>' +
      pickerHtml(cur.place, cur.lat, cur.lng, cur.date) + '<div class="field"><label for="mg-wit">Witnesses</label><input id="mg-wit" name="wit" type="text" maxlength="200" value="' + esc(cur.wit || '') + '"></div>' +
      '<div class="modal-actions" style="justify-content:flex-start"><button class="btn" type="submit">Save</button></div><div class="status-line err" id="ep-msg" role="alert"></div></form>' +
      (sp ? '<div class="doc-section"><h4>Danger zone</h4><p class="empty-note" style="padding:0 0 10px">Deleting this marriage removes it, and the spouse link, from both people. Children keep their father and mother.</p><button class="btn danger small" data-act="marr-del" data-id="' + id + '" data-sp="' + sp + '" type="button">Delete this marriage</button></div>' : '');
  }
  function mpStatus(t) { var e = $('#mp-status'); if (e) e.textContent = t; }
  function mpPin(la, ln, fillIfEmpty) {
    $('#mp-lat').value = la.toFixed(6); $('#mp-lng').value = ln.toFixed(6);
    if (MP.map) { if (MP.marker) MP.map.removeLayer(MP.marker); MP.marker = L.marker([la, ln]).addTo(MP.map); MP.map.setView([la, ln], Math.max(MP.map.getZoom(), 12)); }
    mpStatus('Looking up place name\u2026');
    return fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' + la + '&lon=' + ln).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.display_name) { mpStatus('Pinned: ' + d.display_name.slice(0, 70)); if (fillIfEmpty && !$('#mp-loc').value.trim()) $('#mp-loc').value = d.display_name; }
      else mpStatus('Pinned. Could not resolve a place name for that spot.');
    }).catch(function () { mpStatus('Pinned.'); });
  }
  function mpSearch() {
    var q = $('#mp-loc').value.trim();
    if (!q) { mpStatus('Enter a location first.'); return Promise.resolve(); }
    mpStatus('Searching\u2026');
    return geocode(q).then(function (g) {
      if (g) return mpPin(g.lat, g.lon, false).then(function () { mpStatus('Found \u2014 click elsewhere on the map to adjust the pin.'); });
      mpStatus('No match found \u2014 click the map to drop a pin manually.');
    });
  }
  function afterPicker() {
    MP = { map: null, marker: null };
    var start = function () {
      var el = $('#mp-map'); if (!el || !window.L) { mpStatus('Map library failed to load \u2014 check your internet connection.'); return; }
      var la = parseFloat($('#mp-lat').value), ln = parseFloat($('#mp-lng').value), has = isFinite(la) && isFinite(ln);
      var map = L.map(el).setView(has ? [la, ln] : [53.6, -8.3], has ? 13 : 7);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
      if (has) MP.marker = L.marker([la, ln]).addTo(map);
      map.on('click', function (e) { mpPin(e.latlng.lat, e.latlng.lng, true); });
      MP.map = map; setTimeout(function () { map.invalidateSize(); }, 80);
      if (!has && $('#mp-loc').value.trim()) mpSearch();
    };
    if (window.L) return start();
    if (!document.getElementById('leaflet-css')) { var l = document.createElement('link'); l.id = 'leaflet-css'; l.rel = 'stylesheet'; l.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(l); }
    var sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'; sc.onload = start; sc.onerror = start; document.head.appendChild(sc);
  }

  /* ---------- admin ---------- */
  function pageAdmin() {
    if (!S.viewer.admin) return '<div class="page-title"><h2>Admin</h2></div>' + locked('This page is for administrators.');
    var people = S.doc.people.slice().sort(function (a, b) { return nm(a).localeCompare(nm(b)) || a.id - b.id; });
    var opts = '<option value="">New person</option>' + people.map(function (p) { return '<option value="' + p.id + '">' + esc(nm(p)) + ' (' + p.id + ', ' + esc(yrs(p)) + ')</option>'; }).join('');
    var popts = '<option value="">Not linked to a person</option>' + people.map(function (p) { return '<option value="' + p.id + '">' + esc(nm(p)) + ' (' + p.id + ')</option>'; }).join('');
    return '<div class="page-title"><h2>Admin</h2><span class="meta" id="amsg"></span></div><p class="lede">Approve members, handle corrections, edit records and file documents and photographs.</p>' +
      '<section class="admin-section"><h3>Access requests</h3><div id="a-users"><p class="empty-note">Loading…</p></div></section>' +
      '<section class="admin-section"><h3>Suggested corrections</h3><div id="a-sugg"><p class="empty-note">Loading…</p></div></section>' +
      '<section class="admin-section"><h3>Edit or add a person</h3><form class="admin-form" data-form="person"><div class="field"><label for="ap-pick">Person</label><select id="ap-pick">' + opts + '</select></div>' +
      '<div class="field-row"><div class="field"><label for="ap-first">First name</label><input id="ap-first" name="first"></div><div class="field"><label for="ap-sur">Surname</label><input id="ap-sur" name="sur"></div></div>' +
      '<div class="field-row"><div class="field"><label for="ap-born">Born</label><input id="ap-born" name="born"></div><div class="field"><label for="ap-died">Died</label><input id="ap-died" name="died"></div></div>' +
      '<div class="field-row"><div class="field"><label for="ap-bplace">Birth place</label><input id="ap-bplace" name="bplace" placeholder="e.g. Clonruff, Ballymoe"></div><div class="field"><label for="ap-dplace">Death place</label><input id="ap-dplace" name="dplace" placeholder="e.g. Ballymuray"></div></div>' +
      '<div class="field-row"><div class="field"><label for="ap-burial">Burial place</label><input id="ap-burial" name="burial" placeholder="e.g. Ballymoe Cemetery"></div><div class="field"><label for="ap-place">Lived at (from the original tree)</label><input id="ap-place" name="place"></div></div>' +
      '<p class="vt-sub" style="margin:-4px 0 12px">Type a townland, parish or town, with the county or country if you can. Each place shows on a map on the person page.</p>' +
      '<div class="field-row"><div class="field"><label for="ap-mdate">Marriage date (to first spouse)</label><input id="ap-mdate" name="mdate"></div><div class="field"><label for="ap-mplace">Marriage place</label><input id="ap-mplace" name="mplace"></div></div>' +
      '<div class="field-row"><div class="field"><label for="ap-fa">Father record number</label><input id="ap-fa" name="fa" inputmode="numeric" placeholder="e.g. 18"></div><div class="field"><label for="ap-mo">Mother record number</label><input id="ap-mo" name="mo" inputmode="numeric" placeholder="e.g. 17"></div></div>' +
      '<div class="field"><label for="ap-notes">Notes</label><textarea id="ap-notes" name="notes" maxlength="1000"></textarea></div>' +
      '<div class="field-row"><div class="field check"><label><input type="checkbox" name="dna"> DNA tested and matched</label></div><div class="field check"><label><input type="checkbox" name="usa"> Lived in the USA</label></div></div>' +
      '<div class="field"><label for="ap-priv">Visibility to the public</label><select id="ap-priv" name="privacy"><option value="auto">Automatic (hide likely living people)</option><option value="private">Always hide as a living relative</option><option value="public">Always show</option></select></div>' +
      '<div class="field-row" id="ap-new"><div class="field"><label for="ap-sp">Spouse record numbers (new person)</label><input id="ap-sp" name="sp" placeholder="e.g. 52"></div></div>' +
      '<button class="btn small" type="submit">Save person</button><div class="status-line" id="ap-msg" role="status"></div></form></section>' +
      '<section class="admin-section"><h3>Add to the archive</h3><form class="admin-form" data-form="upload"><div class="field"><label for="up-file">File (JPG, PNG, WebP, GIF, PDF or text, up to 3 MB)</label><input id="up-file" name="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain" required></div>' +
      '<div class="field"><label for="up-title">Title</label><input id="up-title" name="title" maxlength="120"></div>' +
      '<div class="field-row"><div class="field"><label for="up-kind">Kind</label><select id="up-kind" name="kind"><option value="photo">Photo</option><option value="newspaper">Newspaper article</option><option value="research">Research note</option><option value="other">Other record</option></select></div>' +
      '<div class="field"><label for="up-person">Belongs to</label><select id="up-person" name="personId">' + popts + '</select></div></div>' +
      '<div class="field"><label for="up-cap">Caption or note</label><input id="up-cap" name="caption" maxlength="400"></div><button class="btn small" type="submit">Upload</button><div class="status-line" id="up-msg" role="status"></div></form>' +
      '<div id="a-items" style="margin-top:22px"></div></section>';
  }

  function adminMsg(text, err) { var m = $('#amsg'); if (m) { m.textContent = text; m.style.color = err ? 'var(--rust)' : 'var(--green)'; } }

  function loadAdmin() {
    Promise.all([api('admin/users'), api('admin/suggestions')]).then(function (r) {
      S.admin.users = r[0].users; S.admin.suggestions = r[1].items; drawAdmin();
    }).catch(function (e) { adminMsg(e.message, true); });
  }
  function drawAdmin() {
    var u = $('#a-users'); if (!u) return;
    u.innerHTML = S.admin.users.map(function (x) {
      var acts = [];
      if (x.status !== 'approved') acts.push('<button class="btn small" data-act="user" data-id="' + x.id + '" data-do="approve" type="button">Approve</button>');
      if (x.status !== 'denied' && x.role !== 'admin') acts.push('<button class="btn small ghost" data-act="user" data-id="' + x.id + '" data-do="deny" type="button">Deny</button>');
      if (x.role !== 'admin' && x.status === 'approved') acts.push('<button class="btn small ghost" data-act="user" data-id="' + x.id + '" data-do="makeAdmin" type="button">Make admin</button>');
      if (x.role === 'admin' && x.id !== S.viewer.user.id) acts.push('<button class="btn small ghost" data-act="user" data-id="' + x.id + '" data-do="removeAdmin" type="button">Remove admin</button>');
      return '<div class="admin-row"><div><div class="who">' + esc(x.name) + ' <span class="status-badge ' + (x.role === 'admin' ? 'admin' : x.status) + '">' + (x.role === 'admin' ? 'admin' : x.status) + '</span></div><div class="req-meta">' + esc(x.email) + ' · ' + esc(x.createdAt.slice(0, 10)) + '</div>' + (x.note ? '<div class="msg">' + esc(x.note) + '</div>' : '') + '</div><div class="admin-actions">' + acts.join('') + '</div></div>';
    }).join('') || '<p class="empty-note">No accounts yet.</p>';
    var open = S.admin.suggestions.filter(function (s) { return s.status === 'open'; });
    $('#a-sugg').innerHTML = open.map(function (s) {
      var p = S.by.get(s.personId);
      return '<div class="admin-row"><div><div class="who">' + (p ? '<a href="/person/' + p.id + '">' + esc(nm(p)) + '</a>' : 'Record ' + s.personId) + '</div><div class="req-meta">from ' + esc(s.userName) + ' · ' + esc(s.createdAt.slice(0, 10)) + '</div><div class="msg">' + esc(s.text) + '</div></div><div class="admin-actions"><button class="btn small" data-act="sugg" data-id="' + s.id + '" data-do="done" type="button">Mark done</button><button class="btn small ghost" data-act="sugg" data-id="' + s.id + '" data-do="dismissed" type="button">Dismiss</button></div></div>';
    }).join('') || '<p class="empty-note">No open corrections.</p>';
    var it = S.arch.items.slice().reverse();
    $('#a-items').innerHTML = '<h3 style="font-family:var(--display);font-size:20px;margin:0 0 8px">Filed items · ' + it.length + '</h3>' + (it.map(function (i) {
      var p = i.personId != null ? S.by.get(i.personId) : null;
      return '<div class="admin-row"><div><div class="who"><a href="/api/file/' + i.id + '" target="_blank" rel="noopener">' + esc(i.title) + '</a></div><div class="req-meta">' + esc(KIND_LABEL[i.kind] || i.kind) + (p ? ' · ' + esc(nm(p)) : '') + ' · ' + Math.round(i.size / 1024) + ' KB</div></div><div class="admin-actions"><button class="btn small danger" data-act="del-ask" data-id="' + i.id + '" type="button">Delete</button></div></div>';
    }).join('') || '<p class="empty-note">Nothing filed yet.</p>');
  }
  function afterAdmin() {
    if (!S.viewer.admin) return;
    loadAdmin();
    var m = /[?&]edit=(\d+)/.exec(location.search);
    if (m) { var sel = $('#ap-pick'); sel.value = m[1]; fillPerson(+m[1]); }
  }
  function fillPerson(id) {
    var f = $('form[data-form="person"]'), p = S.by.get(id);
    ['first', 'sur', 'born', 'died', 'bplace', 'dplace', 'place', 'burial', 'notes'].forEach(function (k) { f.elements[k].value = p ? (p[k] || '') : ''; });
    var m0 = p && p.marr && p.marr.filter(function (m) { return m.sp === (p.sp || [])[0]; })[0];
    f.elements.mdate.value = (m0 && m0.date) || ''; f.elements.mplace.value = (m0 && m0.place) || '';
    f.elements.fa.value = (p && p.fa) || ''; f.elements.mo.value = (p && p.mo) || '';
    f.elements.dna.checked = !!(p && p.dna); f.elements.usa.checked = !!(p && p.usa);
    f.elements.privacy.value = p && p.privacy ? p.privacy : 'auto';
    $('#ap-new').hidden = !!p;
  }

  /* ---------- modal ---------- */
  function modal(html) {
    var b = document.createElement('div'); b.className = 'modal-backdrop'; b.innerHTML = '<div class="modal wide" role="dialog" aria-modal="true">' + '<button class="close-x" data-act="close" type="button" aria-label="Close">×</button>' + html + '</div>';
    document.body.appendChild(b);
    var f = b.querySelector('textarea,input'); if (f) f.focus();
    return b;
  }
  function closeModal() { var b = $('.modal-backdrop'); if (b) b.remove(); }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (a && !e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0 && !a.target) {
      var h = a.getAttribute('href');
      if (h && h.charAt(0) === '/' && h.indexOf('/api/') !== 0 && h.indexOf('//') !== 0) { e.preventDefault(); go(h); return; }
    }
    var n = e.target.closest('[data-go]');
    if (n) { go(n.dataset.go); return; }
    var s = e.target.closest('[data-sort]');
    if (s) { var k = s.dataset.sort; if (S.sort.key === k) S.sort.dir = -S.sort.dir; else { S.sort.key = k; S.sort.dir = 1; } render(); return; }
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.dataset.act;
    if (act === 'logout') { api('logout', { method: 'POST', body: {} }).then(refresh).then(function () { go('/'); }); }
    else if (act === 'close') closeModal();
    else if (act === 'suggest') {
      var pid = +b.dataset.id, p = S.by.get(pid);
      var m = modal('<h3>Suggest a correction</h3><div class="sub">' + esc(nm(p)) + '</div><form data-form="suggest" data-id="' + pid + '"><div class="field"><label for="sg-text">What should change?</label><textarea id="sg-text" name="text" maxlength="1000" required placeholder="For example: born 14 March 1891, not 1892. Source: parish register.">' + (b.dataset.ctx ? esc(b.dataset.ctx) + ': ' : '') + '</textarea></div><div class="status-line err" id="sg-msg" role="alert"></div><div class="modal-actions"><button class="btn small ghost" data-act="close" type="button">Cancel</button><button class="btn small" type="submit">Send</button></div></form>');
    }
    else if (act === 'mp-search') mpSearch();
    else if (act === 'tree-preview') treePreview();
    else if (act === 'tp-close') closePreview();
    else if (act === 'tp-print') printPreview();
    else if (act === 'marr-del') {
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Confirm delete'; return; }
      api('admin/person/' + b.dataset.id + '/marriage', { method: 'POST', body: { sp: +b.dataset.sp, remove: true } }).then(function () { return refresh(false); }).then(function () { go('/person/' + b.dataset.id); }).catch(function (er) { setMsg('ep-msg', er.message, true); });
    }
    else if (act === 'doc-add') {
      var dk = BUCKETS.filter(function (x) { return x[0] === b.dataset.kind; })[0];
      modal('<h3>Add to ' + dk[1].replace(' (Scanned)', '') + '</h3><div class="sub">' + esc(dn(S.by.get(+b.dataset.id))) + '</div><form data-form="upload"><input type="hidden" name="kind" value="' + dk[0] + '"><input type="hidden" name="personId" value="' + b.dataset.id + '">' +
        '<div class="field"><label for="up-file">File (JPG, PNG, WebP, GIF, PDF or text, up to 3 MB)</label><input id="up-file" name="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain" required></div><div class="field"><label for="up-title">Title</label><input id="up-title" name="title" maxlength="120"></div>' +
        '<div class="status-line err" id="up-msg" role="alert"></div><div class="modal-actions"><button class="btn small ghost" data-act="close" type="button">Cancel</button><button class="btn small" type="submit">Upload</button></div></form>');
    }
    else if (act === 'child-add') {
      var cp = S.by.get(+b.dataset.id), role = b.dataset.role;
      var cs = cp.sp.map(function (i) { return S.by.get(i); }).filter(Boolean);
      var copts = '<option value="">Not recorded</option>' + cs.map(function (x) { return '<option value="' + x.id + '"' + (cs.length === 1 ? ' selected' : '') + '>' + esc(dn(x)) + '</option>'; }).join('');
      modal('<h3>Add child (as ' + (role === 'fa' ? 'father' : 'mother') + ')</h3><div class="sub">' + esc(dn(cp)) + '</div><form data-form="child" data-id="' + cp.id + '" data-role="' + role + '"><div class="field-row"><div class="field"><label for="ch-first">First name</label><input id="ch-first" name="first" maxlength="80" required></div><div class="field"><label for="ch-sur">Surname</label><input id="ch-sur" name="sur" maxlength="80" value="' + esc(cp.sur || '') + '"></div></div>' +
        '<div class="field"><label for="ch-born">Born</label><input id="ch-born" name="born" maxlength="60"></div><div class="field"><label for="ch-other">' + (role === 'fa' ? 'Mother' : 'Father') + '</label><select id="ch-other" name="other">' + copts + '</select></div>' +
        '<div class="status-line err" id="ch-msg" role="alert"></div><div class="modal-actions"><button class="btn small ghost" data-act="close" type="button">Cancel</button><button class="btn small" type="submit">Add child</button></div></form>');
    }
    else if (act === 'user') {
      api('admin/users/' + b.dataset.id, { method: 'POST', body: { action: b.dataset.do } }).then(function () { adminMsg('Saved.'); loadAdmin(); return refresh(false); }).catch(function (er) { adminMsg(er.message, true); });
    }
    else if (act === 'sugg') {
      api('admin/suggestions/' + b.dataset.id, { method: 'POST', body: { status: b.dataset.do } }).then(function () { adminMsg('Saved.'); loadAdmin(); }).catch(function (er) { adminMsg(er.message, true); });
    }
    else if (act === 'del-ask') { b.dataset.act = 'del'; b.textContent = 'Confirm delete'; }
    else if (act === 'del') {
      api('archive/' + b.dataset.id, { method: 'DELETE' }).then(function () { return refresh(false); }).then(function () { adminMsg('Deleted.'); drawAdmin(); }).catch(function (er) { adminMsg(er.message, true); });
    }
  });

  document.addEventListener('input', function (e) {
    if (e.target.id === 'aq') { S.q = e.target.value; fillArchive(); }
    else if (e.target.id === 'pq') { S.pq = e.target.value; fillPhotos(); }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'af') { S.filter = e.target.value; fillArchive(); }
    else if (e.target.id === 'ap-pick') fillPerson(e.target.value ? +e.target.value : null);
  });

  function setMsg(id, text, err) { var m = document.getElementById(id); if (m) { m.textContent = text; m.className = 'status-line' + (err ? ' err' : ''); } }

  document.addEventListener('submit', function (e) {
    var f = e.target.closest('form[data-form]'); if (!f) return;
    e.preventDefault();
    var kind = f.dataset.form, v = function (n) { return f.elements[n] ? f.elements[n].value : ''; };
    var btn = f.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
    var done = function () { if (btn) btn.disabled = false; };
    if (kind === 'login') {
      api('login', { method: 'POST', body: { email: v('email'), password: v('password') } }).then(function () { return refresh(); }).then(function () { go('/'); }).catch(function (er) { setMsg('li-msg', er.message, true); done(); });
    } else if (kind === 'register') {
      api('register', { method: 'POST', body: { name: v('name'), email: v('email'), password: v('password'), note: v('note'), setupCode: v('setupCode') } }).then(function () { return refresh(); }).then(function () { go('/membership'); }).catch(function (er) { setMsg('rg-msg', er.message, true); done(); });
    } else if (kind === 'password') {
      api('password', { method: 'POST', body: { current: v('current'), next: v('next') } }).then(function () { f.reset(); setMsg('pw-msg', 'Password changed.'); done(); }).catch(function (er) { setMsg('pw-msg', er.message, true); done(); });
    } else if (kind === 'suggest') {
      api('suggest', { method: 'POST', body: { personId: +f.dataset.id, text: v('text') } }).then(function () { closeModal(); }).catch(function (er) { setMsg('sg-msg', er.message, true); done(); });
    } else if (kind === 'evpage') {
      api('admin/person/' + f.dataset.id + '/event', { method: 'POST', body: { type: f.dataset.type, place: v('location'), date: v('date'), lat: v('lat'), lng: v('lng') } }).then(function () { return refresh(false); }).then(function () { go('/person/' + f.dataset.id); }).catch(function (er) { setMsg('ep-msg', er.message, true); done(); });
    } else if (kind === 'marrpage') {
      api('admin/person/' + f.dataset.id + '/marriage', { method: 'POST', body: { sp: +v('sp'), place: v('location'), date: v('date'), wit: v('wit'), lat: v('lat'), lng: v('lng') } }).then(function () { return refresh(false); }).then(function () { go('/person/' + f.dataset.id); }).catch(function (er) { setMsg('ep-msg', er.message, true); done(); });
    } else if (kind === 'child') {
      var fa = f.dataset.role === 'fa' ? f.dataset.id : v('other'), mo = f.dataset.role === 'mo' ? f.dataset.id : v('other');
      api('admin/person', { method: 'POST', body: { first: v('first'), sur: v('sur'), born: v('born'), fa: fa, mo: mo } }).then(function () { closeModal(); return refresh(); }).catch(function (er) { setMsg('ch-msg', er.message, true); done(); });
    } else if (kind === 'person') {
      var id = $('#ap-pick').value;
      var body = { first: v('first'), sur: v('sur'), born: v('born'), died: v('died'), bplace: v('bplace'), dplace: v('dplace'), place: v('place'), burial: v('burial'), mdate: v('mdate'), mplace: v('mplace'), fa: v('fa'), mo: v('mo'), notes: v('notes'), dna: f.elements.dna.checked, usa: f.elements.usa.checked, privacy: v('privacy'), sp: v('sp') };
      api('admin/person' + (id ? '/' + id : ''), { method: 'POST', body: body }).then(function (r) { return refresh(false).then(function () { setMsg('ap-msg', 'Saved record ' + r.id + '.'); $('#ap-pick').innerHTML = pageAdminOptions(); $('#ap-pick').value = String(r.id); fillPerson(r.id); done(); }); }).catch(function (er) { setMsg('ap-msg', er.message, true); done(); });
    } else if (kind === 'upload') {
      var file = f.elements.file.files[0];
      if (!file) { setMsg('up-msg', 'Choose a file first.', true); return done(); }
      if (file.size > 3 * 1024 * 1024) { setMsg('up-msg', 'That file is over 3 MB.', true); return done(); }
      var rd = new FileReader();
      rd.onload = function () {
        var data = String(rd.result).split(',')[1] || '';
        api('archive', { method: 'POST', body: { title: v('title'), kind: v('kind'), personId: v('personId'), caption: v('caption'), filename: file.name, contentType: file.type, data: data } })
          .then(function () { return refresh(false); }).then(function () { if ($('.modal-backdrop')) { closeModal(); render(); return; } f.reset(); setMsg('up-msg', 'Filed.'); drawAdmin(); done(); })
          .catch(function (er) { setMsg('up-msg', er.message, true); done(); });
      };
      rd.onerror = function () { setMsg('up-msg', 'Could not read that file.', true); done(); };
      rd.readAsDataURL(file);
    }
  });
  function pageAdminOptions() {
    var people = S.doc.people.slice().sort(function (a, b) { return nm(a).localeCompare(nm(b)) || a.id - b.id; });
    return '<option value="">New person</option>' + people.map(function (p) { return '<option value="' + p.id + '">' + esc(nm(p)) + ' (' + p.id + ', ' + esc(yrs(p)) + ')</option>'; }).join('');
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeModal(); closePreview(); }
    var pv = $('.photo-viewer');
    if (!pv || e.target.closest('input,textarea,select')) return;
    var to = e.key === 'Escape' ? pv.dataset.close : e.key === 'ArrowLeft' ? pv.dataset.prev : e.key === 'ArrowRight' ? pv.dataset.next : '';
    if (to) go(to);
  });
  window.addEventListener('popstate', render);

  /* ---------- boot ---------- */
  function refresh(rerender) {
    return Promise.all([api('me'), api('people'), api('archive')]).then(function (r) {
      S.viewer = { user: r[0].user, approved: r[0].approved, admin: r[0].admin };
      S.doc = r[1]; S.arch = r[2]; index();
      if (rerender !== false) render();
    });
  }
  render();
  refresh().catch(function () { $('#view').innerHTML = '<p class="empty-note">The archive could not be loaded. Please refresh the page.</p>'; });
})();
