/**
 * ZENTARA SYNC — Google Apps Script intégré à Zentara
 * ======================================================
 *
 * Un seul script = 5 super-pouvoirs Google pour ton app :
 *   1. GOOGLE SHEETS  → base de données (companies, prospects, contacts,
 *                       emails, contrats, monitoring, etc.)
 *   2. ENTRAÎNEMENT IA → toutes les requêtes/réponses des modèles sont
 *                       consignées dans la feuille +training+ (tu peux
 *                       ensuite exporter ce CSV en dataset).
 *   3. GOOGLE DOCS    → génération de contrats / rapports / documents
 *                       (Markdown → Google Doc + export PDF).
 *   4. GOOGLE CALENDAR → création d'événements (meetings, RDV CTA emails).
 *   5. GOOGLE MAPS    → géocodage / recherche de lieux (service Maps
 *                       intégré à Apps Script, AUCUNE clé API requise).
 *   Bonus : GMAIL → envoi d'emails depuis le Gmail du compte propriétaire.
 *
 * ----------------------------------------------------------------------
 * DÉPLOIEMENT (une seule fois) :
 *   1. Ouvre https://script.google.com → Nouveau projet.
 *   2. Colle TOUT ce fichier dans Code.gs.
 *   3. (Optionnel) Renseigne SPREADSHEET_ID ci-dessous, sinon le script
 *      crée automatiquement les feuilles sur une NOUVELLE spreadsheet.
 *   4. Déploiement → Nouveau déploiement → Application Web :
 *        - Exécuter en tant que : Moi
 *        - Accès : Toute personne (gratuit) — ou "Tous utilisateurs anonymes"
 *      Copie l'URL /exec, colle-la dans Zentara → Réglages → Sheets Sync.
 *
 *   ⚠️ Après le premier déploiement, si tu modifies le code, fais
 *      « Gérer les déploiements → Modifier → Nouvelle version ».
 * ----------------------------------------------------------------------
 */

// =====================================================================
// CONFIG
// =====================================================================

/** ID de la spreadsheet DB. Laisse '' pour créer/utiliser une nouvelle spreadsheet. */
const SPREADSHEET_ID = '';

/** Calendrier utilisé par défaut (laisse '' pour le calendrier principal). */
const CALENDAR_ID = '';

/** Nom affiché de l'émetteur des emails (sujet pre-header Gmail). */
const SENDER_NAME = 'Zentara';

/** Feuille d'entraînement IA : 1000 dernières entrées max par sync (quota-friendly). */
const TRAIN_BATCH_MAX = 1000;

/** Colonnes fixes des feuilles "tables" (ordre = ordre des colonnes). */
const TABLE_HEADERS = {
  companies: ['id', 'name', 'website', 'sector', 'industry', 'address', 'city', 'country', 'phone', 'email', 'score', 'status', 'tags', 'created_at'],
  prospects: ['id', 'company_id', 'first_name', 'last_name', 'email', 'phone', 'role', 'sector', 'city', 'country', 'website', 'score', 'status', 'tags', 'created_at'],
  contacts: ['id', 'company_id', 'first_name', 'last_name', 'role', 'email', 'phone', 'tags', 'status', 'created_at'],
  campaigns: ['id', 'name', 'description', 'status', 'target', 'created_at'],
  emails: ['id', 'prospect_id', 'company_id', 'subject', 'status', 'tone', 'sent_at', 'created_at'],
  contracts: ['id', 'type', 'status', 'title', 'party_a_id', 'party_b_id', 'party_b_name', 'party_b_email', 'product_ref', 'created_at'],
  monitoring: ['id', 'entity_type', 'entity_id', 'source', 'signal_type', 'signal', 'confidence', 'detected_at'],
  intelligence: ['id', 'entity_type', 'entity_id', 'score', 'summary', 'created_at'],
  tasks: ['id', 'title', 'status', 'priority', 'due_at', 'created_at'],
};

/** Feuille d'entraînement IA : colonnes. */
const TRAIN_HEADERS = [
  'timestamp', 'kind', 'provider', 'model', 'prompt', 'output', 'entity', 'score', 'feedback', 'origin',
];

/** Feuille d'activité (logs de l'Apps Script). */
const ACTIVITY_HEADERS = ['timestamp', 'action', 'status', 'detail'];

