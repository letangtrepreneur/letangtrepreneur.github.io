#!/usr/bin/env node
/* build.mjs : génère dist/ à partir de data/fiches.json. Node 20+, aucune dépendance.
 *
 *   node site/build.mjs                  construit le site réel (data/fiches.json, images/)
 *   node site/build.mjs --exemple        construit avec les 12 fiches fictives (data/exemple.json)
 *   options : --data <fichier> --images <dossier> --out <dossier> --no-csp
 *
 * Le build sort en erreur (code 1) si :
 *   - un champ privé apparaît dans les données (garde-fou §4.5 de la spec) ;
 *   - un contraste de la charte retenue est inférieur à 4,5:1 ;
 *   - une fiche est incomplète, une photo manque, une URL n'est pas http(s).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SITE, '..');
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const flag = (n) => args.includes(n);
const exemple = flag('--exemple');
const DATA_FILE = path.resolve(ROOT, opt('--data') || (exemple ? 'data/exemple.json' : 'data/fiches.json'));
const IMAGES_DIR = path.resolve(ROOT, opt('--images') || (exemple ? 'data/exemple-images' : 'images'));
const OUT = path.resolve(ROOT, opt('--out') || 'dist');
const AVEC_CSP = !flag('--no-csp');

const erreurs = [];
const err = (m) => erreurs.push(m);
const lire = (p) => fs.readFileSync(p, 'utf8');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const jsonScript = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/* ------------------------------------------------------------------ configuration */
const cfg = JSON.parse(lire(path.join(SITE, 'config.json')));
const tax = JSON.parse(lire(path.join(SITE, 'taxonomies.json')));
cfg.SITE_URL = String(cfg.SITE_URL || '').replace(/\/+$/, '');
if (!/^https:\/\/[^/]+/.test(cfg.SITE_URL)) err('config.json : SITE_URL doit commencer par https://');
if (!['A', 'B', 'C'].includes(cfg.CHARTE)) err('config.json : CHARTE doit valoir "A", "B" ou "C"');
const BASE_PATH = (() => { try { return new URL(cfg.SITE_URL).pathname.replace(/\/+$/, '') + '/'; } catch { return '/'; } })();
let webhookOrigin = '';
try { webhookOrigin = new URL(cfg.WEBHOOK_BASE).origin; } catch { err('config.json : WEBHOOK_BASE invalide'); }
const TURNSTILE = String(cfg.TURNSTILE_SITEKEY || '').trim();

/* ------------------------------------------------------------------ contrôle de contraste */
const parseVars = (css) => Object.fromEntries([...css.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/g)].map((m) => [m[1], m[2]]));
const rgb = (h) => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

function controlerCharte(lettre) {
  const css = lire(path.join(SITE, 'css', 'chartes', lettre + '.css'));
  const v = parseVars(css);
  const lignes = [], echecs = [];
  const paire = (nom, a, b, min = 4.5) => {
    const r = ratio(v[a], v[b]);
    lignes.push(`${nom.padEnd(38)} ${r.toFixed(2).padStart(5)}:1  ${r >= min ? 'ok' : 'ÉCHEC (min ' + min + ')'}`);
    if (r < min) echecs.push(`${nom} : ${r.toFixed(2)}:1`);
    return r;
  };
  paire('texte / fond', 'c-texte', 'c-fond');
  paire('texte / carte', 'c-texte', 'c-carte');
  paire('texte secondaire / fond', 'c-texte2', 'c-fond');
  paire('texte secondaire / carte', 'c-texte2', 'c-carte');
  paire('pastille 1 (texte / fond)', 'c-pastille1-texte', 'c-pastille1-fond');
  paire('pastille 2 (texte / fond)', 'c-pastille2-texte', 'c-pastille2-fond');
  paire('texte sur primaire (boutons)', 'c-sur-primaire', 'c-primaire');
  paire('texte sur secondaire (bandeau)', 'c-texte', 'c-secondaire');
  paire('primaire / fond (focus, 3:1)', 'c-primaire', 'c-fond', 3);
  paire('champs : texte secondaire / blanc (3:1)', 'c-texte2', 'c-carte', 3);
  /* Couleur des liens : la secondaire si elle passe sur le fond ET sur les cartes, sinon la primaire. */
  let lien = null;
  for (const cand of ['c-secondaire', 'c-primaire']) {
    if (ratio(v[cand], v['c-fond']) >= 4.5 && ratio(v[cand], v['c-carte']) >= 4.5) { lien = cand; break; }
  }
  if (lien) lignes.push(`${'liens'.padEnd(38)} couleur retenue : ${lien === 'c-secondaire' ? 'secondaire' : 'primaire'} ${v[lien]}`);
  else { lignes.push('liens : ni la secondaire ni la primaire ne passent 4,5:1 → ÉCHEC'); echecs.push('liens'); }
  return { css, vars: v, lien: lien ? v[lien] : v['c-primaire'], lignes, echecs };
}

