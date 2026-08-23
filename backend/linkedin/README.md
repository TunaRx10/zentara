# LinkedIn Live — recherche réelle par niche + besoins (gratuit, open-source)

Recherche LinkedIn **gratuite** branchée dans Zentara. Vendored ici (aucune clé API,
aucun service payant) :

| Repo | Rôle | Statut |
|---|---|---|
| `vendor/StaffSpy` | Roster d'entreprise (décideurs) + recherche globale par niche (`search_term`) | ✅ branché |
| `vendor/linkedin-mcp-server` | 19 outils MCP (search_people, get_person_profile…) pour agent IA | vendored, runtime dédié (non branché) |
| `vendor/linkedin-python-lead-generation-scraper` | — | ❌ repo **vide** (README marketing, aucun code source) |

## Architecture

```
frontend → POST /api/search/linkedin        (server.js)
               → backend/linkedin.js        (spawn python, normalize → Lead)
                   → backend/linkedin-bridge.py
                       → StaffSpy (staffspy)
```

Source keelead `linkedin-live` (`kee/sources/professional/linkedin-live.js`) est
enregistrée mais **désactivée par défaut** (opt-in) : elle exige une session LinkedIn.

## Activer (une fois)

### 1. Installer les dépendances Python de StaffSpy
```bash
cd backend
pip3 install pandas selenium requests pydantic tldextract tenacity python-dateutil beautifulsoup4 2captcha-python
# + un driver Chrome/Chromium compatible (selenium-manager le télécharge au 1er run)
```

### 2. Créer une session LinkedIn (StaffSpy)
```bash
cd backend/linkedin/vendor/StaffSpy
python3 -c "from staffspy import LinkedInAccount; LinkedInAccount(session_file='session.pkl', log_level=2)"
# → le navigateur s'ouvre, connecte-toi manuellement, la session est sauvegardée dans session.pkl
```

### 3. Configurer les variables d'environnement (backend/.env)
```bash
LINKEDIN_SESSION_FILE=/home/tunation_fr/zentara/backend/linkedin/vendor/StaffSpy/session.pkl
# OU (fallback identifiants, plus risqué / 2FA)
# LINKEDIN_USERNAME=ton@email.com
# LINKEDIN_PASSWORD=ton_mdp
LINKEDIN_LIMIT=25
```

### 4. Redémarrer le backend et vérifier
```bash
curl http://127.0.0.1:4000/api/search/linkedin/status
```

## Endpoints

- `GET  /api/search/linkedin/status` — disponibilité moteurs + session
- `POST /api/search/linkedin` — recherche
  ```json
  // roster d'entreprise (besoins ciblés)
  { "company": "Lucca", "roles": "Head of Sales", "limit": 25 }

  // recherche globale par niche + besoins
  { "niche": "SaaS B2B", "roles": "Head of Sales recrute", "location": "Europe", "limit": 25 }
  ```

## ⚠️ Important

- LinkedIn **bloque** les requêtes non authentifiées (HTTP 999) → une session est obligatoire.
- L'automatisation intensive (send/connect) peut faire **restreindre le compte**. Zentara n'utilise
  ici que la lecture (`scrape_staff` / recherche), pas l'envoi de messages.
- Sans session ni dépendances, le backend renvoie proprement `{ available: false, error: ... }`
  (aucun crash).
