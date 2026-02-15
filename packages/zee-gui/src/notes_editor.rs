//! Notes Editor View for Stanley GUI
//!
//! A self-contained markdown note editor with:
//! - Multi-note tab management
//! - Markdown syntax highlighting (visual styling)
//! - Markdown preview toggle
//! - File persistence to ~/.stanley/notes/
//! - Keyboard shortcuts (Ctrl+S, Ctrl+B, Ctrl+I, Ctrl+P, Ctrl+N)
//! - Auto-save with debouncing
//! - Dirty state tracking

use crate::theme::Theme;
use gpui::prelude::*;
use gpui::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};

// ============================================================================
// NOTE BUFFER
// ============================================================================

/// Unique identifier for a note
pub type NoteId = String;

/// Represents a single note buffer with content and metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct NoteBuffer {
    /// Unique identifier (usually filename without extension)
    pub id: NoteId,
    /// Display title (first line or filename)
    pub title: String,
    /// Full markdown content
    pub content: String,
    /// Tags extracted from frontmatter or content
    #[serde(default)]
    pub tags: Vec<String>,
    /// Associated stock symbols
    #[serde(default)]
    pub symbols: Vec<String>,
    /// Note type/category
    #[serde(default)]
    pub note_type: NoteType,
    /// Creation timestamp
    pub created_at: String,
    /// Last modified timestamp
    pub modified_at: String,
    /// Whether content has unsaved changes
    #[serde(skip)]
    pub is_dirty: bool,
    /// Cursor position in content
    #[serde(skip)]
    pub cursor_position: usize,
    /// Scroll offset for the editor
    #[serde(skip)]
    pub scroll_offset: f32,
}

impl NoteBuffer {
    /// Create a new empty note
    pub fn new(id: NoteId) -> Self {
        let now = chrono_now();
        let title = format!("New Note {}", &id[..8.min(id.len())]);
        Self {
            id,
            title,
            content: String::new(),
            tags: Vec::new(),
            symbols: Vec::new(),
            note_type: NoteType::Research,
            created_at: now.clone(),
            modified_at: now,
            is_dirty: true,
            cursor_position: 0,
            scroll_offset: 0.0,
        }
    }

    /// Create from file content
    #[allow(dead_code)]
    pub fn from_content(id: NoteId, content: String) -> Self {
        let title = extract_title(&content).unwrap_or_else(|| id.clone());
        let tags = extract_tags(&content);
        let symbols = extract_symbols(&content);
        let note_type = detect_note_type(&content);
        let now = chrono_now();

        Self {
            id,
            title,
            content,
            tags,
            symbols,
            note_type,
            created_at: now.clone(),
            modified_at: now,
            is_dirty: false,
            cursor_position: 0,
            scroll_offset: 0.0,
        }
    }

    /// Update content and mark as dirty
    #[allow(dead_code)]
    pub fn set_content(&mut self, content: String) {
        if self.content != content {
            self.content = content.clone();
            self.title = extract_title(&content).unwrap_or_else(|| self.id.clone());
            self.tags = extract_tags(&content);
            self.symbols = extract_symbols(&content);
            self.modified_at = chrono_now();
            self.is_dirty = true;
        }
    }

    /// Mark as saved
    pub fn mark_saved(&mut self) {
        self.is_dirty = false;
        self.modified_at = chrono_now();
    }

    /// Get file path for this note
    pub fn file_path(&self) -> PathBuf {
        notes_directory().join(format!("{}.md", self.id))
    }
}

/// Note type classification
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum NoteType {
    #[default]
    Research,
    Thesis,
    Trade,
    Daily,
    Meeting,
    Idea,
}

impl NoteType {
    pub fn label(&self) -> &'static str {
        match self {
            NoteType::Research => "Research",
            NoteType::Thesis => "Thesis",
            NoteType::Trade => "Trade",
            NoteType::Daily => "Daily",
            NoteType::Meeting => "Meeting",
            NoteType::Idea => "Idea",
        }
    }

    pub fn icon(&self) -> &'static str {
        match self {
            NoteType::Research => "R",
            NoteType::Thesis => "T",
            NoteType::Trade => "J",
            NoteType::Daily => "D",
            NoteType::Meeting => "M",
            NoteType::Idea => "I",
        }
    }
}

// ============================================================================
// NOTES VIEW STATE
// ============================================================================

/// Main state for the notes editor view
#[allow(dead_code)]
pub struct NotesEditorState {
    /// All open note buffers
    pub buffers: HashMap<NoteId, NoteBuffer>,
    /// Order of tabs (note IDs)
    pub tab_order: Vec<NoteId>,
    /// Currently active note ID
    pub active_note: Option<NoteId>,
    /// Whether preview mode is enabled
    pub preview_mode: bool,
    /// Split view: show editor and preview side by side
    pub split_view: bool,
    /// Search query for note list
    pub search_query: String,
    /// All notes in the directory (for sidebar)
    pub all_notes: Vec<NoteSummary>,
    /// Auto-save timer tracking
    pub last_edit_time: Option<Instant>,
    /// Whether the notes list is loading
    pub loading: bool,
    /// Error message if any
    pub error: Option<String>,
}