// =====================================================================
// doGet / doPost — entry points WebApp
// =====================================================================

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'status';
  return route_(action, e && e.parameter ? e.parameter : {});
}

function doPost(e) {
  let body = {};
  try {
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
  } catch (err) {
    body = { action: 'error', message: 'JSON invalide : ' + err.message };
  }
  return handle_(body);
}

function handle_(body) {
  return route_(body.action || 'append', body);
}

function route_(action, params) {
  const t0 = Date.now();
  let result;
  try {
    switch (String(action || '').toLowerCase()) {
      case 'ping':
      case 'status':       result = status_(); break;
      case 'sync':         result = sync_(params); break;
      case 'append':       result = append_(params); break;
      case 'query':        result = query_(params); break;
      case 'train':        result = train_(params); break;
      case 'email-send':   result = emailSend_(params); break;
      case 'contract':     result = contract_(params); break;
      case 'calendar-event': result = calendarEvent_(params); break;
      case 'maps-geocode': result = mapsGeocode_(params); break;
      case 'maps-place':   result = mapsGeocode_(params); break;
      case 'list-db':      result = listDb_(params); break;
      case 'set-db':       result = setDb_(params); break;
      case 'reset-db':     result = resetDb_(params); break;
      default:
        result = { ok: false, error: 'Action inconnue: ' + action };
    }
  } catch (err) {
    result = { ok: false, error: String(err && err.message || err) };
  }
  activity_(action || '?', result && result.ok ? 'ok' : 'err', (result && result.error) || (result && result.message) || '');
  return json_({
    ok: !!result.ok,
    action: action || '',
    ts: new Date().toISOString(),
    duration_ms: Date.now() - t0,
    ...result,
  });
}

// =====================================================================
// Helpers
// =====================================================================

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function slice_(s, n) {
  return String(s == null ? '' : s).slice(0, n || 400);
}

/**
 * Résout LA spreadsheet DB à utiliser, dans cet ordre :
 *   1. SPREADSHEET_ID codé en dur (si renseigné) ;
 *   2. ID épinglé via l'action `set-db` (propriété ZENTARA_SPREADSHEET_ID) ;
 *   3. une "Zentara DB" déjà présente dans le Drive (la plus récente) ;
 *   4. sinon, création d'UNE seule "Zentara DB".
 *
 * Les étapes 3-4 empêchent la multiplication de fichiers quand plusieurs
 * projets/déploiements Apps Script pointent vers le même compte Drive.
 */
function getSpreadsheet_() {
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);

  var props = PropertiesService.getScriptProperties();

  var saved = props.getProperty('ZENTARA_SPREADSHEET_ID');
  if (saved) {
    try {
      return SpreadsheetApp.openById(saved);
    } catch (e) { /* spreadsheet supprimée → on retombe plus bas */ }
  }

  var existing = findExistingZentaraDb_();
  if (existing) {
    props.setProperty('ZENTARA_SPREADSHEET_ID', existing.getId());
    return existing;
  }

  var ss = SpreadsheetApp.create('Zentara DB');
  props.setProperty('ZENTARA_SPREADSHEET_ID', ss.getId());
  return ss;
}

/** Cherche dans le Drive toutes les spreadsheets "Zentara DB" (non corbeille)
 *  et renvoie la plus récemment modifiée, ou null. */
function findExistingZentaraDb_() {
  try {
    var files = DriveApp.searchFiles(
      "mimeType = 'application/vnd.google-apps.spreadsheet' and title = 'Zentara DB' and trashed = false"
    );
    var newest = null;
    var newestDate = null;
    while (files.hasNext()) {
      var f = files.next();
      var d = f.getLastUpdated();
      if (!newest || d > newestDate) { newest = f; newestDate = d; }
    }
    if (newest) return SpreadsheetApp.openById(newest.getId());
  } catch (e) { /* permissions Drive absentes ou aucun résultat */ }
  return null;
}

