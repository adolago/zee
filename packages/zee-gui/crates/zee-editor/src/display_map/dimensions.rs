// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later
// Based on Zed's display_map dimensions

//! Dimension types and coordinate conversions for the display map

use crate::DisplayRow;

/// Extension trait for display row operations
pub trait RowExt {
    fn as_f64(self) -> f64;
    fn as_usize(self) -> usize;
}

impl RowExt for DisplayRow {
    fn as_f64(self) -> f64 {
        self.0 as f64
    }

    fn as_usize(self) -> usize {
        self.0 as usize
    }
}

/// A range of display rows
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DisplayRowRange {
    pub start: DisplayRow,
    pub end: DisplayRow,
}

impl DisplayRowRange {
    pub fn new(start: DisplayRow, end: DisplayRow) -> Self {
        Self { start, end }
    }

    pub fn len(&self) -> u32 {
        self.end.0.saturating_sub(self.start.0)
    }

    pub fn is_empty(&self) -> bool {
        self.start.0 >= self.end.0
    }

    pub fn contains(&self, row: DisplayRow) -> bool {
        row.0 >= self.start.0 && row.0 < self.end.0
    }

    pub fn iter(&self) -> impl Iterator<Item = DisplayRow> {
        (self.start.0..self.end.0).map(DisplayRow)
    }
}

/// Extension trait for row range operations
pub trait RowRangeExt {
    fn to_display_rows(&self) -> DisplayRowRange;
}

impl RowRangeExt for std::ops::Range<DisplayRow> {
    fn to_display_rows(&self) -> DisplayRowRange {
        DisplayRowRange::new(self.start, self.end)
    }
}

impl RowRangeExt for std::ops::Range<u32> {
    fn to_display_rows(&self) -> DisplayRowRange {
        DisplayRowRange::new(DisplayRow(self.start), DisplayRow(self.end))
    }
}
