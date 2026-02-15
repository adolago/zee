// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later
//! Editor actions for keybinding-triggered operations

use gpui::actions;

// Movement actions
actions!(
    editor,
    [
        MoveUp,
        MoveDown,
        MoveLeft,
        MoveRight,
        MoveToBeginningOfLine,
        MoveToEndOfLine,
        MoveToBeginningOfDocument,
        MoveToEndOfDocument,
        MoveWordLeft,
        MoveWordRight,
        PageUp,
        PageDown,
    ]
);

// Selection actions
actions!(
    editor,
    [
        SelectUp,
        SelectDown,
        SelectLeft,
        SelectRight,
        SelectToBeginningOfLine,
        SelectToEndOfLine,
        SelectAll,
        SelectWord,
        SelectLine,
    ]
);

// Edit actions
actions!(
    editor,
    [
        Backspace, Delete, DeleteLine, DeleteWord, Cut, Copy, Paste, Undo, Redo, Tab, TabPrev,
        Newline,
    ]
);

// View actions
actions!(editor, [ScrollPageUp, ScrollPageDown, CenterScreen,]);