/** Liste toutes les spreadsheets "Zentara DB" du Drive (pour choisir/corbeille). */
function listZentaraDbs_() {
  var out = [];
  try {
    var files = DriveApp.searchFiles(
      "mimeType = 'application/vnd.google-apps.spreadsheet' and title = 'Zentara DB' and trashed = false"
    );
    while (files.hasNext()) {
      var f = files.next();
      var id = f.getId();
      var nbFeuilles = 0;
      var nbLignes = 0;
      try {
        var ss = SpreadsheetApp.openById(id);
        var shs = ss.getSheets();
        nbFeuilles = shs.length;
        for (var i = 0; i < shs.length; i++) {
          var last = shs[i].getLastRow();
          nbLignes += last > 1 ? last - 1 : 0;
        }
      } catch (e) { /* spreadsheet illisible */ }
      out.push({
        id: id,
        url: 'https://docs.google.com/spreadsheets/d/' + id + '/edit',
        name: f.getName(),
        updated_at: f.getLastUpdated().toISOString(),
        sheets: nbFeuilles,
        data_rows: nbLignes,
      });
    }
  } catch (e) { /* ignore */ }
  return out;
}

function sheet_(name, headers) {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (headers && sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#7C3AED').setFontColor('#ffffff');
  }
  return sh;
}

function allRows_(name, headers) {
  const sh = sheet_(name, headers);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
}

/** Ajoute des lignes avec dédup par colonne id (s'il y en a). */
function addRowsDedup_(name, headers, rows) {
  if (!rows || rows.length === 0) return 0;
  const sh = sheet_(name, headers);
  const existing = new Set();
  const idIdx = headers.indexOf('id');
  sh.getLastRow(0);
  for (const r of allRows_(name, headers)) {
    if (idIdx >= 0 && r[idIdx]) existing.add(String(r[idIdx]));
  }
  let added = 0;
  const toAppend = [];
  for (const row of rows) {
    const vals = headers.map((h) => (row[h] === undefined || row[h] === null ? null : typeof row[h] === 'object' ? JSON.stringify(row[h]) : String(row[h])));
    if (idIdx >= 0 && vals[idIdx] && existing.has(String(vals[idIdx]))) continue;
    if (idIdx >= 0 && vals[idIdx]) existing.add(String(vals[idIdx]));
    toAppend.push(vals);
    added++;
  }
  if (toAppend.length) sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, headers.length).setValues(toAppend);
  return added;
}

function activity_(action, status, detail) {
  try {
    const sh = sheet_('activity', ACTIVITY_HEADERS);
    sh.appendRow([new Date().toISOString(), action, status, slice_(detail, 300)]);
  } catch (e) { /* non bloquant */ }
}

// =====================================================================
// 1. STATUS / PING
// =====================================================================

function status_() {
  const ss = getSpreadsheet_();
  return {
    ok: true,
    name: 'Zentara Sync Apps Script',
    spreadsheet_id: ss.getId(),
    spreadsheet_url: ss.getUrl(),
    sheets: ss.getSheets().map((s) => s.getName()),
    services: {
      sheets: true,
      docs: true,
      calendar: !!CalendarApp.getDefaultCalendar(),
      maps: true,
      gmail: true,
    },
  };
}

// =====================================================================
// 2. SYNC — pousse plein de tables depuis Zentara backend
// =====================================================================

function sync_(params) {
  const tables = params.tables || {};
  const out = { tables: [], rows: 0 };
  for (const name of Object.keys(tables)) {
    const rows = tables[name];
    if (!Array.isArray(rows)) continue;
    const headers = TABLE_HEADERS[name] || Object.keys(rows[0] || {}).sort();
    const n = addLogLines_(name, headers, rows);
    out.tables.push(name);
    out.rows += n;
  }
  if (params.training && Array.isArray(params.training)) {
    const n = addLogLines_('training', TRAIN_HEADERS, params.training);
    out.tables.push('training');
    out.rows += n;
  }
  return { ok: true, message: 'Sync terminé : ' + out.rows + ' lignes vers ' + out.tables.length + ' feuille(s).', ...out };
}

// =====================================================================
// 3. APPEND — une ligne dans une table
// =====================================================================

function append_(params) {
  const table = params.table || params.table_name;
  const row = params.row || params;
  if (!table || typeof row !== 'object') throw new Error('table + row requis');
  const headers = TABLE_HEADERS[table] || Object.keys(row).sort();
  const n = addLogLines_(table, headers, [row]);
  return { ok: true, message: 'append ' + table + ' : ' + n + ' ligne(s)', rows: n };
}

// =====================================================================
// 4. QUERY — cherche des lignes (colonne = valeur)
// =====================================================================

