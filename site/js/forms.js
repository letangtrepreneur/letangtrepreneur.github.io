/* Formulaires : inscription (/inscrire/) et modification (/modifier/), même code.
   - 5 étapes en deux pages : annuaire public (activité, photos) puis annuaire privé (portrait, compétences) ;
   - validation à chaque étape ;
   - photos redimensionnées dans le navigateur (WebP 1600 px, qualité 0,82, repli JPEG) ;
   - anti-robots : champ piège, délai minimal de 4 s, Turnstile si une clé est configurée ;
   - le jeton de modification reste dans le fragment (#t=...) et part en en-tête. */
(function () {
  'use strict';
  var E = window.ELV;
  var form = document.getElementById('fiche-form');
  var formLien = document.getElementById('form-lien');
  var MAX_PHOTOS = 6, MAX_TEMOIGNAGES = 5, DELAI_MIN = 4000, MAX_OCTETS = 2 * 1024 * 1024;
  var CHAMPS_TEXTE = ['prenom', 'nom', 'email_contact', 'tel_prive', 'enseigne', 'categorie', 'metier', 'accroche', 'presentation',
    'histoire_etang', 'adresse', 'code_postal', 'commune', 'zone', 'horaires', 'telephone_public', 'email_public', 'site_web',
    'facebook', 'instagram', 'linkedin', 'autre_lien', 'competences', 'centres_interet', 'recherche'];
  var PORTRAIT_MAX = 600;
  var token = null, statutFiche = null;
  var photos = [], temoignages = [], portrait = null;
  var etape = 1, nbEtapes = 5, turnstileJeton = '';

  /* ---------- Demande du lien de modification ---------- */
  if (formLien) {
    var tokenMatch = /(?:^|[#&])t=([A-Za-z0-9_-]{20,128})/.exec(location.hash);
    if (tokenMatch) { token = tokenMatch[1]; charger(); }
    formLien.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var statut = document.getElementById('l-statut'), btn = formLien.querySelector('button[type=submit]');
      var email = formLien.email;
      if (!email.checkValidity()) { email.reportValidity(); return; }
      btn.disabled = true;
      E.post('lien-modification', { email: email.value.trim(), hp: formLien.entreprise_web.value, t: Date.now() - E.t0 }).then(function (res) {
        btn.disabled = false;
        if (res.ok) E.show(statut, 'Si une fiche correspond à cette adresse, un lien vient de partir. Il est valable 7 jours.', 'ok');
        else E.show(statut, E.messageErreur(res), 'erreur');
      });
    });
  }

  function charger() {
    document.getElementById('m-demande').hidden = true;
    document.getElementById('m-chargement').hidden = false;
    E.post('charger', {}, token).then(function (res) {
      document.getElementById('m-chargement').hidden = true;
      if (!res.ok || !res.data || !res.data.fiche) {
        document.getElementById('m-demande').hidden = false;
        document.getElementById('m-invalide').hidden = false;
        token = null;
        return;
      }
      statutFiche = res.data.statut || 'publiee';
      remplir(res.data);
      document.getElementById('m-brouillon').hidden = statutFiche !== 'brouillon_importe';
      document.getElementById('m-edition').hidden = false;
      var zs = document.getElementById('zone-suppression');
      if (zs) zs.hidden = false;
    });
  }

  if (!form) return;
  var mode = form.getAttribute('data-mode');
  var $ = function (id) { return document.getElementById(id); };
  var sections = [].slice.call(form.querySelectorAll('fieldset.etape'));
  nbEtapes = sections.length;
  var volets = [].slice.call(form.querySelectorAll('[data-volet-lien]'));

  /* ---------- Étapes ---------- */
  function afficherEtape(n, sansFocus) {
    etape = n;
    sections.forEach(function (s, i) { s.hidden = i !== n - 1; });
    $('etapes').textContent = 'Étape ' + n + ' sur ' + nbEtapes + ' · ' + sections[n - 1].getAttribute('data-titre');
    $('btn-prec').hidden = n === 1;
    $('btn-suiv').hidden = n === nbEtapes;
    $('btn-envoi').hidden = n !== nbEtapes;
    var volet = sections[n - 1].getAttribute('data-volet');
    volets.forEach(function (li) {
      if (li.getAttribute('data-volet-lien') === volet) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
    if (n === nbEtapes) recap();
    var leg = sections[n - 1].querySelector('legend');
    if (leg && !sansFocus) { leg.setAttribute('tabindex', '-1'); leg.focus(); }
  }
  function etapeValide(n) {
    var champs = sections[n - 1].querySelectorAll('input, select, textarea');
    for (var i = 0; i < champs.length; i++) {
      if (champs[i].type === 'file') continue;
      if (!champs[i].checkValidity()) { champs[i].classList.add('invalide'); champs[i].reportValidity(); return false; }
      champs[i].classList.remove('invalide');
    }
    return true;
  }
  $('btn-suiv').addEventListener('click', function () { if (etapeValide(etape)) afficherEtape(etape + 1); });
  $('btn-prec').addEventListener('click', function () { afficherEtape(etape - 1); });

  /* ---------- Compteurs de caractères, bloc adresse ---------- */
  [].forEach.call(form.querySelectorAll('[data-compte]'), function (p) {
    var champ = $(p.getAttribute('data-compte'));
    var maj = function () { p.textContent = champ.value.length + ' / ' + champ.maxLength + ' caractères'; };
    champ.addEventListener('input', maj); maj();
  });
  var casAdresse = form.adresse_publique;
  function majAdresse() {
    $('bloc-adresse').hidden = !casAdresse.checked;
    form.adresse.required = form.code_postal.required = form.commune.required = casAdresse.checked;
  }
  casAdresse.addEventListener('change', majAdresse); majAdresse();

  /* ---------- Étiquettes et métiers selon la catégorie ---------- */
  function majCategorie() {
    var cat = form.categorie.value, t = E.tax;
    var ok = {};
    ((cat && t.etiquettes_par_categorie[cat]) || []).concat(cat ? t.etiquettes_socle : []).forEach(function (k) { ok[k] = true; });
    [].forEach.call(form.querySelectorAll('input[name=etiquettes]'), function (c) {
      var visible = !!ok[c.value];
      if (!visible) c.checked = false;
      c.closest('.case').hidden = !visible;
    });
    var aide = $('aide-etiquettes');
    if (aide) aide.hidden = !!cat;
    var dl = $('liste-metiers');
    dl.textContent = '';
    ((cat && t.metiers_par_categorie[cat]) || []).forEach(function (m) { dl.appendChild(E.el('option', { value: m })); });
  }
  form.categorie.addEventListener('change', majCategorie); majCategorie();

  /* ---------- Photos ---------- */
  function reduire(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(file.type)) return reject(new Error('« ' + file.name + ' » n\'est pas une image.'));
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth, h = img.naturalHeight, k = Math.max(w, h) > 1600 ? 1600 / Math.max(w, h) : 1;
        var c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        var c8 = document.createElement('canvas'), k8 = Math.max(c.width, c.height) > 800 ? 800 / Math.max(c.width, c.height) : 1;
        c8.width = Math.round(c.width * k8); c8.height = Math.round(c.height * k8);
        c8.getContext('2d').drawImage(c, 0, 0, c8.width, c8.height);
        var enBlob = function (cv, cb) {
          cv.toBlob(function (b) {
            if (b && b.type === 'image/webp') cb(b);
            else cv.toBlob(cb, 'image/jpeg', 0.82);
          }, 'image/webp', 0.82);
        };
        var lire = function (b) {
          return new Promise(function (ok, ko) {
            var fr = new FileReader();
            fr.onload = function () { ok(fr.result); };
            fr.onerror = function () { ko(new Error('Lecture impossible.')); };
            fr.readAsDataURL(b);
          });
        };
        enBlob(c, function (b) {
          if (!b) return reject(new Error('« ' + file.name + ' » n\'a pas pu être réduite.'));
          if (b.size > MAX_OCTETS) return reject(new Error('« ' + file.name + ' » reste trop lourde après réduction (plus de 2 Mo). Choisissez une autre photo.'));
          enBlob(c8, function (b8) {
            Promise.all([lire(b), lire(b8)]).then(function (d) { resolve({ data: d[0], data800: d[1], octets: b.size }); }, reject);
          });
        });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('« ' + file.name + ' » est illisible.')); };
      img.src = url;
    });
  }

  function dessinerPhotos() {
    var liste = $('liste-photos');
    liste.textContent = '';
    photos.forEach(function (p, i) {
      var alt = E.el('input', { type: 'text', id: 'alt-' + i, maxlength: '140', required: true, value: p.alt || '' });
      alt.addEventListener('input', function () { p.alt = alt.value; });
      var actions = E.el('div', { class: 'actions' }, [
        i > 0 ? bouton('Monter', function () { echanger(i, i - 1); }) : null,
        i < photos.length - 1 ? bouton('Descendre', function () { echanger(i, i + 1); }) : null,
        bouton('Retirer', function () { photos.splice(i, 1); dessinerPhotos(); })
      ]);
      liste.appendChild(E.el('div', { class: 'element' }, [
        E.el('div', { class: 'rang' }, [
          E.el('img', { src: p.apercu, alt: '' }),
          E.el('div', { style: false }, [
            E.el('p', { text: 'Photo ' + (i + 1) + (i === 0 ? ' (vignette de la fiche)' : '') }),
            E.el('label', { for: 'alt-' + i, text: 'Texte alternatif : décrivez la photo *' }),
            alt
          ])
        ]), actions
      ]));
    });
  }
  function bouton(txt, fn) { var b = E.el('button', { type: 'button', class: 'bouton secondaire', text: txt }); b.addEventListener('click', fn); return b; }
  function echanger(a, b) { var t = photos[a]; photos[a] = photos[b]; photos[b] = t; dessinerPhotos(); }

  $('f-photos').addEventListener('change', function (ev) {
    var fichiers = [].slice.call(ev.target.files), statut = $('statut');
    ev.target.value = '';
    var place = MAX_PHOTOS - photos.length;
    if (fichiers.length > place) { E.show(statut, 'Six photos au maximum : seules les ' + place + ' premières sont gardées.', 'erreur'); fichiers = fichiers.slice(0, place); }
    fichiers.reduce(function (chaine, f) {
      return chaine.then(function () {
        return reduire(f).then(function (r) {
          photos.push({ data: r.data, data800: r.data800, apercu: r.data, alt: ($('f-enseigne').value || '').trim(), octets: r.octets });
          dessinerPhotos();
        }).catch(function (e) { E.show(statut, e.message, 'erreur'); });
      });
    }, Promise.resolve());
  });

  /* ---------- Portrait (annuaire privé) ---------- */
  function reduirePortrait(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(file.type)) return reject(new Error('« ' + file.name + ' » n\'est pas une image.'));
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth, h = img.naturalHeight, k = Math.max(w, h) > PORTRAIT_MAX ? PORTRAIT_MAX / Math.max(w, h) : 1;
        var c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        var fini = function (b) {
          if (!b) return reject(new Error('« ' + file.name + ' » n\'a pas pu être réduite.'));
          var fr = new FileReader();
          fr.onload = function () { resolve(fr.result); };
          fr.onerror = function () { reject(new Error('Lecture impossible.')); };
          fr.readAsDataURL(b);
        };
        c.toBlob(function (b) { if (b && b.type === 'image/webp') fini(b); else c.toBlob(fini, 'image/jpeg', 0.85); }, 'image/webp', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('« ' + file.name + ' » est illisible.')); };
      img.src = url;
    });
  }
  function dessinerPortrait() {
    var zone = $('zone-portrait');
    zone.textContent = '';
    if (!portrait) return;
    zone.appendChild(E.el('div', { class: 'element' }, [
      E.el('div', { class: 'rang' }, [
        E.el('img', { src: portrait.apercu, alt: '', class: 'portrait' }),
        E.el('p', { text: portrait.data ? 'Nouvelle photo, enregistrée à l\'envoi du formulaire.' : 'Votre photo actuelle.' })
      ]),
      E.el('div', { class: 'actions' }, [bouton('Retirer ma photo', function () { portrait = null; dessinerPortrait(); })])
    ]));
  }
  $('f-portrait').addEventListener('change', function (ev) {
    var f = ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    reduirePortrait(f).then(function (d) { portrait = { data: d, apercu: d }; dessinerPortrait(); })
      .catch(function (e) { E.show($('statut'), e.message, 'erreur'); });
  });

  /* ---------- Récapitulatif avant envoi ---------- */
  function recap() {
    var r = $('recap-volets'), pub = form.consent_public.checked, priv = form.consent_prive.checked;
    r.textContent = '';
    var t = pub && priv ? 'Votre fiche figurera dans les deux annuaires : la page publique pour les habitants, la page privée pour les membres du groupe.'
      : pub ? 'Votre fiche figurera dans l\'annuaire public seulement. Les informations de la page privée ne seront visibles de personne.'
      : priv ? 'Votre fiche figurera dans l\'annuaire privé seulement. Rien ne sera publié sur l\'annuaire public.'
      : 'Vous n\'avez coché aucun des deux annuaires : revenez à la page publique (étape 3) ou à la page privée (étape 4) pour cocher au moins une case.';
    r.appendChild(E.el('p', { text: t }));
    r.className = 'message' + (pub || priv ? ' ok' : ' erreur');
  }

  /* ---------- Témoignages ---------- */
  function dessinerTemoignages() {
    var liste = $('liste-temoignages');
    liste.textContent = '';
    temoignages.forEach(function (t, i) {
      var texte = E.el('textarea', { id: 'tm-t-' + i, maxlength: '400', rows: '3', required: true, text: t.texte || '' });
      var auteur = E.el('input', { type: 'text', id: 'tm-a-' + i, maxlength: '40', required: true, value: t.auteur || '' });
      var contexte = E.el('input', { type: 'text', id: 'tm-c-' + i, maxlength: '60', value: t.contexte || '', placeholder: 'cliente depuis 2019' });
      var compte = E.el('p', { class: 'compte', text: (t.texte || '').length + ' / 400 caractères' });
      texte.addEventListener('input', function () { t.texte = texte.value; compte.textContent = texte.value.length + ' / 400 caractères'; });
      auteur.addEventListener('input', function () { t.auteur = auteur.value; });
      contexte.addEventListener('input', function () { t.contexte = contexte.value; });
      liste.appendChild(E.el('div', { class: 'element' }, [
        E.el('p', { text: 'Témoignage ' + (i + 1) }),
        E.el('label', { for: 'tm-t-' + i, text: 'Texte *' }), texte, compte,
        E.el('div', { class: 'grille2' }, [
          E.el('div', {}, [E.el('label', { for: 'tm-a-' + i, text: 'Auteur (prénom et initiale) *' }), auteur]),
          E.el('div', {}, [E.el('label', { for: 'tm-c-' + i, text: 'Contexte (facultatif)' }), contexte])
        ]),
        E.el('div', { class: 'actions' }, [bouton('Retirer ce témoignage', function () { temoignages.splice(i, 1); dessinerTemoignages(); })])
      ]));
    });
    $('ajout-temoignage').hidden = temoignages.length >= MAX_TEMOIGNAGES;
    $('bloc-attestation').hidden = temoignages.length === 0;
    form.attestation.required = temoignages.length > 0;
  }
  $('ajout-temoignage').addEventListener('click', function () {
    if (temoignages.length < MAX_TEMOIGNAGES) { temoignages.push({ texte: '', auteur: '', contexte: '' }); dessinerTemoignages(); }
  });

  /* ---------- Préremplissage (modification) ---------- */
  function remplir(d) {
    var f = d.fiche;
    CHAMPS_TEXTE.forEach(function (k) { if (form[k] && f[k] != null) form[k].value = f[k]; });
    [].forEach.call(form.querySelectorAll('input[name=etiquettes]'), function (c) { c.checked = (f.etiquettes || []).indexOf(c.value) >= 0; });
    casAdresse.checked = !!f.adresse_publique; majAdresse();
    form.email_contact.readOnly = true;
    $('aide-email').textContent = 'Cette adresse identifie votre fiche : elle ne peut pas être modifiée ici. Pour en changer, écrivez-nous.';
    photos = (d.photos || []).map(function (p) { return { id: p.id, apercu: p.data, alt: p.alt || '' }; });
    temoignages = (d.temoignages || []).map(function (t) { return { texte: t.texte, auteur: t.auteur, contexte: t.contexte || '' }; });
    portrait = d.portrait ? { apercu: d.portrait } : null;
    dessinerPhotos(); dessinerTemoignages(); dessinerPortrait();
    majCategorie();
    [].forEach.call(form.querySelectorAll('input[name=etiquettes]'), function (c) { c.checked = (f.etiquettes || []).indexOf(c.value) >= 0; });
    form.consent_public.checked = !!f.consentement_public;
    form.consent_prive.checked = !!f.consentement_prive;
    form.conditions.checked = statutFiche !== 'brouillon_importe';
    [].forEach.call(form.querySelectorAll('[data-compte]'), function (p) { $(p.getAttribute('data-compte')).dispatchEvent(new Event('input')); });
    afficherEtape(1, true);
  }

  /* ---------- Turnstile (seulement si une clé est configurée) ---------- */
  if (E.cfg.TURNSTILE_SITEKEY) {
    window.__elvTurnstile = function () {
      window.turnstile.render('#turnstile', { sitekey: E.cfg.TURNSTILE_SITEKEY, callback: function (t) { turnstileJeton = t; } });
    };
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__elvTurnstile';
    s.async = true; document.head.appendChild(s);
  }

  /* ---------- Envoi ---------- */
  function charge() {
    var fiche = {};
    CHAMPS_TEXTE.forEach(function (k) { if (form[k]) fiche[k] = form[k].value.trim(); });
    fiche.etiquettes = [].map.call(form.querySelectorAll('input[name=etiquettes]:checked'), function (c) { return c.value; });
    fiche.adresse_publique = casAdresse.checked;
    return {
      fiche: fiche,
      photos: photos.map(function (p) { return p.data ? { data: p.data, data800: p.data800, alt: p.alt.trim() } : { id: p.id, alt: p.alt.trim() }; }),
      temoignages: temoignages.map(function (t) { return { texte: t.texte.trim(), auteur: t.auteur.trim(), contexte: (t.contexte || '').trim() }; }),
      /* Portrait de l'annuaire privé : nouvelle image, conservation de l'actuelle, ou null pour l'effacer. Jamais publié sur GitHub. */
      portrait: portrait ? (portrait.data ? { data: portrait.data } : { garder: true }) : null,
      consentement: { conditions: form.conditions.checked, attestation: form.attestation.checked, public: form.consent_public.checked, prive: form.consent_prive.checked },
      hp: form.entreprise_web.value, t: Date.now() - E.t0, turnstile: turnstileJeton
    };
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    for (var n = 1; n <= nbEtapes; n++) { if (!etapeValide(n)) { afficherEtape(n); etapeValide(n); return; } }
    var statut = $('statut'), btn = $('btn-envoi');
    if (!form.consent_public.checked && !form.consent_prive.checked) { afficherEtape(nbEtapes); E.show(statut, 'Cochez au moins une des deux cases : annuaire public, annuaire privé des entrepreneurs, ou les deux.', 'erreur'); return; }
    if (E.cfg.TURNSTILE_SITEKEY && !turnstileJeton) { E.show(statut, 'Validez d\'abord le contrôle anti-robot.', 'erreur'); return; }
    btn.disabled = true;
    var attente = Math.max(0, DELAI_MIN - (Date.now() - E.t0));
    E.show(statut, 'Envoi en cours…');
    E.pause(attente).then(function () {
      var corps = charge();
      if (mode === 'modifier') return E.post('enregistrer', Object.assign({ action: 'enregistrer' }, corps), token, 90000);
      return E.post('inscrire', corps, null, 90000);
    }).then(function (res) {
      btn.disabled = false;
      if (!res.ok) { E.show(statut, E.messageErreur(res), 'erreur'); return; }
      if (mode === 'modifier') {
        $('m-edition').hidden = true; $('m-brouillon').hidden = true;
        E.show($('m-fini'), 'Modifications enregistrées. Elles seront visibles sur le site dans quelques minutes.', 'ok');
      } else {
        form.hidden = true;
        var ok = $('succes');
        ok.textContent = '';
        ok.appendChild(E.el('strong', { text: 'Votre inscription est enregistrée.' }));
        ok.appendChild(document.createTextNode(' Un e-mail de confirmation vient de partir à ' + form.email_contact.value.trim() + '. Cliquez sur le lien qu\'il contient (valable 72 heures) : votre fiche sera alors publiée. Pensez à regarder dans vos courriers indésirables.'));
        ok.className = 'message ok'; ok.hidden = false; ok.focus();
      }
    });
  });

  /* ---------- Suppression (double confirmation) ---------- */
  var bs = $('btn-suppr');
  if (bs) {
    bs.addEventListener('click', function () { $('confirm-suppr').hidden = false; bs.hidden = true; $('btn-suppr-non').focus(); });
    $('btn-suppr-non').addEventListener('click', function () { $('confirm-suppr').hidden = true; bs.hidden = false; bs.focus(); });
    $('btn-suppr-oui').addEventListener('click', function () {
      var o = $('btn-suppr-oui'); o.disabled = true;
      E.post('enregistrer', { action: 'supprimer' }, token).then(function (res) {
        o.disabled = false;
        if (res.ok) {
          $('m-edition').hidden = true; $('m-brouillon').hidden = true;
          E.show($('m-fini'), 'Votre fiche est supprimée. Vos coordonnées et vos photos sont effacées ; la fiche disparaît du site dans quelques minutes.', 'ok');
        } else E.show($('statut'), E.messageErreur(res), 'erreur');
      });
    });
  }

  dessinerPhotos(); dessinerTemoignages(); dessinerPortrait(); afficherEtape(1, true);
})();
