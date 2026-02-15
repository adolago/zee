// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later
// Based on Zed's selections_collection implementation

//! Selection management for the editor
//!
//! This module handles multiple cursors/selections, selection modes,
//! and selection operations like merging and sorting.

use crate::{Anchor, Bias, SelectMode};
use std::ops::Range;
use std::sync::Arc;

/// The goal position for vertical movement
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum SelectionGoal {
    /// No specific goal
    #[default]
    None,
    /// Maintain horizontal pixel position
    HorizontalPosition(f32),
    /// Wrapped horizontal position (line, x)
    WrappedHorizontalPosition((u32, f32)),
    /// Horizontal range for block selection
    HorizontalRange { start: f32, end: f32 },
    /// Specific column goal
    Column(u32),
}

/// A single selection in the editor
#[derive(Clone, Debug)]
pub struct Selection<T: Clone> {
    /// Unique identifier for this selection
    pub id: usize,
    /// Start of the selection
    pub start: T,
    /// End of the selection
    pub end: T,
    /// Whether the selection is reversed (cursor at start)
    pub reversed: bool,
    /// Goal for vertical movement
    pub goal: SelectionGoal,
}

impl<T: Clone + Ord> Selection<T> {
    /// Create a new selection
    pub fn new(id: usize, start: T, end: T) -> Self {
        let reversed = start > end;
        let (start, end) = if reversed { (end, start) } else { (start, end) };

        Self {
            id,
            start,
            end,
            reversed,
            goal: SelectionGoal::None,
        }
    }

    /// Get the cursor position (head of selection)
    pub fn head(&self) -> T {
        if self.reversed {
            self.start.clone()
        } else {
            self.end.clone()
        }
    }

    /// Get the anchor position (tail of selection)
    pub fn tail(&self) -> T {
        if self.reversed {
            self.end.clone()
        } else {
            self.start.clone()
        }
    }

    /// Get the selection range
    pub fn range(&self) -> Range<T> {
        self.start.clone()..self.end.clone()
    }

    /// Check if this is a point selection (no range)
    pub fn is_empty(&self) -> bool
    where
        T: PartialEq,
    {
        self.start == self.end
    }

    /// Map the selection through a function
    pub fn map<U: Clone + Ord, F: Fn(T) -> U>(self, f: F) -> Selection<U> {
        Selection {
            id: self.id,
            start: f(self.start),
            end: f(self.end),
            reversed: self.reversed,
            goal: self.goal,
        }
    }
}

/// Pending selection state during drag operations
#[derive(Clone, Debug)]
pub struct PendingSelection {
    /// The selection being dragged
    pub selection: Selection<Anchor>,
    /// Selection mode during drag
    pub mode: SelectMode,
}

/// Collection of selections in the editor
#[derive(Clone, Debug)]
pub struct SelectionsCollection {
    /// Next ID to assign to new selections
    next_id: usize,
    /// Whether selections are in line mode
    pub line_mode: bool,
    /// The finalized, non-overlapping selections
    disjoint: Arc<[Selection<Anchor>]>,
    /// In-progress selection (e.g., during mouse drag)
    pending: Option<PendingSelection>,
    /// Current selection mode
    pub select_mode: SelectMode,
    /// Whether extending an existing selection
    pub is_extending: bool,
}

impl SelectionsCollection {
    /// Create a new selections collection with a single cursor at the start
    pub fn new() -> Self {
        Self {
            next_id: 1,
            line_mode: false,
            disjoint: Arc::new([]),
            pending: Some(PendingSelection {
                selection: Selection {
                    id: 0,
                    start: Anchor::min(),
                    end: Anchor::min(),
                    reversed: false,
                    goal: SelectionGoal::None,
                },
                mode: SelectMode::Character,
            }),
            select_mode: SelectMode::Character,
            is_extending: false,
        }
    }

    /// Get the number of selections
    pub fn count(&self) -> usize {
        let mut count = self.disjoint.len();
        if self.pending.is_some() {
            count += 1;
        }
        count
    }

    /// Get the disjoint selections (without pending)
    pub fn disjoint(&self) -> &[Selection<Anchor>] {
        &self.disjoint
    }

    /// Get the pending selection
    pub fn pending(&self) -> Option<&PendingSelection> {
        self.pending.as_ref()
    }

    /// Get mutable pending selection
    pub fn pending_mut(&mut self) -> Option<&mut PendingSelection> {
        self.pending.as_mut()
    }

    /// Set a single selection
    pub fn set_selection(&mut self, selection: Selection<Anchor>) {
        self.pending = None;
        self.disjoint = Arc::new([selection]);
    }

