# 🔐 Guide de configuration des clés API Zentara

Ce fichier liste **toutes les clés API** nécessaires pour activer 100% des fonctionnalités de Zentara.

---

## 📋 Résumé rapide

| Service | Clé | Statut | Obligatoire |
|---------|-----|--------|-------------|
| NVIDIA NIM | `NVIDIA_API_KEY` | ✅ Configuré | **OUI** |
| Google Gemini | `GEMINI_API_KEY` | ❌ À ajouter | Fallback recommandé |
| OpenRouter | `OPENROUTER_API_KEY` | ❌ À ajouter | Optionnel |
| Mistral AI | `MISTRAL_API_KEY` | ❌ À ajouter | Optionnel |
| Google Maps | `GOOGLE_MAPS_API_KEY` | ❌ À ajouter | Optionnel |
| SerpAPI | `SERPAPI_KEY` | ❌ À ajouter | Optionnel |
| Outscraper | `OUTSCRAPER_API_KEY` | ❌ À ajouter | Optionnel |
| LinkedIn | `LINKEDIN_USERNAME/PASSWORD` | ❌ À ajouter | Optionnel |
| 2Captcha | `2CAPTCHA_API_KEY` | ❌ À ajouter | Optionnel |
| OpenCorporates | `OPENCORPORATES_API_KEY` | ❌ À ajouter | Optionnel |

---

## 🚀 Configuration minimale (pour démarrer)

### 1. NVIDIA NIM (OBLIGATOIRE — IA)

**Fichier** : `backend/.env`
```env
NVIDIA_API_KEY=nvapi-votre-cle-ici
AI_PROVIDER=nvidia
AI_MODEL=nvidia/nemotron-3-ultra-550b-a55b
```

**Comment l'obtenir** :
1. Allez sur https://build.nvidia.com/explore/discover
2. Créez un compte gratuit (crédits offerts)
3. Générez une clé API dans "API Keys"
4. Copiez-la dans `backend/.env`

---

### 2. Frontend (OBLIGATOIRE — connexion backend)

**Fichier** : `frontend/.env.local`
```env
VITE_API_BASE_URL=http://localhost:4000/api
VITE_SYNC_ENABLED=true
VITE_API_TIMEOUT_MS=30000
```

---

## 🔧 Configuration complète (toutes fonctionnalités)

### 3. Google Gemini (Fallback IA)

**Fichier** : `backend/.env`
```env
GEMINI_API_KEY=your_gemini_key_here
```

**Comment l'obtenir** :
1. https://aistudio.google.com/apikey
2. Créer un projet Google Cloud
3. Activer "Generative AI Studio API"
4. Créer une clé API

**Coût** : Gratuit jusqu'à 15 req/min

---

### 4. OpenRouter (Fallback IA)

**Fichier** : `backend/.env`
```env
OPENROUTER_API_KEY=your_openrouter_key_here
```

**Comment l'obtenir** :
1. https://openrouter.ai/keys
2. Créez un compte
3. Ajoutez des crédits (min $5)

**Avantage** : Accès à 200+ modèles (Claude, GPT-4, Llama, etc.)

---

### 5. Mistral AI (Fallback IA)

**Fichier** : `backend/.env`
```env
MISTRAL_API_KEY=your_mistral_key_here
```

**Comment l'obtenir** :
1. https://console.mistral.ai/api-keys
2. Créez un compte
3. Générez une clé

**Coût** : Gratuit pendant la beta

---

### 6. Google Maps API (Enrichissement lieux)

**Fichier** : `backend/.env`
```env
GOOGLE_MAPS_API_KEY=your_google_maps_key_here
```

**Comment l'obtenir** :
1. https://console.cloud.google.com/apis/credentials
2. Créez un projet
3. Activez "Places API" et "Maps JavaScript API"
4. Créez une clé API
5. Restreignez la clé (HTTP referrers)

**Coût** : Gratuit jusqu'à 200$/mois de crédit

---

### 7. SerpAPI (Alternative maps)

**Fichier** : `backend/.env`
```env
SERPAPI_KEY=your_serpapi_key_here
```

**Comment l'obtenir** :
1. https://serpapi.com/dashboard
2. Créez un compte (100 recherches gratuites/mois)

---

### 8. Outscraper (Alternative maps)

**Fichier** : `backend/.env`
```env
OUTSCRAPER_API_KEY=your_outscraper_key_here
```

**Comment l'obtenir** :
1. https://outscraper.com/api-dashboard
2. Créez un compte

---

### 9. LinkedIn (Scraping de profils)

