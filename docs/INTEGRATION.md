# Zentara × Backend — Intégration frontend ↔ backend

> **Round 9** — branchement complet : Préchargement, Lock Screen PIN + Biométrie,
> API Bearer, sync hybride offline-first, pipeline 7 engines IA + RAG.
>
> Round 8 (précédent) avait ajouté sync hybride.
> Round 9 ajoute la couche Auth (PIN/biométrie) + un overhaul design.

## TL;DR

- **Frontend** (Capacitor + React 19, SQLite locale embarquée) garde la
  lecture/écriture offline → source de vérité UI primaire.
- **Backend** (Node + Express + SQLite + pipeline 7 engines IA + RAG)
  est un **gateway de services** : il est invoqué pour les opérations
  lourdes (IA, embeddings, recherche sémantique, monitoring distant).
- Quand online, le frontend **propage fire-and-forget** les nouvelles
  entrées locales vers le backend (`syncService`).
- Quand offline, le frontend **fallback heuristique local**
  (`LocalIntelligenceService` backend + endpoint `/pipeline/local-*`).
- **Round 9** ajoute **PreloadSplash** au démarrage, **LockScreen PIN + biométrie**,
  **API Bearer** côté `/api/auth/*`, et un overhaul design (glassmorphism,
  gradients animés, animations `shake` / `gradient` / `pulse`).

## Architecture cible

```
┌─────────────────────────────────────────┐
│              APK Zentara                │
│                                          │
│   ┌─────────────┐    ┌──────────────┐    │
│   │  React UI   │───▶│ services/api │    │
│   │  (offline-  │    │  (typed client│    │
│   │   first)    │    │  + retry)    │    │
│   └─────────────┘    └──────┬───────┘    │
│          │                  │            │
│   ┌──────▼──────┐    ┌──────▼───────┐    │
│   │ local-db    │    │ sync layer   │    │
│   │ (Capacitor  │    │ (fire-and-   │    │
│   │  SQLite)    │    │  forget)     │    │
│   └─────────────┘    └──────┬───────┘    │
│                           │             │
│  ┌────────────────────────▼───────────┐ │
│  │   Network Status + Zustand-like UI  │ │
│  └────────────────────────────────────┘ │
└──────────────┬───────────────────────────┘
               │ HTTPS (VITE_API_BASE_URL)
               ▼
┌─────────────────────────────────────────┐
│              Backend Node               │
│                                          │
│   ┌─────────────┐  ┌─────────────────┐   │
│   │ Express API │──│ SQLite (sqlite) │   │
│   │  /api/*     │  │ + security-     │   │
│   └──────┬──────┘  │   encrypted     │   │
│          │         └─────────────────┘   │
│   ┌──────▼───────────────┐               │
│   │ Pipeline 7 engines    │               │
│   │  + LocalService       │               │
│   │  + AIAnalysisCache    │               │
│   └──────┬───────────────┘               │
│          │                               │
│   ┌──────▼─────┐   ┌──────────────┐       │
│   │ AI Gateway │   │ Knowledge    │       │
│   │ (multi-    │   │ (RAG) +      │       │
│   │  provider) │   │ embedding    │       │
│   └────────────┘   └──────────────┘       │
└──────────────────────────────────────────┘
```

## Variables d'environnement

### Frontend (`frontend/.env.local`)

```bash
VITE_API_BASE_URL=http://localhost:4000/api
VITE_SYNC_ENABLED=true
VITE_API_TIMEOUT_MS=30000
```

### Backend (`backend/.env`)

```bash
PORT=4000
AI_PROVIDER=stub      # stub | openai | gemini | deepseek
AI_MODEL=
AI_API_KEY=
CORS_ORIGIN=http://localhost:5173
DB_PATH=./data/zentara.db
AI_CACHE_TTL_SECONDS=3600
AI_CASCADE_THRESHOLD=30
AI_RAG_TOP_K=5
AI_EMBEDDING_BACKEND=hash
```

## Endpoints consommés par le frontend

| Service frontend | Endpoint backend | Mode |
|---|---|---|
| `ai.service.analyzeProspect()` | `POST /api/intelligence/analyze` | auto (pipeline ⇄ heuristic) |
| `ai.service.analyzeProspectFull()` | `POST /api/intelligence/pipeline/prospect` | explicite (détail 7 engines) |
| `ai.service._callLocalProspect()` | `POST /api/intelligence/pipeline/local-prospect` | offline |
| `knowledge.service.ingestNote()` | `POST /api/knowledge/ingest` | online only |
| `knowledge.service.search()` | `POST /api/knowledge/search` | online only |
| `knowledge.service.getStats()` | `GET /api/knowledge/stats` | online only |
| `syncService.syncProspect()` | `POST /api/prospects` | fire-and-forget |
| `syncService.syncCompany()` | `POST /api/companies` | fire-and-forget |
| `syncService.syncContact()` | `POST /api/contacts` | fire-and-forget |