function query_(params) {
  const table = params.table;
  const column = params.column;
  const value = String(params.value == null ? '' : params.value).toString();
  const limit = Number(params.limit || 100);
  if (!table) throw new Error('table requis');
  const headers = TABLE_HEADERS[table] || [];
  const rows = allRows_(table, headers);
  const colIdx = headers.indexOf(column);
  const out = [];
  for (const r of rows) {
    if (colIdx >= 0 && String(r[colIdx]).toLowerCase().indexOf(value.toLowerCase()) !== -1) {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = r[i]; });
      out.push(obj);
      if (out.length >= limit) break;
    }
  }
  return { ok: true, matches: out.length, rows: out, table };
}

// =====================================================================
// 5. ENTRAÎNEMENT IA — consigne requête/réponse + feedback
// =====================================================================

function train_(params) {
  const item = params;
  const timestamp = new Date().toISOString();
  const rows = Array.isArray(params.items) ? params.items : [params];
  const norm = rows.map((it) => ({
    timestamp: it.timestamp || timestamp,
    kind: it.kind || it.type || 'llm',
    provider: it.provider || '',
    model: it.model || '',
    prompt: slice_(it.prompt || it.input || '', 4000),
    output: slice_(it.output || it.response || it.answer || '', 8000),
    entity: it.entity || it.entity_type || '',
    score: it.score == null ? '' : String(it.score),
    feedback: (it.feedback || (it.rating != null ? String(it.rating) : '')),
    origin: it.origin || 'zentara',
  }));
  const n = addLogLines_('training', TRAIN_HEADERS, norm);
  // Consigne aussi dans une feuille "ai_log" brute (pas de dédup) pour l'historique complet.
  try {
    addLogLines_('ai_log', TRAIN_HEADERS, norm);
  } catch (e) {}
  return { ok: true, message: n + " entrée(s) d'entraînement consignée(s)", rows: n };
}

// =====================================================================
// 6. EMAIL — envoie via le Gmail du compte script (GmailApp)
// =====================================================================

function emailSend_(params) {
  const to = params.to || params.recipient || params.recipients;
  const subject = params.subject || '';
  const html = params.html || params.html_body || params.body || '';
  if (!to) throw new Error('destinataire requis (to)');
  const options = { htmlBody: html, name: SENDER_NAME };
  if (params.cc) options.cc = params.cc;
  if (params.bcc) options.bcc = params.bcc;
  if (params.replyTo) options.replyTo = params.replyTo;
  const msg = GmailApp.sendEmail(String(to).split(','), subject, html.replace(/<[^>]+>/g, ''), options);
  return { ok: true, message: 'Email envoyé à ' + to, message_id: msg.getId() };
}

// =====================================================================
// 7. GOOGLE DOCS — contrat / document depuis du Markdown
// =====================================================================

function contract_(params) {
  const title = params.title || 'Document Zentra';
  const md = params.markdown || params.body || params.content || '';
  const doc = DocumentApp.create(title);
  markdownToDoc_(doc, String(md));
  const file = DriveApp.getFileById(doc.getId());
  // Export PDF côté Drive
  let pdfUrl = null;
  try {
    const blob = doc.getBlob().getAs('application/pdf');
    const pdfFile = DriveApp.createFile(blob);
    pdfFile.setName(title + '.pdf');
    pdfUrl = pdfFile.getUrl();
  } catch (e) { /* PDF dispo si l'export fonctionne */ }
  const result = { ok: true, doc_id: doc.getId(), url: doc.getUrl(), pdf_url: pdfUrl };
  if (params.email_to) {
    emailSend_({
      to: params.email_to,
      subject: 'Document : ' + title,
      html: '<p>Veuillez trouver le document : <a href="' + doc.getUrl() + '">' + title + '</a></p>',
    });
    result.sent_to = params.email_to;
  }
  return result;
}

function markdownToDoc_(doc, md) {
  const body = doc.getBody();
  body.clear();
  md.split('\n').forEach(function (line) {
    const l = line.trim();
    if (!l) { body.appendParagraph(''); return; }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) { body.appendParagraph(h[2]).setHeading(Number(h[1].length)); return; }
    if (/^-\s+/.test(l)) { body.appendListItem(l.replace(/^-\s+/, '')).setGlyphType(DocumentApp.GlyphType.BULLET); return; }
    body.appendParagraph(l);
  });
}

// =====================================================================
// 8. GOOGLE CALENDAR — événement
// =====================================================================

