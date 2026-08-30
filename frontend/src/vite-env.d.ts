/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL du backend Zentara (ex: http://localhost:4000/api). */
  readonly VITE_API_BASE_URL: string;
  /** Toggle pour activer le sync hybride (défaut: true). */
  readonly VITE_SYNC_ENABLED?: string;
  /** Timeout par défaut des requêtes API (ms). */
  readonly VITE_API_TIMEOUT_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
