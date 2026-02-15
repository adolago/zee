//! Streaming Response Renderer for Stanley GUI
//!
//! Provides token-by-token display with typing animation, markdown rendering
//! during stream, code block syntax highlighting, and cancel functionality.
//!
//! ## Features
//!
//! - **Token Buffer**: Accumulates streamed text with character-by-character reveal
//! - **Typing Animation**: Blinking cursor with progressive text reveal
//! - **Markdown Parsing**: Real-time markdown rendering as content streams
//! - **Syntax Highlighting**: Code block detection with multi-language support
//! - **Smooth Scrolling**: Auto-scroll as new content arrives
//! - **Cancel Support**: Ability to stop streaming mid-response

use crate::theme::Theme;
use gpui::prelude::*;
use gpui::*;
use std::time::{Duration, Instant};

// =============================================================================
// Catppuccin Mocha Colors for Syntax Highlighting
// =============================================================================

/// Catppuccin Mocha palette colors for syntax highlighting
#[allow(dead_code)]
pub struct CatppuccinMocha;

#[allow(dead_code)]
impl CatppuccinMocha {
    pub fn rosewater() -> Hsla {
        hsla(10.0 / 360.0, 0.56, 0.91, 1.0)
    }
    pub fn flamingo() -> Hsla {
        hsla(0.0 / 360.0, 0.59, 0.88, 1.0)
    }
    pub fn pink() -> Hsla {
        hsla(316.0 / 360.0, 0.72, 0.86, 1.0)
    }
    pub fn mauve() -> Hsla {
        hsla(267.0 / 360.0, 0.84, 0.81, 1.0)
    }
    pub fn red() -> Hsla {
        hsla(343.0 / 360.0, 0.81, 0.75, 1.0)
    }
    pub fn maroon() -> Hsla {
        hsla(350.0 / 360.0, 0.65, 0.77, 1.0)
    }
    pub fn peach() -> Hsla {
        hsla(23.0 / 360.0, 0.92, 0.75, 1.0)
    }
    pub fn yellow() -> Hsla {
        hsla(41.0 / 360.0, 0.86, 0.83, 1.0)
    }
    pub fn green() -> Hsla {
        hsla(115.0 / 360.0, 0.54, 0.76, 1.0)
    }
    pub fn teal() -> Hsla {
        hsla(170.0 / 360.0, 0.57, 0.73, 1.0)
    }
    pub fn sky() -> Hsla {
        hsla(189.0 / 360.0, 0.71, 0.73, 1.0)
    }
    pub fn sapphire() -> Hsla {
        hsla(199.0 / 360.0, 0.76, 0.69, 1.0)
    }
    pub fn blue() -> Hsla {
        hsla(217.0 / 360.0, 0.92, 0.76, 1.0)
    }
    pub fn lavender() -> Hsla {
        hsla(232.0 / 360.0, 0.97, 0.85, 1.0)
    }
    pub fn text() -> Hsla {
        hsla(226.0 / 360.0, 0.64, 0.88, 1.0)
    }
    pub fn subtext1() -> Hsla {
        hsla(227.0 / 360.0, 0.35, 0.80, 1.0)
    }
    pub fn subtext0() -> Hsla {
        hsla(228.0 / 360.0, 0.24, 0.72, 1.0)
    }
    pub fn overlay2() -> Hsla {
        hsla(228.0 / 360.0, 0.17, 0.64, 1.0)
    }
    pub fn overlay1() -> Hsla {
        hsla(230.0 / 360.0, 0.13, 0.55, 1.0)
    }
    pub fn overlay0() -> Hsla {
        hsla(231.0 / 360.0, 0.11, 0.47, 1.0)
    }
    pub fn surface2() -> Hsla {
        hsla(233.0 / 360.0, 0.12, 0.39, 1.0)
    }
    pub fn surface1() -> Hsla {
        hsla(234.0 / 360.0, 0.13, 0.31, 1.0)
    }
    pub fn surface0() -> Hsla {
        hsla(237.0 / 360.0, 0.16, 0.23, 1.0)
    }
    pub fn base() -> Hsla {
        hsla(240.0 / 360.0, 0.21, 0.15, 1.0)
    }
    pub fn mantle() -> Hsla {
        hsla(240.0 / 360.0, 0.21, 0.12, 1.0)
    }
    pub fn crust() -> Hsla {
        hsla(240.0 / 360.0, 0.23, 0.09, 1.0)
    }
}

// =============================================================================
// Streaming State
// =============================================================================

