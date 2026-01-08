import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ZeeApp } from "./app";

const originalConnect = ZeeApp.prototype.connect;

function mountApp(pathname: string) {
  window.history.replaceState({}, "", pathname);
  const app = document.createElement("zee-app") as ZeeApp;
  document.body.append(app);
  return app;
}

beforeEach(() => {
  ZeeApp.prototype.connect = () => {
    // no-op: avoid real gateway WS connections in browser tests
  };
  window.__ZEE_CONTROL_UI_BASE_PATH__ = undefined;
  document.body.innerHTML = "";
});

afterEach(() => {
  ZeeApp.prototype.connect = originalConnect;
  window.__ZEE_CONTROL_UI_BASE_PATH__ = undefined;
  document.body.innerHTML = "";
});

describe("chat markdown rendering", () => {
  it("renders markdown inside tool result cards", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    app.chatMessages = [
      {
        role: "assistant",
        content: [
          { type: "toolcall", name: "noop", arguments: {} },
          { type: "toolresult", name: "noop", text: "Hello **world**" },
        ],
        timestamp: Date.now(),
      },
    ];

    await app.updateComplete;

    const strong = app.querySelector(".chat-tool-card__output strong");
    expect(strong?.textContent).toBe("world");
  });
});

