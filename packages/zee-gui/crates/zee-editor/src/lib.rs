// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later
// Based on Zed's editor crate (https://github.com/zed-industries/zed)
// Original work Copyright 2024 Zed Industries Inc.
// Modifications Copyright 2024 Stanley Contributors

//! Stanley Editor - A standalone text editor component
//!
//! This crate provides a minimal, standalone text editor built on GPUI,
//! extracted and adapted from Zed's editor crate. It focuses on core
//! text editing functionality without LSP, Git, or collaboration features.
//!
//! # Features
//!
//! - Text buffer management with efficient rope-based storage
//! - Display mapping (soft wrapping, tabs, folds)
//! - Selection and cursor management
//! - Scrolling and viewport handling
//! - GPUI-based rendering
//!
//! # Removed Features (from Zed)
//!
//! The following Zed features are intentionally excluded:
//! - LSP integration (language server protocol)
//! - Git integration (blame, diff, status)
//! - Collaboration features (multi-user editing)
//! - Language-specific extensions (clangd, rust-analyzer)
//! - Project/workspace integration
//! - AI/edit predictions
//!
//! # Architecture
//!
//! The editor is structured around these core components:
//!
//! - [`Editor`]: Main editor struct holding state and handling input
//! - [`EditorElement`]: GPUI element for rendering the editor
//! - [`Buffer`]: Text buffer abstraction
//! - [`DisplayMap`]: Coordinates text transformations (wraps, folds, tabs)
//! - [`SelectionsCollection`]: Manages multiple cursors/selections

#![allow(dead_code)] // During development

pub mod actions;
pub mod buffer;
pub mod display_map;
pub mod editor;
pub mod element;
pub mod movement;
pub mod scroll;
pub mod selection;
pub mod settings;
mod shims;

#[cfg(test)]
mod tests;

// Re-exports for convenience
pub use buffer::{Buffer, BufferSnapshot};
pub use display_map::{DisplayMap, DisplayPoint, DisplaySnapshot};
pub use editor::{Editor, EditorEvent, EditorMode, EditorStyle};
pub use element::EditorElement;
// TextLayoutDetails may not be available in simplified movement module
pub use scroll::{Autoscroll, ScrollAnchor, ScrollManager};
pub use selection::{Selection, SelectionGoal, SelectionsCollection};
pub use settings::EditorSettings;

// Core types re-exported from GPUI
pub use gpui::{Pixels, Point, SharedString};

/// Bias for cursor positioning when text is ambiguous
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Default)]
pub enum Bias {
    /// Prefer the left side of ambiguous positions
    #[default]
    Left,
    /// Prefer the right side of ambiguous positions
    Right,
}

/// A row in the display coordinate system (after wrapping)
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DisplayRow(pub u32);

impl DisplayRow {
    pub fn as_f64(self) -> f64 {
        self.0 as f64
    }

    pub fn next_row(self) -> Self {
        Self(self.0.saturating_add(1))
    }

    pub fn previous_row(self) -> Self {
        Self(self.0.saturating_sub(1))
    }
}

impl std::ops::Add<u32> for DisplayRow {
    type Output = Self;
    fn add(self, rhs: u32) -> Self {
        Self(self.0 + rhs)
    }
}

impl std::ops::Sub<u32> for DisplayRow {
    type Output = Self;
    fn sub(self, rhs: u32) -> Self {
        Self(self.0.saturating_sub(rhs))
    }
}

impl std::ops::AddAssign<u32> for DisplayRow {
    fn add_assign(&mut self, rhs: u32) {
        self.0 += rhs;
    }
}

impl std::ops::SubAssign<u32> for DisplayRow {
    fn sub_assign(&mut self, rhs: u32) {
        self.0 = self.0.saturating_sub(rhs);
    }
}

/// A point in the buffer coordinate system (row, column in actual text)
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct BufferPoint {
    pub row: u32,
    pub column: u32,
}

impl BufferPoint {
    pub fn new(row: u32, column: u32) -> Self {
        Self { row, column }
    }

    pub fn zero() -> Self {
        Self::default()
    }
}

/// An anchor into the buffer that maintains its position across edits
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Anchor {
    /// Offset into the buffer
    pub offset: usize,
    /// Bias for ambiguous positions
    pub bias: Bias,
}

impl Anchor {
    pub fn min() -> Self {
        Self {
            offset: 0,
            bias: Bias::Left,
        }
    }

    pub fn max() -> Self {
        Self {
            offset: usize::MAX,
            bias: Bias::Right,
        }
    }
}

impl Default for Anchor {
    fn default() -> Self {
        Self::min()
    }
}

/// Selection mode for how selections behave
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum SelectMode {
    /// Character-by-character selection
    #[default]
    Character,
    /// Word-by-word selection
    Word(std::ops::Range<Anchor>),
    /// Line-by-line selection
    Line(std::ops::Range<Anchor>),
    /// Block/column selection
    Block,
}

/// Cursor shape for different editing modes
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub enum CursorShape {
    /// Standard vertical bar cursor
    #[default]
    Bar,
    /// Block cursor (vim normal mode style)
    Block,
    /// Underline cursor
    Underline,
    /// Hollow block cursor (vim replace mode)
    Hollow,
}

/// Result type for editor operations
pub type Result<T> = anyhow::Result<T>;
