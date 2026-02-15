//! Unit tests for the Notes Editor module
//!
//! Tests cover:
//! - NoteBuffer creation and manipulation
//! - NotesEditorState management
//! - Tab operations
//! - Helper functions (extract_title, extract_tags, extract_symbols)
//! - Note type detection

use super::super::notes_editor::*;

// ============================================================================
// NOTE TYPE TESTS
// ============================================================================

#[test]
fn test_note_type_label() {
    assert_eq!(NoteType::Research.label(), "Research");
    assert_eq!(NoteType::Thesis.label(), "Thesis");
    assert_eq!(NoteType::Trade.label(), "Trade");
    assert_eq!(NoteType::Daily.label(), "Daily");
    assert_eq!(NoteType::Meeting.label(), "Meeting");
    assert_eq!(NoteType::Idea.label(), "Idea");
}

#[test]
fn test_note_type_icon() {
    assert_eq!(NoteType::Research.icon(), "R");
    assert_eq!(NoteType::Thesis.icon(), "T");
    assert_eq!(NoteType::Trade.icon(), "J");
    assert_eq!(NoteType::Daily.icon(), "D");
    assert_eq!(NoteType::Meeting.icon(), "M");
    assert_eq!(NoteType::Idea.icon(), "I");
}

#[test]
fn test_note_type_default() {
    let default: NoteType = Default::default();
    assert_eq!(default, NoteType::Research);
}

// ============================================================================
// NOTE BUFFER TESTS
// ============================================================================

#[test]
fn test_note_buffer_new() {
    let buffer = NoteBuffer::new("test_note".to_string());

    assert_eq!(buffer.id, "test_note");
    assert!(buffer.title.contains("New Note"));
    assert!(buffer.content.is_empty());
    assert!(buffer.tags.is_empty());
    assert!(buffer.symbols.is_empty());
    assert_eq!(buffer.note_type, NoteType::Research);
    assert!(buffer.is_dirty); // New notes start dirty
    assert_eq!(buffer.cursor_position, 0);
    assert_eq!(buffer.scroll_offset, 0.0);
}

#[test]
fn test_note_buffer_from_content() {
    let content = "# My Research Note\n\nAnalysis of $AAPL and $MSFT\n\n#tech #analysis";
    let buffer = NoteBuffer::from_content("research_note".to_string(), content.to_string());

    assert_eq!(buffer.id, "research_note");
    assert_eq!(buffer.title, "My Research Note");
    assert!(!buffer.is_dirty); // Loaded from content, not dirty
    assert!(buffer.tags.contains(&"tech".to_string()));
    assert!(buffer.tags.contains(&"analysis".to_string()));
    assert!(buffer.symbols.contains(&"AAPL".to_string()));
    assert!(buffer.symbols.contains(&"MSFT".to_string()));
}

#[test]
fn test_note_buffer_set_content() {
    let mut buffer = NoteBuffer::new("test".to_string());
    buffer.is_dirty = false; // Reset dirty flag

    buffer.set_content("# New Title\n\nNew content".to_string());

    assert!(buffer.is_dirty);
    assert_eq!(buffer.title, "New Title");
}

#[test]
fn test_note_buffer_set_same_content_no_dirty() {
    let content = "# Test\n\nContent";
    let mut buffer = NoteBuffer::from_content("test".to_string(), content.to_string());
    assert!(!buffer.is_dirty);

    // Set same content
    buffer.set_content(content.to_string());

    // Should not mark as dirty if content is the same
    assert!(!buffer.is_dirty);
}

#[test]
fn test_note_buffer_mark_saved() {
    let mut buffer = NoteBuffer::new("test".to_string());
    assert!(buffer.is_dirty);

    buffer.mark_saved();

    assert!(!buffer.is_dirty);
}

#[test]
fn test_note_buffer_file_path() {
    let buffer = NoteBuffer::new("my_note".to_string());
    let path = buffer.file_path();

    assert!(path.to_string_lossy().ends_with("my_note.md"));
    assert!(path.to_string_lossy().contains(".stanley/notes"));
}

// ============================================================================
// NOTES EDITOR STATE TESTS
// ============================================================================

