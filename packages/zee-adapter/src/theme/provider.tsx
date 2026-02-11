/**
 * Theme Provider for OpenCode Web UI
 *
 * Applies TUI-matching theme to make the web UI look like the terminal.
 */

import { createSignal, createContext, useContext, onMount, type JSX } from "solid-js"

export type ThemeMode = "tui" | "zee" | "auto"

interface ThemeContextValue {
  mode: () => ThemeMode
  setMode: (mode: ThemeMode) => void
  isDark: () => boolean
}

const ThemeContext = createContext<ThemeContextValue>()

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider")
  }
  return ctx
}

export function applyTuiTheme(element: HTMLElement = document.documentElement) {
  element.classList.add("theme-tui")
  element.setAttribute("data-theme", "tui")

  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
  element.style.colorScheme = prefersDark ? "dark" : "light"
}

export function removeTuiTheme(element: HTMLElement = document.documentElement) {
  element.classList.remove("theme-tui")
  element.removeAttribute("data-theme")
}

interface ThemeProviderProps {
  children: JSX.Element
  initialMode?: ThemeMode
}

export function ThemeProvider(props: ThemeProviderProps) {
  const [mode, setMode] = createSignal<ThemeMode>(props.initialMode ?? "tui")
  const [isDark, setIsDark] = createSignal(true)

  onMount(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    setIsDark(mediaQuery.matches)

    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches)
    mediaQuery.addEventListener("change", handler)

    if (mode() === "tui") {
      applyTuiTheme()
    }

    return () => mediaQuery.removeEventListener("change", handler)
  })

  const handleSetMode = (newMode: ThemeMode) => {
    const current = mode()
    if (current === "tui") {
      removeTuiTheme()
    }
    setMode(newMode)
    if (newMode === "tui") {
      applyTuiTheme()
    }
  }

  const value: ThemeContextValue = {
    mode,
    setMode: handleSetMode,
    isDark,
  }

  return (
    <ThemeContext.Provider value={value}>
      {props.children}
    </ThemeContext.Provider>
  )
}
