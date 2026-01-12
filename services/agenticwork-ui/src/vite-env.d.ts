/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_ENABLE_CHAIN_OF_THOUGHT?: string

  // Build-time feature flags
  readonly VITE_FEATURE_OLLAMA?: string
  readonly VITE_FEATURE_FLOWISE?: string
  readonly VITE_FEATURE_AGENTICODE?: string
  readonly VITE_FEATURE_MULTIMODEL?: string
  readonly VITE_FEATURE_SLIDER?: string
  readonly VITE_FEATURE_MCP?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
