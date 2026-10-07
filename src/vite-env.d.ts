/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_ORS_KEY?: string;
  /** The cron worker's POST /report URL; without it the report form opens a GitHub issue. */
  readonly VITE_REPORT_URL?: string;
  readonly BASE_URL: string;
}