const rapports = Object.fromEntries(['A', 'B', 'C'].map((l) => [l, controlerCharte(l)]));
const charte = rapports[cfg.CHARTE];
if (charte) charte.echecs.forEach((e) => err(`contraste charte ${cfg.CHARTE} : ${e}`));
for (const l of ['A', 'B', 'C']) if (l !== cfg.CHARTE && rapports[l].echecs.length) console.warn(`  note : la charte ${l} (non retenue) échouerait au contrôle : ${rapports[l].echecs.join(' ; ')}`);

/* ------------------------------------------------------------------ données et garde-fou §4.5 */
const PRIVES = new Set(['statut', 'prenom', 'nom', 'email_contact', 'tel_prive', 'adresse_publique', 'consentement_publication_le', 'attestation_temoignages_le',
  'token_hash', 'token_expire_le', 'regen_demandee', 'airtable_id', 'cree_le', 'maj_le', 'publie_le', 'id', 'created_at', 'updated_at']);
const PUBLICS = new Set(['slug', 'enseigne', 'categorie', 'metier', 'accroche', 'presentation', 'histoire_etang', 'etiquettes', 'adresse', 'code_postal', 'commune', 'zone',
  'lat', 'lon', 'horaires', 'telephone_public', 'email_public', 'site_web', 'facebook', 'instagram', 'linkedin', 'autre_lien', 'photos', 'temoignages', 'maj']);
const PUBLICS_PHOTO = new Set(['fichier', 'alt', 'ordre']);
const PUBLICS_TEMOIGNAGE = new Set(['texte', 'auteur', 'contexte', 'ordre']);

function gardeFou(valeur, chemin) {
  if (Array.isArray(valeur)) valeur.forEach((x, i) => gardeFou(x, `${chemin}[${i}]`));
  else if (valeur && typeof valeur === 'object') {
    for (const k of Object.keys(valeur)) {
      if (PRIVES.has(k.toLowerCase())) err(`GARDE-FOU : champ privé « ${k} » présent dans ${chemin}`);
      gardeFou(valeur[k], `${chemin}.${k}`);
    }
  }
}

let fiches = [];
if (!fs.existsSync(DATA_FILE)) err(`données introuvables : ${DATA_FILE}`);
else {
  try { fiches = JSON.parse(lire(DATA_FILE)); } catch (e) { err(`${path.basename(DATA_FILE)} : JSON invalide (${e.message})`); }
  if (!Array.isArray(fiches)) { err('les données doivent être un tableau de fiches'); fiches = []; }
}
gardeFou(fiches, 'data');

