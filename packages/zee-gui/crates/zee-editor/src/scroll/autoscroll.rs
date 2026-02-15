// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later
// Based on Zed's autoscroll implementation

//! Autoscroll behavior for keeping cursor visible

use crate::{DisplayPoint, DisplayRow, DisplaySnapshot};

/// Autoscroll request to ensure cursor visibility
#[derive(Clone, Debug)]
pub struct Autoscroll {
    /// Strategy for autoscrolling
    pub strategy: AutoscrollStrategy,
}

impl Autoscroll {
    /// Create an autoscroll that fits the cursor in view
    pub fn fit() -> Self {
        Self {
            strategy: AutoscrollStrategy::Fit,
        }
    }

    /// Create an autoscroll that centers the cursor
    pub fn center() -> Self {
        Self {
            strategy: AutoscrollStrategy::Center,
        }
    }

    /// Create an autoscroll that puts cursor at top
    pub fn top() -> Self {
        Self {
            strategy: AutoscrollStrategy::Top,
        }
    }

    /// Create an autoscroll that puts cursor at bottom
    pub fn bottom() -> Self {
        Self {
            strategy: AutoscrollStrategy::Bottom,
        }
    }

    /// Create an autoscroll that scrolls to the newest selection
    pub fn newest() -> Self {
        Self {
            strategy: AutoscrollStrategy::Newest { center_if_offscreen: false },
        }
    }

    /// Compute the target scroll position
    pub fn compute_scroll_target(
        &self,
        cursor: DisplayPoint,
        visible_rows: f64,
        scroll_margin: f64,
        current_scroll: f64,
        snapshot: &DisplaySnapshot,
    ) -> Option<f64> {
        let cursor_row = cursor.row().0 as f64;
        let max_row = snapshot.max_row().0 as f64;

        match self.strategy {
            AutoscrollStrategy::Fit => {
                let top = current_scroll;
                let bottom = current_scroll + visible_rows;

                // Check if cursor is outside visible area (with margin)
                if cursor_row < top + scroll_margin {
                    Some((cursor_row - scroll_margin).max(0.0))
                } else if cursor_row > bottom - scroll_margin - 1.0 {
                    Some((cursor_row - visible_rows + scroll_margin + 1.0).min(max_row))
                } else {
                    None
                }
            }

            AutoscrollStrategy::Center => {
                Some((cursor_row - visible_rows / 2.0).clamp(0.0, max_row))
            }

            AutoscrollStrategy::Top => {
                Some(cursor_row.clamp(0.0, max_row))
            }

            AutoscrollStrategy::Bottom => {
                Some((cursor_row - visible_rows + 1.0).clamp(0.0, max_row))
            }

            AutoscrollStrategy::Newest { center_if_offscreen } => {
                let top = current_scroll;
                let bottom = current_scroll + visible_rows;

                if cursor_row < top || cursor_row > bottom {
                    if center_if_offscreen {
                        Some((cursor_row - visible_rows / 2.0).clamp(0.0, max_row))
                    } else {
                        if cursor_row < top {
                            Some((cursor_row - scroll_margin).max(0.0))
                        } else {
                            Some((cursor_row - visible_rows + scroll_margin + 1.0).min(max_row))
                        }
                    }
                } else {
                    None
                }
            }
        }
    }
}

/// Strategy for autoscrolling
#[derive(Clone, Debug)]
pub enum AutoscrollStrategy {
    /// Just ensure cursor is visible (minimal scrolling)
    Fit,
    /// Center the cursor in the viewport
    Center,
    /// Put cursor at the top of the viewport
    Top,
    /// Put cursor at the bottom of the viewport
    Bottom,
    /// Scroll to the newest selection
    Newest { center_if_offscreen: bool },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Buffer, DisplayMap, DisplayMapConfig};

    fn test_snapshot(lines: u32) -> DisplaySnapshot {
        let text: String = (0..lines).map(|i| format!("line{}\n", i)).collect();
        let buffer = Buffer::from_text(&text);
        DisplayMap::new(buffer.snapshot(), DisplayMapConfig::default()).snapshot()
    }

    #[test]
    fn test_autoscroll_fit() {
        let snapshot = test_snapshot(100);
        let autoscroll = Autoscroll::fit();

        // Cursor at row 50, viewport showing rows 0-20
        let target = autoscroll.compute_scroll_target(
            DisplayPoint::new(DisplayRow(50), 0),
            20.0,
            3.0,
            0.0,
            &snapshot,
        );

        // Should scroll down to show row 50
        assert!(target.is_some());
        let scroll = target.unwrap();
        assert!(scroll > 0.0);
    }

    #[test]
    fn test_autoscroll_center() {
        let snapshot = test_snapshot(100);
        let autoscroll = Autoscroll::center();

        let target = autoscroll.compute_scroll_target(
            DisplayPoint::new(DisplayRow(50), 0),
            20.0,
            3.0,
            0.0,
            &snapshot,
        );

        // Should center around row 50
        assert!(target.is_some());
        let scroll = target.unwrap();
        assert!((scroll - 40.0).abs() < 1.0); // 50 - 20/2 = 40
    }
}
