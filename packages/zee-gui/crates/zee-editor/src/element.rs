// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later
//! GPUI element for rendering the editor

use crate::editor::Editor;
use crate::DisplayRow;
use gpui::{
    div, px, rgb, Bounds, Context, Entity, IntoElement, ParentElement, Pixels, Render, Styled,
    Window,
};

/// GPUI element that renders an Editor
pub struct EditorElement {
    editor: Entity<Editor>,
}

impl EditorElement {
    pub fn new(editor: Entity<Editor>) -> Self {
        Self { editor }
    }

    /// Calculate visible line range based on viewport
    #[allow(dead_code)]
    fn visible_line_range(
        &self,
        bounds: Bounds<Pixels>,
        cx: &Context<Self>,
    ) -> (DisplayRow, DisplayRow) {
        let editor = self.editor.read(cx);
        let line_height = editor.style().line_height;
        let scroll_row = editor.scroll_row();

        let visible_lines = (bounds.size.height / line_height).ceil() as u32;
        let start_row = scroll_row;
        let end_row = DisplayRow(start_row.0.saturating_add(visible_lines));

        (start_row, end_row)
    }
}

impl Render for EditorElement {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let editor = self.editor.read(cx);
        let style = editor.style();
        let is_focused = editor.is_focused();

        let mut container = div()
            .size_full()
            .bg(rgb(0x1e1e2e)) // Catppuccin Mocha base
            .child(
                // Gutter
                div().w(px(50.0)).h_full().bg(rgb(0x181825)), // Catppuccin Mocha mantle
            );

        // Add cursor when focused
        if is_focused {
            container = container.child(
                div()
                    .absolute()
                    .left(px(60.0))
                    .top(px(4.0))
                    .w(px(2.0))
                    .h(style.line_height)
                    .bg(rgb(0xf5e0dc)), // Catppuccin rosewater
            );
        }

        container
    }
}
