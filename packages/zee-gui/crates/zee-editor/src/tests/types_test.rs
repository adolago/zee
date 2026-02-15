//! Unit tests for core editor types
//!
//! These tests cover the fundamental types that don't require GPUI context.

use crate::{Anchor, Bias, BufferPoint, CursorShape, DisplayRow, SelectMode};

// ============================================================================
// BIAS TESTS
// ============================================================================

#[test]
fn test_bias_default() {
    let bias: Bias = Default::default();
    assert_eq!(bias, Bias::Left);
}

#[test]
fn test_bias_equality() {
    assert_eq!(Bias::Left, Bias::Left);
    assert_eq!(Bias::Right, Bias::Right);
    assert_ne!(Bias::Left, Bias::Right);
}

// ============================================================================
// DISPLAY ROW TESTS
// ============================================================================

#[test]
fn test_display_row_default() {
    let row: DisplayRow = Default::default();
    assert_eq!(row.0, 0);
}

#[test]
fn test_display_row_as_f64() {
    let row = DisplayRow(42);
    assert!((row.as_f64() - 42.0).abs() < 0.001);
}

#[test]
fn test_display_row_next() {
    let row = DisplayRow(10);
    assert_eq!(row.next_row(), DisplayRow(11));
}

#[test]
fn test_display_row_previous() {
    let row = DisplayRow(10);
    assert_eq!(row.previous_row(), DisplayRow(9));
}

#[test]
fn test_display_row_previous_at_zero() {
    let row = DisplayRow(0);
    assert_eq!(row.previous_row(), DisplayRow(0)); // Saturating
}

#[test]
fn test_display_row_add() {
    let row = DisplayRow(10);
    assert_eq!(row + 5, DisplayRow(15));
}

#[test]
fn test_display_row_sub() {
    let row = DisplayRow(10);
    assert_eq!(row - 5, DisplayRow(5));
}

#[test]
fn test_display_row_sub_saturating() {
    let row = DisplayRow(5);
    assert_eq!(row - 10, DisplayRow(0)); // Saturating subtraction
}

#[test]
fn test_display_row_add_assign() {
    let mut row = DisplayRow(10);
    row += 5;
    assert_eq!(row, DisplayRow(15));
}

#[test]
fn test_display_row_sub_assign() {
    let mut row = DisplayRow(10);
    row -= 5;
    assert_eq!(row, DisplayRow(5));
}

#[test]
fn test_display_row_sub_assign_saturating() {
    let mut row = DisplayRow(5);
    row -= 10;
    assert_eq!(row, DisplayRow(0));
}

#[test]
fn test_display_row_ordering() {
    assert!(DisplayRow(5) < DisplayRow(10));
    assert!(DisplayRow(10) > DisplayRow(5));
    assert_eq!(DisplayRow(5), DisplayRow(5));
}

// ============================================================================
// BUFFER POINT TESTS
// ============================================================================

#[test]
fn test_buffer_point_new() {
    let point = BufferPoint::new(10, 20);
    assert_eq!(point.row, 10);
    assert_eq!(point.column, 20);
}

#[test]
fn test_buffer_point_zero() {
    let point = BufferPoint::zero();
    assert_eq!(point.row, 0);
    assert_eq!(point.column, 0);
}

#[test]
fn test_buffer_point_default() {
    let point: BufferPoint = Default::default();
    assert_eq!(point.row, 0);
    assert_eq!(point.column, 0);
}

#[test]
fn test_buffer_point_equality() {
    let p1 = BufferPoint::new(5, 10);
    let p2 = BufferPoint::new(5, 10);
    let p3 = BufferPoint::new(5, 11);

    assert_eq!(p1, p2);
    assert_ne!(p1, p3);
}

#[test]
fn test_buffer_point_ordering() {
    let p1 = BufferPoint::new(5, 10);
    let p2 = BufferPoint::new(5, 20);
    let p3 = BufferPoint::new(6, 5);

    assert!(p1 < p2); // Same row, different column
    assert!(p2 < p3); // Different row
}

// ============================================================================
// ANCHOR TESTS
// ============================================================================

#[test]
fn test_anchor_min() {
    let anchor = Anchor::min();
    assert_eq!(anchor.offset, 0);
    assert_eq!(anchor.bias, Bias::Left);
}

