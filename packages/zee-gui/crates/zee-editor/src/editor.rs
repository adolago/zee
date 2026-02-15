// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later
//! Core editor implementation
//!
//! The Editor struct is the main entry point for the text editor component.
//! It manages the buffer, selections, display, and handles input events.

use crate::buffer::Buffer;
use crate::display_map::{DisplayMap, DisplaySnapshot};
use crate::scroll::ScrollManager;
use crate::selection::SelectionsCollection;
use crate::settings::EditorSettings;
use crate::{Bias, CursorShape, DisplayRow};
use gpui::{px, App, AppContext as _, Context, Entity, EventEmitter, Pixels};

/// Events emitted by the editor
#[derive(Clone, Debug)]
pub enum EditorEvent {
    /// The buffer contents changed
    BufferChanged,
    /// The selection changed
    SelectionChanged,
    /// The scroll position changed
    ScrollChanged,
    /// The editor gained focus
    Focused,
    /// The editor lost focus
    Blurred,
}

/// Editor operating mode
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum EditorMode {
    /// Full editing capability
    #[default]
    Full,
    /// Single line input (for search, etc.)
    SingleLine,
    /// Read-only mode
    ReadOnly,
}

/// Style configuration for the editor
#[derive(Clone, Debug)]
pub struct EditorStyle {
    pub font_size: Pixels,
    pub line_height: Pixels,
    pub cursor_shape: CursorShape,
    pub show_line_numbers: bool,
    pub show_gutter: bool,
}

impl Default for EditorStyle {
    fn default() -> Self {
        Self {
            font_size: px(14.0),
            line_height: px(20.0),
            cursor_shape: CursorShape::Bar,
            show_line_numbers: true,
            show_gutter: true,
        }
    }
}

/// The main editor component
pub struct Editor {
    buffer: Entity<Buffer>,
    display_map: DisplayMap,
    selections: SelectionsCollection,
    scroll_manager: ScrollManager,
    mode: EditorMode,
    style: EditorStyle,
    settings: EditorSettings,
    focused: bool,
}

impl EventEmitter<EditorEvent> for Editor {}

impl Editor {
    /// Create a new editor with an empty buffer
    pub fn new(cx: &mut App) -> Entity<Self> {
        let buffer = cx.new(|_| Buffer::new());
        Self::for_buffer(buffer, cx)
    }

    /// Create a new editor for an existing buffer
    pub fn for_buffer(buffer: Entity<Buffer>, cx: &mut App) -> Entity<Self> {
        cx.new(|_cx| {
            let mut display_map = DisplayMap::new();
            display_map.set_line_height(px(20.0));

            Self {
                buffer,
                display_map,
                selections: SelectionsCollection::new(),
                scroll_manager: ScrollManager::new(),
                mode: EditorMode::Full,
                style: EditorStyle::default(),
                settings: EditorSettings::default(),
                focused: false,
            }
        })
    }

    /// Get the buffer entity
    pub fn buffer(&self) -> &Entity<Buffer> {
        &self.buffer
    }

    /// Get a snapshot of the display state
    pub fn display_snapshot(&self) -> DisplaySnapshot {
        self.display_map.snapshot()
    }

    /// Get the current editor mode
    pub fn mode(&self) -> EditorMode {
        self.mode
    }

    /// Set the editor mode
    pub fn set_mode(&mut self, mode: EditorMode) {
        self.mode = mode;
    }

    /// Check if the editor is read-only
    pub fn is_read_only(&self) -> bool {
        self.mode == EditorMode::ReadOnly
    }

    /// Get the editor style
    pub fn style(&self) -> &EditorStyle {
        &self.style
    }

    /// Get the current cursor shape
    pub fn cursor_shape(&self) -> CursorShape {
        self.style.cursor_shape
    }

    /// Check if the editor is focused
    pub fn is_focused(&self) -> bool {
        self.focused
    }

    /// Set focus state
    pub fn set_focused(&mut self, focused: bool, cx: &mut Context<Self>) {
        if self.focused != focused {
            self.focused = focused;
            cx.emit(if focused {
                EditorEvent::Focused
            } else {
                EditorEvent::Blurred
            });
        }
    }

    /// Get the selections collection
    pub fn selections(&self) -> &SelectionsCollection {
        &self.selections
    }

    /// Get the scroll manager
    pub fn scroll_manager(&self) -> &ScrollManager {
        &self.scroll_manager
    }

    /// Get scroll position as row
    pub fn scroll_row(&self) -> DisplayRow {
        self.scroll_manager.scroll_row()
    }

    /// Scroll to a specific row
    pub fn scroll_to_row(&mut self, row: DisplayRow, cx: &mut Context<Self>) {
        self.scroll_manager.scroll_to_row(row);
        cx.emit(EditorEvent::ScrollChanged);
    }

    /// Insert text at the current cursor position
    pub fn insert(&mut self, text: &str, cx: &mut Context<Self>) {
        if self.is_read_only() {
            return;
        }

        // Get current cursor position
        if let Some(selection) = self.selections.primary() {
            let offset = selection.head().offset;
            self.buffer.update(cx, |buffer, _| {
                buffer.insert(offset, text);
            });
        }

        // Move cursor forward
        self.selections.move_by(text.len() as i32, Bias::Right);
        cx.emit(EditorEvent::BufferChanged);
        cx.emit(EditorEvent::SelectionChanged);
    }

    /// Delete the character before the cursor (backspace)
    pub fn backspace(&mut self, cx: &mut Context<Self>) {
        if self.is_read_only() {
            return;
        }

        if let Some(selection) = self.selections.primary() {
            let offset = selection.head().offset;
            if offset > 0 {
                self.buffer.update(cx, |buffer, _| {
                    buffer.delete(offset - 1..offset);
                });
                self.selections.move_by(-1, Bias::Left);
            }
        }

        cx.emit(EditorEvent::BufferChanged);
        cx.emit(EditorEvent::SelectionChanged);
    }

    /// Delete the character after the cursor
    pub fn delete(&mut self, cx: &mut Context<Self>) {
        if self.is_read_only() {
            return;
        }

        if let Some(selection) = self.selections.primary() {
            let offset = selection.head().offset;
            let buffer_len = self.buffer.read(cx).len();
            if offset < buffer_len {
                self.buffer.update(cx, |buffer, _| {
                    buffer.delete(offset..offset + 1);
                });
            }
        }

        cx.emit(EditorEvent::BufferChanged);
    }

    /// Get the text content of the buffer
    pub fn text(&self, cx: &App) -> String {
        self.buffer.read(cx).text()
    }

    /// Set the text content of the buffer
    pub fn set_text(&mut self, text: &str, cx: &mut Context<Self>) {
        self.buffer.update(cx, |buffer, _| {
            buffer.set_text(text);
        });
        self.selections.reset();
        cx.emit(EditorEvent::BufferChanged);
    }
}
