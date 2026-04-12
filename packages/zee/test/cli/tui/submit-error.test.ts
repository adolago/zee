import { expect, test } from "bun:test"
import { formatSubmitError } from "../../../src/cli/cmd/tui/util/submit-error"

test("summarizes Bun fallback HTML errors", () => {
  const encoded = Buffer.from(
    "Cannot find module '../../../packages/zee/src/global' from 'dist/.zee/tool/lib/zee-banner.ts'",
  ).toString("base64")
  const html = `<!doctype html><html><body><script id="__bunfallback" type="binary/peechy">${encoded}</script></body></html>`

  expect(formatSubmitError(html)).toBe(
    "Bun runtime error: Cannot find module '../../../packages/zee/src/global' from 'dist/.zee/tool/lib/zee-banner.ts'",
  )
})

test("formats structured submit errors", () => {
  expect(formatSubmitError({ error: { message: "No provider configured" } })).toBe("No provider configured")
})
