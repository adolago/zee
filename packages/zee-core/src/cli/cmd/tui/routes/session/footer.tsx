import { StatusBar } from "../../ui/status-bar"
import { Header as HeaderStyles } from "@tui/ui/header-footer"

/**
 * Footer component - renders the StatusBar with consistent styling
 *
 * The StatusBar handles its own internal rendering. This component
 * serves as a wrapper to ensure consistent container styling with
 * the Header component.
 */
export function Footer() {
  return <StatusBar />
}

/**
 * Re-export header style constants for footer consistency.
 *
 * The footer uses the same padding as the header for visual alignment.
 * Use these when creating custom footer components.
 */
export { HeaderStyles }
