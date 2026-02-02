interface ImportMetaEnv {
  readonly VITE_AGENT_CORE_SERVER_HOST: string
  readonly VITE_AGENT_CORE_SERVER_PORT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