/// Summary info for note list
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct NoteSummary {
    pub id: NoteId,
    pub title: String,
    pub note_type: NoteType,
    pub modified_at: String,
    pub preview: String,
}

impl Default for NotesEditorState {
    fn default() -> Self {
        Self {
            buffers: HashMap::new(),
            tab_order: Vec::new(),
            active_note: None,
            preview_mode: false,
            split_view: false,
            search_query: String::new(),
            all_notes: Vec::new(),
            last_edit_time: None,
            loading: true,
            error: None,
        }
    }
}

impl NotesEditorState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Get the active note buffer
    pub fn active_buffer(&self) -> Option<&NoteBuffer> {
        self.active_note
            .as_ref()
            .and_then(|id| self.buffers.get(id))
    }

    /// Get mutable active note buffer
    #[allow(dead_code)]
    pub fn active_buffer_mut(&mut self) -> Option<&mut NoteBuffer> {
        if let Some(id) = self.active_note.clone() {
            self.buffers.get_mut(&id)
        } else {
            None
        }
    }

    /// Create a new note and open it
    pub fn new_note(&mut self) -> NoteId {
        let id = generate_note_id();
        let buffer = NoteBuffer::new(id.clone());

        self.buffers.insert(id.clone(), buffer);
        self.tab_order.push(id.clone());
        self.active_note = Some(id.clone());

        id
    }

    /// Open an existing note by ID
    #[allow(dead_code)]
    pub fn open_note(&mut self, id: NoteId, content: String) {
        if !self.buffers.contains_key(&id) {
            let buffer = NoteBuffer::from_content(id.clone(), content);
            self.buffers.insert(id.clone(), buffer);
            self.tab_order.push(id.clone());
        }
        self.active_note = Some(id);
    }

    /// Close a note tab
    pub fn close_note(&mut self, id: &NoteId) -> bool {
        if let Some(buffer) = self.buffers.get(id) {
            if buffer.is_dirty {
                // Return false to indicate unsaved changes
                return false;
            }
        }

        self.buffers.remove(id);
        self.tab_order.retain(|tab_id| tab_id != id);

        // If we closed the active note, switch to another
        if self.active_note.as_ref() == Some(id) {
            self.active_note = self.tab_order.last().cloned();
        }

        true
    }

    /// Force close a note (discard changes)
    #[allow(dead_code)]
    pub fn force_close_note(&mut self, id: &NoteId) {
        self.buffers.remove(id);
        self.tab_order.retain(|tab_id| tab_id != id);

        if self.active_note.as_ref() == Some(id) {
            self.active_note = self.tab_order.last().cloned();
        }
    }

    /// Switch to a specific tab
    #[allow(dead_code)]
    pub fn switch_to_tab(&mut self, id: NoteId) {
        if self.buffers.contains_key(&id) {
            self.active_note = Some(id);
        }
    }

    /// Switch to next tab
    pub fn next_tab(&mut self) {
        if let Some(current) = &self.active_note {
            if let Some(pos) = self.tab_order.iter().position(|id| id == current) {
                let next_pos = (pos + 1) % self.tab_order.len();
                self.active_note = Some(self.tab_order[next_pos].clone());
            }
        }
    }

    /// Switch to previous tab
    pub fn prev_tab(&mut self) {
        if let Some(current) = &self.active_note {
            if let Some(pos) = self.tab_order.iter().position(|id| id == current) {
                let prev_pos = if pos == 0 {
                    self.tab_order.len() - 1
                } else {
                    pos - 1
                };
                self.active_note = Some(self.tab_order[prev_pos].clone());
            }
        }
    }

    /// Toggle preview mode
    pub fn toggle_preview(&mut self) {
        self.preview_mode = !self.preview_mode;
    }

    /// Toggle split view
    pub fn toggle_split_view(&mut self) {
        self.split_view = !self.split_view;
    }

    /// Check if any notes have unsaved changes
    #[allow(dead_code)]
    pub fn has_unsaved_changes(&self) -> bool {
        self.buffers.values().any(|b| b.is_dirty)
    }

    /// Get list of notes with unsaved changes
    #[allow(dead_code)]
    pub fn unsaved_notes(&self) -> Vec<&NoteBuffer> {
        self.buffers.values().filter(|b| b.is_dirty).collect()
    }

    /// Update content of active note
    #[allow(dead_code)]
    pub fn update_active_content(&mut self, content: String) {
        if let Some(buffer) = self.active_buffer_mut() {
            buffer.set_content(content);
            self.last_edit_time = Some(Instant::now());
        }
    }

    /// Insert text at cursor position in active note
    pub fn insert_text(&mut self, text: &str) {
        if let Some(buffer) = self.active_buffer_mut() {
            let pos = buffer.cursor_position.min(buffer.content.len());
            buffer.content.insert_str(pos, text);
            buffer.cursor_position = pos + text.len();
            buffer.is_dirty = true;
            buffer.modified_at = chrono_now();
            self.last_edit_time = Some(Instant::now());
        }
    }

    /// Wrap selected text with markdown formatting
    pub fn wrap_with(&mut self, prefix: &str, suffix: &str) {
        // For now, just insert at cursor
        self.insert_text(&format!("{}{}", prefix, suffix));
    }

    /// Insert bold markdown
    pub fn insert_bold(&mut self) {
        self.wrap_with("**", "**");
    }

    /// Insert italic markdown
    pub fn insert_italic(&mut self) {
        self.wrap_with("*", "*");
    }

    /// Insert code block
    pub fn insert_code(&mut self) {
        self.wrap_with("`", "`");
    }

    /// Insert link
    pub fn insert_link(&mut self) {
        self.insert_text("[](url)");
    }

    /// Check if auto-save should trigger
    #[allow(dead_code)]
    pub fn should_auto_save(&self) -> bool {
        if let Some(last_edit) = self.last_edit_time {
            last_edit.elapsed() >= Duration::from_secs(5)
        } else {
            false
        }
    }
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================