**Fichier** : `backend/.env`
```env
LINKEDIN_USERNAME=votre_email@exemple.com
LINKEDIN_PASSWORD=votre_mot_de_passe
LINKEDIN_PROXY=http://user:pass@host:port  ← RECOMMANDÉ
```

**Comment l'obtenir** :
1. Utilisez un compte LinkedIn (de préférence Sales Navigator)
2. Configurez un proxy résidentiel (obligatoire pour éviter le blocage)

**⚠️ Attention** :
- LinkedIn interdit le scraping dans ses CGU
- Utilisez un proxy résidentiel pour minimiser les risques
- Limitez le nombre de requêtes

---

### 10. 2Captcha (Bypass anti-bot LinkedIn)

**Fichier** : `backend/.env`
```env
2CAPTCHA_API_KEY=your_2captcha_key_here
```

**Comment l'obtenir** :
1. https://2captcha.com/enterpage
2. Créez un compte
3. Ajoutez des crédits (~$3 pour 1000 captchas)

---

### 11. OpenCorporates (Base entreprises)

**Fichier** : `backend/.env`
```env
OPENCORPORATES_API_KEY=your_opencorporates_key_here
```

**Comment l'obtenir** :
1. https://opencorporates.com/api_accounts/new
2. Créez un compte gratuit

---

## 📁 Fichiers de configuration

### `backend/.env` (complet)

```env
# Port
PORT=4000
LISTEN_HOST=0.0.0.0

# AI (OBLIGATOIRE)
NVIDIA_API_KEY=nvapi-votre-cle-ici
AI_PROVIDER=nvidia
AI_MODEL=nvidia/nemotron-3-ultra-550b-a55b

# AI Fallback (OPTIONNEL)
GEMINI_API_KEY=
OPENROUTER_API_KEY=
MISTRAL_API_KEY=

# Maps (OPTIONNEL)
GOOGLE_MAPS_API_KEY=
SERPAPI_KEY=
OUTSCRAPER_API_KEY=

# LinkedIn (OPTIONNEL)
LINKEDIN_USERNAME=
LINKEDIN_PASSWORD=
LINKEDIN_SESSION_FILE=
LINKEDIN_PROXY=
2CAPTCHA_API_KEY=

# OpenCorporates (OPTIONNEL)
OPENCORPORATES_API_KEY=

# Infrastructure
PYTHON=python3
ZENTARA_DB_PATH=./data/zentara.db
TZ=Europe/Paris
```

### `frontend/.env.local`

```env
VITE_API_BASE_URL=http://localhost:4000/api
VITE_SYNC_ENABLED=true
VITE_API_TIMEOUT_MS=30000
```

---

## 🎯 Ordre de priorité

1. **NVIDIA NIM** → Sans ça, pas d'IA, pas d'analyses, pas d'emails générés
2. **Frontend .env.local** → Sans ça, pas de connexion au backend
3. **Google Gemini** → Fallback si NVIDIA tombe
4. **Google Maps** → Pour l'enrichissement géolocalisé
5. **LinkedIn** → Pour le scraping de prospection
6. **Autres** → Selon vos besoins

---

## ⚙️ Configuration via l'interface (Page Settings)

Les clés API peuvent aussi être configurées depuis l'interface :
1. Ouvrez Zentara dans le navigateur
2. Allez dans **Paramètres** → **API & Clés**
3. Remplissez les champs pour chaque service
4. Cliquez sur **Sauvegarder**

Les clés sont envoyées au backend via l'API `/settings/api-keys` et stockées dans `app_settings`.

---

## 🔒 Sécurité

- **Ne committez JAMAIS** vos fichiers `.env` dans Git
- Le fichier `.gitignore` contient déjà `.env` et `.env.local`
- Restreignez vos clés API (IP, domaines) quand c'est possible
- Régénérez vos clés si elles sont exposées
- Utilisez des variables d'environnement en production (Koyeb, Vercel, etc.)

---

## 🧪 Vérification

Après avoir configuré les clés, vérifiez que tout fonctionne :

```bash
# Lancez le backend
cd backend
node server.js

# Dans un autre terminal, testez l'API
curl http://localhost:4000/api/health

# Ou ouvrez le frontend
cd frontend
yarn dev
```

Allez dans **Paramètres** → **API & Clés** — vous devriez voir le statut "Backend connecté".

---

## 📞 Support

Si vous rencontrez des problèmes :
1. Vérifiez que les clés sont correctement copiées (sans espaces)
2. Redémarrez le backend après modification du `.env`
3. Consultez les logs du backend pour les erreurs détaillées
4. Vérifiez les quotas de vos fournisseurs de clés