#[test]
fn test_notes_editor_state_default() {
    let state = NotesEditorState::default();

    assert!(state.buffers.is_empty());
    assert!(state.tab_order.is_empty());
    assert!(state.active_note.is_none());
    assert!(!state.preview_mode);
    assert!(!state.split_view);
    assert!(state.search_query.is_empty());
    assert!(state.all_notes.is_empty());
    assert!(state.loading);
    assert!(state.error.is_none());
}

#[test]
fn test_new_note_creation() {
    let mut state = NotesEditorState::new();

    let note_id = state.new_note();

    assert!(!note_id.is_empty());
    assert!(state.buffers.contains_key(&note_id));
    assert_eq!(state.tab_order.len(), 1);
    assert_eq!(state.active_note, Some(note_id.clone()));
    assert!(state.buffers.get(&note_id).unwrap().is_dirty);
}

#[test]
fn test_open_note() {
    let mut state = NotesEditorState::new();
    let content = "# Test Note\n\nContent here";

    state.open_note("test_note".to_string(), content.to_string());

    assert!(state.buffers.contains_key("test_note"));
    assert_eq!(state.tab_order, vec!["test_note"]);
    assert_eq!(state.active_note, Some("test_note".to_string()));
}

#[test]
fn test_open_note_twice_no_duplicate() {
    let mut state = NotesEditorState::new();
    let content = "# Test Note\n\nContent";

    state.open_note("test_note".to_string(), content.to_string());
    state.open_note("test_note".to_string(), content.to_string());

    // Should not create duplicate tabs
    assert_eq!(state.buffers.len(), 1);
    assert_eq!(state.tab_order.len(), 1);
}

#[test]
fn test_close_note_clean() {
    let mut state = NotesEditorState::new();
    state.open_note("note1".to_string(), "Content".to_string());

    let closed = state.close_note(&"note1".to_string());

    assert!(closed);
    assert!(!state.buffers.contains_key("note1"));
    assert!(state.tab_order.is_empty());
    assert!(state.active_note.is_none());
}

#[test]
fn test_close_note_dirty_returns_false() {
    let mut state = NotesEditorState::new();
    let note_id = state.new_note(); // New notes are dirty

    let closed = state.close_note(&note_id);

    assert!(!closed);
    assert!(state.buffers.contains_key(&note_id)); // Still there
}

#[test]
fn test_force_close_note() {
    let mut state = NotesEditorState::new();
    let note_id = state.new_note();

    state.force_close_note(&note_id);

    assert!(!state.buffers.contains_key(&note_id));
    assert!(state.tab_order.is_empty());
}

#[test]
fn test_switch_to_tab() {
    let mut state = NotesEditorState::new();
    state.open_note("note1".to_string(), "Content 1".to_string());
    state.open_note("note2".to_string(), "Content 2".to_string());

    assert_eq!(state.active_note, Some("note2".to_string()));

    state.switch_to_tab("note1".to_string());

    assert_eq!(state.active_note, Some("note1".to_string()));
}

#[test]
fn test_next_tab() {
    let mut state = NotesEditorState::new();
    state.open_note("note1".to_string(), "Content 1".to_string());
    state.open_note("note2".to_string(), "Content 2".to_string());
    state.open_note("note3".to_string(), "Content 3".to_string());

    state.switch_to_tab("note1".to_string());
    state.next_tab();

    assert_eq!(state.active_note, Some("note2".to_string()));

    state.next_tab();
    assert_eq!(state.active_note, Some("note3".to_string()));

    // Wrap around
    state.next_tab();
    assert_eq!(state.active_note, Some("note1".to_string()));
}

#[test]
fn test_prev_tab() {
    let mut state = NotesEditorState::new();
    state.open_note("note1".to_string(), "Content 1".to_string());
    state.open_note("note2".to_string(), "Content 2".to_string());
    state.open_note("note3".to_string(), "Content 3".to_string());

    // Currently on note3
    state.prev_tab();
    assert_eq!(state.active_note, Some("note2".to_string()));

    state.prev_tab();
    assert_eq!(state.active_note, Some("note1".to_string()));

    // Wrap around to end
    state.prev_tab();
    assert_eq!(state.active_note, Some("note3".to_string()));
}

#[test]
fn test_toggle_preview() {
    let mut state = NotesEditorState::new();
    assert!(!state.preview_mode);

    state.toggle_preview();
    assert!(state.preview_mode);

    state.toggle_preview();
    assert!(!state.preview_mode);
}