/// State for a streaming response
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct StreamingState {
    /// Full content received so far
    pub content: String,
    /// Number of characters currently displayed (for animation)
    pub displayed_chars: usize,
    /// Whether streaming is active
    pub is_streaming: bool,
    /// Whether the stream was cancelled
    pub is_cancelled: bool,
    /// Start time of the stream
    pub start_time: Option<Instant>,
    /// Characters per second for typing animation
    pub chars_per_second: usize,
    /// Current code block state (language, if in code block)
    pub current_code_block: Option<String>,
    /// Error message if streaming failed
    pub error: Option<String>,
    /// Token buffer for accumulating partial tokens
    pub token_buffer: Vec<StreamToken>,
    /// Last cursor blink time (for animation)
    pub last_cursor_blink: Option<Instant>,
    /// Whether cursor is currently visible (for blink animation)
    pub cursor_visible: bool,
    /// Scroll position hint (percentage 0.0-1.0)
    pub scroll_hint: f32,
    /// Whether auto-scroll is enabled
    pub auto_scroll: bool,
    /// Total tokens received
    pub token_count: usize,
    /// Tokens per second (calculated)
    pub tokens_per_second: f32,
}

/// A single token in the stream
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct StreamToken {
    /// The token text
    pub text: String,
    /// Timestamp when received
    pub timestamp: Instant,
    /// Whether this token completes a word
    pub is_word_boundary: bool,
}

impl Default for StreamingState {
    fn default() -> Self {
        Self {
            content: String::new(),
            displayed_chars: 0,
            is_streaming: false,
            is_cancelled: false,
            start_time: None,
            chars_per_second: 120, // Faster typing speed for better UX
            current_code_block: None,
            error: None,
            token_buffer: Vec::new(),
            last_cursor_blink: None,
            cursor_visible: true,
            scroll_hint: 1.0,
            auto_scroll: true,
            token_count: 0,
            tokens_per_second: 0.0,
        }
    }
}

#[allow(dead_code)]
impl StreamingState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Create with custom typing speed
    pub fn with_speed(chars_per_second: usize) -> Self {
        Self {
            chars_per_second,
            ..Self::default()
        }
    }

    /// Start a new streaming session
    pub fn start(&mut self) {
        self.content.clear();
        self.displayed_chars = 0;
        self.is_streaming = true;
        self.is_cancelled = false;
        self.start_time = Some(Instant::now());
        self.current_code_block = None;
        self.error = None;
        self.token_buffer.clear();
        self.last_cursor_blink = Some(Instant::now());
        self.cursor_visible = true;
        self.scroll_hint = 1.0;
        self.auto_scroll = true;
        self.token_count = 0;
        self.tokens_per_second = 0.0;
    }

    /// Append content to the stream (token by token)
    pub fn append(&mut self, text: &str) {
        let now = Instant::now();
        let is_word_boundary = text.ends_with(' ')
            || text.ends_with('\n')
            || text.ends_with('\t')
            || text.ends_with('.')
            || text.ends_with(',');

        self.token_buffer.push(StreamToken {
            text: text.to_string(),
            timestamp: now,
            is_word_boundary,
        });

        self.content.push_str(text);
        self.token_count += 1;

        // Calculate tokens per second
        if let Some(start) = self.start_time {
            let elapsed = start.elapsed().as_secs_f32();
            if elapsed > 0.0 {
                self.tokens_per_second = self.token_count as f32 / elapsed;
            }
        }

        // Auto-scroll hint
        if self.auto_scroll {
            self.scroll_hint = 1.0;
        }
    }

    /// Append multiple tokens at once (batch append)
    pub fn append_batch(&mut self, tokens: &[&str]) {
        for token in tokens {
            self.append(token);
        }
    }

    /// Update displayed characters based on elapsed time (call in render loop)
    pub fn update_animation(&mut self) {
        if !self.is_streaming {
            self.displayed_chars = self.content.len();
            return;
        }

        if let Some(start) = self.start_time {
            let elapsed = start.elapsed();
            let target_chars = (elapsed.as_secs_f64() * self.chars_per_second as f64) as usize;
            self.displayed_chars = target_chars.min(self.content.len());
        }

        // Update cursor blink (500ms interval)
        if let Some(last_blink) = self.last_cursor_blink {
            if last_blink.elapsed() >= Duration::from_millis(500) {
                self.cursor_visible = !self.cursor_visible;
                self.last_cursor_blink = Some(Instant::now());
            }
        }
    }

    /// Fast-forward animation to show all content immediately
    pub fn skip_animation(&mut self) {
        self.displayed_chars = self.content.len();
    }

    /// Complete the stream
    pub fn finish(&mut self) {
        self.is_streaming = false;
        self.displayed_chars = self.content.len();
        self.cursor_visible = false;
    }

    /// Cancel the stream
    pub fn cancel(&mut self) {
        self.is_streaming = false;
        self.is_cancelled = true;
        self.cursor_visible = false;
    }

    /// Set error state
    pub fn set_error(&mut self, error: String) {
        self.is_streaming = false;
        self.error = Some(error);
        self.cursor_visible = false;
    }

    /// Get the currently visible content
    pub fn visible_content(&self) -> &str {
        if self.displayed_chars >= self.content.len() {
            &self.content
        } else {
            // Find a safe character boundary
            let mut end = self.displayed_chars;
            while end < self.content.len() && !self.content.is_char_boundary(end) {
                end += 1;
            }
            &self.content[..end.min(self.content.len())]
        }
    }

    /// Check if animation is complete
    pub fn animation_complete(&self) -> bool {
        self.displayed_chars >= self.content.len()
    }

    /// Check if cursor should be shown (blinking)
    pub fn should_show_cursor(&self) -> bool {
        self.is_streaming && self.cursor_visible
    }

    /// Get streaming progress (0.0 to 1.0)
    pub fn progress(&self) -> f32 {
        if self.content.is_empty() {
            0.0
        } else {
            self.displayed_chars as f32 / self.content.len() as f32
        }
    }

    /// Get duration since start
    pub fn duration(&self) -> Duration {
        self.start_time
            .map(|s| s.elapsed())
            .unwrap_or(Duration::ZERO)
    }

    /// Get the number of pending characters (not yet revealed)
    pub fn pending_chars(&self) -> usize {
        self.content.len().saturating_sub(self.displayed_chars)
    }

    /// Check if we're catching up (animation behind actual content)
    pub fn is_catching_up(&self) -> bool {
        self.is_streaming && self.pending_chars() > 50
    }

    /// Toggle auto-scroll
    pub fn toggle_auto_scroll(&mut self) {
        self.auto_scroll = !self.auto_scroll;
    }

    /// Set scroll position (0.0-1.0, where 1.0 is bottom)
    pub fn set_scroll_position(&mut self, position: f32) {
        self.scroll_hint = position.clamp(0.0, 1.0);
        // Disable auto-scroll if user scrolls up
        if position < 0.95 {
            self.auto_scroll = false;
        }
    }

    /// Get recent tokens (last N)
    pub fn recent_tokens(&self, count: usize) -> &[StreamToken] {
        let start = self.token_buffer.len().saturating_sub(count);
        &self.token_buffer[start..]
    }

    /// Clear token buffer (to save memory for long streams)
    pub fn clear_token_buffer(&mut self) {
        self.token_buffer.clear();
    }
}

