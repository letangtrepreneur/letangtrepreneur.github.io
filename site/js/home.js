/* Accueil : recherche, filtres, ordre aléatoire du jour, carte. Recherche 100 % navigateur sur index.json. */
(function () {
  'use strict';
  var E = window.ELV;
  var grid = document.getElementById('liste');
  if (!grid) return;
  var cards = {};
  [].forEach.call(grid.querySelectorAll('[data-slug]'), function (c) { cards[c.getAttribute('data-slug')] = c; });
  var $ = function (id) { return document.getElementById(id); };
  var state = { q: '', cat: '', et: [], vue: 'liste' };
  var items = [];
  var map = null, layer = null;

  /* Même graine et même algorithme que build.mjs : mulberry32 sur la date de Paris. */
  function rand(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seedDuJour() {
    var d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
    return parseInt(d.replace(/-/g, ''), 10);
  }
  function ordreDuJour(slugs) {
    var a = slugs.slice().sort(), r = rand(seedDuJour());
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  function matches(it) {
    if (state.cat && it.categorie !== state.cat) return false;
    for (var i = 0; i < state.et.length; i++) if (it.etiquettes.indexOf(state.et[i]) < 0) return false;
    var toks = E.norm(state.q).split(/\s+/).filter(Boolean);
    for (var k = 0; k < toks.length; k++) if (it.q.indexOf(toks[k]) < 0) return false;
    return true;
  }

  function appliquer() {
    var n = 0, visibles = [];
    items.forEach(function (it) {
      var ok = matches(it);
      if (cards[it.slug]) cards[it.slug].hidden = !ok;
      if (ok) { n++; visibles.push(it); }
    });
    $('compteur').textContent = n === 0 ? 'Aucune fiche' : n + (n > 1 ? ' fiches' : ' fiche');
    $('vide').hidden = n !== 0 || state.vue === 'carte';
    if (state.vue === 'carte') dessinerCarte(visibles);
  }

  function dessinerCarte(visibles) {
    if (!map) return;
    layer.clearLayers();
    var pts = [];
    visibles.forEach(function (it) {
      if (typeof it.lat !== 'number' || typeof it.lon !== 'number') return;
      var a = E.el('a', { href: E.root + 'c/' + it.slug + '/', text: it.enseigne });
      var pop = E.el('div', {}, [E.el('strong', {}, [a]), E.el('br'), document.createTextNode(it.metier || '')]);
      L.marker([it.lat, it.lon], { title: it.enseigne, alt: it.enseigne }).bindPopup(pop).addTo(layer);
      pts.push([it.lat, it.lon]);
    });
    var note = $('note-carte');
    note.hidden = false;
    note.textContent = pts.length + (pts.length > 1 ? ' activités affichées' : ' activité affichée') + ' sur la carte. Les activités sans adresse publique n\'y figurent pas.';
    if (pts.length > 1) map.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
    else if (pts.length === 1) map.setView(pts[0], 15);
    else map.setView(E.cfg.CENTRE_CARTE, 13);
  }

  function basculer(vue) {
    state.vue = vue;
    $('vue-liste').setAttribute('aria-pressed', String(vue === 'liste'));
    $('vue-carte').setAttribute('aria-pressed', String(vue === 'carte'));
    grid.hidden = vue === 'carte';
    $('carte').hidden = vue !== 'carte';
    $('note-carte').hidden = vue !== 'carte';
    if (vue === 'carte' && !map) {
      if (typeof L === 'undefined') { E.show($('note-carte'), 'La carte n\'a pas pu se charger.', 'erreur'); return; }
      L.Icon.Default.imagePath = E.root + 'assets/vendor/leaflet/images/';
      map = L.map('carte').setView(E.cfg.CENTRE_CARTE, 13);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>' }).addTo(map);
      layer = L.layerGroup().addTo(map);
    }
    if (map) setTimeout(function () { map.invalidateSize(); }, 0);
    appliquer();
  }

  function initFiltres() {
    var sel = $('cat'), comptes = {};
    items.forEach(function (it) { comptes[it.categorie] = (comptes[it.categorie] || 0) + 1; });
    E.tax.categories.forEach(function (c) {
      if (comptes[c]) sel.appendChild(E.el('option', { value: c, text: c + ' (' + comptes[c] + ')' }));
    });
    sel.addEventListener('change', function () { state.cat = sel.value; appliquer(); });
    var utilisees = {};
    items.forEach(function (it) { it.etiquettes.forEach(function (e) { utilisees[e] = true; }); });
    E.tax.etiquettes.forEach(function (et) {
      if (!utilisees[et.cle]) return;
      var b = E.el('button', { type: 'button', class: 'puce', 'aria-pressed': 'false', text: et.label });
      b.addEventListener('click', function () {
        var i = state.et.indexOf(et.cle);
        if (i >= 0) state.et.splice(i, 1); else state.et.push(et.cle);
        b.setAttribute('aria-pressed', String(i < 0));
        appliquer();
      });
      $('puces').appendChild(b);
    });
    $('filtres').hidden = false;
    $('vues').hidden = false;
  }

  $('form-recherche').addEventListener('submit', function (e) { e.preventDefault(); state.q = $('q').value; appliquer(); });
  $('q').addEventListener('input', function () { state.q = $('q').value; appliquer(); });
  $('vue-liste').addEventListener('click', function () { basculer('liste'); });
  $('vue-carte').addEventListener('click', function () { basculer('carte'); });

  fetch(E.root + 'index.json', { credentials: 'omit' })
    .then(function (r) { if (!r.ok) throw new Error('index'); return r.json(); })
    .then(function (data) {
      items = data;
      ordreDuJour(items.map(function (i) { return i.slug; })).forEach(function (s) { if (cards[s]) grid.appendChild(cards[s]); });
      initFiltres();
      appliquer();
    })
    .catch(function () { /* sans index, la liste complète reste visible */ });
})();
