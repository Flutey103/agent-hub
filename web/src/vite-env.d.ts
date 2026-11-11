/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Set only when the API is on a different origin. The Worker build leaves this unset. */
  readonly VITE_SERVER_URL?: string;
}
