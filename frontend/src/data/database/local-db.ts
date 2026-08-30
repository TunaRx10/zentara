/**
 * Local DB shim — supports BOTH Capacitor native (iOS/Android) AND web browser.
 *
 * Round 94 — Fallback localStorage :
 *   Sur Capacitor (mobile natif), on utilise `@capacitor-community/sqlite` pour
 *   bénéficier d'une vraie base SQLite locale.
 *   Sur navigateur web (cloudflared/preview APK web), Capacitor n'est pas
 *   disponible → on bascule sur une DB shim qui stocke chaque table dans
 *   `localStorage` (clé `zh:db:<table>` → JSON d'array de rows).
 *
 *   Le problème résolu : depuis Round 93, on remontait désormais les erreurs
 *   du repository au lieu de les swallow → l'utilisateur voyait un toast
 *   "Suppression locale impossible" sur CHAQUE delete alors que le backend
 *   avait bien supprimé. Avec ce fallback, le local delete fonctionne
 *   aussi en mode web → plus de confusion UI.
 */
// Round 146 — Lazy import de Capacitor SQLite.
// Sur le web (Vercel, navigateur standard), ces modules natifs n'existent pas
// et un `import` statique crash l'application entière.
// On utilise un import dynamique + cache pour ne charger le module natif
// QUE lorsqu'on détecte une plateforme Capacitor native (iOS/Android).
type SQLiteTypes = {
  CapacitorSQLite: any;
  SQLiteConnection: any;
  SQLiteDBConnection: any;
};
let _sqliteTypes: SQLiteTypes | null = null;
let _sqliteLoadError = false;

async function loadSQLiteTypes(): Promise<SQLiteTypes | null> {
  if (_sqliteTypes) return _sqliteTypes;
  if (_sqliteLoadError) return null;
  try {
    const mod = await import('@capacitor-community/sqlite');
    _sqliteTypes = {
      CapacitorSQLite: mod.CapacitorSQLite,
      SQLiteConnection: mod.SQLiteConnection,
      SQLiteDBConnection: mod.SQLiteDBConnection,
    };
    return _sqliteTypes;
  } catch {
    _sqliteLoadError = true;
    return null;
  }
}

const DB_NAME = 'zentara_local';

/**
 * Détecte si on tourne dans un contexte Capacitor natif (iOS/Android).
 * En navigateur web (preview/cloudflared), `window.Capacitor` n'existe
 * pas ou `isNativePlatform()` retourne false.
 */
function isNativeCapacitor(): boolean {
  try {
    const w = typeof window !== 'undefined' ? (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }) : null;
    if (w?.Capacitor?.isNativePlatform) return w.Capacitor.isNativePlatform();
    return false;
  } catch {
    return false;
  }
}

// =====================================================================
// Native SQLite path (Capacitor) — lazy
// =====================================================================

let db: any = null;
let _sqlite: any = null;
async function getSQLite(): Promise<any> {
  if (_sqlite) return _sqlite;
  const types = await loadSQLiteTypes();
  if (!types) throw new Error('SQLite not available');
  _sqlite = new types.SQLiteConnection(types.CapacitorSQLite);
  return _sqlite;
}

async function openNative(): Promise<any> {
  if (db) return db;
  try {
    const sqlite = await getSQLite();
    db = await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
    await db.open();
    await db.execute('PRAGMA foreign_keys = ON');
    await migrate(db);
    return db;
  } catch (error) {
    console.error('[local-db] Failed to open native SQLite', error);
    throw error;
  }
}

async function migrate(conn: any): Promise<void> {
  const res = await conn.query("SELECT name FROM sqlite_master WHERE type='table' AND name='users';");
  if (res.values && res.values.length === 0) {
    console.log('[local-db] Running initial migrations...');
    await runInitialMigration(conn);
  }
}

