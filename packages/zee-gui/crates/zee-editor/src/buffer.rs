// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later
// Based on Zed's text/buffer implementation

//! Text buffer abstraction for the editor
//!
//! This module provides a simplified buffer implementation for holding
//! and manipulating text. It's designed to be efficient for common
//! editing operations while being simpler than Zed's full multi_buffer.

use crate::shims::text::Rope;
use crate::{Anchor, Bias, BufferPoint};
use parking_lot::RwLock;
use std::ops::Range;
use std::sync::Arc;

/// A text buffer that holds document content
#[derive(Clone)]
pub struct Buffer {
    inner: Arc<RwLock<BufferInner>>,
}

struct BufferInner {
    /// The text content
    text: Rope,
    /// Line ending positions for fast line lookups
    line_offsets: Vec<usize>,
    /// Whether the buffer has been modified since last save
    modified: bool,
    /// Undo history
    undo_stack: Vec<BufferEdit>,
    /// Redo history
    redo_stack: Vec<BufferEdit>,
}

#[derive(Clone, Debug)]
struct BufferEdit {
    range: Range<usize>,
    old_text: String,
    new_text: String,
}

impl Buffer {
    /// Create a new empty buffer
    pub fn new() -> Self {
        Self::from_text("")
    }

    /// Create a buffer with initial text
    pub fn from_text(text: &str) -> Self {
        let rope = Rope::from_str(text);
        let line_offsets = compute_line_offsets(&rope);

        Self {
            inner: Arc::new(RwLock::new(BufferInner {
                text: rope,
                line_offsets,
                modified: false,
                undo_stack: Vec::new(),
                redo_stack: Vec::new(),
            })),
        }
    }

    /// Get a snapshot of the buffer's current state
    pub fn snapshot(&self) -> BufferSnapshot {
        let inner = self.inner.read();
        BufferSnapshot {
            text: inner.text.clone(),
            line_offsets: inner.line_offsets.clone(),
        }
    }

    /// Get the total length of the buffer in bytes
    pub fn len(&self) -> usize {
        self.inner.read().text.len()
    }

    /// Check if the buffer is empty
    pub fn is_empty(&self) -> bool {
        self.inner.read().text.is_empty()
    }

    /// Check if the buffer has been modified
    pub fn is_modified(&self) -> bool {
        self.inner.read().modified
    }

    /// Get the number of lines in the buffer
    pub fn line_count(&self) -> u32 {
        // Number of lines is number of newlines + 1 (for the last line)
        let inner = self.inner.read();
        if inner.text.is_empty() {
            1 // Empty buffer still has one line
        } else {
            inner.line_offsets.len() as u32 + 1
        }
    }

    /// Edit the buffer, replacing a range with new text
    pub fn edit(&self, range: Range<usize>, new_text: &str) {
        let mut inner = self.inner.write();

        // Store for undo
        let old_text = inner.text.slice(range.clone()).to_string();
        inner.undo_stack.push(BufferEdit {
            range: range.clone(),
            old_text,
            new_text: new_text.to_string(),
        });
        inner.redo_stack.clear();

        // Perform the edit
        let mut new_rope = Rope::new();
        if range.start > 0 {
            new_rope.push_str(inner.text.slice(0..range.start));
        }
        new_rope.push_str(new_text);
        if range.end < inner.text.len() {
            new_rope.push_str(inner.text.slice(range.end..inner.text.len()));
        }

        inner.text = new_rope;
        inner.line_offsets = compute_line_offsets(&inner.text);
        inner.modified = true;
    }

    /// Insert text at a position
    pub fn insert(&self, offset: usize, text: &str) {
        self.edit(offset..offset, text);
    }

    /// Delete a range of text
    pub fn delete(&self, range: Range<usize>) {
        self.edit(range, "");
    }

    /// Undo the last edit
    pub fn undo(&self) -> bool {
        let mut inner = self.inner.write();
        if let Some(edit) = inner.undo_stack.pop() {
            // Calculate new range after the edit
            let new_range = edit.range.start..edit.range.start + edit.new_text.len();

            // Perform reverse edit
            let mut new_rope = Rope::new();
            if new_range.start > 0 {
                new_rope.push_str(inner.text.slice(0..new_range.start));
            }
            new_rope.push_str(&edit.old_text);
            if new_range.end < inner.text.len() {
                new_rope.push_str(inner.text.slice(new_range.end..inner.text.len()));
            }

            inner.text = new_rope;
            inner.line_offsets = compute_line_offsets(&inner.text);

            // Move to redo stack
            inner.redo_stack.push(edit);
            true
        } else {
            false
        }
    }

    /// Redo the last undone edit
    pub fn redo(&self) -> bool {
        let mut inner = self.inner.write();
        if let Some(edit) = inner.redo_stack.pop() {
            // Perform the edit again
            let mut new_rope = Rope::new();
            if edit.range.start > 0 {
                new_rope.push_str(inner.text.slice(0..edit.range.start));
            }
            new_rope.push_str(&edit.new_text);
            if edit.range.end < inner.text.len() {
                new_rope.push_str(inner.text.slice(edit.range.end..inner.text.len()));
            }

            inner.text = new_rope;
            inner.line_offsets = compute_line_offsets(&inner.text);

            // Move back to undo stack
            inner.undo_stack.push(edit);
            true
        } else {
            false
        }
    }

    /// Mark the buffer as saved (not modified)
    pub fn mark_saved(&self) {
        self.inner.write().modified = false;
    }

