// SPDX-License-Identifier: Apache-2.0 OR GPL-3.0-or-later
// Shims for removed Zed dependencies

//! Compatibility shims for Zed dependencies that were removed
//!
//! This module provides minimal implementations or type aliases
//! for types that the editor code references but which came from
//! Zed crates we don't include (like lsp, project, workspace, etc.)

/// Placeholder for language registry functionality
pub struct LanguageRegistry;

/// Placeholder for project-related types
pub mod project {
    /// Placeholder for project struct
    pub struct Project;
}

/// Placeholder for workspace-related types
pub mod workspace {
    /// Placeholder for workspace struct
    pub struct Workspace;

    /// Placeholder for item handle
    pub struct ItemHandle;
}

/// Placeholder for theme-related types
pub mod theme {
    use gpui::Hsla;

    /// Syntax highlighting theme
    #[derive(Clone, Debug, Default)]
    pub struct SyntaxTheme {
        pub highlights: Vec<(String, HighlightStyle)>,
    }

    /// Text highlight style
    #[derive(Clone, Debug, Default)]
    pub struct HighlightStyle {
        pub color: Option<Hsla>,
        pub font_weight: Option<u16>,
        pub font_style: Option<FontStyle>,
        pub underline: Option<UnderlineStyle>,
    }

    #[derive(Clone, Copy, Debug, Default)]
    pub enum FontStyle {
        #[default]
        Normal,
        Italic,
        Oblique,
    }

    #[derive(Clone, Debug, Default)]
    pub struct UnderlineStyle {
        pub color: Option<Hsla>,
        pub thickness: f32,
        pub wavy: bool,
    }

    /// Active theme trait
    pub trait ActiveTheme {
        fn theme(&self) -> &Theme;
    }

    /// Theme struct
    #[derive(Clone, Debug, Default)]
    pub struct Theme {
        pub name: String,
        pub syntax: SyntaxTheme,
    }
}

/// Placeholder for settings-related types
pub mod settings_shim {
    /// Generic settings trait
    pub trait Settings: Sized {
        fn get(cx: &impl SettingsStore) -> &Self;
    }

    /// Settings store trait
    pub trait SettingsStore {}
}

/// Placeholder for text/rope types from Zed
pub mod text {
    use std::fmt;
    use std::ops::Range;

    /// A rope data structure for efficient text manipulation
    #[derive(Clone, Debug, Default)]
    pub struct Rope {
        text: String,
    }

    impl Rope {
        pub fn new() -> Self {
            Self {
                text: String::new(),
            }
        }

        pub fn from_str(s: &str) -> Self {
            Self {
                text: s.to_string(),
            }
        }

        pub fn len(&self) -> usize {
            self.text.len()
        }

        pub fn is_empty(&self) -> bool {
            self.text.is_empty()
        }

        pub fn chars(&self) -> impl Iterator<Item = char> + '_ {
            self.text.chars()
        }

        pub fn slice(&self, range: Range<usize>) -> &str {
            &self.text[range]
        }

        pub fn push(&mut self, ch: char) {
            self.text.push(ch);
        }

        pub fn push_str(&mut self, s: &str) {
            self.text.push_str(s);
        }
    }

    impl fmt::Display for Rope {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "{}", self.text)
        }
    }

    impl From<&str> for Rope {
        fn from(s: &str) -> Self {
            Self::from_str(s)
        }
    }

    impl From<String> for Rope {
        fn from(s: String) -> Self {
            Self { text: s }
        }
    }

    /// Text summary for efficient aggregation
    #[derive(Clone, Debug, Default, PartialEq, Eq)]
    pub struct TextSummary {
        pub len: usize,
        pub lines: u32,
        pub first_line_chars: u32,
        pub last_line_chars: u32,
    }

    /// Edit operation on text
    #[derive(Clone, Debug)]
    pub struct Edit<T> {
        pub old: Range<T>,
        pub new: Range<T>,
    }
}

/// Placeholder for collections from Zed
#[allow(unused_imports)]
pub mod collections {
    pub use indexmap::IndexMap;
    pub use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
}

/// Placeholder for util functions from Zed
pub mod util {
    /// Extension trait for Result types
    pub trait ResultExt<T> {
        fn log_err(self) -> Option<T>;
    }

    impl<T, E: std::fmt::Debug> ResultExt<T> for Result<T, E> {
        fn log_err(self) -> Option<T> {
            match self {
                Ok(v) => Some(v),
                Err(e) => {
                    log::error!("{:?}", e);
                    None
                }
            }
        }
    }

    /// Post-increment helper
    pub fn post_inc(value: &mut usize) -> usize {
        let old = *value;
        *value += 1;
        old
    }
}
