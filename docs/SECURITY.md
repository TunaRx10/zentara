# Zentara — Security model (Round 9)

> Authentification PIN + biométrie, sessions Bearer, lockout progressif.

## Vue d'ensemble

Zentara est verrouillé par défaut. Au lancement de l'APK / de la web app,
l'utilisateur doit s'authentifier via :

1. **PIN** (4-12 caractères, hashé bcrypt côté serveur)
2. **Biométrie** (Face ID / Touch ID / empreinte, déclenchée via
   `@aparajita/capacitor-biometric-auth` → prompts natifs Android/iOS)

PIN et biométrie sont **complémentaires** : la biométrie est un raccourci,
pas un facteur suffisant. Le PIN reste exigé lors du **setup initial** et
peut servir de fallback à tout moment.

## Modèle de menace (V1 mono-utilisateur)

| Attaquant | Barrière | Mitigation |
|---|---|---|
| Lecture brute de la DB SQLite (device rooté) | bcrypt cost = 12 sur PIN (`pin_hash`) | Le PIN n'apparaît jamais en clair |
| Vol de session token | tokens opaques 256 bits SHA-256-hashed côté DB | `token_hash` jamais en clair ; rotation 30 jours |
| Brute-force | lockout progressif (5 → 15 min, 10 → 1 h) | `users.failed_attempts` + `lockout_until` |
| Appareil perdu | Keystore / Keychain protège le secret biométrique | Désinscription forcée via reset (avec PIN) |
| MITM réseau | HTTPS obligatoire en prod | Cf. `APP_DEBUG=false` |
| Replay | TTL + rotation | TTL 30 jours + refresh token rotation |

## Flux utilisateur

```
                    +-----------------+
                    |   PreloadSplash |
                    |   (capacitor)  |
                    +--------+--------+
                             |
                    state.kind = 'preload'
                             |
              +--------------+--------------+
              |                             |
   aucun user local / email           token Bearer valide
              |                             |
              v                             v
       +-------------+               +-------------+
       | SetupPanel  |               |   AppRouter |
       | (1er lancement)              |   (UI auto) |
       |  email + name + PIN + bio    +-------------+
       +------+------+                    ^
              |                           |
       POST /api/auth/setup          state.kind = 'authenticated'
              |
              v
       +------+------+
       |   Locked    |
       | PIN keypad   | --- auto-tente biométrie si dispo ---|
       +------+------+
              |
       POST /api/auth/login {email, pin}
       ou POST /api/auth/biometric {email, token}
              |
              v
       +------+------+
       | Unlocking  | (≤1 requête réseau)
       +------+------+
              |
       token Bearer retourné → state.kind = 'authenticated'
```

## Routes `/api/auth/*`

| Méthode | Path | Body | Effet |
|---|---|---|---|
| `POST` | `/api/auth/setup` | `{ email, name, pin, biometric_token? }` | Crée le 1er user + session. `409` si déjà fait. |
| `POST` | `/api/auth/login` | `{ email, pin }` | Vérifie PIN bcrypt, retourne Bearer. |
| `POST` | `/api/auth/biometric` | `{ email, biometric_token }` | Compare SHA-256(token), retourne Bearer. |
| `POST` | `/api/auth/refresh` | `{ token }` | Révoque ancien + émet nouveau (rotation). |
| `POST` | `/api/auth/logout` | `{ token }` | Révoque la session. |
| `GET`  | `/api/auth/me` | _(Bearer)_ | Profil utilisateur courant + lockout status. |

## Schéma DB (migration 004)

```sql
-- users : ajout de colonnes sécurité
ALTER TABLE users ADD COLUMN pin_hash TEXT;                   -- bcrypt du PIN
ALTER TABLE users ADD COLUMN biometric_enabled INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN biometric_token TEXT;            -- SHA-256 côté serveur (proof-of-possession)
ALTER TABLE users ADD COLUMN failed_attempts INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN lockout_until TEXT;               -- ISO

-- auth_sessions : sessions Bearer
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,           -- sess_<random>
  user_id TEXT NOT NULL,         -- FK users
  token_hash TEXT UNIQUE,        -- SHA-256(token)
  auth_method TEXT,              -- 'pin'|'biometric'|'setup'|'refresh'
  expires_at TEXT NOT NULL,      -- ISO (TTL = 30j par défaut)
  created_at TEXT,
  last_used_at TEXT,
  ip TEXT,
  user_agent TEXT,
  metadata TEXT                  -- JSON debug
);
```

## Tokens biométriques (V1)

Stratégie simplifiée (Android Keystore / iOS Keychain) :

1. Au setup biométrique ou à l'enrollment, le **device** génère un secret
   32 bytes (base64url, `crypto.getRandomValues`).
2. Ce secret est chiffré par le système (`BiometricAuth.authenticate` +
   KeyStore / Keychain hardware-backed) AVANT envoi au backend.
3. Le backend stocke `sha256(token)` dans `users.biometric_token`.

> **V2** envisagée : signature EdDSA via clé asymétrique
> pré-enregistrée (cf. `enableBiometric()` côté frontend et round 10 :
> endpoint `/api/auth/biometric-enroll`).

## Lockout progressif

```text
failed_attempts   lockout_until   message
0-4               (null)          normal
5-9               now + 15 min    "Compte verrouillé 15 min"
10+               now + 1 h       "Compte verrouillé 1 h"
```

Réinitialisé à 0 sur login réussi.

## Variables d'environnement

```bash
# /backend/.env
BCRYPT_COST=12                    # 4..15 (défaut 12)
AUTH_SESSION_TTL_SECONDS=2592000  # 30 jours
AUTH_ALLOW_SETUP=true             # false en prod après création initiale
```

## Tests

- `backend/test/auth.test.ts` (16 tests) :
  - setup + conflits + validations
  - login PIN avec lockout progressif (5 fails → 403)
  - login biométrique
  - refresh + rotation + old-token-invalid
  - logout + revokation
  - /me Bearer / sans / mauvais

## Roadmap Court Terme

| Item | Impact |
|---|---|
| Endpoint `/api/auth/biometric-enroll` | Enrollment côté serveur (round 10) |
| Endpoint `/api/auth/pin-reset` (avec questions ou recovery email) | Oubli de PIN |
| ssh-style WebAuthn flow pour le web | Compatibilité desktop + Linux |
| Audit log dédié | `auth_attempts` table (IP, UA, succès/échec) |
| MFA TOTP optionnel | 2FA pour usage critique |
