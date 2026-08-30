# Zentara

> Projet **Zentara** — backend d'abord, frontend à venir.

## Stack

| Couche       | Techno                                       |
| ------------ | -------------------------------------------- |
| Backend      | Node.js ≥ 18, TypeScript 5, Express 4        |
| Tests        | Vitest + supertest                           |
| Dev runner   | `tsx` (recharge à chaud, pas de compilation) |
| Frontend     | *(à venir — placeholder `frontend/`)*        |

## Structure

```
zentara/
├── backend/     ← API Node + TypeScript + Express
└── frontend/    ← réservé, sera rempli plus tard
```

## Démarrage rapide (backend)

```bash
cd backend
cp .env.example .env
npm install
npm run dev     # http://localhost:4001
```

Endpoints disponibles :

- `GET /health`         — santé du service
- `GET /api/v1/hello`   — ping de bienvenue
- `GET /api/v1/version` — nom, env, version d'API

## Tests

```bash
cd backend
npm test
```

## Commandes utiles (backend)

| Commande              | Effet                                     |
| --------------------- | ----------------------------------------- |
| `npm run dev`         | Démarre en mode watch (`tsx`)            |
| `npm run build`       | Compile TypeScript → `dist/`              |
| `npm start`           | Lance le build compilé                    |
| `npm run typecheck`   | Vérifie les types sans compiler           |
| `npm test`            | Lance la suite Vitest                    |

## Prochaines étapes

1. Brancher une base de données (PostgreSQL, MongoDB, SQLite…) selon le besoin.
2. Ajouter l'authentification (JWT, sessions, OAuth…).
3. Définir les modèles / routes métier.
4. Initialiser le frontend (Vite + React + TS suggéré, cohérent avec `pronox/`).
