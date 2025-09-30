declare const __dirname: string;

interface ImportMetaEnv {
  readonly VITE_COTURN_HOST?: string;
  readonly VITE_COTURN_USER?: string;
  readonly VITE_COTURN_PASS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
