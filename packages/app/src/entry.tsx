// @refresh reload
import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface } from "@/app"
import { Platform, PlatformProvider, type LaunchZeeGuiOptions } from "@/context/platform"
import { dict as en } from "@/i18n/en"
import { dict as zh } from "@/i18n/zh"
import pkg from "../package.json"

const DEFAULT_SERVER_URL_KEY = "zee.settings.dat:defaultServerUrl"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  const locale = (() => {
    if (typeof navigator !== "object") return "en" as const
    const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
    for (const language of languages) {
      if (!language) continue
      if (language.toLowerCase().startsWith("zh")) return "zh" as const
    }
    return "en" as const
  })()

  const key = "error.dev.rootNotFound" as const
  const message = locale === "zh" ? (zh[key] ?? en[key]) : en[key]
  throw new Error(message)
}

async function launchViaTauriShell(opts: LaunchZeeGuiOptions = {}): Promise<boolean> {
  const tauri = (
    window as unknown as {
      __TAURI__?: {
        shell?: {
          Command?: {
            create?: (
              program: string,
              args?: string[],
            ) => { spawn?: () => Promise<unknown>; execute?: () => Promise<unknown> }
          }
        }
      }
    }
  ).__TAURI__

  const create = tauri?.shell?.Command?.create
  if (typeof create !== "function") return false

  const args = ["gui"]
  if (opts.sidebar) args.push("--sidebar")
  if (opts.runtimeMode) args.push("--runtime-mode", opts.runtimeMode)

  try {
    const command = create("zee", args)
    if (command?.spawn) {
      await command.spawn()
      return true
    }
    if (command?.execute) {
      await command.execute()
      return true
    }
  } catch {
    return false
  }

  return false
}

const platform: Platform = {
  platform: "web",
  version: pkg.version,
  openLink(url: string) {
    window.open(url, "_blank")
  },
  back() {
    window.history.back()
  },
  forward() {
    window.history.forward()
  },
  restart: async () => {
    window.location.reload()
  },
  notify: async (title, description, href) => {
    if (!("Notification" in window)) return

    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission().catch(() => "denied")
        : Notification.permission

    if (permission !== "granted") return

    const inView = document.visibilityState === "visible" && document.hasFocus()
    if (inView) return

    await Promise.resolve()
      .then(() => {
        const notification = new Notification(title, {
          body: description ?? "",
          icon: "/favicon-96x96-v3.png",
        })
        notification.onclick = () => {
          window.focus()
          if (href) {
            window.history.pushState(null, "", href)
            window.dispatchEvent(new PopStateEvent("popstate"))
          }
          notification.close()
        }
      })
      .catch(() => undefined)
  },
  getDefaultServerUrl: () => {
    if (typeof localStorage === "undefined") return null
    try {
      return localStorage.getItem(DEFAULT_SERVER_URL_KEY)
    } catch {
      return null
    }
  },
  setDefaultServerUrl: (url) => {
    if (typeof localStorage === "undefined") return
    try {
      if (url) {
        localStorage.setItem(DEFAULT_SERVER_URL_KEY, url)
        return
      }
      localStorage.removeItem(DEFAULT_SERVER_URL_KEY)
    } catch {
      return
    }
  },
  launchZeeGui: async (opts) => launchViaTauriShell(opts),
}

render(
  () => (
    <PlatformProvider value={platform}>
      <AppBaseProviders>
        <AppInterface />
      </AppBaseProviders>
    </PlatformProvider>
  ),
  root!,
)
