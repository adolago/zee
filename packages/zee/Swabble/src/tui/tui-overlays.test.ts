import type { Component, TUI } from "@mariozechner/pi-tui";
import { describe, expect, it, vi } from "vitest";

import { OverlayFrame } from "./components/overlay-frame.js";
import { createOverlayHandlers } from "./tui-overlays.js";

class DummyComponent implements Component {
  render() {
    return ["dummy"];
  }

  invalidate() {}
}

describe("createOverlayHandlers", () => {
  it("routes overlays through the TUI overlay stack", () => {
    const showOverlay = vi.fn();
    const hideOverlay = vi.fn();
    const setFocus = vi.fn();
    const state = { open: false };
    const overlayHandle = {} as ReturnType<TUI["showOverlay"]>;

    const host = {
      showOverlay: (component: Component) => {
        state.open = true;
        showOverlay(component);
        return overlayHandle;
      },
      hideOverlay: () => {
        state.open = false;
        hideOverlay();
      },
      hasOverlay: () => state.open,
      setFocus,
    };

    const { openOverlay, closeOverlay } = createOverlayHandlers(host, new DummyComponent());
    const overlay = new DummyComponent();

    openOverlay(overlay);
    expect(showOverlay).toHaveBeenCalledTimes(1);
    const shown = showOverlay.mock.calls[0]?.[0];
    expect(shown).toBeInstanceOf(OverlayFrame);

    closeOverlay();
    expect(hideOverlay).toHaveBeenCalledTimes(1);
    expect(setFocus).not.toHaveBeenCalled();
  });

  it("restores focus when closing without an overlay", () => {
    const setFocus = vi.fn();
    const overlayHandle = {} as ReturnType<TUI["showOverlay"]>;
    const host = {
      showOverlay: vi.fn(() => overlayHandle),
      hideOverlay: vi.fn(),
      hasOverlay: () => false,
      setFocus,
    };
    const fallback = new DummyComponent();

    const { closeOverlay } = createOverlayHandlers(host, fallback);
    closeOverlay();

    expect(setFocus).toHaveBeenCalledWith(fallback);
  });
});