#[test]
fn test_toggle_split_view() {
    let mut state = NotesEditorState::new();
    assert!(!state.split_view);

    state.toggle_split_view();
    assert!(state.split_view);

    state.toggle_split_view();
    assert!(!state.split_view);
}

#[test]
fn test_has_unsaved_changes() {
    let mut state = NotesEditorState::new();
    assert!(!state.has_unsaved_changes()); // No notes

    state.open_note("clean".to_string(), "Content".to_string());
    assert!(!state.has_unsaved_changes()); // Loaded notes are clean

    state.new_note(); // New notes are dirty
    assert!(state.has_unsaved_changes());
}

#[test]
fn test_unsaved_notes() {
    let mut state = NotesEditorState::new();
    state.open_note("clean1".to_string(), "Content".to_string());
    state.open_note("clean2".to_string(), "Content".to_string());
    let dirty_id = state.new_note();

    let unsaved = state.unsaved_notes();

    assert_eq!(unsaved.len(), 1);
    assert_eq!(unsaved[0].id, dirty_id);
}

#[test]
fn test_update_active_content() {
    let mut state = NotesEditorState::new();
    state.open_note("test".to_string(), "Original".to_string());

    state.update_active_content("Updated content".to_string());

    let buffer = state.active_buffer().unwrap();
    assert_eq!(buffer.content, "Updated content");
    assert!(buffer.is_dirty);
}

#[test]
fn test_insert_text() {
    let mut state = NotesEditorState::new();
    state.open_note("test".to_string(), "Hello World".to_string());

    // Set cursor to beginning and insert
    if let Some(buffer) = state.active_buffer_mut() {
        buffer.cursor_position = 6; // After "Hello "
    }

    state.insert_text("Beautiful ");

    let buffer = state.active_buffer().unwrap();
    assert_eq!(buffer.content, "Hello Beautiful World");
    assert_eq!(buffer.cursor_position, 16); // After inserted text
}

#[test]
fn test_insert_bold() {
    let mut state = NotesEditorState::new();
    state.open_note("test".to_string(), String::new());

    state.insert_bold();

    let buffer = state.active_buffer().unwrap();
    assert!(buffer.content.contains("****"));
}

#[test]
fn test_insert_italic() {
    let mut state = NotesEditorState::new();
    state.open_note("test".to_string(), String::new());

    state.insert_italic();

    let buffer = state.active_buffer().unwrap();
    assert!(buffer.content.contains("**"));
}

#[test]
fn test_insert_code() {
    let mut state = NotesEditorState::new();
    state.open_note("test".to_string(), String::new());

    state.insert_code();

    let buffer = state.active_buffer().unwrap();
    assert!(buffer.content.contains("``"));
}

#[test]
fn test_insert_link() {
    let mut state = NotesEditorState::new();
    state.open_note("test".to_string(), String::new());

    state.insert_link();

    let buffer = state.active_buffer().unwrap();
    assert!(buffer.content.contains("[](url)"));
}

// ============================================================================
// ACTIVE BUFFER TESTS
// ============================================================================

#[test]
fn test_active_buffer_none_when_empty() {
    let state = NotesEditorState::new();
    assert!(state.active_buffer().is_none());
}

#[test]
fn test_active_buffer_returns_correct_note() {
    let mut state = NotesEditorState::new();
    state.open_note("note1".to_string(), "Content 1".to_string());
    state.open_note("note2".to_string(), "Content 2".to_string());

    let buffer = state.active_buffer().unwrap();
    assert_eq!(buffer.id, "note2");
}

// ============================================================================
// NOTES DIRECTORY TESTS
// ============================================================================

#[test]
fn test_notes_directory_path() {
    let dir = notes_directory();
    let dir_str = dir.to_string_lossy();

    assert!(dir_str.contains(".stanley"));
    assert!(dir_str.ends_with("notes"));
}

// ============================================================================
// EDGE CASES
// ============================================================================

#[test]
fn test_switch_to_nonexistent_tab() {
    let mut state = NotesEditorState::new();
    state.open_note("note1".to_string(), "Content".to_string());

    state.switch_to_tab("nonexistent".to_string());

    // Should not change active note
    assert_eq!(state.active_note, Some("note1".to_string()));
}