// =============================================================================
// Token Types for Syntax Highlighting
// =============================================================================

/// Token types for syntax highlighting
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum TokenType {
    Keyword,
    String,
    Number,
    Comment,
    Function,
    Variable,
    Operator,
    Punctuation,
    Type,
    Constant,
    Plain,
}

impl TokenType {
    /// Get the color for this token type using Catppuccin Mocha
    pub fn color(&self) -> Hsla {
        match self {
            TokenType::Keyword => CatppuccinMocha::mauve(),
            TokenType::String => CatppuccinMocha::green(),
            TokenType::Number => CatppuccinMocha::peach(),
            TokenType::Comment => CatppuccinMocha::overlay1(),
            TokenType::Function => CatppuccinMocha::blue(),
            TokenType::Variable => CatppuccinMocha::text(),
            TokenType::Operator => CatppuccinMocha::sky(),
            TokenType::Punctuation => CatppuccinMocha::overlay2(),
            TokenType::Type => CatppuccinMocha::yellow(),
            TokenType::Constant => CatppuccinMocha::peach(),
            TokenType::Plain => CatppuccinMocha::text(),
        }
    }
}

/// A highlighted token
#[derive(Debug, Clone)]
pub struct HighlightedToken {
    pub text: String,
    pub token_type: TokenType,
}

// =============================================================================
// Simple Syntax Highlighter
// =============================================================================

/// Simple syntax highlighter for common languages
pub struct SyntaxHighlighter;

