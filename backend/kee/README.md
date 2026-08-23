# kee/ — Sources de données gratuites (portées depuis KeeLead)

Ce dossier contient **39 sources de prospection gratuites** (zéro clé API) portées
depuis le projet open-source **KeeLead** (https://github.com/Atum246/keelead).

## Attribution & licence

- Code original : **KeeLead** — © 2024 KeeLead — **MIT License**
- Le dossier `compiled` original a été transpilé (TypeScript → JavaScript CommonJS)
  avec `tsc`, puis les erreurs de compilation suivantes ont été corrigées :
  - `local/openstreetmap.ts` : template literal cassé (backtick parasite) + paramètre
    `options` manquant dans `searchWithGeo`.
- Licence MIT intégrale : `zentara/backend/kee/LICENSE` (copie de KeeLead).

## Sources incluses (39) — toutes `requiresApiKey = false`

| Catégorie | Sources |
|---|---|
| search | duckduckgo, searxng, google-cache |
| professional | linkedin (proxy Google) |
| company | opencorporates, sec-edgar, companies-house, builtin, builtwith, wikidata |
| local | openstreetmap, yellowpages, bbb, chamberofcommerce |
| social | github, reddit |
| developer | github-orgs, stackoverflow, devto, npm, pypi, dockerhub |
| startup | indiehackers, betalist |
| government | samgov, usaspending, census, eu-register, patents, trademarks |
| education | google-scholar, researchgate, orcid, academia |
| email | whois, dns-lookup, ssl-cert, email-guesser |
| events | conference-speakers |

## Orchestrateur
`backend/multi-source.js` instancie le registre, applique timeouts (~9 s/source,
35 s global), concurrency par lots de 5, dédup par nom, et normalise vers le
format LocalHit (`{name, sector, city, country, website, email, phone, source, score}`).

- `GET /api/search/external` — moteur multi-source
- `GET /api/search/external/status` — registre live (41 moteurs)
- `POST /api/maps/search` — recherche locale OpenStreetMap/Overpass (gmaps.js)