    /// Set multiple selections
    pub fn set_selections(&mut self, selections: Vec<Selection<Anchor>>) {
        self.pending = None;
        self.disjoint = selections.into();
    }

    /// Start a pending selection
    pub fn set_pending(&mut self, selection: Selection<Anchor>, mode: SelectMode) {
        self.pending = Some(PendingSelection { selection, mode });
    }

    /// Clear the pending selection
    pub fn clear_pending(&mut self) {
        self.pending = None;
    }

    /// Get the next selection ID and increment the counter
    pub fn next_selection_id(&mut self) -> usize {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    /// Get the newest (most recently created) selection
    pub fn newest(&self) -> Option<&Selection<Anchor>> {
        // Pending takes precedence
        if let Some(pending) = &self.pending {
            return Some(&pending.selection);
        }

        // Find selection with highest ID
        self.disjoint.iter().max_by_key(|s| s.id)
    }

    /// Merge overlapping selections
    pub fn merge_overlapping(&mut self) {
        if self.disjoint.len() <= 1 {
            return;
        }

        let mut selections: Vec<Selection<Anchor>> = self.disjoint.to_vec();
        selections.sort_by(|a, b| a.start.offset.cmp(&b.start.offset));

        let mut merged = Vec::with_capacity(selections.len());
        let mut current = selections.remove(0);

        for selection in selections {
            if should_merge(&current, &selection) {
                // Merge by extending current
                if selection.end.offset > current.end.offset {
                    current.end = selection.end;
                }
                // Keep the newest ID
                if selection.id > current.id {
                    current.id = selection.id;
                }
            } else {
                merged.push(current);
                current = selection;
            }
        }
        merged.push(current);

        self.disjoint = merged.into();
    }
}

impl Default for SelectionsCollection {
    fn default() -> Self {
        Self::new()
    }
}

impl SelectionsCollection {
    /// Get the primary (first) selection
    pub fn primary(&self) -> Option<&Selection<Anchor>> {
        // Return pending if available, otherwise first disjoint
        if let Some(pending) = &self.pending {
            Some(&pending.selection)
        } else {
            self.disjoint.first()
        }
    }

    /// Move all selections by a given offset
    pub fn move_by(&mut self, delta: i32, bias: Bias) {
        if let Some(pending) = &mut self.pending {
            let new_offset = if delta >= 0 {
                pending
                    .selection
                    .start
                    .offset
                    .saturating_add(delta as usize)
            } else {
                pending
                    .selection
                    .start
                    .offset
                    .saturating_sub((-delta) as usize)
            };
            pending.selection.start = Anchor {
                offset: new_offset,
                bias,
            };
            pending.selection.end = Anchor {
                offset: new_offset,
                bias,
            };
        }

        // Also update disjoint selections
        let mut selections: Vec<Selection<Anchor>> = self.disjoint.to_vec();
        for selection in &mut selections {
            let new_offset = if delta >= 0 {
                selection.start.offset.saturating_add(delta as usize)
            } else {
                selection.start.offset.saturating_sub((-delta) as usize)
            };
            selection.start = Anchor {
                offset: new_offset,
                bias,
            };
            selection.end = Anchor {
                offset: new_offset,
                bias,
            };
        }
        self.disjoint = selections.into();
    }

    /// Reset selections to a single cursor at the start
    pub fn reset(&mut self) {
        self.disjoint = Arc::new([]);
        self.pending = Some(PendingSelection {
            selection: Selection {
                id: self.next_selection_id(),
                start: Anchor::min(),
                end: Anchor::min(),
                reversed: false,
                goal: SelectionGoal::None,
            },
            mode: SelectMode::Character,
        });
    }
}

/// Check if two selections should be merged
fn should_merge(a: &Selection<Anchor>, b: &Selection<Anchor>) -> bool {
    // b starts before or at where a ends
    b.start.offset <= a.end.offset
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_selection_creation() {
        let sel = Selection::new(1, 0usize, 10usize);
        assert_eq!(sel.start, 0);
        assert_eq!(sel.end, 10);
        assert!(!sel.reversed);
    }

    #[test]
    fn test_reversed_selection() {
        let sel = Selection::new(1, 10usize, 0usize);
        assert_eq!(sel.start, 0);
        assert_eq!(sel.end, 10);
        assert!(sel.reversed);
        assert_eq!(sel.head(), 0);
        assert_eq!(sel.tail(), 10);
    }

    #[test]
    fn test_selections_collection() {
        let mut collection = SelectionsCollection::new();
        assert_eq!(collection.count(), 1); // Has pending selection

        let id = collection.next_selection_id();
        collection.set_selection(Selection::new(id, Anchor::min(), Anchor::min()));

        assert_eq!(collection.count(), 1);
    }
}