/// Get the notes directory path
pub fn notes_directory() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".stanley").join("notes")
}

/// Ensure notes directory exists
#[allow(dead_code)]
pub fn ensure_notes_directory() -> std::io::Result<()> {
    let dir = notes_directory();
    std::fs::create_dir_all(&dir)?;
    Ok(())
}

/// List all note files in the directory
pub fn list_note_files() -> std::io::Result<Vec<PathBuf>> {
    let dir = notes_directory();
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            files.push(path);
        }
    }

    // Sort by modification time (newest first)
    files.sort_by(|a, b| {
        let a_time = a.metadata().and_then(|m| m.modified()).ok();
        let b_time = b.metadata().and_then(|m| m.modified()).ok();
        b_time.cmp(&a_time)
    });

    Ok(files)
}

/// Load a note from disk
pub fn load_note(path: &PathBuf) -> std::io::Result<(NoteId, String)> {
    let content = std::fs::read_to_string(path)?;
    let id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();
    Ok((id, content))
}

/// Save a note to disk
#[allow(dead_code)]
pub fn save_note(buffer: &NoteBuffer) -> std::io::Result<()> {
    ensure_notes_directory()?;
    let path = buffer.file_path();
    std::fs::write(&path, &buffer.content)?;
    Ok(())
}

/// Delete a note from disk
#[allow(dead_code)]
pub fn delete_note(id: &NoteId) -> std::io::Result<()> {
    let path = notes_directory().join(format!("{}.md", id));
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

/// Load all note summaries
pub fn load_note_summaries() -> Vec<NoteSummary> {
    let files = match list_note_files() {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };

    files
        .into_iter()
        .filter_map(|path| {
            let (id, content) = load_note(&path).ok()?;
            let title = extract_title(&content).unwrap_or_else(|| id.clone());
            let note_type = detect_note_type(&content);
            let preview = content.chars().take(100).collect::<String>();
            let modified_at = path
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .map(|t| format!("{:?}", t))
                .unwrap_or_default();

            Some(NoteSummary {
                id,
                title,
                note_type,
                modified_at,
                preview,
            })
        })
        .collect()
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/// Generate a unique note ID
#[allow(dead_code)]
fn generate_note_id() -> NoteId {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("note_{}", timestamp)
}

/// Get current timestamp as string
#[allow(dead_code)]
fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();
    // Simple ISO-like format
    let days = secs / 86400;
    let years = 1970 + days / 365;
    let remaining_days = days % 365;
    let months = remaining_days / 30 + 1;
    let day = remaining_days % 30 + 1;
    format!("{:04}-{:02}-{:02}", years, months, day)
}

/// Extract title from markdown content (first heading or first line)
fn extract_title(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        // Check for markdown heading
        if let Some(title) = trimmed.strip_prefix("# ") {
            return Some(title.to_string());
        }
        // Use first non-empty line as title
        return Some(trimmed.chars().take(50).collect());
    }
    None
}

/// Extract tags from content (looks for #tag patterns)
#[allow(dead_code)]
fn extract_tags(content: &str) -> Vec<String> {
    let mut tags = Vec::new();
    for word in content.split_whitespace() {
        if let Some(tag) = word.strip_prefix('#') {
            let clean_tag: String = tag.chars().take_while(|c| c.is_alphanumeric()).collect();
            if !clean_tag.is_empty() && !tags.contains(&clean_tag) {
                tags.push(clean_tag);
            }
        }
    }
    tags
}

