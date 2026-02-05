import { afterAll, describe, expect, mock, test } from "bun:test"
import type { JSX } from "solid-js"

afterAll(() => {
  mock.restore()
})

mock.module("@opentui/solid/jsx-runtime", () => ({
  jsx: (type: any, props: any) => ({ type, props }),
  jsxs: (type: any, props: any) => ({ type, props }),
  jsxDEV: (type: any, props: any) => ({ type, props }),
}))

describe("renderDialogSelectFooter", () => {
  test("wraps string footer in a text node with correct color", async () => {
    const { renderDialogSelectFooter } = await import("../../../src/cli/cmd/tui/ui/dialog-select-footer")

    const fg = "green"
    const muted = "gray"
    const result = renderDialogSelectFooter("Connected", fg, muted, true) as unknown as {
      type: string
      props: { fg: string | undefined; children: string }
    }

    expect(result.type).toBe("text")
    expect(result.props.children).toBe("Connected")
    expect(result.props.fg).toBe(fg)
  })

  test("returns JSX footer element as-is", async () => {
    const { renderDialogSelectFooter } = await import("../../../src/cli/cmd/tui/ui/dialog-select-footer")

    const footerNode = { type: "box", props: { id: "footer" } } as unknown as JSX.Element
    const result = renderDialogSelectFooter(footerNode, "green", "gray", false)

    expect(result).toBe(footerNode)
  })

  test("returns null when footer is undefined", async () => {
    const { renderDialogSelectFooter } = await import("../../../src/cli/cmd/tui/ui/dialog-select-footer")

    expect(renderDialogSelectFooter(undefined, undefined, undefined, false)).toBeNull()
  })
})
