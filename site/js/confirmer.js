/* Page de confirmation : le jeton est dans le fragment (#c=...), jamais dans l'URL envoyée au serveur. */
(function () {
  'use strict';
  var E = window.ELV;
  var box = document.getElementById('c-statut');
  var m = /(?:^|[#&])c=([A-Za-z0-9_-]{20,128})/.exec(location.hash);
  if (!m) { E.show(box, 'Ce lien est incomplet. Utilisez le lien reçu par e-mail.', 'erreur'); return; }
  E.post('confirmer', { token: m[1] }).then(function (res) {
    if (res.ok) {
      box.textContent = '';
      box.appendChild(E.el('strong', { text: 'Merci, votre adresse est confirmée.' }));
      box.appendChild(document.createTextNode(' Votre fiche sera visible sur le site dans quelques minutes. Un e-mail contenant votre lien de modification vous est envoyé.'));
      box.className = 'message ok'; box.hidden = false; box.focus();
      history.replaceState(null, '', location.pathname);
    } else if (res.status === 401 || res.status === 410 || res.status === 404) {
      E.show(box, 'Ce lien a expiré ou a déjà été utilisé. Si votre fiche n\'est pas en ligne, refaites votre inscription : cela ne prend que quelques minutes.', 'erreur');
    } else {
      E.show(box, E.messageErreur(res), 'erreur');
    }
  });
})();