/// Extract stock symbols from content (looks for $SYMBOL patterns)
#[allow(dead_code)]
fn extract_symbols(content: &str) -> Vec<String> {
    let mut symbols = Vec::new();
    for word in content.split_whitespace() {
        if let Some(symbol) = word.strip_prefix('$') {
            let clean_symbol: String = symbol
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '.')
                .collect::<String>()
                .to_uppercase();
            if !clean_symbol.is_empty() && !symbols.contains(&clean_symbol) {
                symbols.push(clean_symbol);
            }
        }
    }
    symbols
}

/// Detect note type from content
fn detect_note_type(content: &str) -> NoteType {
    let lower = content.to_lowercase();
    if lower.contains("thesis:") || lower.contains("investment thesis") {
        NoteType::Thesis
    } else if lower.contains("trade:") || lower.contains("entry:") || lower.contains("exit:") {
        NoteType::Trade
    } else if lower.contains("daily:") || lower.contains("daily note") {
        NoteType::Daily
    } else if lower.contains("meeting:") || lower.contains("call with") {
        NoteType::Meeting
    } else if lower.contains("idea:") {
        NoteType::Idea
    } else {
        NoteType::Research
    }
}

// ============================================================================
// MARKDOWN RENDERING (Simple Preview)
// ============================================================================

/// Parse markdown to styled elements for preview
pub fn render_markdown_preview(theme: &Theme, content: &str) -> Div {
    let lines: Vec<Div> = content
        .lines()
        .map(|line| render_markdown_line(theme, line))
        .collect();

    div()
        .flex()
        .flex_col()
        .gap(px(8.0))
        .p(px(16.0))
        .children(lines)
}

/// Render a single line of markdown
fn render_markdown_line(theme: &Theme, line: &str) -> Div {
    let trimmed = line.trim();

    // Headings
    if let Some(text) = trimmed.strip_prefix("### ") {
        return div()
            .text_size(px(16.0))
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(theme.text)
            .pb(px(4.0))
            .child(text.to_string());
    }
    if let Some(text) = trimmed.strip_prefix("## ") {
        return div()
            .text_size(px(18.0))
            .font_weight(FontWeight::BOLD)
            .text_color(theme.text)
            .pb(px(6.0))
            .child(text.to_string());
    }
    if let Some(text) = trimmed.strip_prefix("# ") {
        return div()
            .text_size(px(22.0))
            .font_weight(FontWeight::BOLD)
            .text_color(theme.text)
            .pb(px(8.0))
            .child(text.to_string());
    }

    // Bullet points
    if let Some(text) = trimmed.strip_prefix("- ") {
        return div()
            .flex()
            .items_start()
            .gap(px(8.0))
            .child(
                div()
                    .text_size(px(14.0))
                    .text_color(theme.accent)
                    .child("*"),
            )
            .child(
                div()
                    .text_size(px(14.0))
                    .text_color(theme.text_secondary)
                    .child(text.to_string()),
            );
    }

    // Numbered lists
    if trimmed.starts_with(|c: char| c.is_numeric()) {
        if let Some(pos) = trimmed.find(". ") {
            let num = &trimmed[..pos + 1];
            let text = &trimmed[pos + 2..];
            return div()
                .flex()
                .items_start()
                .gap(px(8.0))
                .child(
                    div()
                        .text_size(px(14.0))
                        .text_color(theme.accent)
                        .child(num.to_string()),
                )
                .child(
                    div()
                        .text_size(px(14.0))
                        .text_color(theme.text_secondary)
                        .child(text.to_string()),
                );
        }
    }

    // Blockquotes
    if let Some(text) = trimmed.strip_prefix("> ") {
        return div()
            .pl(px(12.0))
            .border_l_2()
            .border_color(theme.accent)
            .text_size(px(14.0))
            .text_color(theme.text_muted)
            // Note: font_style not available in GPUI, using opacity for visual distinction
            .opacity(0.85)
            .child(text.to_string());
    }

    // Code blocks (inline detection)
    if trimmed.starts_with("```") {
        return div()
            .p(px(8.0))
            .rounded(px(4.0))
            .bg(theme.card_bg)
            .text_size(px(12.0))
            .text_color(theme.accent)
            .child(trimmed.to_string());
    }

    // Horizontal rule
    if trimmed == "---" || trimmed == "***" || trimmed == "___" {
        return div().h(px(1.0)).my(px(12.0)).bg(theme.border);
    }

    // Empty lines
    if trimmed.is_empty() {
        return div().h(px(8.0));
    }

    // Regular paragraph
    div()
        .text_size(px(14.0))
        .text_color(theme.text_secondary)
        .child(line.to_string())
}

// ============================================================================
// RENDERING
// ============================================================================

/// Render the notes editor view
pub fn render_notes_editor(theme: &Theme, state: &NotesEditorState) -> Div {
    div()
        .flex_grow()
        .h_full()
        .flex()
        .flex_row()
        // Left sidebar: notes list
        .child(render_notes_sidebar(theme, state))
        // Right: editor area with tabs
        .child(render_editor_area(theme, state))
}

