/* Annuaire privé : liste réservée aux membres validés. Le jeton d'accès reste dans le fragment (#m=...) et part en en-tête. */
(function () {
  'use strict';
  var E = window.ELV, $ = function (id) { return document.getElementById(id); };
  var membres = [];
  var m = /(?:^|[#&])m=([A-Za-z0-9_-]{20,128})/.exec(location.hash);

  $('form-membre').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target, statut = $('p-statut'), btn = f.querySelector('button[type=submit]');
    if (!f.email.checkValidity()) { f.email.reportValidity(); return; }
    btn.disabled = true;
    E.post('membre-lien', { email: f.email.value.trim(), hp: f.entreprise_web.value, t: Date.now() - E.t0 }).then(function (res) {
      btn.disabled = false;
      if (res.ok) E.show(statut, 'Si cette adresse correspond à un membre validé, un lien d\'accès vient de partir. Il est valable 24 heures.', 'ok');
      else E.show(statut, E.messageErreur(res), 'erreur');
    });
  });

  function texte(tag, t, cls) { var e = E.el(tag, cls ? { class: cls } : {}); e.textContent = t; return e; }
  function carte(x) {
    var nom = [x.prenom, x.nom].filter(Boolean).join(' ');
    var c = E.el('article', { class: 'element membre' });
    /* Portrait : uniquement en data:image (la CSP n'autorise pas d'autre origine pour les images). */
    if (typeof x.portrait === 'string' && /^data:image\/(webp|jpeg|png);base64,/.test(x.portrait)) {
      c.appendChild(E.el('img', { class: 'portrait', src: x.portrait, alt: 'Portrait de ' + (nom || x.enseigne), width: '96', height: '96', loading: 'lazy' }));
    } else {
      c.appendChild(E.el('div', { class: 'portrait initiale', 'aria-hidden': 'true', text: ((x.prenom || x.enseigne || '?')[0] || '?').toUpperCase() }));
    }
    c.appendChild(texte('h3', (nom || x.enseigne) + (nom && x.enseigne ? ' · ' + x.enseigne : '')));
    c.appendChild(texte('p', [x.categorie, x.metier].filter(Boolean).join(' · '), 'categorie'));
    if (x.accroche) c.appendChild(texte('p', x.accroche));
    var ul = E.el('ul', { class: 'coordonnees' });
    if (x.email_contact) { var a = E.el('a', { href: 'mailto:' + x.email_contact }); a.textContent = x.email_contact; var li = E.el('li'); li.appendChild(a); ul.appendChild(li); }
    if (x.tel_prive) { var t = E.el('a', { href: 'tel:' + x.tel_prive.replace(/[^+0-9]/g, '') }); t.textContent = x.tel_prive; var l2 = E.el('li'); l2.appendChild(t); ul.appendChild(l2); }
    c.appendChild(ul);
    var dl = E.el('dl', { class: 'prive' });
    [['competences', 'Compétences'], ['centres_interet', 'Centres d\'intérêt'], ['recherche', 'Cherche ou propose']].forEach(function (k) {
      if (!x[k[0]]) return;
      dl.appendChild(texte('dt', k[1])); dl.appendChild(texte('dd', x[k[0]]));
    });
    if (dl.firstChild) c.appendChild(dl);
    if (x.presentation) { var d = E.el('details'); d.appendChild(texte('summary', 'Présentation de l\'activité')); d.appendChild(texte('p', x.presentation)); c.appendChild(d); }
    return c;
  }
  function afficher() {
    var q = E.norm($('p-recherche').value), cat = $('p-cat').value, zone = $('p-cartes');
    zone.textContent = '';
    var n = 0;
    membres.forEach(function (x) {
      if (cat && x.categorie !== cat) return;
      var blob = E.norm([x.prenom, x.nom, x.enseigne, x.categorie, x.metier, x.accroche, x.presentation, x.competences, x.centres_interet, x.recherche, x.commune].join(' '));
      if (q && blob.indexOf(q) < 0) return;
      zone.appendChild(carte(x)); n++;
    });
    $('p-compte').textContent = n + (n > 1 ? ' membres' : ' membre');
  }
  if (m) {
    $('p-demande').hidden = true; $('p-chargement').hidden = false;
    E.post('membres', {}, m[1]).then(function (res) {
      $('p-chargement').hidden = true;
      if (!res.ok || !res.data || !res.data.membres) { $('p-demande').hidden = false; $('p-invalide').hidden = false; return; }
      membres = res.data.membres;
      var cats = {}; membres.forEach(function (x) { if (x.categorie) cats[x.categorie] = true; });
      E.tax.categories.forEach(function (c) { if (cats[c]) { var o = E.el('option', { value: c }); o.textContent = c; $('p-cat').appendChild(o); } });
      $('p-recherche').addEventListener('input', afficher); $('p-cat').addEventListener('change', afficher);
      $('p-liste').hidden = false; afficher();
    });
  }
})();