const slugs = new Set();
const urlsSures = ['site_web', 'facebook', 'instagram', 'linkedin', 'autre_lien'];
const reseaux = { facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', autre_lien: 'Autre lien', site_web: 'Site web' };

function urlSure(valeur, ou) {
  try { const u = new URL(valeur); if (u.protocol === 'https:' || u.protocol === 'http:') return u.href; } catch { /* tombe dans l'erreur */ }
  err(`${ou} : URL invalide ou non http(s) « ${String(valeur).slice(0, 60)} »`);
  return null;
}

fiches.forEach((f, i) => {
  const ou = `fiche ${f.slug || '#' + i}`;
  for (const k of Object.keys(f)) if (!PUBLICS.has(k) && !PRIVES.has(k.toLowerCase())) err(`${ou} : champ inconnu « ${k} » (seuls les champs publics sont acceptés)`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.slug || '')) err(`${ou} : slug invalide`);
  if (slugs.has(f.slug)) err(`${ou} : slug en double`);
  slugs.add(f.slug);
  for (const k of ['enseigne', 'categorie', 'accroche', 'zone']) if (!f[k]) err(`${ou} : « ${k} » manquant`);
  if (f.categorie && !tax.categories.includes(f.categorie)) err(`${ou} : catégorie inconnue « ${f.categorie} »`);
  if (f.zone && !tax.zones.includes(f.zone)) err(`${ou} : zone inconnue « ${f.zone} »`);
  f.etiquettes = f.etiquettes || [];
  for (const e of f.etiquettes) if (!tax.etiquettes.some((t) => t.cle === e)) err(`${ou} : étiquette inconnue « ${e} »`);
  if (f.enseigne && f.enseigne.length > 80) err(`${ou} : enseigne trop longue`);
  if (f.accroche && f.accroche.length > 140) err(`${ou} : accroche > 140 caractères`);
  if (f.presentation && f.presentation.length > 1500) err(`${ou} : présentation > 1500 caractères`);
  if (f.histoire_etang && f.histoire_etang.length > 800) err(`${ou} : histoire > 800 caractères`);
  if ((f.lat == null) !== (f.lon == null)) err(`${ou} : lat et lon vont ensemble`);
  if (f.lat != null && !f.adresse) err(`${ou} : coordonnées sans adresse publique`);
  for (const k of urlsSures) if (f[k]) f[k] = urlSure(f[k], `${ou}.${k}`) || '';
  f.photos = (f.photos || []).slice().sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
  if (f.photos.length > 6) err(`${ou} : plus de 6 photos`);
  f.photos.forEach((p, j) => {
    for (const k of Object.keys(p)) if (!PUBLICS_PHOTO.has(k)) err(`${ou} photo ${j + 1} : champ inconnu « ${k} »`);
    if (!/^[\w-]+$/.test(p.fichier || '')) err(`${ou} photo ${j + 1} : nom de fichier invalide`);
    if (!p.alt) err(`${ou} photo ${j + 1} : texte alternatif manquant`);
    for (const t of [800, 1600]) if (!fs.existsSync(path.join(IMAGES_DIR, f.slug || '', `${p.fichier}-${t}.webp`))) err(`${ou} photo ${j + 1} : fichier ${f.slug}/${p.fichier}-${t}.webp absent de ${IMAGES_DIR}`);
  });
  f.temoignages = (f.temoignages || []).slice().sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
  if (f.temoignages.length > 5) err(`${ou} : plus de 5 témoignages`);
  f.temoignages.forEach((t, j) => {
    for (const k of Object.keys(t)) if (!PUBLICS_TEMOIGNAGE.has(k)) err(`${ou} témoignage ${j + 1} : champ inconnu « ${k} »`);
    if (!t.texte || t.texte.length > 400) err(`${ou} témoignage ${j + 1} : texte vide ou > 400 caractères`);
    if (!t.auteur) err(`${ou} témoignage ${j + 1} : auteur manquant`);
    if (t.contexte && t.contexte.length > 60) err(`${ou} témoignage ${j + 1} : contexte > 60 caractères`);
  });
});

if (erreurs.length) {
  console.error('\nÉCHEC DU BUILD :');
  erreurs.forEach((e) => console.error('  - ' + e));
  process.exit(1);
}