/// Render the notes list sidebar
fn render_notes_sidebar(theme: &Theme, state: &NotesEditorState) -> Div {
    div()
        .w(px(280.0))
        .h_full()
        .flex()
        .flex_col()
        .bg(theme.sidebar_bg)
        .border_r_1()
        .border_color(theme.border_subtle)
        // Header with search and new note button
        .child(
            div()
                .px(px(16.0))
                .py(px(12.0))
                .border_b_1()
                .border_color(theme.border_subtle)
                .flex()
                .flex_col()
                .gap(px(12.0))
                // Title and new button
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(
                            div()
                                .text_size(px(14.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(theme.text)
                                .child("Notes"),
                        )
                        .child(
                            div()
                                .px(px(10.0))
                                .py(px(4.0))
                                .rounded(px(4.0))
                                .bg(theme.accent)
                                .cursor_pointer()
                                .hover(|s| s.bg(theme.accent_hover))
                                .text_size(px(11.0))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(hsla(0.0, 0.0, 1.0, 1.0))
                                .child("+ New"),
                        ),
                )
                // Search box
                .child(
                    div()
                        .h(px(32.0))
                        .px(px(10.0))
                        .rounded(px(6.0))
                        .bg(theme.card_bg)
                        .border_1()
                        .border_color(theme.border_subtle)
                        .flex()
                        .items_center()
                        .child(
                            div()
                                .text_size(px(12.0))
                                .text_color(theme.text_dimmed)
                                .child(if state.search_query.is_empty() {
                                    "Search notes...".to_string()
                                } else {
                                    state.search_query.clone()
                                }),
                        ),
                ),
        )
        // Notes list
        .child(div().flex_grow().overflow_hidden().child(if state.loading {
            render_loading_indicator(theme)
        } else if state.all_notes.is_empty() {
            render_empty_state(theme)
        } else {
            render_notes_list(theme, state)
        }))
        // Keyboard shortcuts hint
        .child(
            div()
                .px(px(12.0))
                .py(px(8.0))
                .border_t_1()
                .border_color(theme.border_subtle)
                .flex()
                .items_center()
                .gap(px(12.0))
                .child(shortcut_hint(theme, "Ctrl+N", "New"))
                .child(shortcut_hint(theme, "Ctrl+S", "Save"))
                .child(shortcut_hint(theme, "Ctrl+P", "Preview")),
        )
}

/// Render the list of notes
fn render_notes_list(theme: &Theme, state: &NotesEditorState) -> Div {
    div().flex().flex_col().children(
        state
            .all_notes
            .iter()
            .map(|note| render_note_list_item(theme, note, state.active_note.as_ref())),
    )
}

/// Render a single note in the list
fn render_note_list_item(
    theme: &Theme,
    note: &NoteSummary,
    active_id: Option<&NoteId>,
) -> impl IntoElement {
    let is_active = active_id == Some(&note.id);

    div()
        .px(px(12.0))
        .py(px(10.0))
        .cursor_pointer()
        .bg(if is_active {
            theme.accent_subtle
        } else {
            transparent_black()
        })
        .border_b_1()
        .border_color(theme.border_subtle)
        .hover(|s| s.bg(theme.hover_bg))
        .flex()
        .flex_col()
        .gap(px(4.0))
        // Title row with type badge
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                .child(
                    div()
                        .size(px(20.0))
                        .rounded(px(4.0))
                        .bg(note_type_color(theme, note.note_type).opacity(0.15))
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(9.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(note_type_color(theme, note.note_type))
                        .child(note.note_type.icon()),
                )
                .child(
                    div()
                        .flex_grow()
                        .text_size(px(12.0))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(if is_active {
                            theme.text
                        } else {
                            theme.text_secondary
                        })
                        .overflow_hidden()
                        .child(note.title.clone()),
                ),
        )
        // Preview text
        .child(
            div()
                .text_size(px(11.0))
                .text_color(theme.text_dimmed)
                .overflow_hidden()
                .child(note.preview.chars().take(60).collect::<String>()),
        )
}

/// Render the main editor area
fn render_editor_area(theme: &Theme, state: &NotesEditorState) -> Div {
    div()
        .flex_grow()
        .h_full()
        .flex()
        .flex_col()
        .bg(theme.background)
        // Tab bar
        .child(render_tab_bar(theme, state))
        // Editor content
        .child(if state.tab_order.is_empty() {
            render_no_notes_open(theme)
        } else if state.split_view {
            render_split_editor(theme, state)
        } else if state.preview_mode {
            render_preview_only(theme, state)
        } else {
            render_editor_only(theme, state)
        })
}

/// Render the tab bar
fn render_tab_bar(theme: &Theme, state: &NotesEditorState) -> Div {
    div()
        .h(px(40.0))
        .px(px(8.0))
        .flex()
        .items_center()
        .gap(px(4.0))
        .border_b_1()
        .border_color(theme.border_subtle)
        .bg(theme.card_bg)
        .children(
            state
                .tab_order
                .iter()
                .filter_map(|id| state.buffers.get(id))
                .map(|buffer| render_tab(theme, buffer, state.active_note.as_ref())),
        )
        // Spacer
        .child(div().flex_grow())
        // View toggles
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(4.0))
                .child(view_toggle_button(theme, "Edit", !state.preview_mode))
                .child(view_toggle_button(theme, "Preview", state.preview_mode))
                .child(view_toggle_button(theme, "Split", state.split_view)),
        )
}

