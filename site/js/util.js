/* Utilitaires communs : configuration, normalisation, appels aux webhooks. Aucune dépendance. */
(function () {
  'use strict';
  var cfg = JSON.parse(document.getElementById('cfg').textContent);

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae')
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (attrs[k] === true) n.setAttribute(k, '');
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  /* POST JSON vers un webhook n8n. Le jeton éventuel part en en-tête, jamais dans l'URL. */
  function post(name, body, token, ms) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms || 30000);
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-Annuaire-Jeton'] = token;
    var url = cfg.WEBHOOK_BASE.replace(/\/$/, '') + '/' + name;
    return fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body || {}), signal: ctrl.signal, credentials: 'omit' })
      .then(function (r) {
        clearTimeout(timer);
        return r.text().then(function (txt) {
          var data = null;
          try { data = JSON.parse(txt); } catch (e) { /* réponse non JSON */ }
          return { status: r.status, ok: r.ok, data: data };
        });
      })
      .catch(function (e) { clearTimeout(timer); return { status: 0, ok: false, data: null, error: e }; });
  }

  function show(box, text, kind) {
    box.textContent = text;
    box.className = 'message' + (kind ? ' ' + kind : '');
    box.hidden = false;
    box.focus();
  }

  function pause(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function messageErreur(res) {
    if (res.status === 429) return 'Trop de demandes en ce moment. Réessayez dans une heure.';
    if (res.status === 0) return 'Le serveur ne répond pas. Vérifiez votre connexion et réessayez dans un instant.';
    if (res.data && res.data.erreur) return String(res.data.erreur);
    return 'Une erreur est survenue (code ' + res.status + '). Réessayez, ou écrivez-nous si cela continue.';
  }

  window.ELV = { cfg: cfg, tax: cfg.tax, root: cfg.root, norm: norm, el: el, post: post, show: show, pause: pause, messageErreur: messageErreur, t0: Date.now() };
})();