/* ------------------------------------------------------------------ ordre aléatoire du jour (même algorithme que js/home.js) */
function rand(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const aujourdhui = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
const slugsOrdonnes = (() => {
  const a = fiches.map((f) => f.slug).sort(), r = rand(parseInt(aujourdhui.replace(/-/g, ''), 10));
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
})();
const parSlug = Object.fromEntries(fiches.map((f) => [f.slug, f]));

/* ------------------------------------------------------------------ gabarits */
const TPL = (n) => lire(path.join(SITE, 'templates', n));
function rendre(tpl, vars, nom = 'gabarit') {
  const val = (k) => { if (!(k in vars)) throw new Error(`${nom} : variable {{${k}}} non fournie`); return vars[k] ?? ''; };
  return tpl.replace(/\{\{\{(\w+)\}\}\}/g, (_, k) => String(val(k))).replace(/\{\{(\w+)\}\}/g, (_, k) => esc(val(k)));
}
const commun = { CHARTE: cfg.CHARTE, NOM: cfg.NOM, SITE_URL: cfg.SITE_URL, CONTACT_EMAIL: cfg.CONTACT_EMAIL };

const csp = (avecTurnstile) => !AVEC_CSP ? '' :
  `<meta http-equiv="Content-Security-Policy" content="${esc([
    "default-src 'none'",
    `script-src 'self'${avecTurnstile ? ' https://challenges.cloudflare.com' : ''}`,
    "style-src 'self'",
    "img-src 'self' data: blob: https://tile.openstreetmap.org",
    "font-src 'self'",
    `connect-src 'self' ${webhookOrigin}`,
    avecTurnstile ? 'frame-src https://challenges.cloudflare.com' : '',
    "base-uri 'none'", "form-action 'none'"
  ].filter(Boolean).join('; '))}">`;

const pages = []; // {chemin, html, url, sitemap}
function page({ chemin, profondeur, titre, description, content, cur = '', robots = false, head_extra = '', scripts = [], sitemap = true, formulaire = false }) {
  const root = profondeur === 'abs' ? BASE_PATH : profondeur === 0 ? './' : '../'.repeat(profondeur);
  const url = cfg.SITE_URL + '/' + chemin.replace(/index\.html$/, '');
  const clientCfg = { root, WEBHOOK_BASE: cfg.WEBHOOK_BASE, TURNSTILE_SITEKEY: formulaire ? TURNSTILE : '', CENTRE_CARTE: cfg.CENTRE_CARTE, tax };
  const html = rendre(TPL('layout.html'), {
    ...commun, titre, description, root, canonique: url,
    robots: robots ? '<meta name="robots" content="noindex,nofollow">' : '',
    csp: csp(formulaire && !!TURNSTILE), head_extra,
    cur_accueil: cur === 'accueil' ? ' aria-current="page"' : '', cur_inscrire: cur === 'inscrire' ? ' aria-current="page"' : '',
    cur_modifier: cur === 'modifier' ? ' aria-current="page"' : '', cur_apropos: cur === 'apropos' ? ' aria-current="page"' : '',
    content: content.split('{{ROOT}}').join(root),
    cfg: jsonScript(clientCfg),
    scripts: scripts.map((s) => `<script src="${root}assets/${s}" defer></script>`).join('\n')
  }, chemin);
  pages.push({ chemin, html, url, sitemap });
  return root;
}

/* ------------------------------------------------------------------ rendu des fiches */
const dateFr = (iso) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }).format(new Date(iso + 'T12:00:00Z'));
const paragraphes = (t) => String(t || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('\n');
const etiqLabel = (cle) => tax.etiquettes.find((e) => e.cle === cle);
const pastilles = (f, max = 99) => f.etiquettes.length
  ? `<ul class="pastilles">${f.etiquettes.slice(0, max).map((cle) => { const e = etiqLabel(cle); return `<li class="pastille${e.groupe === 2 ? ' g2' : ''}">${esc(e.label)}</li>`; }).join('')}</ul>` : '';
const villeDe = (f) => (f.zone === "L'Étang-la-Ville" ? "L'Étang-la-Ville" : (f.commune || f.zone));
const lienExt = (href, texte) => `<a href="${esc(href)}" rel="noopener nofollow">${esc(texte)}</a>`;
const court = (u) => { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + (x.pathname === '/' ? '' : x.pathname)).replace(/\/$/, ''); };
const chiffres = (t) => String(t).replace(/[^\d+]/g, '');