impl SyntaxHighlighter {
    /// Keywords for various languages
    const KEYWORDS: &'static [&'static str] = &[
        // Rust
        "fn",
        "let",
        "mut",
        "const",
        "static",
        "pub",
        "mod",
        "use",
        "struct",
        "enum",
        "impl",
        "trait",
        "type",
        "where",
        "async",
        "await",
        "match",
        "if",
        "else",
        "for",
        "while",
        "loop",
        "break",
        "continue",
        "return",
        "self",
        "Self",
        "super",
        "crate",
        "as",
        "in",
        "move",
        "ref",
        "dyn",
        "unsafe",
        // Python
        "def",
        "class",
        "import",
        "from",
        "as",
        "if",
        "elif",
        "else",
        "for",
        "while",
        "try",
        "except",
        "finally",
        "with",
        "lambda",
        "yield",
        "return",
        "pass",
        "raise",
        "True",
        "False",
        "None",
        "and",
        "or",
        "not",
        "is",
        "in",
        "global",
        "nonlocal",
        // JavaScript/TypeScript
        "function",
        "var",
        "let",
        "const",
        "class",
        "extends",
        "import",
        "export",
        "default",
        "if",
        "else",
        "for",
        "while",
        "do",
        "switch",
        "case",
        "break",
        "continue",
        "return",
        "try",
        "catch",
        "finally",
        "throw",
        "new",
        "this",
        "typeof",
        "instanceof",
        "async",
        "await",
        "yield",
        "true",
        "false",
        "null",
        "undefined",
    ];

    const TYPES: &'static [&'static str] = &[
        // Rust types
        "i8", "i16", "i32", "i64", "i128", "isize", "u8", "u16", "u32", "u64", "u128", "usize",
        "f32", "f64", "bool", "char", "str", "String", "Vec", "Option", "Result", "Box", "Rc",
        "Arc", "HashMap", "HashSet", "BTreeMap", "BTreeSet", // Common types
        "int", "float", "double", "string", "boolean", "void", "Array", "Object", "Map", "Set",
        "Promise",
    ];

    /// Highlight a line of code
    pub fn highlight_line(line: &str, _language: Option<&str>) -> Vec<HighlightedToken> {
        let mut tokens = Vec::new();
        let mut current = String::new();
        let mut in_string = false;
        let mut string_char = '"';
        #[allow(unused_assignments)]
        let in_comment = false;
        let chars: Vec<char> = line.chars().collect();
        let mut i = 0;

        while i < chars.len() {
            let c = chars[i];

            // Handle comments
            if !in_string && !in_comment {
                if c == '/' && i + 1 < chars.len() && chars[i + 1] == '/' {
                    // Flush current token
                    if !current.is_empty() {
                        tokens.push(Self::classify_token(&current));
                        current.clear();
                    }
                    // Rest of line is comment
                    let comment: String = chars[i..].iter().collect();
                    tokens.push(HighlightedToken {
                        text: comment,
                        token_type: TokenType::Comment,
                    });
                    break;
                }
                if c == '#' {
                    // Python comment
                    if !current.is_empty() {
                        tokens.push(Self::classify_token(&current));
                        current.clear();
                    }
                    let comment: String = chars[i..].iter().collect();
                    tokens.push(HighlightedToken {
                        text: comment,
                        token_type: TokenType::Comment,
                    });
                    break;
                }
            }

            // Handle strings
            if !in_comment && (c == '"' || c == '\'' || c == '`') {
                if in_string && c == string_char {
                    // End of string
                    current.push(c);
                    tokens.push(HighlightedToken {
                        text: current.clone(),
                        token_type: TokenType::String,
                    });
                    current.clear();
                    in_string = false;
                } else if !in_string {
                    // Start of string
                    if !current.is_empty() {
                        tokens.push(Self::classify_token(&current));
                        current.clear();
                    }
                    string_char = c;
                    in_string = true;
                    current.push(c);
                } else {
                    current.push(c);
                }
                i += 1;
                continue;
            }

            if in_string {
                current.push(c);
                i += 1;
                continue;
            }

            // Handle operators and punctuation
            if Self::is_operator(c) {
                if !current.is_empty() {
                    tokens.push(Self::classify_token(&current));
                    current.clear();
                }
                tokens.push(HighlightedToken {
                    text: c.to_string(),
                    token_type: TokenType::Operator,
                });
                i += 1;
                continue;
            }

            if Self::is_punctuation(c) {
                if !current.is_empty() {
                    tokens.push(Self::classify_token(&current));
                    current.clear();
                }
                tokens.push(HighlightedToken {
                    text: c.to_string(),
                    token_type: TokenType::Punctuation,
                });
                i += 1;
                continue;
            }

            // Handle whitespace
            if c.is_whitespace() {
                if !current.is_empty() {
                    tokens.push(Self::classify_token(&current));
                    current.clear();
                }
                tokens.push(HighlightedToken {
                    text: c.to_string(),
                    token_type: TokenType::Plain,
                });
                i += 1;
                continue;
            }

            current.push(c);
            i += 1;
        }

        // Flush remaining token
        if !current.is_empty() {
            let token_type = if in_string {
                TokenType::String
            } else {
                Self::classify_token(&current).token_type
            };
            tokens.push(HighlightedToken {
                text: current,
                token_type,
            });
        }

        tokens
    }

    fn is_operator(c: char) -> bool {
        matches!(
            c,
            '+' | '-' | '*' | '/' | '=' | '<' | '>' | '!' | '&' | '|' | '^' | '%' | '~'
        )
    }

    fn is_punctuation(c: char) -> bool {
        matches!(
            c,
            '(' | ')' | '[' | ']' | '{' | '}' | ',' | ';' | ':' | '.' | '@' | '?'
        )
    }

    fn classify_token(text: &str) -> HighlightedToken {
        let token_type = if Self::KEYWORDS.contains(&text) {
            TokenType::Keyword
        } else if Self::TYPES.contains(&text) {
            TokenType::Type
        } else if text
            .chars()
            .all(|c| c.is_ascii_digit() || c == '.' || c == '_')
            && text.chars().any(|c| c.is_ascii_digit())
        {
            TokenType::Number
        } else if text.starts_with(|c: char| c.is_uppercase()) {
            TokenType::Type
        } else {
            TokenType::Plain
        };

        HighlightedToken {
            text: text.to_string(),
            token_type,
        }
    }
}

