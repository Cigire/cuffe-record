'use strict';
(function () {
  /* ---------- state ---------- */
  var S = {
    viewer: { user: null, approved: false, admin: false },
    doc: null, arch: { locked: true, counts: {}, items: [] },
    expanded: new Set(), hit: null, treeQ: '',
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
  function parentCell(id) { var q = id ? S.by.get(id) : null; return q ? '<a href="/person/' + q.id + '">' + esc(dn(q)) + '</a>' : '<span class="vt-empty">unknown</span>'; }
  /* maps: the place name is looked up in the visitor's browser on OpenStreetMap and remembered there */
  function mapBox(place) {
    if (!place || /[;\d]/.test(place) && /born|died/i.test(place)) return '';
    return '<div class="vt-map" data-place="' + esc(place) + '"></div>';
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
    el.innerHTML = '<iframe title="Map of ' + esc(el.dataset.place) + '" loading="lazy" referrerpolicy="no-referrer" src="https://www.openstreetmap.org/export/embed.html?bbox=' + b + '&layer=mapnik&marker=' + g.lat.toFixed(5) + ',' + g.lon.toFixed(5) + '"></iframe>' +
      '<a class="map-link" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=' + g.lat.toFixed(5) + '&mlon=' + g.lon.toFixed(5) + '#map=13/' + g.lat.toFixed(5) + '/' + g.lon.toFixed(5) + '">View larger map \u2192</a>';
  }
  function afterMaps() {
    var els = Array.prototype.slice.call(document.querySelectorAll('.vt-map'));
    var chain = Promise.resolve();
    els.forEach(function (el) {
      chain = chain.then(function () {
        if (!el.isConnected) return null;
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
  var KIND_LABEL = { photo: 'Photos', newspaper: 'Newspaper Articles', research: 'Research Notes', other: 'Other Records' };
  function path() { var p = location.pathname.replace(/\/+$/, ''); return p || '/'; }

  function shell(active) {
    var v = S.viewer, tabs = [['/', 'Overview'], ['/tree', 'Family Tree'], ['/archive', 'Archive'], ['/photos', 'Photos'],
      [v.user ? '/membership' : '/membership', v.user ? 'My Account' : 'Login / Register'], ['/help', 'Help']];
    if (v.admin) tabs.push(['/admin', 'Admin']);
    $('#tabs').innerHTML = tabs.map(function (t) { return '<a href="' + t[0] + '"' + (t[0] === active ? ' class="active"' : '') + '>' + t[1] + '</a>'; }).join('');
    var label = 'Guest', dot = 'guest';
    if (v.user) {
      if (v.admin) { label = 'Admin'; dot = 'approved'; }
      else if (v.approved) { label = 'Approved member'; dot = 'approved'; }
      else if (v.user.status === 'denied') { label = 'Access declined'; dot = 'denied'; }
      else { label = 'Pending approval'; dot = 'pending'; }
    }
    $('#pill').innerHTML = '<span class="dot ' + dot + '"></span> ' + esc(label);
    $('#foot-count').textContent = S.doc ? S.doc.people.length + ' people recorded' : '';
  }

  function activeTab(p) {
    if (p === '/' || p === '') return '/';
    if (p.indexOf('/person/') === 0) return '/archive';
    return p;
  }

  function render() {
    var p = path(), v = $('#view');
    if (!S.doc) { v.innerHTML = '<p class="empty-note">Loading the archive…</p>'; return; }
    shell(activeTab(p));
    var m = /^\/person\/(\d+)$/.exec(p);
    var html;
    if (m) html = pagePerson(+m[1]);
    else if (p === '/tree') html = pageTree();
    else if (p === '/archive') html = pageArchive();
    else if (p === '/photos') html = pagePhotos();
    else if (p === '/membership') html = pageMembership();
    else if (p === '/help') html = pageHelp();
    else if (p === '/admin') html = pageAdmin();
    else html = pageHome();
    v.innerHTML = html;
    document.title = (m && S.by.get(+m[1]) ? nm(S.by.get(+m[1])) + ' · ' : '') + 'The Cuffe Record';
    if (p === '/tree') afterTree();
    if (m) afterMaps();
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
    var v = S.viewer, hid = S.doc.hidden;
    var msg, act = '';
    if (v.approved) return '';
    if (v.user && v.user.status === 'pending') msg = 'Your account is waiting for approval. Document scans and full details open once an admin approves it.';
    else if (v.user) msg = 'Your access request was declined. Please contact the family administrator.';
    else { msg = "You're viewing the public preview. Document scans, notes and living relatives are visible to approved members only."; act = '<a href="/membership">Request access →</a>'; }
    return '<div class="banner"><span>' + msg + (hid ? ' ' + hid + ' living relatives are shown without details.' : '') + '</span>' + act + '</div>';
  }

  function personCard(p) {
    var kids = kidsOf(p.id).length, d = details(p), n = docs(p.id), tags = [];
    if (kids) tags.push(kids + (kids === 1 ? ' child' : ' children'));
    tags.push(d + '/4 details');
    if (p.dna) tags.push('DNA matched');
    if (p.usa) tags.push('Lived in USA');
    var c = S.arch.counts[p.id] || {};
    Object.keys(KIND_LABEL).forEach(function (k) { if (c[k]) tags.push(KIND_LABEL[k] + ' (' + c[k] + ')'); });
    var sub = yrs(p) + (p.id === S.doc.root ? ' · the root of the tree' : '');
    return '<a class="person-card-link" href="/person/' + p.id + '"><div class="person-card"><span class="stamp">' + n + ' docs</span><h3>' + esc(dn(p)) + '</h3><div class="years">' + esc(sub) + '</div><div class="tagrow">' +
      tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') + '</div><span class="open">View record →</span></div></a>';
  }

  function pageHome() {
    var d = S.doc, line = S.gen.size, items = S.arch.items.length;
    var total = Object.keys(S.arch.counts).reduce(function (a, k) { return a + S.arch.counts[k].total; }, 0);
    var first = d.people.filter(function (p) { return S.gen.has(p.id) && S.gen.get(p.id) <= 3 && !(S.gen.get(p.id) === 3 && p.sp.length === 0 && false); })
      .sort(function (a, b) { return (S.gen.get(a.id) - S.gen.get(b.id)) || byBirth(a.id, b.id); });
    return '<div class="home-hero"><div class="eyebrow">Welcome</div><h1>The story of the Cuffe family, kept for those who come next</h1>' +
      '<p class="welcome-copy">This is a family archive for the descendants of the Cuffes of Clonruff, the earliest of whom was born in 1790. Whether you’re tracing a great-grandparent’s townland, looking for a relative’s marriage date, or just curious how you connect to everyone else here, this site is built for you to browse, explore and add to over time.</p>' +
      '<div class="aims-grid">' +
      '<div class="aim"><h4>Record</h4><p>Capture each person’s dates, place and notes, including who witnessed the marriages that can still be traced.</p></div>' +
      '<div class="aim"><h4>Preserve</h4><p>Keep newspaper clippings, photographs and research notes in one place, linked to the person they belong to.</p></div>' +
      '<div class="aim"><h4>Connect</h4><p>Show real father, mother and spouse relationships, so it’s clear exactly how every name fits into the wider family.</p></div>' +
      '<div class="aim"><h4>Share</h4><p>Keep the family tree open for anyone to browse, while document scans and living relatives stay visible to approved family members only.</p></div></div></div>' +
      '<div class="page-title"><h2>The archive so far</h2><span class="meta">' + total + ' records catalogued · ' + d.people.length + ' people · ' + line + ' in the Cuffe line</span></div>' +
      banner() +
      '<div class="card-grid">' + first.map(personCard).join('') + '</div>' +
      '<p style="margin-top:26px"><a class="btn small ghost" href="/archive">See all ' + d.people.length + ' people</a></p>';
  }

  /* ---------- family tree ---------- */
  var NW = 158, NH = 80, GX = 14, GY = 54;
  function layout() {
    function build(id) {
      var ch = S.expanded.has(id) ? kidsOf(id).map(build) : [];
      var w = ch.length ? Math.max(NW, ch.reduce(function (a, c) { return a + c.w; }, 0) + GX * (ch.length - 1)) : NW;
      return { id: id, ch: ch, w: w };
    }
    var root = build(S.doc.root), nodes = [], links = [], maxD = 0;
    (function place(n, left, d) {
      n.x = left + n.w / 2; n.y = 10 + d * (NH + GY); maxD = Math.max(maxD, d); nodes.push(n);
      var used = n.ch.reduce(function (a, c) { return a + c.w; }, 0) + GX * Math.max(0, n.ch.length - 1);
      var cx = left + (n.w - used) / 2;
      n.ch.forEach(function (c) { links.push([n, c]); place(c, cx, d + 1); cx += c.w + GX; });
    })(root, 10, 0);
    return { nodes: nodes, links: links, w: root.w + 20, h: 20 + (maxD + 1) * (NH + GY) };
  }

  function pageTree() {
    return '<div class="page-title"><h2>Family tree</h2><span class="meta">' + S.gen.size + ' people descend from the first Cuffe</span></div>' +
      '<p class="lede">Select a person to open their record. Use the small + beneath a card to show or hide their children.</p>' + banner() +
      '<div class="toolbar"><input type="search" id="tq" placeholder="Find a name or place" aria-label="Find a name or place" value="' + esc(S.treeQ) + '">' +
      '<button class="btn small ghost" data-act="tree-open" type="button">Show everyone</button>' +
      '<button class="btn small ghost" data-act="tree-reset" type="button">Reset view</button><span class="count" id="tcount"></span></div>' +
      '<div id="tmatches" class="kinds"></div><div class="tree-wrap" id="twrap"></div>';
  }

  function drawTree() {
    var L = layout(), out = [];
    L.links.forEach(function (l) {
      var a = l[0], b = l[1], mid = a.y + NH + GY / 2;
      out.push('<path class="tlink" d="M' + a.x + ' ' + (a.y + NH) + 'V' + mid + 'H' + b.x + 'V' + b.y + '"/>');
    });
    L.nodes.forEach(function (n) {
      var p = S.by.get(n.id), has = kidsOf(n.id).length, open = S.expanded.has(n.id), c = dcount(n.id);
      out.push('<g class="tnode' + (n.id === S.doc.root ? ' root' : '') + (S.hit === n.id ? ' hit' : '') + '" data-go="/person/' + n.id + '" data-node="' + n.id + '"><rect x="' + (n.x - NW / 2) + '" y="' + n.y + '" width="' + NW + '" height="' + NH + '" rx="2"/>' +
        '<foreignObject x="' + (n.x - NW / 2) + '" y="' + n.y + '" width="' + NW + '" height="' + NH + '"><div class="tnode-body"><div class="name">' + esc(p.private || p.first ? nm(p) : (p.sur || 'Unnamed')) + '</div><div class="years">' + esc(p.private ? 'Living' : (p.born ? 'b. ' + p.born : (p.died ? 'd. ' + p.died : ''))) + '</div>' +
        (has ? '<div class="gcount">' + c + (c === 1 ? ' descendant' : ' descendants') + '</div>' : '') + '</div></foreignObject></g>');
      if (has) out.push('<g class="ttog" data-tog="' + n.id + '"><title>' + (open ? 'Hide' : 'Show') + ' children</title><circle cx="' + n.x + '" cy="' + (n.y + NH + 11) + '" r="9"/><text x="' + n.x + '" y="' + (n.y + NH + 11) + '">' + (open ? '−' : '+') + '</text></g>');
    });
    var wrap0 = $('#twrap'), keep = wrap0.scrollLeft;
    wrap0.innerHTML = '<svg width="' + L.w + '" height="' + (L.h + 14) + '" viewBox="0 0 ' + L.w + ' ' + (L.h + 14) + '" role="img" aria-label="Family tree of the Cuffe line">' + out.join('') + '</svg>';
    var wrap = $('#twrap');
    if (S.center) { var rn = L.nodes[0]; wrap.scrollLeft = Math.max(0, rn.x - wrap.clientWidth / 2); S.center = false; } else wrap.scrollLeft = keep;
    var shown = L.nodes.length;
    $('#tcount').textContent = shown + ' of ' + S.gen.size + ' shown';
    if (S.hit != null) { var h = $('.tnode.hit'); if (h && h.scrollIntoView) h.scrollIntoView({ block: 'nearest', inline: 'center' }); }
  }

  function afterTree() {
    if (!S.expanded.size) resetTree();
    S.center = true;
    drawTree();
    if (S.treeQ) runTreeSearch(false);
  }
  function resetTree() { S.expanded = new Set([S.doc.root].concat(S.doc.people.filter(function (p) { return S.gen.get(p.id) === 1 || S.gen.get(p.id) === 2; }).map(function (p) { return p.id; }))); S.hit = null; }
  function runTreeSearch(scroll) {
    var q = S.treeQ.trim().toLowerCase(), box = $('#tmatches');
    if (!q) { S.hit = null; box.innerHTML = ''; drawTree(); return; }
    var ms = S.doc.people.filter(function (p) { return !p.private && (nm(p) + ' ' + (p.place || '')).toLowerCase().indexOf(q) >= 0; });
    var first = ms.find(function (p) { return S.gen.has(p.id); });
    S.hit = first ? first.id : null;
    if (first) { var c = lineParent(first); while (c) { S.expanded.add(c.id); c = lineParent(c); } }
    drawTree();
    box.innerHTML = ms.slice(0, 10).map(function (p) { return '<a class="tag" href="/person/' + p.id + '">' + esc(nm(p)) + (S.gen.has(p.id) ? '' : ' (married in)') + '</a>'; }).join('') + (ms.length > 10 ? '<span class="tag">+' + (ms.length - 10) + ' more</span>' : '') + (!ms.length ? '<span class="empty-note">No one matches that.</span>' : '');
  }

  /* ---------- archive (people table) ---------- */
  function pageArchive() {
    return '<div class="page-title"><h2>Browse the archive</h2><span class="meta" id="acount"></span></div>' + banner() +
      '<div class="archive-search field"><label for="aq">Search by name</label><input type="search" id="aq" placeholder="e.g. Bridget, Thomas\u2026" autocomplete="off" value="' + esc(S.q) + '"></div>' +
      '<div class="table-scroll"><table class="archive-table"><thead><tr>' + th('name', 'Name') + th('born', 'Birth') + th('father', 'Father') + th('mother', 'Mother') + th('vital', 'Vital events') + th('docs', 'Documents') + '<th></th></tr></thead><tbody id="abody"></tbody></table></div>';
  }
  function th(k, label) {
    var on = S.sort.key === k;
    return '<th aria-sort="' + (on ? (S.sort.dir > 0 ? 'ascending' : 'descending') : 'none') + '"><button type="button" class="sort-link' + (on ? ' active' : '') + '" data-sort="' + k + '">' + label + ' <span class="sort-arrow">' + (on && S.sort.dir < 0 ? '\u25bc' : '\u25b2') + '</span></button></th>';
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
      return '<tr><td><a class="name" href="/person/' + p.id + '">' + esc(dn(p)) + '</a></td><td class="muted-cell">' + (p.private ? '<em>Living</em>' : esc(p.born) || '\u2014') + '</td><td class="kin">' + parentCell(p.fa) + '</td><td class="kin">' + parentCell(p.mo) + '</td><td class="muted-cell">' + vcount(p) + '/4</td><td class="muted-cell">' + docs(p.id) + '</td><td><a class="view-link" href="/person/' + p.id + '">View record \u2192</a></td></tr>';
    }).join('') || '<tr><td colspan="7" class="empty-note">Nobody matches. Clear the search to see everyone.</td></tr>';
  }

  /* ---------- photos ---------- */
  function locked(text) {
    return '<div class="locked-block"><span class="lock-icon" aria-hidden="true">\u{1F512}</span><p>' + text + '</p>' +
      (S.viewer.user ? '' : '<a class="btn small" href="/membership">Login / Register</a>') + '</div>';
  }
  function pagePhotos() {
    var items = S.arch.items.filter(function (i) { return i.kind === 'photo'; });
    var body;
    if (S.arch.locked) body = locked(S.viewer.user ? 'Photographs open once an admin approves your account.' : 'Photographs are visible to approved family members only.');
    else if (!items.length) body = '<p class="empty-note">No photographs have been added yet.' + (S.viewer.admin ? ' Add them from the <a href="/admin">Admin</a> tab.' : '') + '</p>';
    else body = '<ul class="photo-grid">' + items.map(function (i) {
      var who = i.personId != null && S.by.get(i.personId) ? nm(S.by.get(i.personId)) : '';
      return '<li><a class="photo-thumb" href="/api/file/' + i.id + '" target="_blank" rel="noopener"><img src="/api/file/' + i.id + '" alt="' + esc(i.title) + '" loading="lazy"><span class="cap">' + esc(i.title) + '</span><span class="kind">' + esc(who) + '</span></a></li>';
    }).join('') + '</ul>';
    return '<div class="page-title"><h2>Photos</h2><span class="meta">' + (S.arch.locked ? '' : items.length + ' photographs') + '</span></div><p class="lede">Family photographs, linked to the person they show or belong to.</p>' + body;
  }

  /* ---------- person ---------- */
  function table(list) {
    if (!list.length) return '';
    return '<table class="children-table"><thead><tr><th></th><th>Name</th><th>Birth</th><th>Vital events</th><th>Documents</th><th></th></tr></thead><tbody>' + list.map(function (p, i) {
      return '<tr><td class="idx">' + (i + 1) + '.</td><td><a class="name" href="/person/' + p.id + '">' + esc(dn(p)) + '</a></td><td class="muted-cell">' + (p.private ? '<em>Living</em>' : esc(p.born) || '\u2014') + '</td><td class="muted-cell">' + vcount(p) + '/4</td><td class="muted-cell">' + docs(p.id) + '</td><td><a class="view-link" href="/person/' + p.id + '">View record \u2192</a></td></tr>';
    }).join('') + '</tbody></table>';
  }
  function pagePerson(id) {
    var p = S.by.get(id);
    if (!p) return '<a class="back-link" href="/archive">\u2190 Back to archive</a><p class="empty-note">That person is not in the record.</p>';
    var spouses = p.sp.map(function (i) { return S.by.get(i); }).filter(Boolean);
    var kids = kidsOf(id).map(function (i) { return S.by.get(i); });
    var sibIds = Array.from(new Set([].concat.apply([], p.par.map(kidsOf)))).filter(function (i) { return i !== id; }).sort(byBirth);
    var sibs = sibIds.map(function (i) { return S.by.get(i); });
    var path = [], c = p, g = 0;
    while (c && g++ < 40) { path.unshift(c); c = lineParent(c); }
    var crumb = S.gen.has(id) && path.length > 1 ? path.slice(0, -1).map(plink).join(' \u2192 ') : (S.gen.has(id) ? 'Root of the tree' : 'Married into the family');
    var initial = p.private ? '?' : ((p.first || '').charAt(0) + (p.sur || '').charAt(0)).toUpperCase() || '?';
    var row = function (k, v) { return '<tr><th>' + k + '</th><td>' + v + '</td></tr>'; };
    var empty = '<span class="vt-empty">Not recorded yet</span>';
    var nDocs = docs(id);
    var ev = function (date, place) { if (!date && !place) return empty; return '<div class="vt-event"><div class="vt-detail"><span>' + [date ? esc(date) : '', place ? esc(place) : ''].filter(Boolean).join(' \u00b7 ') + '</span></div>' + (place ? mapBox(place) : '') + '</div>'; };
    var marrs = (p.marr || []).filter(function (m) { return m.date || m.place; });
    var marrHtml = marrs.length ? marrs.map(function (m) {
      var to = m.sp && S.by.get(m.sp) ? ' <span class="vt-sub">to ' + dlink(S.by.get(m.sp)) + '</span>' : '';
      return '<div class="vt-event"><div class="vt-detail"><span>' + [m.place ? esc(m.place) : '', m.date ? esc(m.date) : ''].filter(Boolean).join(' \u00b7 ') + to + '</span></div>' +
        (m.wit && S.viewer.approved ? '<div class="vt-sub">Witnesses: ' + esc(m.wit) + '</div>' : '') + (m.place ? mapBox(m.place) : '') + '</div>';
    }).join('') : empty;
    var vit = row('Name', esc(dn(p))) + row('Father', parentCell(p.fa)) + row('Mother', parentCell(p.mo)) +
      row(spouses.length > 1 ? 'Spouses' : 'Spouse', spouses.length ? spouses.map(dlink).join('<br>') : '<span class="vt-empty">unknown</span>') +
      row('Birth', ev(p.born, p.bplace)) + row('Marriage', marrHtml) +
      row('Death', (p.died || p.dplace) ? ev(p.died, p.dplace) : (p.private ? '<span class="vt-empty">Living</span>' : empty)) +
      row('Burial', p.burial ? ev('', p.burial) : empty);
    if (p.place && !p.private) vit += row('Lived at', '<div class="vt-event"><div class="vt-detail"><span>' + esc(p.place) + '</span></div>' + mapBox(p.place) + '</div>');
    vit += row('Documents', nDocs + ' on file' + (S.arch.locked ? ' <span class="vt-sub">(' + (S.viewer.user ? 'available once an admin approves your account' : 'sign in as an approved member to view') + ')</span>' : ''));
    if (S.viewer.approved) {
      if (p.dna) vit += row('DNA', 'Tested and matched');
      if (p.usa) vit += row('USA', 'Lived in the United States');
      if (p.notes) vit += row('Notes', esc(p.notes));
    }
    vit += row('Last modified', esc(longDate(p.mod || S.doc.updated)) || empty);
    var cats = S.arch.counts[id] || {};
    var pills = Object.keys(KIND_LABEL).filter(function (k) { return cats[k]; }).map(function (k) { return '<div class="cat-pill">' + KIND_LABEL[k] + ' <b>' + cats[k] + '</b></div>'; }).join('');
    var docHtml;
    if (S.arch.locked) docHtml = '<div class="locked-block"><span class="lock-icon" aria-hidden="true">\u{1F512}</span><div class="lock-title">' + nDocs + ' document' + (nDocs === 1 ? '' : 's') + ' on file for ' + esc(dn(p)) + '</div><p>Newspaper clippings, photos and research notes are visible to approved members only.</p>' +
      (S.viewer.user ? '' : '<a class="btn small" href="/membership">Request access</a>') + '</div>';
    else {
      var mine = S.arch.items.filter(function (i) { return i.personId === id; });
      docHtml = mine.length ? Object.keys(KIND_LABEL).filter(function (k) { return mine.some(function (i) { return i.kind === k; }); }).map(function (k) {
        return '<h4>' + KIND_LABEL[k] + '</h4><ul class="doc-list">' + mine.filter(function (i) { return i.kind === k; }).map(function (i) {
          return '<li><a class="fname" href="/api/file/' + i.id + '" target="_blank" rel="noopener">' + esc(i.title) + '</a><span class="ftype">' + esc(i.contentType.split('/')[1]) + '</span></li>';
        }).join('') + '</ul>';
      }).join('') : '<p class="empty-note">Nothing has been filed for this person yet.</p>';
    }
    var actions = '';
    if (S.viewer.approved) actions += '<button class="btn small ghost" data-act="suggest" data-id="' + id + '" type="button">Suggest a correction</button> ';
    if (S.viewer.admin) actions += '<a class="btn small ghost" href="/admin?edit=' + id + '">Edit record</a>';
    return '<a class="back-link" href="/archive">\u2190 Back to archive</a>' +
      '<div class="profile-head"><div class="profile-photo placeholder" aria-hidden="true">' + esc(initial) + '</div><div><div class="breadcrumb">' + crumb + '</div><div class="page-title"><h2>' + esc(dn(p)) + '</h2></div><div class="parent-line">' +
      (p.private ? 'Living' : 'b. ' + (p.born ? esc(p.born) : '\u2014') + (p.died ? ' \u00b7 d. ' + esc(p.died) : '')) + '</div>' +
      (pills ? '<div class="cat-summary">' + pills + '</div>' : '') + (actions ? '<div class="profile-actions">' + actions + '</div>' : '') + '</div></div>' +
      '<div class="doc-section"><h4>Vital records</h4><table class="vitals-table"><tbody>' + vit + '</tbody></table></div>' +
      '<div class="doc-section doc-files">' + docHtml + '</div>' +
      (kids.length ? '<div class="doc-section"><h4>Children (' + kids.length + ')</h4>' + table(kids) + '</div>' : '') +
      (sibs.length ? '<details class="branch-box"><summary>Brothers and sisters <span class="cnt">' + sibs.length + '</span></summary>' + table(sibs) + '</details>' : '');
  }

  function pageMembership() {
    var v = S.viewer;
    if (v.user) {
      var u = v.user, dot = u.status === 'approved' ? 'approved' : u.status === 'denied' ? 'denied' : 'pending';
      var msg = v.admin ? 'You are an administrator. You can approve members, edit records and add documents.' :
        u.status === 'approved' ? 'Your account is approved. You can see document scans, notes and photographs, and suggest corrections.' :
        u.status === 'denied' ? 'Your access request was declined. Please contact the family administrator.' :
        'Your account is waiting for an admin to approve it. You can still browse the tree.';
      return '<div class="page-title"><h2>My Account</h2></div><p class="lede">Your sign-in and access to the family records.</p><div class="forms-row">' +
        '<div class="account-card"><h3 style="margin-top:0">' + esc(u.name) + '</h3><p class="sub-copy">' + esc(u.email) + '</p><div class="account-status-row"><span class="dot ' + dot + '"></span><div>' + esc(msg) + '</div></div>' +
        '<button class="btn small ghost" data-act="logout" type="button">Log out</button></div>' +
        '<div class="account-card"><h3 style="margin-top:0">Change password</h3><form data-form="password" autocomplete="off"><div class="field"><label for="pw-cur">Current password</label><input id="pw-cur" name="current" type="password" autocomplete="current-password" required></div>' +
        '<div class="field"><label for="pw-new">New password</label><input id="pw-new" name="next" type="password" autocomplete="new-password" minlength="8" required></div><button class="btn small" type="submit">Change password</button><div class="status-line" id="pw-msg" role="status"></div></form></div></div>';
    }
    return '<div class="page-title"><h2>Login / Register</h2></div><p class="lede">Notes, document scans, photographs and living relatives are restricted to approved family members. Anyone can browse the tree and see who is documented; an admin approves access to the records themselves.</p>' +
      '<div class="forms-row"><div class="account-card"><h3 style="margin-top:0">Log in</h3><p class="sub-copy">Already registered? Sign in here.</p><form data-form="login"><div class="field"><label for="li-email">Email</label><input id="li-email" name="email" type="email" autocomplete="email" required></div>' +
      '<div class="field"><label for="li-pw">Password</label><input id="li-pw" name="password" type="password" autocomplete="current-password" required></div><button class="btn small" type="submit">Log in</button><div class="status-line err" id="li-msg" role="alert"></div></form></div>' +
      '<div class="account-card"><h3 style="margin-top:0">Create an account</h3><p class="sub-copy">New here? Request access. An admin will review it.</p><form data-form="register"><div class="field"><label for="rg-name">Your name</label><input id="rg-name" name="name" autocomplete="name" required></div>' +
      '<div class="field"><label for="rg-email">Email</label><input id="rg-email" name="email" type="email" autocomplete="email" required></div>' +
      '<div class="field"><label for="rg-pw">Password (8 or more characters)</label><input id="rg-pw" name="password" type="password" minlength="8" autocomplete="new-password" required></div>' +
      '<div class="field"><label for="rg-note">How are you related?</label><textarea id="rg-note" name="note" maxlength="500" placeholder="For example: grandson of Tom and Mary Cuffe"></textarea></div>' +
      '<details style="margin-bottom:14px"><summary class="muted" style="cursor:pointer;font-family:var(--mono);font-size:13px">Administrator setup code</summary><div class="field" style="margin-top:8px"><label for="rg-code">Setup code</label><input id="rg-code" name="setupCode" autocomplete="off"></div></details>' +
      '<button class="btn small" type="submit">Create account</button><div class="status-line err" id="rg-msg" role="alert"></div></form></div></div>';
  }

  /* ---------- help ---------- */
  function pageHelp() {
    return '<div class="page-title"><h2>Help</h2></div><p class="lede">How to browse the tree, read a record, join the archive and, for administrators, look after it.</p>' +
      '<div class="home-hero" style="padding:24px 30px"><div class="eyebrow">Getting started</div><ol class="manual-steps">' +
      '<li><div><h4>Browse the tree</h4><p>Open Family Tree and select a person. The small + under a card shows or hides their children. Search finds a name or townland and opens the branch for you.</p></div></li>' +
      '<li><div><h4>Read a record</h4><p>Each person has their dates, place, spouse, parents, children and brothers and sisters. Everyone linked there is clickable.</p></div></li>' +
      '<li><div><h4>Ask for access</h4><p>Use Login / Register to create an account. Say how you are related. An admin reviews each request.</p></div></li>' +
      '<li><div><h4>Once approved</h4><p>You can see notes, DNA matches, photographs and document scans, and send the administrator a correction from any person’s page.</p></div></li></ol></div>' +
      '<div class="page-title" style="margin-top:34px"><h2>What each visitor sees</h2></div>' +
      '<dl class="manual-anatomy"><div class="row"><dt>Anyone</dt><dd>Names, family links, dates and places for people who have died.</dd></div>' +
      '<div class="row"><dt>Approved member</dt><dd>Everything above plus notes, DNA and USA flags, living relatives, photographs and documents.</dd></div>' +
      '<div class="row"><dt>Admin</dt><dd>Everything above plus approving members, editing records and filing documents.</dd></div></dl>' +
      '<div class="tip-note"><b>Living relatives.</b> People with no death date who were born in 1920 or later appear as “Living relative” to the public, and to members who are still waiting for approval. An admin can change this for any person.</div>' +
      '<div class="tip-note warn"><b>Records can be incomplete.</b> Where the original tree showed only a first name, the surname has been taken from the father. Some people are still listed by first name only, and some children were grouped together on the original tree, so they carry no dates. If you can fill a gap, use Suggest a correction.</div>';
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
    var t = e.target.closest('[data-tog]');
    if (t) { var id = +t.dataset.tog; if (S.expanded.has(id)) S.expanded.delete(id); else S.expanded.add(id); S.hit = null; drawTree(); return; }
    var n = e.target.closest('[data-go]');
    if (n) { go(n.dataset.go); return; }
    var s = e.target.closest('[data-sort]');
    if (s) { var k = s.dataset.sort; if (S.sort.key === k) S.sort.dir = -S.sort.dir; else { S.sort.key = k; S.sort.dir = 1; } render(); return; }
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.dataset.act;
    if (act === 'tree-open') { S.doc.people.forEach(function (p) { if (kidsOf(p.id).length) S.expanded.add(p.id); }); S.hit = null; S.center = true; drawTree(); }
    else if (act === 'tree-reset') { resetTree(); S.center = true; S.treeQ = ''; $('#tq').value = ''; $('#tmatches').innerHTML = ''; drawTree(); }
    else if (act === 'logout') { api('logout', { method: 'POST', body: {} }).then(refresh).then(function () { go('/'); }); }
    else if (act === 'close') closeModal();
    else if (act === 'suggest') {
      var pid = +b.dataset.id, p = S.by.get(pid);
      var m = modal('<h3>Suggest a correction</h3><div class="sub">' + esc(nm(p)) + '</div><form data-form="suggest" data-id="' + pid + '"><div class="field"><label for="sg-text">What should change?</label><textarea id="sg-text" name="text" maxlength="1000" required placeholder="For example: born 14 March 1891, not 1892. Source: parish register."></textarea></div><div class="status-line err" id="sg-msg" role="alert"></div><div class="modal-actions"><button class="btn small ghost" data-act="close" type="button">Cancel</button><button class="btn small" type="submit">Send</button></div></form>');
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
    else if (e.target.id === 'tq') { S.treeQ = e.target.value; runTreeSearch(true); }
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
          .then(function () { return refresh(false); }).then(function () { f.reset(); setMsg('up-msg', 'Filed.'); drawAdmin(); done(); })
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

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  window.addEventListener('popstate', render);

  /* ---------- boot ---------- */
  function refresh(rerender) {
    return Promise.all([api('me'), api('people'), api('archive')]).then(function (r) {
      S.viewer = { user: r[0].user, approved: r[0].approved, admin: r[0].admin };
      S.doc = r[1]; S.arch = r[2]; index();
      if (!S.expanded.size) resetTree();
      if (rerender !== false) render();
    });
  }
  render();
  refresh().catch(function () { $('#view').innerHTML = '<p class="empty-note">The archive could not be loaded. Please refresh the page.</p>'; });
})();
