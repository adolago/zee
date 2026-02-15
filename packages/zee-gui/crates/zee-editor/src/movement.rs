// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later
//! Movement operations for the editor

use crate::display_map::DisplaySnapshot;
use crate::BufferPoint;
use gpui::{px, Pixels};

/// Text layout details for movement calculations
#[derive(Clone, Debug)]
pub struct TextLayoutDetails {
    pub line_height: Pixels,
    pub scroll_anchor: BufferPoint,
}

impl Default for TextLayoutDetails {
    fn default() -> Self {
        Self {
            line_height: px(20.0),
            scroll_anchor: BufferPoint::zero(),
        }
    }
}

/// Movement direction
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Up,
    Down,
    Left,
    Right,
}

/// Movement unit
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unit {
    Character,
    Word,
    Line,
    Paragraph,
    Document,
    HalfPage,
    Page,
}

/// Calculate next position after movement
pub fn next_position(
    current: BufferPoint,
    direction: Direction,
    unit: Unit,
    snapshot: &DisplaySnapshot,
    text: &str,
) -> BufferPoint {
    match (direction, unit) {
        (Direction::Left, Unit::Character) => move_left_by_char(current),
        (Direction::Right, Unit::Character) => move_right_by_char(current),
        (Direction::Up, Unit::Character) => move_up_by_line(current),
        (Direction::Down, Unit::Character) => move_down_by_line(current, snapshot),
        (Direction::Left, Unit::Line) => BufferPoint::new(current.row, 0),
        (Direction::Right, Unit::Line) => move_to_end_of_line(current, text),
        (Direction::Up, Unit::Document) => BufferPoint::zero(),
        (Direction::Down, Unit::Document) => move_to_end_of_document(snapshot),
        _ => current,
    }
}

fn move_left_by_char(point: BufferPoint) -> BufferPoint {
    if point.column > 0 {
        BufferPoint::new(point.row, point.column - 1)
    } else if point.row > 0 {
        BufferPoint::new(point.row - 1, u32::MAX)
    } else {
        point
    }
}

fn move_right_by_char(point: BufferPoint) -> BufferPoint {
    BufferPoint::new(point.row, point.column + 1)
}

fn move_up_by_line(point: BufferPoint) -> BufferPoint {
    if point.row > 0 {
        BufferPoint::new(point.row - 1, point.column)
    } else {
        BufferPoint::new(0, 0)
    }
}

fn move_down_by_line(point: BufferPoint, snapshot: &DisplaySnapshot) -> BufferPoint {
    let max_row = snapshot.max_row().0;
    if point.row < max_row {
        BufferPoint::new(point.row + 1, point.column)
    } else {
        point
    }
}

fn move_to_end_of_line(point: BufferPoint, text: &str) -> BufferPoint {
    let lines: Vec<&str> = text.lines().collect();
    if let Some(line) = lines.get(point.row as usize) {
        BufferPoint::new(point.row, line.len() as u32)
    } else {
        point
    }
}

fn move_to_end_of_document(snapshot: &DisplaySnapshot) -> BufferPoint {
    BufferPoint::new(snapshot.max_row().0, 0)
}

pub fn is_word_boundary(c: char) -> bool {
    !c.is_alphanumeric() && c != '_'
}