/// Render a single tab
fn render_tab(theme: &Theme, buffer: &NoteBuffer, active_id: Option<&NoteId>) -> impl IntoElement {
    let is_active = active_id == Some(&buffer.id);

    div()
        .px(px(12.0))
        .py(px(6.0))
        .rounded_t(px(4.0))
        .cursor_pointer()
        .bg(if is_active {
            theme.background
        } else {
            transparent_black()
        })
        .border_1()
        .border_color(if is_active {
            theme.border_subtle
        } else {
            transparent_black()
        })
        .border_b_0()
        .hover(|s| if is_active { s } else { s.bg(theme.hover_bg) })
        .flex()
        .items_center()
        .gap(px(8.0))
        // Dirty indicator
        .when(buffer.is_dirty, |el| {
            el.child(div().size(px(6.0)).rounded_full().bg(theme.warning))
        })
        // Title
        .child(
            div()
                .text_size(px(12.0))
                .text_color(if is_active {
                    theme.text
                } else {
                    theme.text_muted
                })
                .max_w(px(120.0))
                .overflow_hidden()
                .child(buffer.title.clone()),
        )
        // Close button
        .child(
            div()
                .size(px(16.0))
                .rounded(px(2.0))
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(10.0))
                .text_color(theme.text_dimmed)
                .hover(|s| s.bg(theme.hover_bg).text_color(theme.text))
                .child("x"),
        )
}

/// View toggle button
fn view_toggle_button(theme: &Theme, label: &str, is_active: bool) -> impl IntoElement {
    div()
        .px(px(10.0))
        .py(px(4.0))
        .rounded(px(4.0))
        .cursor_pointer()
        .bg(if is_active {
            theme.accent_subtle
        } else {
            transparent_black()
        })
        .text_color(if is_active {
            theme.accent
        } else {
            theme.text_muted
        })
        .text_size(px(11.0))
        .font_weight(if is_active {
            FontWeight::SEMIBOLD
        } else {
            FontWeight::NORMAL
        })
        .hover(|s| s.bg(theme.hover_bg))
        .child(label.to_string())
}

/// Render editor only view
fn render_editor_only(theme: &Theme, state: &NotesEditorState) -> Div {
    div()
        .flex_grow()
        .p(px(24.0))
        .overflow_hidden()
        .child(match state.active_buffer() {
            Some(buffer) => render_editor_content(theme, buffer),
            None => render_no_notes_open(theme),
        })
}

/// Render preview only view
fn render_preview_only(theme: &Theme, state: &NotesEditorState) -> Div {
    div()
        .flex_grow()
        .overflow_hidden()
        .child(match state.active_buffer() {
            Some(buffer) => render_markdown_preview(theme, &buffer.content),
            None => render_no_notes_open(theme),
        })
}

/// Render split view (editor + preview)
fn render_split_editor(theme: &Theme, state: &NotesEditorState) -> Div {
    div()
        .flex_grow()
        .flex()
        .flex_row()
        // Editor pane
        .child(
            div()
                .w_1_2()
                .p(px(24.0))
                .overflow_hidden()
                .border_r_1()
                .border_color(theme.border_subtle)
                .child(match state.active_buffer() {
                    Some(buffer) => render_editor_content(theme, buffer),
                    None => div(),
                }),
        )
        // Preview pane
        .child(div().w_1_2().overflow_hidden().bg(theme.card_bg).child(
            match state.active_buffer() {
                Some(buffer) => render_markdown_preview(theme, &buffer.content),
                None => div(),
            },
        ))
}

