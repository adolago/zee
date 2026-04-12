export const HIDDEN_SESSION_MODEL_PROVIDER_IDS = new Set(["gemini-cli"])

export type SessionModelPickerProvider = {
  id: string
  models: Record<string, { status?: string }>
}

export type SessionModelPickerAuthStatus = {
  valid: boolean
  expiringSoon: boolean
  expiresIn: number | null
}

type SessionModelPickerVisibilityInput = {
  connectedProviderIDs: Iterable<string>
  authStatus?: Record<string, SessionModelPickerAuthStatus>
}

function toConnectedProviderSet(connectedProviderIDs: Iterable<string>) {
  return connectedProviderIDs instanceof Set ? connectedProviderIDs : new Set(connectedProviderIDs)
}

export function hasSelectableSessionModels(provider: SessionModelPickerProvider) {
  return Object.values(provider.models).some((model) => model.status !== "deprecated")
}

export function isSessionModelProviderVisible<T extends SessionModelPickerProvider>(
  provider: T,
  input: SessionModelPickerVisibilityInput,
) {
  const connectedProviderIDs = toConnectedProviderSet(input.connectedProviderIDs)
  if (HIDDEN_SESSION_MODEL_PROVIDER_IDS.has(provider.id)) return false
  if (!connectedProviderIDs.has(provider.id)) return false
  const status = input.authStatus?.[provider.id]
  if (status && !status.valid) return false
  return hasSelectableSessionModels(provider)
}

export function listVisibleSessionModelProviders<T extends SessionModelPickerProvider>(
  providers: T[],
  input: SessionModelPickerVisibilityInput,
) {
  return providers.filter((provider) => isSessionModelProviderVisible(provider, input))
}

export function hasVisibleSessionModelProviders<T extends SessionModelPickerProvider>(
  providers: T[],
  input: SessionModelPickerVisibilityInput,
) {
  return listVisibleSessionModelProviders(providers, input).length > 0
}
