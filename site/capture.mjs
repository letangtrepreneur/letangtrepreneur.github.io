#!/usr/bin/env node
/* Captures de recette avec un vrai viewport (Chrome DevTools Protocol, Node 22+, aucune dépendance).
   node site/capture.mjs <dossier-de-sortie> [url-de-base=http://127.0.0.1:8920]
   Relève aussi les domaines contactés par chaque page (critère 8 de la spec). Port DevTools : 8930 (plage 8900-8999). */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sortie = path.resolve(process.argv[2] || '.');
const base = (process.argv[3] || 'http://127.0.0.1:8920').replace(/\/$/, '');
const PORT = 8930;
const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
if (!chrome) { console.error('Chrome introuvable'); process.exit(1); }
const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'elv-cdp-'));
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profil}`, 'about:blank'], { stdio: 'ignore' });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

let cible = null;
for (let i = 0; i < 40 && !cible; i++) {
  try { cible = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page'); } catch { await dormir(250); }
}
if (!cible) { proc.kill(); console.error('DevTools injoignable'); process.exit(1); }
const ws = new WebSocket(cible.webSocketDebuggerUrl);
let n = 0; const attente = new Map(); let origines = new Set();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && attente.has(m.id)) { attente.get(m.id)(m); attente.delete(m.id); }
  else if (m.method === 'Network.requestWillBeSent') { try { origines.add(new URL(m.params.request.url).origin); } catch { /* data: ou blob: */ } }
};
await new Promise((r) => { ws.onopen = r; });
const envoyer = (method, params = {}) => new Promise((res) => { const i = ++n; attente.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await envoyer('Network.enable'); await envoyer('Page.enable');

const prises = [
  ['/', 'accueil-1280.png', 1280], ['/', 'accueil-390.png', 390],
  ['/c/la-table-de-l-etang/', 'fiche-1280.png', 1280], ['/c/la-table-de-l-etang/', 'fiche-390.png', 390],
  ['/c/cabinet-du-tilleul/', 'fiche-sans-adresse-390.png', 390],
  ['/inscrire/', 'inscrire-390.png', 390], ['/modifier/', 'modifier-390.png', 390]
];
for (const [chemin, fichier, w] of prises) {
  origines = new Set();
  await envoyer('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 500 });
  await envoyer('Page.navigate', { url: base + chemin });
  await dormir(2500);
  const mesure = (await envoyer('Runtime.evaluate', { expression: 'JSON.stringify({h:document.documentElement.scrollHeight,sw:document.documentElement.scrollWidth,vw:innerWidth})', returnByValue: true })).result.result.value;
  const { h, sw, vw } = JSON.parse(mesure);
  await envoyer('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
  await dormir(1500);
  const img = await envoyer('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(sortie, fichier), Buffer.from(img.result.data, 'base64'));
  console.log(`${fichier.padEnd(30)} viewport ${vw}px, largeur du contenu ${sw}px ${sw > vw ? 'DÉBORDE' : 'ok'}, hauteur ${h}px, domaines : ${[...origines].join(', ')}`);
}
ws.close(); proc.kill();
try { fs.rmSync(profil, { recursive: true, force: true }); } catch { /* profil temporaire */ }
process.exit(0);