function carteHtml(f, root) {
  const v = f.photos[0];
  const media = v
    ? `<img class="vignette" src="${root}images/${f.slug}/${v.fichier}-800.webp" alt="" width="800" height="600" loading="lazy">`
    : `<div class="initiale" aria-hidden="true">${esc([...f.enseigne.replace(/^(le|la|les|l'|l’)\s*/i, '')][0] || '?').toUpperCase()}</div>`;
  return `    <li class="fiche-carte" data-slug="${esc(f.slug)}">
      ${media}
      <div class="corps">
        <p class="categorie">${esc(f.categorie)}</p>
        <h3><a href="${root}c/${f.slug}/">${esc(f.enseigne)}</a></h3>
        ${f.metier ? `<p class="metier">${esc(f.metier)} · ${esc(villeDe(f))}</p>` : `<p class="metier">${esc(villeDe(f))}</p>`}
        <p class="accroche">${esc(f.accroche)}</p>
        ${pastilles(f, 3)}
      </div>
    </li>`;
}

function ficheHtml(f) {
  const root = '../../';
  const canon = `${cfg.SITE_URL}/c/${f.slug}/`;
  const publique = !!f.adresse;
  const galerie = f.photos.length ? (() => {
    const p0 = f.photos[0], src = (p, t) => `${root}images/${f.slug}/${p.fichier}-${t}.webp`;
    const mini = f.photos.length > 1 ? `<ul class="miniatures">${f.photos.map((p, i) => `<li><button type="button" data-photo data-src="${src(p, 800)}" data-srcset="${src(p, 800)} 800w, ${src(p, 1600)} 1600w" data-alt="${esc(p.alt)}" aria-current="${i === 0}" aria-label="Voir la photo ${i + 1}"><img src="${src(p, 800)}" alt="" width="72" height="54" loading="lazy"></button></li>`).join('')}</ul>` : '';
    return `        <div class="galerie"><img id="photo-principale" class="principale" src="${src(p0, 800)}" srcset="${src(p0, 800)} 800w, ${src(p0, 1600)} 1600w" sizes="(min-width: 56rem) 40rem, 100vw" alt="${esc(p0.alt)}" width="800" height="600">${mini}</div>`;
  })() : '';
  const infos = [];
  if (publique) infos.push(`<li><span class="etiq">Adresse</span>${esc(f.adresse)}${f.code_postal || f.commune ? '<br>' + esc([f.code_postal, f.commune].filter(Boolean).join(' ')) : ''}</li>`);
  if (f.horaires) infos.push(`<li><span class="etiq">Horaires</span>${esc(f.horaires).replace(/\n/g, '<br>')}</li>`);
  if (f.telephone_public) infos.push(`<li><span class="etiq">Téléphone</span><a href="tel:${esc(chiffres(f.telephone_public))}">${esc(f.telephone_public)}</a></li>`);
  if (f.email_public) infos.push(`<li><span class="etiq">E-mail</span><a href="mailto:${esc(f.email_public)}">${esc(f.email_public)}</a></li>`);
  for (const k of ['site_web', 'facebook', 'instagram', 'linkedin', 'autre_lien']) if (f[k]) infos.push(`<li><span class="etiq">${reseaux[k]}</span>${lienExt(f[k], court(f[k]))}</li>`);
  if (!infos.length) infos.push('<li>Cette activité n\'affiche pas de coordonnées publiques.</li>');
  const temoignages = f.temoignages.length
    ? `<h2>Ce que disent leurs clients</h2>\n${f.temoignages.map((t) => `          <blockquote class="temoignage"><p>${esc(t.texte)}</p><footer>${esc(t.auteur)}${t.contexte ? ', ' + esc(t.contexte) : ''}</footer></blockquote>`).join('\n')}` : '';
  const ld = {
    '@context': 'https://schema.org', '@type': 'LocalBusiness', name: f.enseigne, description: f.accroche, url: canon,
    ...(f.photos.length ? { image: f.photos.map((p) => `${cfg.SITE_URL}/images/${f.slug}/${p.fichier}-1600.webp`) } : {}),
    ...(f.telephone_public ? { telephone: f.telephone_public } : {}),
    ...(f.email_public ? { email: f.email_public } : {}),
    ...(publique ? { address: { '@type': 'PostalAddress', streetAddress: f.adresse, postalCode: f.code_postal, addressLocality: f.commune, addressCountry: 'FR' } } : {}),
    ...(publique && f.lat != null ? { geo: { '@type': 'GeoCoordinates', latitude: f.lat, longitude: f.lon } } : {}),
    ...(urlsSures.map((k) => f[k]).filter(Boolean).length ? { sameAs: urlsSures.map((k) => f[k]).filter(Boolean) } : {})
  };
  const carteSit = publique && f.lat != null
    ? `        <div class="carte-fiche" id="carte-fiche" role="region" aria-label="Situation de ${esc(f.enseigne)}" data-lat="${f.lat}" data-lon="${f.lon}" data-nom="${esc(f.enseigne)}"></div>` : '';
  const contenu = rendre(TPL('fiche.html'), {
    root, categorie: f.categorie, metier_suite: f.metier ? ' · ' + esc(f.metier) : '', enseigne: f.enseigne, accroche: f.accroche, slug: f.slug,
    pastilles: pastilles(f), galerie, presentation: paragraphes(f.presentation),
    histoire: f.histoire_etang ? `<h2>Mon histoire avec L'Étang</h2>\n${paragraphes(f.histoire_etang)}` : '',
    temoignages, coordonnees: `          <ul class="coordonnees">\n            ${infos.join('\n            ')}\n          </ul>`,
    carte_situation: carteSit, maj: f.maj ? dateFr(f.maj) : dateFr(aujourdhui),
    motifs_options: '<option value="">Choisir…</option>' + tax.motifs.map((m) => `<option value="${m.cle}">${esc(m.label)}</option>`).join('')
  }, 'fiche.html');
  const avecCarte = !!carteSit;
  page({
    chemin: `c/${f.slug}/index.html`, profondeur: 2,
    titre: `${f.enseigne} — ${f.metier ? f.metier.toLowerCase() + ' ' : ''}à ${villeDe(f)}`,
    description: f.accroche, content: contenu,
    head_extra: (avecCarte ? '<link rel="stylesheet" href="../../assets/vendor/leaflet/leaflet.css">\n' : '') + `<script type="application/ld+json">${jsonScript(ld)}</script>`,
    scripts: [...(avecCarte ? ['vendor/leaflet/leaflet.js'] : []), 'fiche.js']
  });
}