// =============================================================================
// Markdown Line Types
// =============================================================================

/// Types of markdown lines
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum MarkdownLine {
    /// Regular paragraph text
    Paragraph(String),
    /// Heading with level (1-6)
    Heading(u8, String),
    /// Code block start with language
    CodeBlockStart(Option<String>),
    /// Code block content
    CodeBlockContent(String),
    /// Code block end
    CodeBlockEnd,
    /// Inline code
    InlineCode(String),
    /// List item (unordered)
    UnorderedListItem(String),
    /// List item (ordered) with number
    OrderedListItem(u32, String),
    /// Blockquote
    Blockquote(String),
    /// Horizontal rule
    HorizontalRule,
    /// Empty line
    Empty,
    /// Bold text
    Bold(String),
    /// Italic text
    Italic(String),
    /// Link with text and url
    Link(String, String),
}

/// Parse markdown content into lines
pub fn parse_markdown(content: &str) -> Vec<MarkdownLine> {
    let mut lines = Vec::new();
    let mut in_code_block = false;
    #[allow(unused_assignments)]
    let mut _code_language: Option<String> = None;

    for line in content.lines() {
        if line.starts_with("```") {
            if in_code_block {
                lines.push(MarkdownLine::CodeBlockEnd);
                in_code_block = false;
                _code_language = None;
            } else {
                let lang = line.trim_start_matches('`').trim();
                let lang_opt = if lang.is_empty() {
                    None
                } else {
                    Some(lang.to_string())
                };
                lines.push(MarkdownLine::CodeBlockStart(lang_opt.clone()));
                _code_language = lang_opt;
                in_code_block = true;
            }
            continue;
        }

        if in_code_block {
            lines.push(MarkdownLine::CodeBlockContent(line.to_string()));
            continue;
        }

        // Check for headings
        if line.starts_with('#') {
            let level = line.chars().take_while(|c| *c == '#').count() as u8;
            let text = line.trim_start_matches('#').trim().to_string();
            lines.push(MarkdownLine::Heading(level.min(6), text));
            continue;
        }

        // Check for unordered list
        if line.starts_with("- ") || line.starts_with("* ") || line.starts_with("+ ") {
            lines.push(MarkdownLine::UnorderedListItem(line[2..].to_string()));
            continue;
        }

        // Check for ordered list
        if let Some(dot_pos) = line.find('.') {
            if dot_pos < 4 {
                if let Ok(num) = line[..dot_pos].trim().parse::<u32>() {
                    if line.len() > dot_pos + 1 && line.chars().nth(dot_pos + 1) == Some(' ') {
                        lines.push(MarkdownLine::OrderedListItem(
                            num,
                            line[dot_pos + 2..].to_string(),
                        ));
                        continue;
                    }
                }
            }
        }

        // Check for blockquote
        if let Some(quote_content) = line.strip_prefix("> ") {
            lines.push(MarkdownLine::Blockquote(quote_content.to_string()));
            continue;
        }

        // Check for horizontal rule
        if line.trim() == "---" || line.trim() == "***" || line.trim() == "___" {
            lines.push(MarkdownLine::HorizontalRule);
            continue;
        }

        // Empty line
        if line.trim().is_empty() {
            lines.push(MarkdownLine::Empty);
            continue;
        }

        // Regular paragraph
        lines.push(MarkdownLine::Paragraph(line.to_string()));
    }

    lines
}

// =============================================================================
// Streaming Renderer
// =============================================================================