/// Render the text editor content
fn render_editor_content(theme: &Theme, buffer: &NoteBuffer) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(16.0))
        // Metadata bar
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(12.0))
                .pb(px(12.0))
                .border_b_1()
                .border_color(theme.border_subtle)
                // Note type badge
                .child(
                    div()
                        .px(px(10.0))
                        .py(px(4.0))
                        .rounded(px(4.0))
                        .bg(note_type_color(theme, buffer.note_type).opacity(0.15))
                        .text_size(px(11.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(note_type_color(theme, buffer.note_type))
                        .child(buffer.note_type.label()),
                )
                // Tags
                .children(buffer.tags.iter().take(3).map(|tag| {
                    div()
                        .px(px(8.0))
                        .py(px(2.0))
                        .rounded(px(4.0))
                        .bg(theme.border_subtle)
                        .text_size(px(10.0))
                        .text_color(theme.text_muted)
                        .child(format!("#{}", tag))
                }))
                // Symbols
                .children(buffer.symbols.iter().take(3).map(|sym| {
                    div()
                        .px(px(8.0))
                        .py(px(2.0))
                        .rounded(px(4.0))
                        .bg(theme.accent.opacity(0.1))
                        .text_size(px(10.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.accent)
                        .child(format!("${}", sym))
                }))
                // Spacer
                .child(div().flex_grow())
                // Modified time
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(theme.text_dimmed)
                        .child(format!("Modified: {}", buffer.modified_at)),
                ),
        )
        // Toolbar
        .child(render_editor_toolbar(theme))
        // Text editor area (styled as editable text display)
        .child(
            div()
                .min_h(px(400.0))
                .p(px(16.0))
                .rounded(px(8.0))
                .bg(theme.card_bg)
                .border_1()
                .border_color(theme.border)
                // Monospace font for markdown editing
                .text_size(px(14.0))
                .text_color(theme.text_secondary)
                .child(if buffer.content.is_empty() {
                    div()
                        .text_color(theme.text_dimmed)
                        .child("Start writing your note...")
                } else {
                    // Render content with simple syntax highlighting
                    render_syntax_highlighted_content(theme, &buffer.content)
                }),
        )
}

/// Render the editor toolbar
fn render_editor_toolbar(theme: &Theme) -> Div {
    div()
        .flex()
        .items_center()
        .gap(px(4.0))
        .child(toolbar_button(theme, "B", "Bold (Ctrl+B)"))
        .child(toolbar_button(theme, "I", "Italic (Ctrl+I)"))
        .child(toolbar_button(theme, "</> ", "Code"))
        .child(div().w(px(1.0)).h(px(20.0)).bg(theme.border_subtle))
        .child(toolbar_button(theme, "H1", "Heading 1"))
        .child(toolbar_button(theme, "H2", "Heading 2"))
        .child(toolbar_button(theme, "H3", "Heading 3"))
        .child(div().w(px(1.0)).h(px(20.0)).bg(theme.border_subtle))
        .child(toolbar_button(theme, "*", "Bullet list"))
        .child(toolbar_button(theme, "1.", "Numbered list"))
        .child(toolbar_button(theme, ">", "Quote"))
        .child(div().w(px(1.0)).h(px(20.0)).bg(theme.border_subtle))
        .child(toolbar_button(theme, "[]", "Link"))
        .child(toolbar_button(theme, "$", "Symbol"))
        .child(toolbar_button(theme, "#", "Tag"))
}

/// Toolbar button
fn toolbar_button(theme: &Theme, label: &str, _tooltip: &str) -> impl IntoElement {
    div()
        .px(px(8.0))
        .py(px(4.0))
        .rounded(px(4.0))
        .cursor_pointer()
        .text_size(px(12.0))
        .font_weight(FontWeight::MEDIUM)
        .text_color(theme.text_muted)
        .hover(|s| s.bg(theme.hover_bg).text_color(theme.text))
        .child(label.to_string())
}

/// Render syntax highlighted content
fn render_syntax_highlighted_content(theme: &Theme, content: &str) -> Div {
    div()
        .flex()
        .flex_col()
        .children(content.lines().map(|line| {
            let trimmed = line.trim();

            // Headings - blue
            if trimmed.starts_with('#') {
                return div()
                    .text_color(theme.accent)
                    .font_weight(FontWeight::BOLD)
                    .child(line.to_string());
            }

            // Bullet points and lists - dimmed bullet
            if trimmed.starts_with("- ") || trimmed.starts_with("* ") {
                return div().child(line.to_string());
            }

            // Quotes - muted
            if trimmed.starts_with('>') {
                return div()
                    .text_color(theme.text_muted)
                    .opacity(0.85)
                    .child(line.to_string());
            }

            // Code blocks
            if trimmed.starts_with("```") {
                return div().text_color(theme.positive).child(line.to_string());
            }

            // Regular text
            div()
                .text_color(theme.text_secondary)
                .child(line.to_string())
        }))
}

/// Render no notes open state
fn render_no_notes_open(theme: &Theme) -> Div {
    div()
        .flex_grow()
        .flex()
        .items_center()
        .justify_center()
        .child(
            div()
                .flex()
                .flex_col()
                .items_center()
                .gap(px(16.0))
                .child(
                    div()
                        .size(px(64.0))
                        .rounded_full()
                        .bg(theme.card_bg)
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(24.0))
                        .text_color(theme.text_dimmed)
                        .child("N"),
                )
                .child(
                    div()
                        .text_size(px(16.0))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(theme.text_muted)
                        .child("No notes open"),
                )
                .child(
                    div()
                        .text_size(px(13.0))
                        .text_color(theme.text_dimmed)
                        .child("Select a note from the sidebar or press Ctrl+N to create one"),
                ),
        )
}

