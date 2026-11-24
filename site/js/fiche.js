/* Page de fiche : galerie, carte de situation, signalement. */
(function () {
  'use strict';
  var E = window.ELV;

  var principale = document.getElementById('photo-principale');
  [].forEach.call(document.querySelectorAll('[data-photo]'), function (b) {
    b.addEventListener('click', function () {
      principale.src = b.getAttribute('data-src');
      principale.srcset = b.getAttribute('data-srcset');
      principale.alt = b.getAttribute('data-alt');
      [].forEach.call(document.querySelectorAll('[data-photo]'), function (o) { o.setAttribute('aria-current', String(o === b)); });
    });
  });

  var carte = document.getElementById('carte-fiche');
  if (carte && typeof L !== 'undefined') {
    var pos = [parseFloat(carte.getAttribute('data-lat')), parseFloat(carte.getAttribute('data-lon'))];
    L.Icon.Default.imagePath = E.root + 'assets/vendor/leaflet/images/';
    var m = L.map(carte, { scrollWheelZoom: false }).setView(pos, 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>' }).addTo(m);
    L.marker(pos, { title: carte.getAttribute('data-nom'), alt: carte.getAttribute('data-nom') }).addTo(m);
  }

  var form = document.getElementById('form-signaler');
  if (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var statut = document.getElementById('s-statut');
      var btn = form.querySelector('button[type=submit]');
      if (!form.motif.value) { E.show(statut, 'Choisissez un motif.', 'erreur'); return; }
      btn.disabled = true;
      E.post('signaler', {
        slug: document.getElementById('signaler').getAttribute('data-slug'),
        motif: form.motif.value, detail: form.detail.value.slice(0, 300),
        hp: form.entreprise_web.value, t: Date.now() - E.t0
      }).then(function (res) {
        btn.disabled = false;
        if (res.ok) { E.show(statut, 'Merci, votre signalement a bien été transmis.', 'ok'); form.reset(); }
        else E.show(statut, E.messageErreur(res), 'erreur');
      });
    });
  }
})();
