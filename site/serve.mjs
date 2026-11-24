#!/usr/bin/env node
/* Serveur statique local pour la recette : node site/serve.mjs [port] [dossier]
   Écoute sur 127.0.0.1 uniquement, port 8920 par défaut (plage 8900-8999 du registre ports.md),
   repli borné sur les 9 ports suivants. Aucune dépendance. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(process.argv[3] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist'));
const depart = parseInt(process.argv[2] || '8920', 10);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8' };

const serveur = http.createServer((req, res) => {
  let chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.normalize(path.join(racine, chemin));
  if (!f.startsWith(racine)) { res.writeHead(403); return res.end('interdit'); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404, { 'Content-Type': types['.html'] }); return res.end(fs.existsSync(path.join(racine, '404.html')) ? fs.readFileSync(path.join(racine, '404.html')) : 'introuvable'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});

let essais = 0;
function ecouter(port) {
  serveur.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && ++essais < 10) ecouter(port + 1);
    else { console.error('Impossible de démarrer :', e.message); process.exit(1); }
  });
  serveur.listen({ port, host: '127.0.0.1', exclusive: true }, () => console.log(`Annuaire : http://127.0.0.1:${port}/  (dossier ${racine})`));
}
ecouter(depart);