/* ------------------------------------------------------------------ pages */
const nbTexte = fiches.length === 0 ? 'Les premières fiches arrivent bientôt' : `${fiches.length} ${fiches.length > 1 ? 'fiches' : 'fiche'}`;
page({
  chemin: 'index.html', profondeur: 0, cur: 'accueil',
  titre: `${cfg.NOM} — l'annuaire des commerçants, artisans et entrepreneurs de L'Étang-la-Ville`,
  description: "Annuaire gratuit des commerçants, artisans, producteurs et entrepreneurs de L'Étang-la-Ville et des environs. Sans publicité, sans classement.",
  content: rendre(TPL('index.html'), { nb_texte: nbTexte, cartes: slugsOrdonnes.map((s) => carteHtml(parSlug[s], './')).join('\n') }, 'index.html'),
  head_extra: '<link rel="stylesheet" href="assets/vendor/leaflet/leaflet.css">',
  scripts: ['vendor/leaflet/leaflet.js', 'home.js']
});
fiches.forEach(ficheHtml);

const formVars = (mode, root) => ({
  mode, root,
  categorie_options: tax.categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join(''),
  zone_options: tax.zones.map((z) => `<option value="${esc(z)}">${esc(z)}</option>`).join(''),
  etiquettes_cases: tax.etiquettes.map((e) => `      <div class="case"><input type="checkbox" name="etiquettes" value="${e.cle}" id="et-${e.cle}"><label for="et-${e.cle}">${esc(e.label)}</label></div>`).join('\n'),
  libelle_envoi: mode === 'modifier' ? 'Enregistrer mes modifications' : 'Envoyer mon inscription',
  zone_suppression: mode === 'modifier' ? TPL('zone-suppression.html') : ''
});
const formulaire = (mode, root) => rendre(TPL('form-fiche.html'), formVars(mode, root), 'form-fiche.html');