#[test]
fn test_anchor_max() {
    let anchor = Anchor::max();
    assert_eq!(anchor.offset, usize::MAX);
    assert_eq!(anchor.bias, Bias::Right);
}

#[test]
fn test_anchor_default() {
    let anchor: Anchor = Default::default();
    assert_eq!(anchor.offset, 0);
    assert_eq!(anchor.bias, Bias::Left);
}

#[test]
fn test_anchor_equality() {
    let a1 = Anchor {
        offset: 10,
        bias: Bias::Left,
    };
    let a2 = Anchor {
        offset: 10,
        bias: Bias::Left,
    };
    let a3 = Anchor {
        offset: 10,
        bias: Bias::Right,
    };
    let a4 = Anchor {
        offset: 11,
        bias: Bias::Left,
    };

    assert_eq!(a1, a2);
    assert_ne!(a1, a3); // Different bias
    assert_ne!(a1, a4); // Different offset
}

// ============================================================================
// SELECT MODE TESTS
// ============================================================================

#[test]
fn test_select_mode_default() {
    let mode: SelectMode = Default::default();
    assert_eq!(mode, SelectMode::Character);
}

#[test]
fn test_select_mode_character() {
    let mode = SelectMode::Character;
    assert_eq!(mode, SelectMode::Character);
}

#[test]
fn test_select_mode_word() {
    let start = Anchor {
        offset: 0,
        bias: Bias::Left,
    };
    let end = Anchor {
        offset: 10,
        bias: Bias::Right,
    };
    let mode = SelectMode::Word(start.clone()..end.clone());

    match mode {
        SelectMode::Word(range) => {
            assert_eq!(range.start, start);
            assert_eq!(range.end, end);
        }
        _ => panic!("Expected Word mode"),
    }
}

#[test]
fn test_select_mode_line() {
    let start = Anchor::min();
    let end = Anchor {
        offset: 100,
        bias: Bias::Right,
    };
    let mode = SelectMode::Line(start.clone()..end.clone());

    match mode {
        SelectMode::Line(range) => {
            assert_eq!(range.start, start);
            assert_eq!(range.end, end);
        }
        _ => panic!("Expected Line mode"),
    }
}

#[test]
fn test_select_mode_block() {
    let mode = SelectMode::Block;
    assert_eq!(mode, SelectMode::Block);
}

// ============================================================================
// CURSOR SHAPE TESTS
// ============================================================================

#[test]
fn test_cursor_shape_default() {
    let shape: CursorShape = Default::default();
    assert_eq!(shape, CursorShape::Bar);
}

#[test]
fn test_cursor_shape_variants() {
    assert_eq!(CursorShape::Bar, CursorShape::Bar);
    assert_eq!(CursorShape::Block, CursorShape::Block);
    assert_eq!(CursorShape::Underline, CursorShape::Underline);
    assert_eq!(CursorShape::Hollow, CursorShape::Hollow);

    assert_ne!(CursorShape::Bar, CursorShape::Block);
}

// ============================================================================
// EDGE CASES
// ============================================================================

#[test]
fn test_display_row_overflow_next() {
    let row = DisplayRow(u32::MAX);
    assert_eq!(row.next_row(), DisplayRow(u32::MAX)); // Saturating
}

#[test]
fn test_buffer_point_large_values() {
    let point = BufferPoint::new(u32::MAX, u32::MAX);
    assert_eq!(point.row, u32::MAX);
    assert_eq!(point.column, u32::MAX);
}

#[test]
fn test_anchor_clone() {
    let anchor = Anchor {
        offset: 42,
        bias: Bias::Right,
    };
    let cloned = anchor.clone();

    assert_eq!(anchor, cloned);
}

#[test]
fn test_display_row_hash() {
    use std::collections::HashSet;

    let mut set = HashSet::new();
    set.insert(DisplayRow(5));
    set.insert(DisplayRow(10));
    set.insert(DisplayRow(5)); // Duplicate

    assert_eq!(set.len(), 2);
    assert!(set.contains(&DisplayRow(5)));
    assert!(set.contains(&DisplayRow(10)));
}

#[test]
fn test_buffer_point_hash() {
    use std::collections::HashSet;

    let mut set = HashSet::new();
    set.insert(BufferPoint::new(1, 2));
    set.insert(BufferPoint::new(3, 4));
    set.insert(BufferPoint::new(1, 2)); // Duplicate

    assert_eq!(set.len(), 2);
}