Tous les chemins sont centralisés dans `frontend/src/services/api/endpoints.ts`.

## Mode offline-first

**Garanties offline** :
- ✅ CRUD local (prospects, companies, contacts, campaigns) — toujours fonctionnel.
- ✅ Recherche fulltext sur la base locale.
- ✅ Analyse heuristique offline (`use_full_pipeline: false` ou route `/local-prospect`).
- ❌ IA distante (GPT-4o, Gemini…) — appelle le backend → fallback heuristique.
- ❌ RAG / Knowledge base — backend only. Affichage "backend injoignable".

**Détection** :
Le hook `useNetworkStatus` combine `navigator.onLine` ET l'événement
`zentara:network-status` émis par `apiClient` quand un `Failed to fetch`
arrive (le navigateur peut dire `online=true` mais le backend est down).

**Indicateurs UI** :
- AppLayout : badge `OPERATIONAL` / `DISCONNECTED` (déjà câblé).
- AICenterPage : badge vert "pipeline 7 engines" ou ambre "heuristique locale".
- ProspectsPage : badges `local-only` / `synced` / `sync failed` par carte.

## 🔐 Authentification (Round 9)

Zentara est verrouillé par défaut. À chaque lancement :

1. **PreloadSplash** → animation de chargement (6 phases : sécurité,
   base locale, backend, IA prête…),
2. **LockScreen** :
   - Premier lancement : `SetupPanel` (email + nom + PIN + opt-in biométrie),
   - Setup ultérieur : keypad PIN + bouton biométrique auto-déclenché.
3. **Token Bearer** stocké dans `secureStorage` (Capacitor Preferences
   sur natif, localStorage sur web).
4. **AuthProvider** transitionne : `preload → setup/locked → unlocking → authenticated`.

Routes `/api/auth/*` :
- `POST /setup` — création initiale (1 fois).
- `POST /login` — PIN bcrypt.
- `POST /biometric` — sha256(token) comparé à `users.biometric_token`.
- `POST /refresh` — rotation de session (ancien token invalidé).
- `POST /logout` — révocation.
- `GET /me` — profil + lockout status (Bearer requis).

Détails complets : [`docs/SECURITY.md`](./SECURITY.md).

## Schémas partagés

Les types TypeScript miroitent fidèlement les Zod schemas backend :

- **`frontend/src/services/api/types.ts`** :
  - `IntelligenceScore`, `IntelligenceAnalysisResponse` (forme du `/api/intelligence/analyze`).
  - `KnowledgeChunk`, `KnowledgeStats`, `KnowledgeSearchResponse`, `KnowledgeIngestResponse`.

- Si un schéma backend change (`backend/src/services/ai/engines/types.ts`),
  mettre à jour les types miroir en conséquence. Pas de validation runtime
  côté front (évite la double perf cost Zod).

## Mode offline-first

**Garanties offline** :
- ✅ CRUD local (prospects, companies, contacts, campaigns) — toujours fonctionnel.
- ✅ Recherche fulltext sur la base locale.
- ✅ Analyse heuristique offline (`use_full_pipeline: false` ou route `/local-prospect`).
- ❌ IA distante (GPT-4o, Gemini…) — appelle le backend → fallback heuristique.
- ❌ RAG / Knowledge base — backend only. Affichage "backend injoignable".

**Détection** :
Le hook `useNetworkStatus` combine `navigator.onLine` ET l'événement
`zentara:network-status` émis par `apiClient` quand un `Failed to fetch`
arrive (le navigateur peut dire `online=true` mais le backend est down).

**Indicateurs UI** :
- AppLayout : badge `OPERATIONAL` / `DISCONNECTED` (déjà câblé).
- AICenterPage : badge vert "pipeline 7 engines" ou ambre "heuristique locale".
- ProspectsPage : badges `local-only` / `synced` / `sync failed` par carte.

## Cache + cascade

L'analyse IA est **coûteuse** (6-8 appels API par analyse complète).
Pour ne pas la déclencher inutilement :

