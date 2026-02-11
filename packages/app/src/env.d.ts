interface ImportMetaEnv {
  readonly VITE_ZEE_SERVER_HOST: string
  readonly VITE_ZEE_SERVER_PORT: string
  readonly VITE_ZEE_CHANGELOG_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