async function runInitialMigration(conn: any): Promise<void> {
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      website TEXT,
      sector TEXT,
      industry TEXT,
      address TEXT,
      city TEXT,
      country TEXT,
      phone TEXT,
      email TEXT,
      social_profiles TEXT,
      google_maps_url TEXT,
      score INTEGER DEFAULT 0,
      status TEXT DEFAULT 'new',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS prospects (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      sector TEXT,
      address TEXT,
      city TEXT,
      country TEXT,
      website TEXT,
      social_profiles TEXT,
      google_maps_url TEXT,
      score INTEGER DEFAULT 0,
      status TEXT DEFAULT 'new',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      role TEXT,
      email TEXT,
      phone TEXT,
      social_profiles TEXT,
      status TEXT DEFAULT 'active',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'draft',
      target TEXT,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS campaign_prospects (
      id TEXT PRIMARY KEY,
      campaign_id TEXT,
      prospect_id TEXT,
      status TEXT DEFAULT 'added',
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(campaign_id, prospect_id),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS intelligence (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      score INTEGER DEFAULT 0,
      opportunity_score INTEGER,
      relevance_score INTEGER,
      intent_score INTEGER,
      activity_score INTEGER,
      confidence_score INTEGER,
      summary TEXT,
      insights TEXT,
      risks TEXT,
      recommendations TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS intelligence_signals (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      source TEXT,
      signal_type TEXT,
      signal TEXT,
      confidence INTEGER,
      detected_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_analysis (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      prompt_version TEXT,
      summary TEXT,
      insights TEXT,
      recommendations TEXT,
      confidence INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      entity_type TEXT,
      entity_id TEXT,
      action TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS monitoring (
      id TEXT PRIMARY KEY,
      entity_type TEXT,
      entity_id TEXT,
      source TEXT,
      signal_type TEXT,
      signal TEXT,
      confidence INTEGER,
      detected_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await conn.execute(schema);
}

// =====================================================================
// Web fallback (Round 94) — localStorage-backed fake SQLite
// =====================================================================

const LS_PREFIX = 'zh:db:';

class LocalStorageDB {
  private loadTable(name: string): Array<Record<string, unknown>> {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_PREFIX + name) : null;
      return raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : [];
    } catch {
      return [];
    }
  }
  private saveTable(name: string, rows: Array<Record<string, unknown>>): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LS_PREFIX + name, JSON.stringify(rows));
  }
  // retourne `{ values: [...] }` comme Capacitor.
  async query(sql: string, params: unknown[] = []): Promise<{ values: Array<Record<string, unknown>> | undefined }> {
    const upper = sql.trim().toUpperCase();
    if (!upper.startsWith('SELECT')) {
      // On ne supporte que SELECT/INSERT/UPDATE/DELETE via run() ; query()
      // sert uniquement à `SELECT name FROM sqlite_master` pour migrate().
      return { values: undefined };
    }
    // SELECT name FROM sqlite_master WHERE type='table' AND name='...';
    const sm = sql.match(/FROM\s+sqlite_master\s+WHERE\s+type\s*=\s*'table'\s+AND\s+name\s*=\s*\?/i);
    if (sm) {
      const tableName = String(params[0] ?? '').replace(/^['"]|['"]$/g, '');
      const exists = this.loadTable(tableName).length >= 0 && localStorage.getItem(LS_PREFIX + tableName) !== null
        || (localStorage.getItem(LS_PREFIX + tableName) === '[]');
      // Si jamais le user a créé au moins une ligne, la table existe.
      // Sinon : on retourne [] (la migrate() traitera comme table absente et créera le bootstrap).
      // Pour distinguer "n'existe pas" → on efface la clé de marker juste avant chaque session — non.
      // Approximation : on retourne la présence du bootstrap key `__seed_v1`.
      const seeded = localStorage.getItem(LS_PREFIX + '_seeded_tables');
      const seededSet = seeded ? (JSON.parse(seeded) as string[]) : [];
      const exists2 = seededSet.includes(tableName);
      return { values: exists2 ? [{ name: tableName }] : [] };
    }
    // SELECT * FROM <table> [WHERE ...] [ORDER BY ...]
    const m = sql.match(/FROM\s+([a-zA-Z_]+)/i);
    if (!m) return { values: [] };
    const tableName = m[1];
    const rows = this.loadTable(tableName);
    // WHERE simplifié : `col = ?`
    const wh = sql.match(/WHERE\s+([a-zA-Z_]+)\s*=\s*\?/i);
    let filtered = rows;
    if (wh && params.length > 0) {
      const col = wh[1];
      const val = String(params[0]);
      filtered = rows.filter((r) => String(r[col] ?? '') === val);
    } else {
      const whLike = sql.match(/WHERE\s+([a-zA-Z_]+)\s+LIKE\s+\?/i);
      if (whLike && params.length > 0) {
        const col = whLike[1];
        const val = String(params[0]).replace(/%/g, '');
        filtered = rows.filter((r) => String(r[col] ?? '').toLowerCase().includes(val.toLowerCase()));
      } else {
        // Multi-col avec OR LIKE patterns (search repository)
        const whMulti = sql.match(/WHERE\s+(.+?)(?:ORDER|LIMIT|$)/i);
        if (whMulti && params.length >= 4) {
          const searchTerm = String(params[0]).replace(/%/g, '').toLowerCase();
          filtered = rows.filter((r) =>
            ['first_name', 'last_name', 'email', 'sector'].some((c) =>
              String(r[c] ?? '').toLowerCase().includes(searchTerm),
            ),
          );
        }
      }
    }
    // ORDER BY col [DESC]
    const ord = sql.match(/ORDER\s+BY\s+([a-zA-Z_]+)(?:\s+(ASC|DESC))?/i);
    if (ord) {
      const col = ord[1];
      const dir = (ord[2] ?? 'ASC').toUpperCase();
      filtered = [...filtered].sort((a, b) => {
        const av = String(a[col] ?? '');
        const bv = String(b[col] ?? '');
        return dir === 'DESC' ? bv.localeCompare(av) : av.localeCompare(bv);
      });
    }
    // LIMIT n
    const lm = sql.match(/LIMIT\s+(\d+)/i);
    if (lm) {
      filtered = filtered.slice(0, Number(lm[1]));
    }
    return { values: filtered as Array<Record<string, unknown>> };
  }
  // INSERT/UPDATE/DELETE — on parse les paramètres dans l'ordre.
  async run(sql: string, params: unknown[] = []): Promise<void> {
    const upper = sql.trim().toUpperCase();
    if (!upper.startsWith('INSERT') && !upper.startsWith('UPDATE') && !upper.startsWith('DELETE')) return;
    const m = sql.match(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-zA-Z_]+)/i);
    if (!m) return;
    const tableName = m[1];
    const rows = this.loadTable(tableName);
    if (upper.startsWith('DELETE')) {
      const wh = sql.match(/WHERE\s+([a-zA-Z_]+)\s*=\s*\?/i);
      if (wh) {
        const col = wh[1];
        const val = String(params[0] ?? '');
        const next = rows.filter((r) => String(r[col] ?? '') !== val);
        this.saveTable(tableName, next);
      } else {
        this.saveTable(tableName, []);
      }
      return;
    }
    if (upper.startsWith('INSERT')) {
      // INSERT INTO table (col1, col2, ...) VALUES (?, ?, ...)
      // On extrait l'ordre des colonnes entre parenthèses après le nom de table.
      const colsMatch = sql.match(/INTO\s+[a-zA-Z_]+\s*\(([^)]+)\)/i);
      const cols = colsMatch ? colsMatch[1].split(',').map((c) => c.trim()) : [];
      const row: Record<string, unknown> = {};
      cols.forEach((c, i) => {
        row[c] = this.coerce(params[i]);
      });
      rows.push(row);
      this.saveTable(tableName, rows);
      // Marquer la table comme "initialisée" pour le bootstrap migré.
      const seeded = localStorage.getItem(LS_PREFIX + '_seeded_tables');
      const seededSet: string[] = seeded ? (JSON.parse(seeded) as string[]) : [];
      if (!seededSet.includes(tableName)) {
        seededSet.push(tableName);
        localStorage.setItem(LS_PREFIX + '_seeded_tables', JSON.stringify(seededSet));
      }
      return;
    }
    if (upper.startsWith('UPDATE')) {
      // UPDATE table SET col1=?, col2=?, updated_at=? WHERE id=?
      // On extrait les SET clauses, chaque clause contient "= ?".
      const setSection = sql.match(/SET\s+([\s\S]+?)\s+WHERE/i);
      if (!setSection) return;
      const setParts = setSection[1].split(',').map((p) => p.trim());
      const colNames: string[] = [];
      setParts.forEach((p) => {
        const m2 = p.match(/^([a-zA-Z_]+)\s*=\s*\?$/);
        if (m2) colNames.push(m2[1]);
      });
      // id est toujours le dernier param pour notre schema.
      const id = String(params[params.length - 1] ?? '');
      const target = rows.find((r) => String(r.id ?? '') === id);
      if (!target) return;
      colNames.forEach((col, i) => {
        target[col] = this.coerce(params[i]);
      });
      this.saveTable(tableName, rows);
    }
  }
  async execute(_sql: string): Promise<void> {
    // PRAGMA / multi-statements : no-op côté shim. La "table" est créée
    // à la première insertion.
    return;
  }
  async open(): Promise<void> {
    // nothing
  }
  private coerce(v: unknown): unknown {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') {
      // SQLite stocke souvent les objects en JSON.stringify ; on ne touche pas si c'est déjà du JSON.
      return v;
    }
    return v;
  }
}