/// Render streaming content with markdown and syntax highlighting
#[allow(dead_code)]
pub fn render_streaming_content(
    theme: &Theme,
    state: &StreamingState,
    on_cancel: Option<impl Fn() + 'static>,
) -> Div {
    let _ = theme; // Theme parameter reserved for future use
    let content = state.visible_content();
    let lines = parse_markdown(content);

    div()
        .flex()
        .flex_col()
        .gap(px(8.0))
        .w_full()
        // Render markdown lines
        .children(lines.iter().map(|line| render_markdown_line(theme, line)))
        // Typing cursor (when streaming and not complete)
        .when(state.is_streaming && !state.animation_complete(), |el| {
            el.child(render_typing_cursor_with_state(theme, state.cursor_visible))
        })
        // Cancel button (when streaming)
        .when(state.is_streaming, |el| {
            if let Some(cancel_fn) = on_cancel {
                el.child(render_cancel_button(theme, cancel_fn))
            } else {
                el
            }
        })
        // Error display
        .when_some(state.error.clone(), |el, error| {
            el.child(render_error(theme, &error))
        })
        // Cancelled indicator
        .when(state.is_cancelled, |el| {
            el.child(render_cancelled_indicator(theme))
        })
}

/// Render streaming content with full controls and stats
#[allow(dead_code)]
pub fn render_streaming_content_full(
    theme: &Theme,
    state: &StreamingState,
    on_cancel: Option<impl Fn() + 'static>,
    show_stats: bool,
) -> Div {
    let _ = theme; // Theme parameter reserved for future use
    let content = state.visible_content();
    let lines = parse_markdown(content);

    div()
        .flex()
        .flex_col()
        .gap(px(8.0))
        .w_full()
        // Stats bar (when streaming and enabled)
        .when(state.is_streaming && show_stats, |el| {
            el.child(render_streaming_stats(theme, state))
        })
        // Render markdown lines
        .children(lines.iter().map(|line| render_markdown_line(theme, line)))
        // Typing cursor with blink state
        .when(state.is_streaming && !state.animation_complete(), |el| {
            el.child(render_typing_cursor_with_state(theme, state.cursor_visible))
        })
        // Catching up indicator
        .when(state.is_catching_up(), |el| {
            el.child(render_catching_up_indicator(theme))
        })
        // Progress bar
        .when(state.is_streaming, |el| {
            el.child(render_streaming_progress(theme, state))
        })
        // Cancel button (when streaming)
        .when(state.is_streaming, |el| {
            if let Some(cancel_fn) = on_cancel {
                el.child(render_cancel_button(theme, cancel_fn))
            } else {
                el
            }
        })
        // Error display
        .when_some(state.error.clone(), |el, error| {
            el.child(render_error(theme, &error))
        })
        // Cancelled indicator
        .when(state.is_cancelled, |el| {
            el.child(render_cancelled_indicator(theme))
        })
}

/// Render streaming statistics bar
#[allow(dead_code)]
fn render_streaming_stats(_theme: &Theme, state: &StreamingState) -> Div {
    let duration = state.duration();
    let duration_secs = duration.as_secs_f32();

    div()
        .w_full()
        .px(px(8.0))
        .py(px(4.0))
        .rounded(px(4.0))
        .bg(CatppuccinMocha::surface0())
        .flex()
        .items_center()
        .justify_between()
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(16.0))
                // Tokens count
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(4.0))
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(CatppuccinMocha::overlay0())
                                .child("Tokens:"),
                        )
                        .child(
                            div()
                                .text_size(px(10.0))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(CatppuccinMocha::text())
                                .child(format!("{}", state.token_count)),
                        ),
                )
                // Tokens per second
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(4.0))
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(CatppuccinMocha::overlay0())
                                .child("Speed:"),
                        )
                        .child(
                            div()
                                .text_size(px(10.0))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(CatppuccinMocha::green())
                                .child(format!("{:.1} t/s", state.tokens_per_second)),
                        ),
                )
                // Duration
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(4.0))
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(CatppuccinMocha::overlay0())
                                .child("Time:"),
                        )
                        .child(
                            div()
                                .text_size(px(10.0))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(CatppuccinMocha::text())
                                .child(format!("{:.1}s", duration_secs)),
                        ),
                ),
        )
        // Auto-scroll indicator
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(4.0))
                .child(div().size(px(6.0)).rounded_full().bg(if state.auto_scroll {
                    CatppuccinMocha::green()
                } else {
                    CatppuccinMocha::overlay0()
                }))
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(CatppuccinMocha::overlay1())
                        .child(if state.auto_scroll {
                            "Auto-scroll"
                        } else {
                            "Scroll paused"
                        }),
                ),
        )
}