page({
  chemin: 'inscrire/index.html', profondeur: 1, cur: 'inscrire', formulaire: true,
  titre: `Inscrire mon activité — ${cfg.NOM}`, description: "Inscrivez gratuitement votre activité dans l'annuaire de L'Étang-la-Ville.",
  content: rendre(TPL('inscrire.html'), { form: formulaire('inscrire', '../') }, 'inscrire.html'), scripts: ['forms.js']
});
page({
  chemin: 'modifier/index.html', profondeur: 1, cur: 'modifier', formulaire: true, robots: true, sitemap: false,
  titre: `Modifier ma fiche — ${cfg.NOM}`, description: 'Modifier ou supprimer votre fiche.',
  content: rendre(TPL('modifier.html'), { form: formulaire('modifier', '../') }, 'modifier.html'), scripts: ['forms.js']
});
page({
  chemin: 'confirmer/index.html', profondeur: 1, robots: true, sitemap: false,
  titre: `Confirmation — ${cfg.NOM}`, description: 'Confirmation de votre adresse e-mail.',
  content: TPL('confirmer.html'), scripts: ['confirmer.js']
});

const paraTurnstile = TURNSTILE ? `<h2>Contrôle anti-robot</h2>
<p>Les formulaires utilisent Cloudflare Turnstile pour écarter les robots. Il s'exécute dans votre navigateur, sur les pages de formulaire seulement, et peut transmettre à Cloudflare des informations techniques (adresse IP, caractéristiques du navigateur).</p>` : '';
const legales = [
  ['a-propos', 'À propos', 'Pourquoi cet annuaire, comment il fonctionne et qui le tient.', 'apropos', 'a-propos.html'],
  ['mentions-legales', 'Mentions légales', 'Éditeur, hébergeur et crédits du site.', '', 'mentions-legales.html'],
  ['confidentialite', 'Confidentialité', 'Données personnelles traitées par le site, durées de conservation et droits.', '', 'confidentialite.html'],
  ['conditions-de-publication', 'Conditions de publication', 'Ce que vous vous engagez à respecter en publiant une fiche.', '', 'conditions.html']
];
for (const [slug, titre, desc, cur, fichier] of legales) {
  const corps = rendre(TPL('pages/' + fichier), { ...commun, para_turnstile: paraTurnstile }, 'pages/' + fichier);
  page({
    chemin: `${slug}/index.html`, profondeur: 1, cur, titre: `${titre} — ${cfg.NOM}`, description: desc,
    content: rendre(TPL('page-legal.html'), { titre_page: titre, corps }, 'page-legal.html')
  });
}
page({
  chemin: '404.html', profondeur: 'abs', robots: true, sitemap: false,
  titre: `Page introuvable — ${cfg.NOM}`, description: 'Page introuvable.',
  content: `<div class="contenu etroit page"><h1>Page introuvable</h1><p>Cette page n'existe pas ou a été retirée. <a href="{{ROOT}}">Retour à l'annuaire</a>.</p></div>`
});