/// Render loading indicator
fn render_loading_indicator(theme: &Theme) -> Div {
    div()
        .py(px(40.0))
        .flex()
        .items_center()
        .justify_center()
        .child(
            div()
                .text_size(px(12.0))
                .text_color(theme.text_dimmed)
                .child("Loading notes..."),
        )
}

/// Render empty state for notes list
fn render_empty_state(theme: &Theme) -> Div {
    div()
        .py(px(40.0))
        .px(px(16.0))
        .flex()
        .flex_col()
        .items_center()
        .gap(px(16.0))
        .child(
            div()
                .text_size(px(13.0))
                .text_color(theme.text_muted)
                .child("No notes yet"),
        )
        // Add a "Create Note" button for better UX
        .child(
            div()
                .px(px(12.0))
                .py(px(6.0))
                .rounded(px(6.0))
                .bg(theme.accent)
                .text_color(hsla(0.0, 0.0, 1.0, 1.0))
                .text_size(px(12.0))
                .font_weight(FontWeight::MEDIUM)
                .cursor_pointer()
                .hover(|s| s.bg(theme.accent_hover))
                // Note: Actual click handling would require this component to accept a callback
                // For now this is a visual improvement that guides the user
                .child("+ Create Note"),
        )
        .child(
            div()
                .text_size(px(11.0))
                .text_color(theme.text_dimmed)
                .text_align(gpui::TextAlign::Center)
                .child("or press Ctrl+N"),
        )
}

/// Keyboard shortcut hint
fn shortcut_hint(theme: &Theme, shortcut: &str, action: &str) -> impl IntoElement {
    div()
        .flex()
        .items_center()
        .gap(px(4.0))
        .child(
            div()
                .px(px(4.0))
                .py(px(2.0))
                .rounded(px(3.0))
                .bg(theme.card_bg)
                .text_size(px(9.0))
                .text_color(theme.text_dimmed)
                .child(shortcut.to_string()),
        )
        .child(
            div()
                .text_size(px(10.0))
                .text_color(theme.text_dimmed)
                .child(action.to_string()),
        )
}

/// Get color for note type
fn note_type_color(theme: &Theme, note_type: NoteType) -> Hsla {
    match note_type {
        NoteType::Research => theme.accent,
        NoteType::Thesis => theme.positive,
        NoteType::Trade => theme.warning,
        NoteType::Daily => theme.text_muted,
        NoteType::Meeting => theme.negative,
        NoteType::Idea => hsla(280.0 / 360.0, 0.70, 0.55, 1.0), // Purple
    }
}

// ============================================================================
// KEYBOARD ACTIONS
// ============================================================================

/// Actions that can be triggered by keyboard shortcuts
#[derive(Debug, Clone, Copy)]
#[allow(dead_code)]
pub enum NotesAction {
    NewNote,
    SaveNote,
    CloseNote,
    TogglePreview,
    ToggleSplit,
    NextTab,
    PrevTab,
    InsertBold,
    InsertItalic,
    InsertCode,
    InsertLink,
}

/// Process a keyboard action
#[allow(dead_code)]
pub fn handle_notes_action(state: &mut NotesEditorState, action: NotesAction) {
    match action {
        NotesAction::NewNote => {
            let _ = state.new_note();
        }
        NotesAction::SaveNote => {
            if let Some(buffer) = state.active_buffer_mut() {
                if let Err(e) = save_note(buffer) {
                    state.error = Some(format!("Failed to save: {}", e));
                } else {
                    buffer.mark_saved();
                }
            }
        }
        NotesAction::CloseNote => {
            if let Some(id) = state.active_note.clone() {
                let _ = state.close_note(&id);
            }
        }
        NotesAction::TogglePreview => {
            state.toggle_preview();
        }
        NotesAction::ToggleSplit => {
            state.toggle_split_view();
        }
        NotesAction::NextTab => {
            state.next_tab();
        }
        NotesAction::PrevTab => {
            state.prev_tab();
        }
        NotesAction::InsertBold => {
            state.insert_bold();
        }
        NotesAction::InsertItalic => {
            state.insert_italic();
        }
        NotesAction::InsertCode => {
            state.insert_code();
        }
        NotesAction::InsertLink => {
            state.insert_link();
        }
    }
}

// Note: Tests are disabled due to GPUI macro expansion issues that cause stack overflow
// during test compilation. The notes editor functions can be tested in a separate
// test crate that doesn't import GPUI.
//
// Test cases to verify:
// - extract_title: "# My Title\nContent" -> Some("My Title")
// - extract_tags: "#research #thesis" -> ["research", "thesis"]
// - extract_symbols: "$AAPL $MSFT" -> ["AAPL", "MSFT"]
// - detect_note_type: "Thesis: ..." -> NoteType::Thesis
// - NoteBuffer dirty state tracking
// - NotesEditorState tab management