/// Render catching up indicator (when animation is behind)
#[allow(dead_code)]
fn render_catching_up_indicator(_theme: &Theme) -> Div {
    div()
        .flex()
        .items_center()
        .gap(px(6.0))
        .px(px(8.0))
        .py(px(4.0))
        .rounded(px(4.0))
        .bg(CatppuccinMocha::yellow().opacity(0.1))
        .child(
            div()
                .text_size(px(10.0))
                .text_color(CatppuccinMocha::yellow())
                .child("Catching up..."),
        )
}

/// Render a single markdown line
#[allow(dead_code)]
fn render_markdown_line(_theme: &Theme, line: &MarkdownLine) -> Div {
    match line {
        MarkdownLine::Heading(level, text) => {
            let size = match level {
                1 => px(24.0),
                2 => px(20.0),
                3 => px(18.0),
                4 => px(16.0),
                _ => px(14.0),
            };
            div()
                .text_size(size)
                .font_weight(FontWeight::BOLD)
                .text_color(CatppuccinMocha::text())
                .py(px(4.0))
                .child(text.clone())
        }
        MarkdownLine::Paragraph(text) => div()
            .text_size(px(14.0))
            .text_color(CatppuccinMocha::subtext1())
            .child(text.clone()),
        MarkdownLine::CodeBlockStart(lang) => div()
            .w_full()
            .rounded_t(px(8.0))
            .bg(CatppuccinMocha::surface0())
            .px(px(12.0))
            .py(px(6.0))
            .flex()
            .items_center()
            .justify_between()
            .child(
                div()
                    .text_size(px(11.0))
                    .text_color(CatppuccinMocha::overlay1())
                    .child(lang.clone().unwrap_or_else(|| "code".to_string())),
            )
            .child(
                div()
                    .flex()
                    .gap(px(4.0))
                    .child(
                        div()
                            .size(px(10.0))
                            .rounded_full()
                            .bg(CatppuccinMocha::red()),
                    )
                    .child(
                        div()
                            .size(px(10.0))
                            .rounded_full()
                            .bg(CatppuccinMocha::yellow()),
                    )
                    .child(
                        div()
                            .size(px(10.0))
                            .rounded_full()
                            .bg(CatppuccinMocha::green()),
                    ),
            ),
        MarkdownLine::CodeBlockContent(code) => {
            let tokens = SyntaxHighlighter::highlight_line(code, None);
            div()
                .w_full()
                .bg(CatppuccinMocha::mantle())
                .px(px(12.0))
                .py(px(2.0))
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .children(tokens.into_iter().map(|token| {
                            div()
                                .text_size(px(13.0))
                                .font_family("monospace")
                                .text_color(token.token_type.color())
                                .child(token.text)
                        })),
                )
        }
        MarkdownLine::CodeBlockEnd => div()
            .w_full()
            .h(px(8.0))
            .rounded_b(px(8.0))
            .bg(CatppuccinMocha::surface0()),
        MarkdownLine::UnorderedListItem(text) => div()
            .flex()
            .items_start()
            .gap(px(8.0))
            .child(
                div()
                    .text_size(px(14.0))
                    .text_color(CatppuccinMocha::mauve())
                    .child("*"),
            )
            .child(
                div()
                    .text_size(px(14.0))
                    .text_color(CatppuccinMocha::subtext1())
                    .child(text.clone()),
            ),
        MarkdownLine::OrderedListItem(num, text) => div()
            .flex()
            .items_start()
            .gap(px(8.0))
            .child(
                div()
                    .text_size(px(14.0))
                    .text_color(CatppuccinMocha::mauve())
                    .child(format!("{}.", num)),
            )
            .child(
                div()
                    .text_size(px(14.0))
                    .text_color(CatppuccinMocha::subtext1())
                    .child(text.clone()),
            ),
        MarkdownLine::Blockquote(text) => div()
            .pl(px(12.0))
            .border_l_2()
            .border_color(CatppuccinMocha::mauve())
            .text_size(px(14.0))
            .text_color(CatppuccinMocha::overlay1())
            .italic()
            .child(text.clone()),
        MarkdownLine::HorizontalRule => div()
            .w_full()
            .h(px(1.0))
            .my(px(8.0))
            .bg(CatppuccinMocha::surface1()),
        MarkdownLine::Empty => div().h(px(8.0)),
        _ => div(),
    }
}

/// Render the typing cursor animation (blinking)
#[allow(dead_code)]
fn render_typing_cursor(_theme: &Theme) -> Div {
    div().flex().items_center().gap(px(4.0)).child(
        div()
            .w(px(2.0))
            .h(px(18.0))
            .bg(CatppuccinMocha::blue())
            .rounded(px(1.0)),
    )
}