/* ------------------------------------------------------------------ écriture de dist/ */
try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (e) { console.warn(`  note : ${OUT} n'a pas pu être vidé (${e.code}) ; les fichiers sont écrasés.`); }
const ecrire = (rel, contenu) => { const p = path.join(OUT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, contenu); };
const copier = (src, rel) => { const p = path.join(OUT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.copyFileSync(src, p); };
const copierDossier = (src, rel) => { for (const e of fs.readdirSync(src, { withFileTypes: true })) { const s = path.join(src, e.name), r = path.join(rel, e.name); e.isDirectory() ? copierDossier(s, r) : copier(s, r); } };

pages.forEach((p) => ecrire(p.chemin, p.html));

/* thème : une seule charte chargée, avec les seules polices qu'elle référence */
ecrire('assets/theme.css', `${charte.css}\n:root{--c-lien:${charte.lien}}\n`);
for (const m of charte.css.matchAll(/url\("fonts\/([^"]+)"\)/g)) copier(path.join(SITE, 'assets', 'fonts', m[1]), 'assets/fonts/' + m[1]);
copier(path.join(SITE, 'css', 'base.css'), 'assets/site.css');
for (const j of ['util.js', 'home.js', 'fiche.js', 'forms.js', 'confirmer.js']) copier(path.join(SITE, 'js', j), 'assets/' + j);
copierDossier(path.join(SITE, 'assets', 'vendor', 'leaflet'), 'assets/vendor/leaflet');
for (const l of fs.readdirSync(path.join(ROOT, 'licences'))) copier(path.join(ROOT, 'licences', l), 'assets/licences/' + l);

/* images des fiches publiées */
fiches.forEach((f) => f.photos.forEach((p) => [800, 1600].forEach((t) => copier(path.join(IMAGES_DIR, f.slug, `${p.fichier}-${t}.webp`), `images/${f.slug}/${p.fichier}-${t}.webp`))));

/* index de recherche (aucun champ privé : il part de fiches déjà contrôlées) */
const indexJson = slugsOrdonnes.map((s) => {
  const f = parSlug[s];
  const q = [f.enseigne, f.metier, f.accroche, f.presentation, ...f.etiquettes.map((e) => etiqLabel(e).label), f.categorie].filter(Boolean).join(' ');
  return {
    slug: f.slug, enseigne: f.enseigne, metier: f.metier || '', categorie: f.categorie, etiquettes: f.etiquettes,
    ...(f.adresse && f.lat != null ? { lat: f.lat, lon: f.lon } : {}),
    q: q.toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '')
  };
});
ecrire('index.json', JSON.stringify(indexJson));
ecrire('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.filter((p) => p.sitemap).map((p) => `  <url><loc>${esc(p.url)}</loc><lastmod>${aujourdhui}</lastmod></url>`).join('\n')}\n</urlset>\n`);
ecrire('robots.txt', `User-agent: *\nAllow: /\nDisallow: ${BASE_PATH}modifier/\nDisallow: ${BASE_PATH}confirmer/\n\nSitemap: ${cfg.SITE_URL}/sitemap.xml\n`);
ecrire('.nojekyll', '');

console.log(`\nBuild terminé : ${fiches.length} fiche(s), ${pages.length} pages → ${OUT}`);
console.log(`Charte ${cfg.CHARTE} · ordre du ${aujourdhui} · CSP ${AVEC_CSP ? 'active' : 'désactivée'} · Turnstile ${TURNSTILE ? 'actif' : 'inactif'}`);
console.log('Contrastes de la charte retenue :\n  ' + charte.lignes.join('\n  '));
