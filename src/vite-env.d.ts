/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_ORS_KEY?: string;
  /** Overrides where feedback is posted, e.g. a local `wrangler dev`; see REPORT_ENDPOINT. */
  readonly VITE_REPORT_URL?: string;
  readonly BASE_URL: string;
}
