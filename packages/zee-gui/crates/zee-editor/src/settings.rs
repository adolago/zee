// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later
// Based on Zed's editor_settings implementation

//! Editor configuration settings
//!
//! This module defines configurable settings for editor behavior
//! including cursor style, scrolling, line numbers, etc.

use serde::{Deserialize, Serialize};

/// Editor configuration settings
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct EditorSettings {
    /// Cursor blink rate in milliseconds (0 to disable)
    pub cursor_blink: bool,

    /// Show line numbers
    pub show_line_numbers: bool,

    /// Use relative line numbers
    pub relative_line_numbers: bool,

    /// Tab width in spaces
    pub tab_size: u32,

    /// Use soft tabs (spaces instead of tabs)
    pub soft_tabs: bool,

    /// Enable soft wrapping
    pub soft_wrap: SoftWrap,

    /// Preferred line length for wrapping
    pub preferred_line_length: u32,

    /// Show indent guides
    pub show_indent_guides: bool,

    /// Highlight current line
    pub current_line_highlight: CurrentLineHighlight,

    /// Scroll margin (lines to keep visible above/below cursor)
    pub scroll_margin: u32,

    /// Scroll beyond last line
    pub scroll_beyond_last_line: ScrollBeyondLastLine,

    /// Show scrollbar
    pub show_scrollbar: ShowScrollbar,

    /// Show minimap
    pub show_minimap: bool,

    /// Hide mouse cursor while typing
    pub hide_mouse_while_typing: bool,

    /// Font size
    pub font_size: f32,

    /// Font family
    pub font_family: String,

    /// Line height multiplier
    pub line_height: LineHeight,
}

impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            cursor_blink: true,
            show_line_numbers: true,
            relative_line_numbers: false,
            tab_size: 4,
            soft_tabs: true,
            soft_wrap: SoftWrap::None,
            preferred_line_length: 80,
            show_indent_guides: true,
            current_line_highlight: CurrentLineHighlight::All,
            scroll_margin: 3,
            scroll_beyond_last_line: ScrollBeyondLastLine::OnePage,
            show_scrollbar: ShowScrollbar::Auto,
            show_minimap: false,
            hide_mouse_while_typing: false,
            font_size: 14.0,
            font_family: "monospace".to_string(),
            line_height: LineHeight::Comfortable,
        }
    }
}

/// Soft wrap mode
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SoftWrap {
    /// No soft wrapping
    #[default]
    None,
    /// Wrap at editor width
    EditorWidth,
    /// Wrap at preferred line length
    PreferredLineLength,
    /// Wrap at bounded length
    Bounded(u32),
}

/// Current line highlight mode
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CurrentLineHighlight {
    /// Highlight entire line
    #[default]
    All,
    /// Only highlight gutter
    Gutter,
    /// Only highlight line content area
    Line,
    /// No highlight
    None,
}

/// Scroll beyond last line behavior
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScrollBeyondLastLine {
    /// Allow scrolling one page beyond
    #[default]
    OnePage,
    /// Allow scrolling to center last line
    Center,
    /// Scroll to show vertical scroll margin
    VerticalScrollMargin,
    /// No scrolling beyond last line
    Off,
}

/// Scrollbar visibility
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShowScrollbar {
    /// Show based on activity
    #[default]
    Auto,
    /// Always show
    Always,
    /// Never show
    Never,
    /// Follow system setting
    System,
}

/// Line height mode
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LineHeight {
    /// Comfortable spacing (1.6x)
    #[default]
    Comfortable,
    /// Standard spacing (1.4x)
    Standard,
    /// Custom multiplier
    Custom(f32),
}

impl LineHeight {
    /// Get the line height multiplier
    pub fn value(&self) -> f32 {
        match self {
            LineHeight::Comfortable => 1.6,
            LineHeight::Standard => 1.4,
            LineHeight::Custom(v) => *v,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_settings() {
        let settings = EditorSettings::default();
        assert!(settings.show_line_numbers);
        assert_eq!(settings.tab_size, 4);
        assert!(settings.soft_tabs);
    }

    #[test]
    fn test_line_height() {
        assert_eq!(LineHeight::Comfortable.value(), 1.6);
        assert_eq!(LineHeight::Standard.value(), 1.4);
        assert_eq!(LineHeight::Custom(2.0).value(), 2.0);
    }
}