function calendarEvent_(params) {
  const title = params.title || params.summary || 'RDV Zentara';
  const cal = (CALENDAR_ID ? CalendarApp.getCalendarById(CALENDAR_ID) : null) || CalendarApp.getDefaultCalendar();
  const start = new Date(params.start || Date.now() + 3600 * 1000);
  const end = params.end ? new Date(params.end) : new Date(start.getTime() + 30 * 60 * 1000);
  const opt = {};
  if (params.description) opt.description = String(params.description);
  if (params.location) opt.location = String(params.location);
  const attendees = params.attendees || params.guests || params.attendee;
  if (attendees) opt.guests = String(attendees).split(',');
  const ev = cal.createEvent(title, start, end, opt);
  return { ok: true, event_id: ev.getId(), url: ev.getDescription() ? ev.getDescription() : 'https://calendar.google.com/', start: start.toISOString(), end: end.toISOString() };
}

// =====================================================================
// 9. GOOGLE MAPS — géocodage / recherche de lieux (sans clé API)
// =====================================================================

function mapsGeocode_(params) {
  const q = params.address || params.query || params.q || params.place;
  if (!q) throw new Error('address/query requis');
  const geo = Maps.newGeocoder().geocode(String(q));
  const status = geo.status;
  if (status !== 'OK') return { ok: false, error: 'Maps status: ' + status };
  const out = [];
  (geo.results || []).slice(0, 5).forEach(function (r) {
    out.push({
      formatted_address: r.formatted_address,
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      place_id: r.place_id,
      types: r.types || [],
    });
  });
  return { ok: true, matches: out.length, results: out };
}

// =====================================================================
// 10. GESTION DE LA SPREADSHEET DB (anti-doublons)
// =====================================================================

function listDb_(params) {
  const dbs = listZentaraDbs_();
  const current = getSpreadsheet_();
  return {
    ok: true,
    active_id: current.getId(),
    active_url: current.getUrl(),
    count: dbs.length,
    databases: dbs,
  };
}

/** Épingle UNE spreadsheet existante comme DB (ex : celle qui a tes données).
 *  Paramètre : spreadsheet_id (ou id). */
function setDb_(params) {
  const id = String(params.spreadsheet_id || params.id || '').trim();
  if (!id) throw new Error('spreadsheet_id requis (ex : action=set-db&spreadsheet_id=XXXX)');
  SpreadsheetApp.openById(id); // lève une erreur si l'ID est invalide
  PropertiesService.getScriptProperties().setProperty('ZENTARA_SPREADSHEET_ID', id);
  return {
    ok: true,
    message: 'Spreadsheet DB épinglée.',
    spreadsheet_id: id,
    spreadsheet_url: 'https://docs.google.com/spreadsheets/d/' + id + '/edit',
  };
}

/** Désépingle la spreadsheet mémorisée → retombe sur la recherche Drive
 *  (réutilise une "Zentara DB" existante) ou en recrée une. */
function resetDb_(params) {
  PropertiesService.getScriptProperties().deleteProperty('ZENTARA_SPREADSHEET_ID');
  const ss = getSpreadsheet_();
  return {
    ok: true,
    message: 'Épinglage réinitialisé.',
    spreadsheet_id: ss.getId(),
    spreadsheet_url: ss.getUrl(),
  };
}

// =====================================================================
// tiny helpers
// =====================================================================

function addLogLines_(table, headers, rows) {
  if (!rows || rows.length === 0) return 0;
  const sh = sheet_(table, headers);
  const existing = new Set();
  const idIdx = headers.indexOf('id');
  for (const r of allRows_(table, headers)) if (idIdx >= 0 && r[idIdx]) existing.add(String(r[idIdx]));
  const toAppend = [];
  let added = 0;
  for (const row of rows) {
    const vals = headers.map((h) => (row[h] === undefined || row[h] === null ? null : typeof row[h] === 'object' ? JSON.stringify(row[h]) : String(row[h])));
    if (idIdx >= 0 && vals[idIdx] && existing.has(String(vals[idIdx]))) continue;
    if (idIdx >= 0 && vals[idIdx]) existing.add(String(vals[idIdx]));
    toAppend.push(vals);
    added++;
  }
  if (toAppend.length) sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, headers.length).setValues(toAppend);
  return added;
}