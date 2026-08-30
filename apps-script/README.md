# Zentara Sync — Google Apps Script

Un seul Apps Script qui connecte Zentara à **5 services Google** :

| Service | Rôle |
|---|---|
| **Google Sheets** | Base de données (companies, prospects, contacts, emails, contrats, monitoring, intelligence, tasks) |
| **Feuille `training`** | **Entraînement des IA** : chaque requête/réponse des modèles (prompt, output, provider, model, feedback) y est consignée → exporte en CSV pour tes datasets |
| **Google Docs** | Génération de **contrats** (Markdown → Google Doc, plus export PDF) |
| **Google Calendar** | Création d'**événements / RDV** (boutons CTA des emails) |
| **Google Maps** | **Géocodage** / recherche de lieux (service Maps intégré, aucune clé API requise) |
| **Gmail** *(bonus)* | **Envoi d'emails** réel depuis le Gmail du compte propriétaire |

---

## 🚀 Déploiement (5 minutes, une seule fois)

1. Ouvre **https://script.google.com** → bouton **Nouveau projet**.
2. Efface le `Code.gs` par défaut et **colle tout le contenu de `ZentaraSync.gs`**.
3. *(Optionnel)* renseigne `SPREADSHEET_ID` en haut du fichier (l'ID de ta spreadsheet).
   - Vide → le script crée automatiquement une nouvelle spreadsheet **« Zentara DB »** avec toutes les feuilles.
4. Déploiement → **Nouveau déploiement** → **Application Web** :
   - **Exécuter en tant que :** `Moi`
   - **Accès :** `Toute personne` (recommandé, gratuit) ou `Tout utilisateur authentifié`
   - Approuve les autorisations (Sheets, Docs, Drive, Calendar, Maps, Gmail).
5. Copie l'URL `/exec` → colle-la dans **Zentara → Réglages → Sheets Sync → URL du Apps Script** → **Tester** → **Sauvegarder**.

> ⚠️ Après chaque modification du code : **Gérer les déploiements → ✎ → Nouvelle version** puis redéploie.

## 📡 Actions supportées (API du Web App)

POST JSON avec `action` + params :

| action | params | retour |
|---|---|---|
| `ping` / `status` | — | infos spreadsheet + services dispo |
| `sync` | `tables: { companies: [...], ... }`, `training?: [...]` | nb de lignes poussées par feuille (dédup par id) |
| `append` | `table`, `row` | 1 ligne ajoutée |
| `query` | `table`, `column`, `value`, `limit` | lignes correspondantes |
| `train` | `prompt`, `output`, `provider`, `model`, `score?`, `feedback?` | consigné dans `training` + `ai_log` |
| `email-send` | `to`, `subject`, `html` | envoyé via GmailApp |
| `contract` | `title`, `markdown`, `email_to?` | Google Doc (+ PDF) créé |
| `calendar-event` | `title`, `start`, `end`, `attendees`, `description`, `location` | événement créé |
| `maps-geocode` | `address`/`query` | adresse formatée + lat/lng |

Exemple (curl) :
```bash
curl -X POST "https://script.google.com/macros/s/<ID>/exec" \
  -H 'Content-Type: application/json' \
  -d '{"action":"sync","tables":{"companies":[{"id":"com_1","name":"Acme","score":80}]}}'
```
```bash
curl -X POST ... -d '{"action":"contract","title":"NDA Acme","markdown":"# NDA\n\nEntre Zentara et Acme","email_to":"finance@acme.com"}'
```

## 📊 Feuilles créées automatiquement

- `companies` · `prospects` · `contacts` · `campaigns` · `emails` · `contracts` · `monitoring` · `intelligence` · `tasks`
- `training` (dataset IA, colonnes : timestamp, kind, provider, model, prompt, output, entity, score, feedback, origin)
- `ai_log` (historique brut complet)
- `activity` (logs de chaque action)

## ⚠️ Quotas Google à connaître

- **Gmail** : ~100 emails/jour (compte perso) — suffisant pour du prospection manuel, pas pour du mass-send.
- **Calendar / Maps / Docs** : généreux (utilisations internes).
- **Apps Script** : 20 000 appels/jour web app environ, 6 min d'exécution par appel.

## 🧪 Test rapide

Colle dans une cellule de la spreadsheet : `=ZENTARA()` sera remplacé par la doc dans la console script :

```js
function test() {
  Logger.log(handle_({ action: 'ping' }));
  Logger.log(handle_({ action: 'train', prompt: 'Bonjour', output: 'Bonjour !', provider: 'gemini', model: 'gemini-3.6-flash' }));
  Logger.log(handle_({ action: 'contract', title: 'Test', markdown: '# Titre\n\nCorps du document' }));
}
```