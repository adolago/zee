# Stanley Editor

Standalone text editor extracted from Zed's editor crate, built on GPUI.

## Features

- Text buffer with undo/redo
- Display mapping (soft wrap, tabs)
- Multi-cursor selection
- Scroll and viewport management
- GPUI rendering

## Usage

```rust
use stanley_editor::{Editor, Buffer};
use gpui::*;

let editor = cx.new(|cx| {
    Editor::for_buffer(
        cx.new(|_| Buffer::from_text("Hello, world!")),
        cx
    )
});
```

## Structure

- `buffer.rs` - Text storage with undo/redo
- `display_map/` - Coordinate transformations
- `selection.rs` - Multi-cursor support
- `scroll/` - Scroll management
- `movement.rs` - Cursor movement
- `element.rs` - GPUI rendering
- `actions.rs` - Keybinding actions

## Excluded from Zed

LSP, Git, collaboration, language extensions, AI predictions, tasks, hover, code actions, inlay hints.

## License

Apache-2.0 OR GPL-3.0-or-later (following Zed's licensing).

Original work Copyright 2024 Zed Industries Inc.
Modifications Copyright 2024 Stanley Contributors.