    /// Get the text content as a string
    pub fn text(&self) -> String {
        self.inner.read().text.to_string()
    }

    /// Set the text content, replacing everything
    pub fn set_text(&self, text: &str) {
        let mut inner = self.inner.write();
        let old_len = inner.text.len();

        // Store for undo
        let old_text = inner.text.to_string();
        inner.undo_stack.push(BufferEdit {
            range: 0..old_len,
            old_text,
            new_text: text.to_string(),
        });
        inner.redo_stack.clear();

        // Replace all text
        inner.text = Rope::from_str(text);
        inner.line_offsets = compute_line_offsets(&inner.text);
        inner.modified = true;
    }
}

impl Default for Buffer {
    fn default() -> Self {
        Self::new()
    }
}

/// An immutable snapshot of a buffer's state
#[derive(Clone)]
pub struct BufferSnapshot {
    text: Rope,
    line_offsets: Vec<usize>,
}

impl BufferSnapshot {
    /// Get the text content as a string
    pub fn text(&self) -> String {
        self.text.to_string()
    }

    /// Get the length in bytes
    pub fn len(&self) -> usize {
        self.text.len()
    }

    /// Check if empty
    pub fn is_empty(&self) -> bool {
        self.text.is_empty()
    }

    /// Get the number of lines
    pub fn line_count(&self) -> u32 {
        // Number of lines is number of newlines + 1 (for the last line)
        if self.text.is_empty() {
            1 // Empty buffer still has one line
        } else {
            self.line_offsets.len() as u32 + 1
        }
    }

    /// Get text for a specific line (0-indexed)
    pub fn line(&self, line: u32) -> Option<&str> {
        let line = line as usize;
        if line >= self.line_offsets.len() {
            return None;
        }

        let start = if line == 0 {
            0
        } else {
            self.line_offsets[line - 1] + 1
        };
        let end = self
            .line_offsets
            .get(line)
            .copied()
            .unwrap_or(self.text.len());

        Some(self.text.slice(start..end))
    }

    /// Get the length of a line (0-indexed)
    pub fn line_len(&self, line: u32) -> u32 {
        self.line(line).map(|s| s.len() as u32).unwrap_or(0)
    }

    /// Convert a buffer point to an offset
    pub fn point_to_offset(&self, point: BufferPoint) -> usize {
        let line = point.row as usize;
        if line == 0 {
            point.column as usize
        } else if line <= self.line_offsets.len() {
            self.line_offsets[line - 1] + 1 + point.column as usize
        } else {
            self.text.len()
        }
    }

    /// Convert an offset to a buffer point
    pub fn offset_to_point(&self, offset: usize) -> BufferPoint {
        let offset = offset.min(self.text.len());

        // Binary search for the line
        let line = match self.line_offsets.binary_search(&offset) {
            Ok(i) => i,
            Err(i) => i,
        };

        let line_start = if line == 0 {
            0
        } else {
            self.line_offsets[line - 1] + 1
        };
        let column = offset.saturating_sub(line_start);

        BufferPoint {
            row: line as u32,
            column: column as u32,
        }
    }

    /// Resolve an anchor to an offset
    pub fn anchor_to_offset(&self, anchor: &Anchor) -> usize {
        anchor.offset.min(self.text.len())
    }

    /// Create an anchor at an offset
    pub fn offset_to_anchor(&self, offset: usize, bias: Bias) -> Anchor {
        Anchor {
            offset: offset.min(self.text.len()),
            bias,
        }
    }

    /// Get a slice of text
    pub fn slice(&self, range: Range<usize>) -> &str {
        let start = range.start.min(self.text.len());
        let end = range.end.min(self.text.len());
        self.text.slice(start..end)
    }

    /// Iterate over characters
    pub fn chars(&self) -> impl Iterator<Item = char> + '_ {
        self.text.chars()
    }
}

/// Compute line ending offsets from text
fn compute_line_offsets(text: &Rope) -> Vec<usize> {
    text.chars()
        .enumerate()
        .filter_map(|(i, ch)| if ch == '\n' { Some(i) } else { None })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_buffer_creation() {
        let buffer = Buffer::from_text("hello\nworld");
        assert_eq!(buffer.len(), 11);
        assert_eq!(buffer.line_count(), 2);
        assert!(!buffer.is_modified());
    }

    #[test]
    fn test_buffer_edit() {
        let buffer = Buffer::from_text("hello");
        buffer.edit(5..5, " world");

        let snapshot = buffer.snapshot();
        assert_eq!(snapshot.text(), "hello world");
        assert!(buffer.is_modified());
    }

    #[test]
    fn test_buffer_undo_redo() {
        let buffer = Buffer::from_text("hello");
        buffer.edit(5..5, " world");

        assert!(buffer.undo());
        assert_eq!(buffer.snapshot().text(), "hello");

        assert!(buffer.redo());
        assert_eq!(buffer.snapshot().text(), "hello world");
    }

    #[test]
    fn test_point_conversion() {
        let buffer = Buffer::from_text("hello\nworld\ntest");
        let snapshot = buffer.snapshot();

        assert_eq!(snapshot.offset_to_point(0), BufferPoint::new(0, 0));
        assert_eq!(snapshot.offset_to_point(6), BufferPoint::new(1, 0));
        assert_eq!(snapshot.offset_to_point(8), BufferPoint::new(1, 2));
    }
}