/// Render the typing cursor with blink state
#[allow(dead_code)]
fn render_typing_cursor_with_state(_theme: &Theme, visible: bool) -> Div {
    div().flex().items_center().gap(px(4.0)).child(
        div()
            .w(px(2.0))
            .h(px(18.0))
            .bg(if visible {
                CatppuccinMocha::blue()
            } else {
                CatppuccinMocha::base()
            })
            .rounded(px(1.0)),
    )
}

/// Render cancel button during streaming
#[allow(dead_code)]
fn render_cancel_button(_theme: &Theme, on_cancel: impl Fn() + 'static) -> Div {
    div().mt(px(12.0)).child(
        div()
            .id("cancel-stream")
            .px(px(16.0))
            .py(px(8.0))
            .rounded(px(6.0))
            .bg(CatppuccinMocha::surface1())
            .border_1()
            .border_color(CatppuccinMocha::surface2())
            .cursor_pointer()
            .hover(|s| s.bg(CatppuccinMocha::surface2()))
            .on_click(move |_event, _window, _cx| {
                on_cancel();
            })
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.0))
                    .child(
                        div()
                            .size(px(14.0))
                            .rounded_full()
                            .bg(CatppuccinMocha::red())
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(div().size(px(6.0)).bg(CatppuccinMocha::crust())),
                    )
                    .child(
                        div()
                            .text_size(px(12.0))
                            .text_color(CatppuccinMocha::subtext0())
                            .child("Stop generating"),
                    ),
            ),
    )
}

/// Render error message
#[allow(dead_code)]
fn render_error(_theme: &Theme, error: &str) -> Div {
    div()
        .mt(px(12.0))
        .p(px(12.0))
        .rounded(px(8.0))
        .bg(CatppuccinMocha::red().opacity(0.15))
        .border_1()
        .border_color(CatppuccinMocha::red().opacity(0.3))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                .child(
                    div()
                        .text_size(px(12.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(CatppuccinMocha::red())
                        .child("Error:"),
                )
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(CatppuccinMocha::subtext0())
                        .child(error.to_string()),
                ),
        )
}

/// Render cancelled indicator
#[allow(dead_code)]
fn render_cancelled_indicator(_theme: &Theme) -> Div {
    div()
        .mt(px(8.0))
        .flex()
        .items_center()
        .gap(px(6.0))
        .child(
            div()
                .size(px(6.0))
                .rounded_full()
                .bg(CatppuccinMocha::yellow()),
        )
        .child(
            div()
                .text_size(px(11.0))
                .text_color(CatppuccinMocha::overlay1())
                .italic()
                .child("Generation stopped"),
        )
}

// =============================================================================
// Streaming Progress Bar
// =============================================================================

/// Render a progress bar for streaming
#[allow(dead_code)]
pub fn render_streaming_progress(_theme: &Theme, state: &StreamingState) -> Div {
    let progress = state.progress();
    let width_percent = (progress * 100.0).min(100.0);

    div()
        .w_full()
        .h(px(3.0))
        .rounded_full()
        .bg(CatppuccinMocha::surface0())
        .child(
            div()
                .h_full()
                .rounded_full()
                .bg(CatppuccinMocha::blue())
                .w(px(width_percent * 2.0)), // Scale for visibility
        )
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_streaming_state() {
        let mut state = StreamingState::new();
        state.start();
        assert!(state.is_streaming);

        state.append("Hello ");
        state.append("World!");
        assert_eq!(state.content, "Hello World!");

        state.finish();
        assert!(!state.is_streaming);
        assert_eq!(state.displayed_chars, state.content.len());
    }

    #[test]
    fn test_markdown_parsing() {
        let content = "# Heading\n\nParagraph text\n\n```rust\nfn main() {}\n```";
        let lines = parse_markdown(content);

        assert!(matches!(lines[0], MarkdownLine::Heading(1, _)));
        assert!(matches!(lines[2], MarkdownLine::Paragraph(_)));
        assert!(matches!(lines[4], MarkdownLine::CodeBlockStart(_)));
    }

    #[test]
    fn test_syntax_highlighting() {
        let tokens = SyntaxHighlighter::highlight_line("let x = 42;", None);
        assert!(!tokens.is_empty());

        // Check that 'let' is identified as keyword
        let let_token = tokens.iter().find(|t| t.text == "let");
        assert!(let_token.is_some());
        assert_eq!(let_token.unwrap().token_type, TokenType::Keyword);
    }

    #[test]
    fn test_catppuccin_colors() {
        // Verify colors are valid HSLA
        let blue = CatppuccinMocha::blue();
        assert!(blue.h >= 0.0 && blue.h <= 1.0);
        assert!(blue.s >= 0.0 && blue.s <= 1.0);
        assert!(blue.l >= 0.0 && blue.l <= 1.0);
    }
}
