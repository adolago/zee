# @zee/tui

Reusable terminal UI framework package for Zee.

## Install

```bash
npm install @zee/tui
```

## Usage

```ts
import { TUI, Text, ProcessTerminal } from "@zee/tui"

const terminal = new ProcessTerminal()
const tui = new TUI(terminal)
tui.addChild(new Text("Hello from @zee/tui"))
tui.start()
```
