# Session LinkedIn MCP — création locale + import sur le serveur

Le serveur `linkedin-mcp-server` (FastMCP) a besoin d'une session LinkedIn
authentifiée pour que `search_people` renvoie de vraies données. On la crée sur
TA machine (avec navigateur + écran), puis on importe ici uniquement les 2
fichiers **portables** :

```
~/.linkedin-mcp/
  cookies.json        ← cookies LinkedIn (format Playwright) — PORTABLE
  source-state.json   ← { source_runtime_id, login_generation } — PORTABLE
  profile/            ← profil navigateur (spécifique à ta machine) — NON portable
  patchright-browsers/ ← navigateur Chromium (~200 Mo) — recréé ici
```

Seuls `cookies.json` + `source-state.json` sont à transférer. Le reste est
recréé automatiquement (bridge de runtime vers `linux-x64-container`).

---

## 1) Sur TA machine (Mac/Windows/Linux avec navigateur)

Installe `uv` si absent : https://docs.astral.sh/uv/getting-started/installation/

### Option A — login navigateur (si pas déjà connecté à LinkedIn dans un navigateur)

```bash
uvx mcp-server-linkedin@latest --login
```

→ Une fenêtre Chromium s'ouvre : connecte-toi à LinkedIn, ferme la fenêtre.
La session est sauvegardée dans `~/.linkedin-mcp/`.

### Option B — import depuis ton navigateur (plus rapide si tu es déjà connecté)

```bash
# Chrome / Edge / Chromium (défaut auto)
uvx mcp-server-linkedin@latest --import-from-browser

# ou Brave
uvx mcp-server-linkedin@latest --import-from-browser brave
```

### Vérifier que ça a marché (optionnel)

```bash
uvx mcp-server-linkedin@latest --status
# → doit afficher "✅ Session is valid"
```

### Emballer les 2 fichiers portables

```bash
cd ~/.linkedin-mcp
tar -czf ~/linkedin-mcp-session.tar.gz cookies.json source-state.json
```

Le fichier `~/linkedin-mcp-session.tar.gz` pèse quelques Ko.

---

## 2) Transférer vers le serveur

Choisis une méthode :

- **scp** : `scp ~/linkedin-mcp-session.tar.gz user@serveur:/home/tunation_fr/`
- **ou colle le contenu** des 2 fichiers JSON dans le chat (je les écris ici).

---

## 3) Sur le serveur (import)

```bash
cd /home/tunation_fr/zentara/backend/linkedin
bash import-mcp-session.sh /home/tunation_fr/linkedin-mcp-session.tar.gz
```

Le script copie `cookies.json` + `source-state.json` dans `~/.linkedin-mcp/`
et lance `--status` pour vérifier.

⚠️ Au premier `--status` ou appel d'outil, le serveur télécharge son Chromium
dans `~/.linkedin-mcp/patchright-browsers` (~200 Mo) puis crée le profil de
runtime dérivé (bridge). Ça prend 1-2 min la première fois.

---

## 4) Tester la vraie recherche People

Une fois la session importée, le bouton **👥 Chercher des personnes LinkedIn**
du chat (ou `POST /api/engine/search` mode `people`) renverra de vrais profils.

---

## Notes de sécurité

- `cookies.json` équivaut à être connecté à LinkedIn : **ne le partage pas**.
- L'automatisation LinkedIn peut restreindre le compte → préfère un compte dédié.
- La session expire au bout de quelques semaines → refais l'étape 1.
