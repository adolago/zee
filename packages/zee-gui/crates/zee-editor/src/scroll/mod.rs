// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later
//! Scroll management for the editor
//!
//! Handles scrolling, viewport management, and scroll anchoring
//! to maintain position across edits.

use crate::DisplayRow;
use gpui::Point;

/// Autoscroll behavior when cursor moves
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Autoscroll {
    /// Don't autoscroll
    #[default]
    None,
    /// Scroll to make cursor visible
    Fit,
    /// Center the cursor vertically
    Center,
    /// Scroll to top of viewport
    Top,
    /// Scroll to show context around cursor
    Context { lines: u32 },
}

/// Anchor for maintaining scroll position across edits
#[derive(Clone, Debug, Default)]
pub struct ScrollAnchor {
    /// Row in display coordinates
    pub row: DisplayRow,
    /// Fractional offset within the row (0.0-1.0)
    pub offset: f32,
}

impl ScrollAnchor {
    pub fn new(row: DisplayRow, offset: f32) -> Self {
        Self {
            row,
            offset: offset.clamp(0.0, 1.0),
        }
    }

    pub fn row(row: DisplayRow) -> Self {
        Self { row, offset: 0.0 }
    }
}

/// Manages scrolling state and behavior
pub struct ScrollManager {
    /// Current scroll position as a row
    scroll_row: DisplayRow,
    /// Scroll anchor for position maintenance
    anchor: ScrollAnchor,
    /// Autoscroll behavior
    autoscroll: Autoscroll,
    /// Number of visible rows in viewport
    visible_rows: u32,
    /// Scroll margin (lines before edge to start scrolling)
    scroll_margin: u32,
}

impl Default for ScrollManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ScrollManager {
    pub fn new() -> Self {
        Self {
            scroll_row: DisplayRow(0),
            anchor: ScrollAnchor::default(),
            autoscroll: Autoscroll::default(),
            visible_rows: 40, // Default assumption
            scroll_margin: 3,
        }
    }

    /// Get the current scroll row
    pub fn scroll_row(&self) -> DisplayRow {
        self.scroll_row
    }

    /// Get the scroll anchor
    pub fn anchor(&self) -> &ScrollAnchor {
        &self.anchor
    }

    /// Scroll to a specific row
    pub fn scroll_to_row(&mut self, row: DisplayRow) {
        self.scroll_row = row;
        self.anchor = ScrollAnchor::row(row);
    }

    /// Scroll by a delta (positive = down, negative = up)
    pub fn scroll_by(&mut self, delta_rows: i32, max_row: DisplayRow) {
        let new_row = if delta_rows >= 0 {
            self.scroll_row.0.saturating_add(delta_rows as u32)
        } else {
            self.scroll_row.0.saturating_sub((-delta_rows) as u32)
        };

        // Clamp to valid range
        let clamped = new_row.min(max_row.0.saturating_sub(self.visible_rows / 2));
        self.scroll_row = DisplayRow(clamped);
        self.anchor = ScrollAnchor::row(self.scroll_row);
    }

    /// Scroll a page up
    pub fn page_up(&mut self) {
        self.scroll_by(-(self.visible_rows as i32 - 2), DisplayRow(0));
    }

    /// Scroll a page down
    pub fn page_down(&mut self, max_row: DisplayRow) {
        self.scroll_by(self.visible_rows as i32 - 2, max_row);
    }

    /// Set the number of visible rows
    pub fn set_visible_rows(&mut self, rows: u32) {
        self.visible_rows = rows;
    }

    /// Set the scroll margin
    pub fn set_scroll_margin(&mut self, margin: u32) {
        self.scroll_margin = margin;
    }

    /// Ensure a cursor row is visible, scrolling if necessary
    pub fn ensure_cursor_visible(&mut self, cursor_row: DisplayRow, max_row: DisplayRow) {
        let top = self.scroll_row.0 + self.scroll_margin;
        let bottom = self.scroll_row.0 + self.visible_rows.saturating_sub(self.scroll_margin);

        if cursor_row.0 < top {
            // Cursor is above viewport
            self.scroll_to_row(DisplayRow(cursor_row.0.saturating_sub(self.scroll_margin)));
        } else if cursor_row.0 >= bottom {
            // Cursor is below viewport
            let new_row = cursor_row
                .0
                .saturating_sub(self.visible_rows - self.scroll_margin - 1);
            self.scroll_to_row(DisplayRow(new_row.min(max_row.0)));
        }
    }

    /// Center the viewport on a specific row
    pub fn center_on_row(&mut self, row: DisplayRow) {
        let new_row = row.0.saturating_sub(self.visible_rows / 2);
        self.scroll_to_row(DisplayRow(new_row));
    }

    /// Get the scroll position as a point (x, y)
    pub fn scroll_position(&self, line_height: f32) -> Point<f32> {
        Point {
            x: 0.0,
            y: self.scroll_row.0 as f32 * line_height + self.anchor.offset * line_height,
        }
    }
}