async function openBrowser(): Promise<any> {
  // Cast : notre shim expose la même interface publique que Capacitor
  // (`run`, `query`, `execute`, `open`).
  const shim = new LocalStorageDB();
  // bootstrap : marquer la table `prospects` seedée si on a déjà des rows
  // pour ne pas que la migrate() la re-crée.
  const existing = shim as unknown as { loadTable: (n: string) => unknown[] };
  const pros = existing.loadTable('prospects');
  if (pros.length > 0) {
    const seeded = (typeof localStorage !== 'undefined') ? localStorage.getItem(LS_PREFIX + '_seeded_tables') : null;
    const seedSet: string[] = seeded ? (JSON.parse(seeded) as string[]) : [];
    ['prospects', 'companies', 'contacts', 'users'].forEach((t) => {
      if (!seedSet.includes(t)) seedSet.push(t);
    });
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LS_PREFIX + '_seeded_tables', JSON.stringify(seedSet));
    }
  }
  return shim as unknown as any;
}

export async function getDatabase(): Promise<any> {
  if (isNativeCapacitor()) {
    try {
      return await openNative();
    } catch (error) {
      console.warn('[local-db] Native SQLite failed, falling back to localStorage', error);
      return await openBrowser();
    }
  }
  return openBrowser();
}
