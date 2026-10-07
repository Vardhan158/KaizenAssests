/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WAREHOUSE_CORE_API: string;
  readonly VITE_LOGISTICS_RETURNS_API: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