1. **Cache TTL** (1h par défaut) : si une analyse existe encore dans
   `ai_analysis` pour la même entité, elle est **réutilisée** telle
   quelle. La forme UI marque `cached: true`.
2. **Cascade conditionnelle** : si l'analyse révèle des scores très
   faibles (opportunity < 30 ET confidence < 30), la couche `synthesis`
   est tronquée et on émet `truncated_by_cascade: true`.
3. **Force refresh** : le frontend peut envoyer `force_refresh: true`
   pour contourner le cache après une modification locale.

## Persistance locale des analyses

Après chaque appel `aiService.analyzeProspect` :

```sql
-- Table `ai_analysis` (audit/replay)
INSERT OR REPLACE INTO ai_analysis (
  id, entity_type, entity_id, provider, model, prompt_version,
  summary, insights, recommendations, confidence, created_at
) VALUES (...);

-- Table `intelligence` (scoring agrégé, agrégat par entité)
INSERT OR REPLACE INTO intelligence (
  id, entity_type, entity_id, score, opportunity_score, relevance_score,
  intent_score, activity_score, confidence_score, summary, insights,
  risks, recommendations, updated_at
) VALUES (...);
```

C'est ce qui permet d'afficher **les dernières analyses même sans backend**.

## Sync hybride (best-effort)

Le `syncService` propage les **nouvelles entrées locales** vers le backend
dès qu'il est online. **PAS** une vraie sync bi-directionnelle : le backend
est un miroir "secondaire" qui sert surtout aux opérations IA.

```ts
// À chaque `addProspect(...)` :
const created = await prospectRepository.create(data);     // 1sqlite local
syncService.syncProspect(created).then(outcome => {        // 2best-effort
  if (!outcome.ok) UI: show "sync failed"
});
```

**Limitations connues** :
- Pas de queue persistante : si l'utilisateur crée 10 prospects en mode
  avion, ces 10 ne seront PAS re-sync automatiquement au retour online.
  (Round 9 : ajouter un `pending_sync_queue` table + un worker `syncRunner`.)
- Pas de résolution de conflits : si le même ID existe local + backend,
  le backend gagne (upsert côté back).
- Pas d'authentification (V1 mono-utilisateur) : à ajouter quand l'APK
  supporte le multi-utilisateur.

## Tests

### Backend (`backend/`)

- **`test/analyze-facade.test.ts`** (Round 8, **NOUVEAU**) :
  - Compat ascendante UI : shape `{summary, insights, recommendations, risks, scores}`.
  - Cache hit replay (TTL).
  - Heuristique offline (`use_full_pipeline: false`).
  - 404 si entité inexistante.
- Tous les autres tests passent (164/164) : aucune régression.

### Frontend (`frontend/`)

- `tsc -b` : typecheck strict sans erreur.
- `vite build` : bundle produit (~847kB, gzip 247kB).

### Smoke E2E manuel

```bash
# Terminal 1 : backend
cd backend
npm run dev    # http://localhost:4000

# Terminal 2 : seed
cd backend
npm run seed:dev   # ou npx tsx scripts/seed-demo.ts

# Terminal 3 : frontend
cd frontend
npm run dev    # http://localhost:5173
# → ouvre /intelligence
# → sélectionne un prospect
# → clique "Start Strategic Analysis"
# → badge "BACKEND LIVE — pipeline 7 engines" + résultats

# Coupure du backend → badge ambre "OFFLINE — heuristique locale"
# → relance analyse → fallback heuristique actif
```

## Roadmap Court Terme

| Priorité | Item | Impact |
|---|---|---|
| **R9** | Queue de sync persistante (`pending_sync` table) | offline-safe création |
| **R10** | UI Knowledge : drag&drop PDF + URL ingest | RAG plus ergonomique |
| **R11** | SSE streaming des 7 engines (UX réactive) | UX analyse time-to-first-token |
| **R12** | Authentication JWT + multi-user | support collaboration |
| **R13** | sqlcipher (Android) chiffrement at-rest | privacy-by-design |

## Contrats de breaking change

Avant de modifier un schéma backend :

1. Mettre à jour `frontend/src/services/api/types.ts` miroir.
2. Mettre à jour `docs/INTEGRATION.md` (cette page).
3. Faire un round de smoke E2E manuel.
4. Documenter dans le CHANGELOG.md.

Le frontend est **tolérant** aux champs optionnels manquants
(graceful degradation → heuristique offline), mais strict sur la forme
des champs consommés par l'UI (`summary`, `insights`, `recommendations`,
`risks`, `scores`).
