import "@/index.css"
import { ErrorBoundary, Show, createEffect, lazy, type ParentProps } from "solid-js"
import { Router, Route, Navigate } from "@solidjs/router"
import { MetaProvider } from "@solidjs/meta"
import { Font } from "@agent-core/ui/font"
import { MarkedProvider } from "@agent-core/ui/context/marked"
import { DiffComponentProvider } from "@agent-core/ui/context/diff"
import { CodeComponentProvider } from "@agent-core/ui/context/code"
import { I18nProvider } from "@agent-core/ui/context"
import { Diff } from "@agent-core/ui/diff"
import { Code } from "@agent-core/ui/code"
import { ThemeProvider, useTheme } from "@agent-core/ui/theme"
import { GlobalSyncProvider } from "@/context/global-sync"
import { PermissionProvider } from "@/context/permission"
import { LayoutProvider } from "@/context/layout"
import { GlobalSDKProvider } from "@/context/global-sdk"
import { normalizeServerUrl, ServerProvider, useServer } from "@/context/server"
import { SettingsProvider } from "@/context/settings"
import { TerminalProvider } from "@/context/terminal"
import { PromptProvider } from "@/context/prompt"
import { FileProvider } from "@/context/file"
import { CommentsProvider } from "@/context/comments"
import { NotificationProvider } from "@/context/notification"
import { ModelsProvider } from "@/context/models"
import { PersonaProvider, usePersona, isPersonaId } from "@/context/persona"
import { DialogProvider } from "@agent-core/ui/context/dialog"
import { CommandProvider } from "@/context/command"
import { LanguageProvider, useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { HighlightsProvider } from "@/context/highlights"
import Layout from "@/pages/layout"
import DirectoryLayout from "@/pages/directory-layout"
import { ErrorPage } from "./pages/error"
import { Suspense } from "solid-js"

const Home = lazy(() => import("@/pages/home"))
const Session = lazy(() => import("@/pages/session"))
const Loading = () => <div class="size-full" />

function UiI18nBridge(props: ParentProps) {
  const language = useLanguage()
  return <I18nProvider value={{ locale: language.locale, t: language.t }}>{props.children}</I18nProvider>
}

declare global {
  interface Window {
    __OPENCODE__?: { updaterEnabled?: boolean; serverPassword?: string; deepLinks?: string[] }
  }
}

const PERSONA_THEME_OVERRIDE_KEY = "agent-core.persona-theme-override"

function PersonaThemeBridge(props: ParentProps) {
  const persona = usePersona()
  const theme = useTheme()

  createEffect(() => {
    const id = persona.id()
    const override = localStorage.getItem(PERSONA_THEME_OVERRIDE_KEY)
    if (override === "true") return
    if (isPersonaId(id) && theme.themes()[id]) {
      theme.setTheme(id)
    }
  })

  return <>{props.children}</>
}

function MarkedProviderWithNativeParser(props: ParentProps) {
  const platform = usePlatform()
  return <MarkedProvider nativeParser={platform.parseMarkdown}>{props.children}</MarkedProvider>
}

export function AppBaseProviders(props: ParentProps) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider>
        <LanguageProvider>
          <UiI18nBridge>
            <ErrorBoundary fallback={(error) => <ErrorPage error={error} />}>
              <DialogProvider>
                <MarkedProviderWithNativeParser>
                  <DiffComponentProvider component={Diff}>
                    <CodeComponentProvider component={Code}>{props.children}</CodeComponentProvider>
                  </DiffComponentProvider>
                </MarkedProviderWithNativeParser>
              </DialogProvider>
            </ErrorBoundary>
          </UiI18nBridge>
        </LanguageProvider>
      </ThemeProvider>
    </MetaProvider>
  )
}

function ServerKey(props: ParentProps) {
  const server = useServer()
  return (
    <Show when={server.url} keyed>
      {props.children}
    </Show>
  )
}

export function AppInterface(props: { defaultUrl?: string }) {
  const platform = usePlatform()

  const stored = (() => {
    if (platform.platform !== "web") return
    const result = platform.getDefaultServerUrl?.()
    if (result instanceof Promise) return
    if (!result) return
    return normalizeServerUrl(result)
  })()

  const defaultServerUrl = () => {
    if (props.defaultUrl) return props.defaultUrl
    if (stored) return stored
    if (location.hostname.includes("opencode.ai")) return "http://localhost:4096"
    if (import.meta.env.DEV)
      return `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`

    return window.location.origin
  }

  return (
    <ServerProvider defaultUrl={defaultServerUrl()}>
      <ServerKey>
        <GlobalSDKProvider>
          <GlobalSyncProvider>
          <PersonaProvider>
          <PersonaThemeBridge>
            <Router
              root={(props) => (
                <SettingsProvider>
                  <PermissionProvider>
                    <LayoutProvider>
                      <NotificationProvider>
                        <ModelsProvider>
                          <CommandProvider>
                            <HighlightsProvider>
                              <Layout>{props.children}</Layout>
                            </HighlightsProvider>
                          </CommandProvider>
                        </ModelsProvider>
                      </NotificationProvider>
                    </LayoutProvider>
                  </PermissionProvider>
                </SettingsProvider>
              )}
            >
              <Route
                path="/"
                component={() => (
                  <Suspense fallback={<Loading />}>
                    <Home />
                  </Suspense>
                )}
              />
              <Route path="/:dir" component={DirectoryLayout}>
                <Route path="/" component={() => <Navigate href="session" />} />
                <Route
                  path="/session/:id?"
                  component={(p) => (
                    <Show when={p.params.id ?? "new"}>
                      <TerminalProvider>
                        <FileProvider>
                          <PromptProvider>
                            <CommentsProvider>
                              <Suspense fallback={<Loading />}>
                                <Session />
                              </Suspense>
                            </CommentsProvider>
                          </PromptProvider>
                        </FileProvider>
                      </TerminalProvider>
                    </Show>
                  )}
                />
              </Route>
            </Router>
          </PersonaThemeBridge>
          </PersonaProvider>
          </GlobalSyncProvider>
        </GlobalSDKProvider>
      </ServerKey>
    </ServerProvider>
  )
}
