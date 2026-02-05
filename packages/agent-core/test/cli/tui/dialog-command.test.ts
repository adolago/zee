import { expect, mock, test, afterAll } from "bun:test"

// Restore mock.module mocks after all tests to avoid polluting other test files
afterAll(() => {
  mock.restore()
})
import { createRoot } from "solid-js"
import type { CommandOption } from "../../../src/cli/cmd/tui/component/dialog-command"

mock.module("@opentui/solid", () => ({
  useKeyboard: () => {},
  useRenderer: () => ({
    root: { getChildren: () => [] },
    currentFocusedRenderable: null,
    getSelection: () => null,
    clearSelection: () => {},
  }),
  useTerminalDimensions: () => () => ({ width: 120, height: 40 }),
  Portal: () => null,
}))

mock.module("@opentui/core", () => ({
  TextAttributes: class {},
}))

mock.module("@tui/ui/dialog", () => ({
  useDialog: () => ({
    stack: [],
    replace: () => {},
    clear: () => {},
  }),
}))

mock.module("@tui/context/keybind", () => ({
  useKeybind: () => ({
    match: () => false,
    print: (key: string) => String(key),
  }),
}))

mock.module("@tui/context/vim", () => ({
  useVim: () => ({ enabled: false, isInsert: false }),
}))

mock.module("@tui/context/theme", () => ({
  useTheme: () => ({
    theme: {
      backgroundElement: { r: 40, g: 40, b: 40, a: 255 },
      primary: { r: 0, g: 120, b: 255, a: 255 },
    },
  }),
}))

mock.module("@tui/ui/dialog-select", () => ({
  DialogSelect: () => null,
}))

mock.module("@opentui/solid/jsx-runtime", () => ({
  jsx: () => null,
  jsxs: () => null,
  jsxDEV: () => null,
}))

test("createCommandDialog filters undefined options from registrations", async () => {
  const { createCommandDialog } = await import("../../../src/cli/cmd/tui/component/dialog-command")

  const setup = createRoot((dispose) => {
    const command = createCommandDialog()
    command.register(() => undefined as unknown as CommandOption[])
    command.register(() => [
      undefined as unknown as CommandOption,
      { title: "Hello", value: "hello", keybind: "input_dictation_toggle" } as CommandOption,
    ])

    return { command, dispose }
  })

  const options = setup.command.options
  expect(options).toHaveLength(1)
  expect(options[0].value).toBe("hello")
  expect(options[0].keybind).toBe("input_dictation_toggle")

  setup.dispose()
})
