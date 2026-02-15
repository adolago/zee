// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later
//! Display map for text transformations

use crate::{Bias, BufferPoint, DisplayRow};
use gpui::{px, Pixels};

/// A point in display coordinates
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub struct DisplayPoint {
    pub row: DisplayRow,
    pub column: u32,
}

impl DisplayPoint {
    pub fn new(row: DisplayRow, column: u32) -> Self {
        Self { row, column }
    }

    pub fn zero() -> Self {
        Self::default()
    }

    pub fn row(&self) -> DisplayRow {
        self.row
    }

    pub fn column(&self) -> u32 {
        self.column
    }
}

/// Snapshot of display map state
#[derive(Clone)]
pub struct DisplaySnapshot {
    pub max_point: DisplayPoint,
    pub line_height: Pixels,
    pub wrap_width: Option<Pixels>,
}

impl Default for DisplaySnapshot {
    fn default() -> Self {
        Self {
            max_point: DisplayPoint::zero(),
            line_height: px(20.0),
            wrap_width: None,
        }
    }
}

impl DisplaySnapshot {
    pub fn buffer_point_to_display_point(&self, point: BufferPoint, _bias: Bias) -> DisplayPoint {
        DisplayPoint::new(DisplayRow(point.row), point.column)
    }

    pub fn display_point_to_buffer_point(&self, point: DisplayPoint, _bias: Bias) -> BufferPoint {
        BufferPoint::new(point.row.0, point.column)
    }

    pub fn max_row(&self) -> DisplayRow {
        self.max_point.row
    }

    pub fn line_height(&self) -> Pixels {
        self.line_height
    }
}

/// Display map for coordinate transformations
pub struct DisplayMap {
    snapshot: DisplaySnapshot,
}

impl Default for DisplayMap {
    fn default() -> Self {
        Self::new()
    }
}

impl DisplayMap {
    pub fn new() -> Self {
        Self {
            snapshot: DisplaySnapshot::default(),
        }
    }

    pub fn snapshot(&self) -> DisplaySnapshot {
        self.snapshot.clone()
    }

    pub fn set_wrap_width(&mut self, width: Option<Pixels>) {
        self.snapshot.wrap_width = width;
    }

    pub fn set_line_height(&mut self, height: Pixels) {
        self.snapshot.line_height = height;
    }

    pub fn update(&mut self, max_row: u32, max_column: u32) {
        self.snapshot.max_point = DisplayPoint::new(DisplayRow(max_row), max_column);
    }
}
