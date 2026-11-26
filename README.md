# Fait à L'Étang

Annuaire gratuit des commerçants, artisans et entrepreneurs de L'Étang-la-Ville. Site statique, sans cookie, sans service tiers (hors tuiles OpenStreetMap), ordre des fiches aléatoire renouvelé chaque jour.

Ce dépôt est **public** : il ne contient que des données déjà publiées par leurs titulaires. Les coordonnées privées (nom, e-mail, téléphone, jetons) restent dans la base de l'éditeur et n'arrivent jamais ici.

## Contenu

| Chemin | Rôle |
|---|---|
| `site/config.json` | `SITE_URL`, `CHARTE` (`A`, `B` ou `C`), `WEBHOOK_BASE`, clé Turnstile (facultative), contact |
| `site/build.mjs` | génère `dist/` (Node 20+, aucune dépendance) |
| `site/templates/`, `site/css/`, `site/js/` | gabarits, styles (3 chartes dans `site/css/chartes/`), scripts |
| `site/assets/` | polices WOFF2 (licence OFL) et Leaflet, auto-hébergés ; licences dans `licences/` ; logo et favicon dans `img/` |
| `data/fiches.json` | fiches publiées (champs publics seulement), écrit par le workflow n8n `annuaire - publier - v1` |
| `images/<slug>/<n>-800.webp`, `-1600.webp` | photos des fiches publiées |
| `data/exemple.json`, `data/exemple-images/` | 12 fiches fictives pour la recette locale |
| `.github/workflows/deploy.yml` | build et publication sur GitHub Pages à chaque push sur `main` |

## Construire et tester en local

```
node site/build.mjs --exemple          # construit dist/ avec les 12 fiches fictives
node site/serve.mjs 8920               # sert dist/ sur http://127.0.0.1:8920/
node site/capture.mjs recette          # captures 390 px et 1280 px (Chrome requis)
node site/build.mjs                    # construit avec data/fiches.json (le vrai site)
```

Options de `build.mjs` : `--data <fichier>`, `--images <dossier>`, `--out <dossier>`, `--no-csp`.

Le build **échoue** (code 1) si :
- un champ privé (`email_contact`, `tel_prive`, `prenom`, `nom`, `portrait`, `competences`, `centres_interet`, `recherche`, `token_hash`, `statut`…) ou un champ inconnu apparaît dans les données ;
- un contraste de la charte retenue passe sous 4,5:1 (3:1 pour les éléments non textuels) ;
- une fiche est incomplète, une photo référencée manque, une URL n'est pas en `http(s)`.

## Choisir la charte

Changer `CHARTE` dans `site/config.json`. Un seul jeu de variables et de polices est chargé dans `dist/`. Le contrôle de contraste du build indique si une autre charte échouerait (la charte A échoue sur la couleur des liens : terracotta sur crème, 4,4:1).

## Changer d'adresse

Toutes les URL sont relatives, sauf les adresses canoniques, le sitemap et le JSON-LD, qui dérivent de `SITE_URL`. Pour passer à un domaine : modifier `SITE_URL`, puis l'origine autorisée (CORS) des webhooks n8n.

## Déploiement

1. Activer GitHub Pages : *Settings → Pages → Source : GitHub Actions*.
2. Chaque push sur `main` lance `node site/build.mjs` puis publie `dist/`.
3. Le workflow n8n `annuaire - publier - v1` pousse `data/fiches.json` et les images (API Git Data, un seul commit par passage) : c'est ce commit qui déclenche le déploiement.

## Licences

Code : à définir par l'éditeur. Polices : SIL OFL 1.1. Leaflet : BSD-2. Fonds de carte : © contributeurs OpenStreetMap (ODbL).