#[test]
fn test_next_tab_single_note() {
    let mut state = NotesEditorState::new();
    state.open_note("only".to_string(), "Content".to_string());

    state.next_tab();

    // Should stay on same note
    assert_eq!(state.active_note, Some("only".to_string()));
}

#[test]
fn test_prev_tab_single_note() {
    let mut state = NotesEditorState::new();
    state.open_note("only".to_string(), "Content".to_string());

    state.prev_tab();

    // Should stay on same note
    assert_eq!(state.active_note, Some("only".to_string()));
}

#[test]
fn test_close_multiple_notes() {
    let mut state = NotesEditorState::new();
    state.open_note("note1".to_string(), "Content 1".to_string());
    state.open_note("note2".to_string(), "Content 2".to_string());
    state.open_note("note3".to_string(), "Content 3".to_string());

    // Close middle note
    state.close_note(&"note2".to_string());

    assert_eq!(state.tab_order, vec!["note1", "note3"]);
    assert_eq!(state.buffers.len(), 2);
    // Active should be note3 (was last)
    assert_eq!(state.active_note, Some("note3".to_string()));
}

#[test]
fn test_note_buffer_large_content() {
    let large_content = "A".repeat(100_000);
    let buffer = NoteBuffer::from_content("large".to_string(), large_content.clone());

    assert_eq!(buffer.content.len(), 100_000);
    // Title should be truncated
    assert!(buffer.title.len() <= 50);
}

#[test]
fn test_note_buffer_unicode_content() {
    let unicode_content = "# Notes with Unicode\n\nSymbols: $AAPL #stocks\n\nEmojis: \u{1F4C8}\u{1F4B0}\u{1F680}";
    let buffer = NoteBuffer::from_content("unicode".to_string(), unicode_content.to_string());

    assert!(buffer.content.contains("\u{1F4C8}"));
    assert!(buffer.symbols.contains(&"AAPL".to_string()));
    assert!(buffer.tags.contains(&"stocks".to_string()));
}

#[test]
fn test_insert_text_at_end() {
    let mut state = NotesEditorState::new();
    state.open_note("test".to_string(), "Hello".to_string());

    // Set cursor past end
    if let Some(buffer) = state.active_buffer_mut() {
        buffer.cursor_position = 1000;
    }

    state.insert_text(" World");

    let buffer = state.active_buffer().unwrap();
    assert_eq!(buffer.content, "Hello World");
}

// ============================================================================
// NOTE SUMMARY TESTS
// ============================================================================

#[test]
fn test_note_summary_creation() {
    let summary = NoteSummary {
        id: "test_id".to_string(),
        title: "Test Title".to_string(),
        note_type: NoteType::Research,
        modified_at: "2024-01-15".to_string(),
        preview: "This is a preview...".to_string(),
    };

    assert_eq!(summary.id, "test_id");
    assert_eq!(summary.title, "Test Title");
    assert_eq!(summary.note_type, NoteType::Research);
}

// ============================================================================
// MULTIPLE NOTE WORKFLOW TESTS
// ============================================================================

#[test]
fn test_typical_editing_workflow() {
    let mut state = NotesEditorState::new();

    // Open existing note
    state.open_note("research".to_string(), "# Research Note\n\nContent".to_string());
    assert_eq!(state.buffers.len(), 1);
    assert!(!state.has_unsaved_changes());

    // Create new note
    let new_id = state.new_note();
    assert_eq!(state.buffers.len(), 2);
    assert!(state.has_unsaved_changes());

    // Switch back to research
    state.switch_to_tab("research".to_string());
    assert_eq!(state.active_note, Some("research".to_string()));

    // Edit research note
    state.update_active_content("# Research Note\n\nUpdated content".to_string());
    assert_eq!(state.unsaved_notes().len(), 2);

    // Save research note
    if let Some(buffer) = state.active_buffer_mut() {
        buffer.mark_saved();
    }

    // Only new note is unsaved now
    assert_eq!(state.unsaved_notes().len(), 1);
    assert_eq!(state.unsaved_notes()[0].id, new_id);
}

#[test]
fn test_auto_save_timing() {
    let mut state = NotesEditorState::new();
    state.open_note("test".to_string(), "Content".to_string());

    // Initially no edit time
    assert!(!state.should_auto_save());

    // After edit, still too recent
    state.update_active_content("Updated".to_string());
    assert!(!state.should_auto_save()); // Just edited, within 5 seconds
}
