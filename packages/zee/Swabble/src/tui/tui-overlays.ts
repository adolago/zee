import type { Component, TUI } from "@mariozechner/pi-tui";
import { OverlayFrame } from "./components/overlay-frame.js";

type OverlayHost = Pick<TUI, "showOverlay" | "hideOverlay" | "hasOverlay" | "setFocus">;

export function createOverlayHandlers(host: OverlayHost, fallbackFocus: Component) {
  const openOverlay = (component: Component) => {
    host.showOverlay(new OverlayFrame(component));
  };

  const closeOverlay = () => {
    if (host.hasOverlay()) {
      host.hideOverlay();
      return;
    }
    host.setFocus(fallbackFocus);
  };

  return { openOverlay, closeOverlay };
}
