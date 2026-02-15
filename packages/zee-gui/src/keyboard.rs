//! Keyboard navigation and shortcuts for Stanley GUI
//!
//! Provides comprehensive keyboard handling for professional trading terminal navigation:
//! - View navigation (1-9 keys)
//! - Symbol search (Cmd+K / Ctrl+K)
//! - Quick actions (Cmd+Shift+...)
//! - Table navigation (arrow keys, vim-like)
//! - Modal handling (Escape, Tab)
//! - Focus management
//! - Customization system

use gpui::*;
use std::collections::HashMap;

// ============================================================================
// KEYBOARD ACTION DEFINITIONS
// ============================================================================

/// All keyboard actions supported by the application
///
/// Some variants are placeholders for future keyboard navigation features.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[allow(dead_code)]
pub enum KeyboardAction {
    // View Navigation (1-9)
    GotoDashboard,
    GotoMoneyFlow,
    GotoInstitutional,
    GotoDarkPool,
    GotoOptions,
    GotoResearch,
    GotoPortfolio,
    GotoCommodities,
    GotoMacro,

    // Symbol Navigation
    OpenSymbolSearch,
    CloseModal,
    ConfirmAction,

    // Watchlist Navigation
    WatchlistUp,
    WatchlistDown,
    WatchlistSelect,
    WatchlistFirst,
    WatchlistLast,
    AddToWatchlist,
    RemoveFromWatchlist,

    // Table Navigation
    TableUp,
    TableDown,
    TableLeft,
    TableRight,
    TablePageUp,
    TablePageDown,
    TableHome,
    TableEnd,
    TableSelect,

    // Data Actions
    RefreshData,
    RefreshAll,
    ExportData,
    CopyToClipboard,

    // UI Actions
    ToggleTheme,
    ToggleSidebar,
    ToggleFullscreen,
    ZoomIn,
    ZoomOut,
    ResetZoom,

    // Focus Management
    FocusNext,
    FocusPrevious,
    FocusSidebar,
    FocusMain,
    FocusSearch,

    // Vim-like Navigation
    VimUp,
    VimDown,
    VimLeft,
    VimRight,
    VimHalfPageUp,
    VimHalfPageDown,
    VimTop,
    VimBottom,

    // Quick Actions
    QuickTrade,
    QuickAlert,
    QuickNote,
    QuickScreenshot,

    // Quick Actions Panel
    ToggleSuggestions,
    ToggleQuickActions,
    OpenQuickActionsPanel,
    CloseQuickActionsPanel,
    FocusAgentInput,
    ExecuteQuickAction1,
    ExecuteQuickAction2,
    ExecuteQuickAction3,
    ExecuteQuickAction4,
    ExecuteQuickAction5,

    // Notes Editor Tab Navigation
    NotesEditorNextTab,
    NotesEditorPrevTab,

    // Help
    ShowHelp,
    ShowShortcuts,

    // Settings
    OpenSettings,
}

// ============================================================================
// KEYBOARD BINDING CONFIGURATION
// ============================================================================

/// Modifier key combinations
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct KeyModifiers {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub cmd: bool, // Super/Meta key
}

#[allow(dead_code)]
impl KeyModifiers {
    pub const NONE: Self = Self {
        ctrl: false,
        alt: false,
        shift: false,
        cmd: false,
    };

    pub const CTRL: Self = Self {
        ctrl: true,
        alt: false,
        shift: false,
        cmd: false,
    };

    pub const ALT: Self = Self {
        ctrl: false,
        alt: true,
        shift: false,
        cmd: false,
    };

    pub const SHIFT: Self = Self {
        ctrl: false,
        alt: false,
        shift: true,
        cmd: false,
    };

    pub const CMD: Self = Self {
        ctrl: false,
        alt: false,
        shift: false,
        cmd: true,
    };

    pub const CTRL_SHIFT: Self = Self {
        ctrl: true,
        alt: false,
        shift: true,
        cmd: false,
    };

    pub const CMD_SHIFT: Self = Self {
        ctrl: false,
        alt: false,
        shift: true,
        cmd: true,
    };

    /// Check if current modifiers match the GPUI modifiers
    pub fn matches(&self, modifiers: &Modifiers) -> bool {
        self.ctrl == modifiers.control
            && self.alt == modifiers.alt
            && self.shift == modifiers.shift
            && self.cmd == modifiers.platform
    }
}

/// Key binding configuration
#[derive(Debug, Clone)]
pub struct KeyBinding {
    pub key: &'static str,
    pub modifiers: KeyModifiers,
    pub action: KeyboardAction,
    pub description: &'static str,
    pub category: &'static str,
}

impl KeyBinding {
    pub const fn new(
        key: &'static str,
        modifiers: KeyModifiers,
        action: KeyboardAction,
        description: &'static str,
        category: &'static str,
    ) -> Self {
        Self {
            key,
            modifiers,
            action,
            description,
            category,
        }
    }
}

// ============================================================================
// DEFAULT KEY BINDINGS
// ============================================================================

/// Default keyboard bindings - modeled after professional trading terminals
pub const DEFAULT_BINDINGS: &[KeyBinding] = &[
    // === VIEW NAVIGATION (1-9) ===
    KeyBinding::new(
        "1",
        KeyModifiers::NONE,
        KeyboardAction::GotoDashboard,
        "Go to Dashboard",
        "Navigation",
    ),
    KeyBinding::new(
        "2",
        KeyModifiers::NONE,
        KeyboardAction::GotoMoneyFlow,
        "Go to Money Flow",
        "Navigation",
    ),
    KeyBinding::new(
        "3",
        KeyModifiers::NONE,
        KeyboardAction::GotoInstitutional,
        "Go to Institutional",
        "Navigation",
    ),
    KeyBinding::new(
        "4",
        KeyModifiers::NONE,
        KeyboardAction::GotoDarkPool,
        "Go to Dark Pool",
        "Navigation",
    ),
    KeyBinding::new(
        "5",
        KeyModifiers::NONE,
        KeyboardAction::GotoOptions,
        "Go to Options Flow",
        "Navigation",
    ),
    KeyBinding::new(
        "6",
        KeyModifiers::NONE,
        KeyboardAction::GotoResearch,
        "Go to Research",
        "Navigation",
    ),
    KeyBinding::new(
        "7",
        KeyModifiers::NONE,
        KeyboardAction::GotoPortfolio,
        "Go to Portfolio",
        "Navigation",
    ),
    KeyBinding::new(
        "8",
        KeyModifiers::NONE,
        KeyboardAction::GotoCommodities,
        "Go to Commodities",
        "Navigation",
    ),
    KeyBinding::new(
        "9",
        KeyModifiers::NONE,
        KeyboardAction::GotoMacro,
        "Go to Macro",
        "Navigation",
    ),
    // === SYMBOL SEARCH ===
    KeyBinding::new(
        "k",
        KeyModifiers::CTRL,
        KeyboardAction::OpenSymbolSearch,
        "Open symbol search",
        "Search",
    ),
    KeyBinding::new(
        "k",
        KeyModifiers::CMD,
        KeyboardAction::OpenSymbolSearch,
        "Open symbol search (Mac)",
        "Search",
    ),
    KeyBinding::new(
        "p",
        KeyModifiers::CTRL,
        KeyboardAction::OpenSymbolSearch,
        "Quick symbol search",
        "Search",
    ),
    KeyBinding::new(
        "/",
        KeyModifiers::NONE,
        KeyboardAction::FocusSearch,
        "Focus search box",
        "Search",
    ),
    // === MODAL HANDLING ===
    KeyBinding::new(
        "escape",
        KeyModifiers::NONE,
        KeyboardAction::CloseModal,
        "Close modal / Cancel",
        "Modal",
    ),
    KeyBinding::new(
        "return",
        KeyModifiers::NONE,
        KeyboardAction::ConfirmAction,
        "Confirm / Select",
        "Modal",
    ),
    KeyBinding::new(
        "enter",
        KeyModifiers::NONE,
        KeyboardAction::ConfirmAction,
        "Confirm / Select",
        "Modal",
    ),
    // === WATCHLIST NAVIGATION ===
    KeyBinding::new(
        "w",
        KeyModifiers::NONE,
        KeyboardAction::WatchlistUp,
        "Previous symbol in watchlist",
        "Watchlist",
    ),
    KeyBinding::new(
        "s",
        KeyModifiers::NONE,
        KeyboardAction::WatchlistDown,
        "Next symbol in watchlist",
        "Watchlist",
    ),
    KeyBinding::new(
        "up",
        KeyModifiers::ALT,
        KeyboardAction::WatchlistUp,
        "Previous symbol in watchlist",
        "Watchlist",
    ),
    KeyBinding::new(
        "down",
        KeyModifiers::ALT,
        KeyboardAction::WatchlistDown,
        "Next symbol in watchlist",
        "Watchlist",
    ),
    KeyBinding::new(
        "a",
        KeyModifiers::CTRL,
        KeyboardAction::AddToWatchlist,
        "Add current symbol to watchlist",
        "Watchlist",
    ),
    KeyBinding::new(
        "d",
        KeyModifiers::CTRL,
        KeyboardAction::RemoveFromWatchlist,
        "Remove symbol from watchlist",
        "Watchlist",
    ),
    KeyBinding::new(
        "home",
        KeyModifiers::ALT,
        KeyboardAction::WatchlistFirst,
        "First symbol in watchlist",
        "Watchlist",
    ),
    KeyBinding::new(
        "end",
        KeyModifiers::ALT,
        KeyboardAction::WatchlistLast,
        "Last symbol in watchlist",
        "Watchlist",
    ),
    // === TABLE NAVIGATION ===
    KeyBinding::new(
        "up",
        KeyModifiers::NONE,
        KeyboardAction::TableUp,
        "Move up in table",
        "Table",
    ),
    KeyBinding::new(
        "down",
        KeyModifiers::NONE,
        KeyboardAction::TableDown,
        "Move down in table",
        "Table",
    ),
    KeyBinding::new(
        "left",
        KeyModifiers::NONE,
        KeyboardAction::TableLeft,
        "Move left in table",
        "Table",
    ),
    KeyBinding::new(
        "right",
        KeyModifiers::NONE,
        KeyboardAction::TableRight,
        "Move right in table",
        "Table",
    ),
    KeyBinding::new(
        "pageup",
        KeyModifiers::NONE,
        KeyboardAction::TablePageUp,
        "Page up in table",
        "Table",
    ),
    KeyBinding::new(
        "pagedown",
        KeyModifiers::NONE,
        KeyboardAction::TablePageDown,
        "Page down in table",
        "Table",
    ),
    KeyBinding::new(
        "home",
        KeyModifiers::NONE,
        KeyboardAction::TableHome,
        "Go to first row",
        "Table",
    ),
    KeyBinding::new(
        "end",
        KeyModifiers::NONE,
        KeyboardAction::TableEnd,
        "Go to last row",
        "Table",
    ),
    KeyBinding::new(
        "space",
        KeyModifiers::NONE,
        KeyboardAction::TableSelect,
        "Select/expand row",
        "Table",
    ),
    // === DATA ACTIONS ===
    KeyBinding::new(
        "r",
        KeyModifiers::CTRL,
        KeyboardAction::RefreshData,
        "Refresh current view",
        "Data",
    ),
    KeyBinding::new(
        "r",
        KeyModifiers::CTRL_SHIFT,
        KeyboardAction::RefreshAll,
        "Refresh all data",
        "Data",
    ),
    KeyBinding::new(
        "e",
        KeyModifiers::CTRL,
        KeyboardAction::ExportData,
        "Export data to CSV",
        "Data",
    ),
    KeyBinding::new(
        "c",
        KeyModifiers::CTRL,
        KeyboardAction::CopyToClipboard,
        "Copy selection to clipboard",
        "Data",
    ),
    // === UI ACTIONS ===
    KeyBinding::new(
        "t",
        KeyModifiers::CTRL,
        KeyboardAction::ToggleTheme,
        "Toggle dark/light theme",
        "UI",
    ),
    KeyBinding::new(
        "b",
        KeyModifiers::CTRL,
        KeyboardAction::ToggleSidebar,
        "Toggle sidebar",
        "UI",
    ),
    KeyBinding::new(
        "f11",
        KeyModifiers::NONE,
        KeyboardAction::ToggleFullscreen,
        "Toggle fullscreen",
        "UI",
    ),
    KeyBinding::new(
        "=",
        KeyModifiers::CTRL,
        KeyboardAction::ZoomIn,
        "Zoom in",
        "UI",
    ),
    KeyBinding::new(
        "-",
        KeyModifiers::CTRL,
        KeyboardAction::ZoomOut,
        "Zoom out",
        "UI",
    ),
    KeyBinding::new(
        "0",
        KeyModifiers::CTRL,
        KeyboardAction::ResetZoom,
        "Reset zoom",
        "UI",
    ),
    KeyBinding::new(
        ",",
        KeyModifiers::CTRL,
        KeyboardAction::OpenSettings,
        "Open settings",
        "UI",
    ),
    // === FOCUS MANAGEMENT ===
    KeyBinding::new(
        "tab",
        KeyModifiers::NONE,
        KeyboardAction::FocusNext,
        "Focus next element",
        "Focus",
    ),
    KeyBinding::new(
        "tab",
        KeyModifiers::SHIFT,
        KeyboardAction::FocusPrevious,
        "Focus previous element",
        "Focus",
    ),
    KeyBinding::new(
        "[",
        KeyModifiers::CTRL,
        KeyboardAction::FocusSidebar,
        "Focus sidebar",
        "Focus",
    ),
    KeyBinding::new(
        "]",
        KeyModifiers::CTRL,
        KeyboardAction::FocusMain,
        "Focus main content",
        "Focus",
    ),
    // === VIM-LIKE NAVIGATION ===
    KeyBinding::new(
        "j",
        KeyModifiers::NONE,
        KeyboardAction::VimDown,
        "Move down (vim)",
        "Vim",
    ),
    KeyBinding::new(
        "k",
        KeyModifiers::NONE,
        KeyboardAction::VimUp,
        "Move up (vim)",
        "Vim",
    ),
    KeyBinding::new(
        "h",
        KeyModifiers::NONE,
        KeyboardAction::VimLeft,
        "Move left (vim)",
        "Vim",
    ),
    KeyBinding::new(
        "l",
        KeyModifiers::NONE,
        KeyboardAction::VimRight,
        "Move right (vim)",
        "Vim",
    ),
    KeyBinding::new(
        "u",
        KeyModifiers::CTRL,
        KeyboardAction::VimHalfPageUp,
        "Half page up (vim)",
        "Vim",
    ),
    KeyBinding::new(
        "d",
        KeyModifiers::CTRL,
        KeyboardAction::VimHalfPageDown,
        "Half page down (vim)",
        "Vim",
    ),
    KeyBinding::new(
        "g",
        KeyModifiers::NONE,
        KeyboardAction::VimTop,
        "Go to top (vim: gg)",
        "Vim",
    ),
    KeyBinding::new(
        "g",
        KeyModifiers::SHIFT,
        KeyboardAction::VimBottom,
        "Go to bottom (vim: G)",
        "Vim",
    ),
    // === QUICK ACTIONS ===
    KeyBinding::new(
        "t",
        KeyModifiers::CMD_SHIFT,
        KeyboardAction::QuickTrade,
        "Quick trade panel",
        "Quick Actions",
    ),
    KeyBinding::new(
        "a",
        KeyModifiers::CMD_SHIFT,
        KeyboardAction::QuickAlert,
        "Create price alert",
        "Quick Actions",
    ),
    KeyBinding::new(
        "n",
        KeyModifiers::CMD_SHIFT,
        KeyboardAction::QuickNote,
        "Add note to symbol",
        "Quick Actions",
    ),
    KeyBinding::new(
        "s",
        KeyModifiers::CMD_SHIFT,
        KeyboardAction::QuickScreenshot,
        "Take screenshot",
        "Quick Actions",
    ),
    // === QUICK ACTIONS PANEL ===
    KeyBinding::new(
        "i",
        KeyModifiers::CMD,
        KeyboardAction::ToggleSuggestions,
        "Toggle inline suggestions",
        "Quick Actions Panel",
    ),
    KeyBinding::new(
        "q",
        KeyModifiers::CMD,
        KeyboardAction::OpenQuickActionsPanel,
        "Open quick actions panel",
        "Quick Actions Panel",
    ),
    KeyBinding::new(
        "k",
        KeyModifiers::CTRL_SHIFT,
        KeyboardAction::ToggleQuickActions,
        "Toggle quick actions panel",
        "Quick Actions Panel",
    ),
    KeyBinding::new(
        "1",
        KeyModifiers::ALT,
        KeyboardAction::ExecuteQuickAction1,
        "Execute quick action 1",
        "Quick Actions Panel",
    ),
    KeyBinding::new(
        "2",
        KeyModifiers::ALT,
        KeyboardAction::ExecuteQuickAction2,
        "Execute quick action 2",
        "Quick Actions Panel",
    ),
    KeyBinding::new(
        "3",
        KeyModifiers::ALT,
        KeyboardAction::ExecuteQuickAction3,
        "Execute quick action 3",
        "Quick Actions Panel",
    ),
    KeyBinding::new(
        "4",
        KeyModifiers::ALT,
        KeyboardAction::ExecuteQuickAction4,
        "Execute quick action 4",
        "Quick Actions Panel",
    ),
    KeyBinding::new(
        "5",
        KeyModifiers::ALT,
        KeyboardAction::ExecuteQuickAction5,
        "Execute quick action 5",
        "Quick Actions Panel",
    ),
    // Ctrl+1-4 for quick actions (alternative to Alt+1-4)
    KeyBinding::new(
        "1",
        KeyModifiers::CTRL,
        KeyboardAction::ExecuteQuickAction1,
        "Execute quick action 1",
        "Quick Actions Panel",
    ),
    KeyBinding::new(
        "2",
        KeyModifiers::CTRL,
        KeyboardAction::ExecuteQuickAction2,
        "Execute quick action 2",
        "Quick Actions Panel",
    ),
    KeyBinding::new(
        "3",
        KeyModifiers::CTRL,
        KeyboardAction::ExecuteQuickAction3,
        "Execute quick action 3",
        "Quick Actions Panel",
    ),
    KeyBinding::new(
        "4",
        KeyModifiers::CTRL,
        KeyboardAction::ExecuteQuickAction4,
        "Execute quick action 4",
        "Quick Actions Panel",
    ),
    // Focus agent input (Ctrl+/ or Cmd+/)
    KeyBinding::new(
        "/",
        KeyModifiers::CTRL,
        KeyboardAction::FocusAgentInput,
        "Focus agent input",
        "Quick Actions Panel",
    ),
    KeyBinding::new(
        "/",
        KeyModifiers::CMD,
        KeyboardAction::FocusAgentInput,
        "Focus agent input (Mac)",
        "Quick Actions Panel",
    ),
    // === HELP ===
    KeyBinding::new(
        "?",
        KeyModifiers::SHIFT,
        KeyboardAction::ShowShortcuts,
        "Show keyboard shortcuts",
        "Help",
    ),
    KeyBinding::new(
        "f1",
        KeyModifiers::NONE,
        KeyboardAction::ShowHelp,
        "Show help",
        "Help",
    ),
    // === NOTES EDITOR ===
    KeyBinding::new(
        "tab",
        KeyModifiers::CTRL,
        KeyboardAction::NotesEditorNextTab,
        "Next editor tab",
        "Notes Editor",
    ),
    KeyBinding::new(
        "tab",
        KeyModifiers::CTRL_SHIFT,
        KeyboardAction::NotesEditorPrevTab,
        "Previous editor tab",
        "Notes Editor",
    ),
    KeyBinding::new(
        "b",
        KeyModifiers::CTRL_SHIFT,
        KeyboardAction::QuickNote, // Reuse for bold since no dedicated action
        "Bold text",
        "Notes Editor",
    ),
    KeyBinding::new(
        "i",
        KeyModifiers::CTRL,
        KeyboardAction::ToggleSuggestions, // Reuse - italic in editor context
        "Italic text",
        "Notes Editor",
    ),
    KeyBinding::new(
        "s",
        KeyModifiers::CTRL,
        KeyboardAction::RefreshData, // Reuse - save in editor context
        "Save note",
        "Notes Editor",
    ),
    KeyBinding::new(
        "n",
        KeyModifiers::CTRL,
        KeyboardAction::QuickNote, // Reuse for new note
        "New note",
        "Notes Editor",
    ),
];

// ============================================================================
// KEYBOARD STATE AND MANAGER
// ============================================================================

/// Focus area for context-aware keyboard handling
///
/// Variants are defined for future keyboard navigation context management.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[allow(dead_code)]
pub enum FocusArea {
    #[default]
    Main,
    Sidebar,
    Watchlist,
    Table,
    Modal,
    Search,
    Chart,
}

/// Modal state for overlay handling
///
/// Variants are defined for future modal dialog support.
#[derive(Debug, Clone, Default)]
#[allow(dead_code)]
pub enum ModalState {
    #[default]
    None,
    SymbolSearch {
        query: String,
        selected_index: usize,
    },
    Shortcuts,
    Help,
    Alert {
        symbol: String,
    },
    Trade {
        symbol: String,
    },
    Confirm {
        message: String,
        on_confirm: Option<KeyboardAction>,
    },
}

impl ModalState {
    pub fn is_open(&self) -> bool {
        !matches!(self, ModalState::None)
    }
}

/// Table navigation state
///
/// This struct is a placeholder for future table navigation support.
/// It tracks row/column positions and selection state for keyboard-driven
/// table navigation in views like institutional holdings and dark pool data.
#[derive(Debug, Clone, Default)]
#[allow(dead_code)]
pub struct TableState {
    pub row_index: usize,
    pub column_index: usize,
    pub total_rows: usize,
    pub total_columns: usize,
    pub page_size: usize,
    pub selected_rows: Vec<usize>,
}

#[allow(dead_code)] // Table navigation methods for future use
impl TableState {
    pub fn new(rows: usize, columns: usize) -> Self {
        Self {
            row_index: 0,
            column_index: 0,
            total_rows: rows,
            total_columns: columns,
            page_size: 20,
            selected_rows: Vec::new(),
        }
    }

    pub fn move_up(&mut self) {
        if self.row_index > 0 {
            self.row_index -= 1;
        }
    }

    pub fn move_down(&mut self) {
        if self.row_index < self.total_rows.saturating_sub(1) {
            self.row_index += 1;
        }
    }

    pub fn move_left(&mut self) {
        if self.column_index > 0 {
            self.column_index -= 1;
        }
    }

    pub fn move_right(&mut self) {
        if self.column_index < self.total_columns.saturating_sub(1) {
            self.column_index += 1;
        }
    }

    pub fn page_up(&mut self) {
        self.row_index = self.row_index.saturating_sub(self.page_size);
    }

    pub fn page_down(&mut self) {
        self.row_index = (self.row_index + self.page_size).min(self.total_rows.saturating_sub(1));
    }

    pub fn go_home(&mut self) {
        self.row_index = 0;
    }

    pub fn go_end(&mut self) {
        self.row_index = self.total_rows.saturating_sub(1);
    }

    pub fn toggle_select(&mut self) {
        if self.selected_rows.contains(&self.row_index) {
            self.selected_rows.retain(|&r| r != self.row_index);
        } else {
            self.selected_rows.push(self.row_index);
        }
    }
}

/// Keyboard navigation configuration
///
/// Contains settings for keyboard behavior including vim mode and key repeat timing.
/// The repeat timing fields are placeholders for future key repeat handling.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct KeyboardConfig {
    pub vim_mode_enabled: bool,
    pub vim_mode_active: bool, // Only active when not in text input
    pub repeat_delay_ms: u64,
    pub repeat_rate_ms: u64,
}

impl Default for KeyboardConfig {
    fn default() -> Self {
        Self {
            vim_mode_enabled: true,
            vim_mode_active: true,
            repeat_delay_ms: 500,
            repeat_rate_ms: 50,
        }
    }
}

/// Keyboard manager for handling all keyboard input
///
/// This struct manages keyboard state including focus tracking, modal state,
/// and navigation indices. Some fields are placeholders for future keyboard
/// navigation features like watchlist cycling and search result caching.
#[derive(Default)]
#[allow(dead_code)]
pub struct KeyboardManager {
    pub focus_area: FocusArea,
    pub modal_state: ModalState,
    pub table_state: TableState,
    pub config: KeyboardConfig,
    pub watchlist_index: usize,
    pub search_results: Vec<String>,
}

#[allow(dead_code)] // Some methods are for future keyboard navigation features
impl KeyboardManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Process a key event and return the action to perform
    pub fn process_key(&mut self, keystroke: &Keystroke) -> Option<KeyboardAction> {
        let key = keystroke.key.as_str().to_lowercase();
        let modifiers = KeyModifiers {
            ctrl: keystroke.modifiers.control,
            alt: keystroke.modifiers.alt,
            shift: keystroke.modifiers.shift,
            cmd: keystroke.modifiers.platform,
        };

        // Special handling for modal state
        if self.modal_state.is_open() {
            return self.process_modal_key(&key, &modifiers);
        }

        // Find matching binding
        for binding in DEFAULT_BINDINGS {
            if binding.key.to_lowercase() == key && binding.modifiers == modifiers {
                // Check if vim keys should be processed
                if binding.category == "Vim" && !self.config.vim_mode_enabled {
                    continue;
                }
                // Don't process vim keys when in text input mode
                if binding.category == "Vim" && !self.config.vim_mode_active {
                    continue;
                }
                return Some(binding.action);
            }
        }

        None
    }

    /// Process keys while a modal is open
    fn process_modal_key(&mut self, key: &str, modifiers: &KeyModifiers) -> Option<KeyboardAction> {
        match &self.modal_state {
            ModalState::SymbolSearch { .. } => {
                match key {
                    "escape" => Some(KeyboardAction::CloseModal),
                    "return" | "enter" => Some(KeyboardAction::ConfirmAction),
                    "up" | "k"
                        if *modifiers == KeyModifiers::NONE || *modifiers == KeyModifiers::CTRL =>
                    {
                        Some(KeyboardAction::TableUp)
                    }
                    "down" | "j"
                        if *modifiers == KeyModifiers::NONE || *modifiers == KeyModifiers::CTRL =>
                    {
                        Some(KeyboardAction::TableDown)
                    }
                    _ => None, // Let text input handle other keys
                }
            }
            ModalState::Shortcuts | ModalState::Help => match key {
                "escape" | "?" => Some(KeyboardAction::CloseModal),
                _ => None,
            },
            ModalState::Confirm { .. } => match key {
                "escape" | "n" => Some(KeyboardAction::CloseModal),
                "return" | "enter" | "y" => Some(KeyboardAction::ConfirmAction),
                _ => None,
            },
            _ => {
                if key == "escape" {
                    Some(KeyboardAction::CloseModal)
                } else {
                    None
                }
            }
        }
    }

    /// Set focus area for context-aware navigation
    pub fn set_focus(&mut self, area: FocusArea) {
        self.focus_area = area;
        // Disable vim mode when in search/text input
        self.config.vim_mode_active = !matches!(area, FocusArea::Search);
    }

    /// Open a modal
    pub fn open_modal(&mut self, modal: ModalState) {
        self.modal_state = modal;
        self.set_focus(FocusArea::Modal);
    }

    /// Close current modal
    pub fn close_modal(&mut self) {
        self.modal_state = ModalState::None;
        self.set_focus(FocusArea::Main);
    }

    /// Update search query in symbol search modal
    pub fn update_search_query(&mut self, query: String) {
        if let ModalState::SymbolSearch { query: q, .. } = &mut self.modal_state {
            *q = query;
        }
    }

    /// Move selection in search results
    pub fn search_move_up(&mut self) {
        if let ModalState::SymbolSearch { selected_index, .. } = &mut self.modal_state {
            if *selected_index > 0 {
                *selected_index -= 1;
            }
        }
    }

    /// Move selection in search results
    pub fn search_move_down(&mut self, max_results: usize) {
        if let ModalState::SymbolSearch { selected_index, .. } = &mut self.modal_state {
            if *selected_index < max_results.saturating_sub(1) {
                *selected_index += 1;
            }
        }
    }

    /// Get selected search result index
    pub fn get_search_selection(&self) -> Option<usize> {
        match &self.modal_state {
            ModalState::SymbolSearch { selected_index, .. } => Some(*selected_index),
            _ => None,
        }
    }

    /// Get formatted shortcut string for an action
    pub fn get_shortcut_string(action: KeyboardAction) -> Option<String> {
        for binding in DEFAULT_BINDINGS {
            if binding.action == action {
                let mut parts = Vec::new();
                if binding.modifiers.cmd {
                    parts.push("Cmd");
                }
                if binding.modifiers.ctrl {
                    parts.push("Ctrl");
                }
                if binding.modifiers.alt {
                    parts.push("Alt");
                }
                if binding.modifiers.shift {
                    parts.push("Shift");
                }
                parts.push(binding.key);
                return Some(parts.join("+"));
            }
        }
        None
    }

    /// Get all bindings grouped by category
    pub fn get_bindings_by_category() -> HashMap<&'static str, Vec<&'static KeyBinding>> {
        let mut categories: HashMap<&'static str, Vec<&'static KeyBinding>> = HashMap::new();
        for binding in DEFAULT_BINDINGS {
            categories
                .entry(binding.category)
                .or_default()
                .push(binding);
        }
        categories
    }
}

// ============================================================================
// GPUI KEYBOARD EVENT HANDLING
// ============================================================================

// GPUI Actions for keyboard shortcuts
// These are registered with GPUI's action system for global key handling

actions!(
    stanley,
    [
        // View navigation
        GotoDashboard,
        GotoMoneyFlow,
        GotoInstitutional,
        GotoDarkPool,
        GotoOptions,
        GotoResearch,
        // Symbol search
        OpenSymbolSearch,
        CloseModal,
        // Data actions
        RefreshData,
        RefreshAll,
        // UI actions
        ToggleTheme,
        ToggleSidebar,
        OpenSettings,
        // Navigation
        NavigateUp,
        NavigateDown,
        NavigateLeft,
        NavigateRight,
        PageUp,
        PageDown,
        GoHome,
        GoEnd,
        Select,
        // Watchlist
        WatchlistPrev,
        WatchlistNext,
        // Help
        ShowShortcuts,
        ShowHelp,
        // Notes Editor
        NotesEditorBold,
        NotesEditorItalic,
        NotesEditorCode,
        NotesEditorSave,
        NotesEditorPreview,
        NotesEditorNewNote,
        NotesEditorNextTab,
        NotesEditorPrevTab,
    ]
);

/// Register all keyboard bindings with GPUI context
pub fn register_keyboard_bindings(cx: &mut App) {
    // View navigation (1-6)
    cx.bind_keys([
        gpui::KeyBinding::new("1", GotoDashboard, None),
        gpui::KeyBinding::new("2", GotoMoneyFlow, None),
        gpui::KeyBinding::new("3", GotoInstitutional, None),
        gpui::KeyBinding::new("4", GotoDarkPool, None),
        gpui::KeyBinding::new("5", GotoOptions, None),
        gpui::KeyBinding::new("6", GotoResearch, None),
    ]);

    // Symbol search (Ctrl+K / Cmd+K)
    cx.bind_keys([
        gpui::KeyBinding::new("ctrl-k", OpenSymbolSearch, None),
        gpui::KeyBinding::new("cmd-k", OpenSymbolSearch, None),
        gpui::KeyBinding::new("ctrl-p", OpenSymbolSearch, None),
    ]);

    // Modal handling
    cx.bind_keys([gpui::KeyBinding::new("escape", CloseModal, None)]);

    // Data refresh
    cx.bind_keys([
        gpui::KeyBinding::new("ctrl-r", RefreshData, None),
        gpui::KeyBinding::new("ctrl-shift-r", RefreshAll, None),
    ]);

    // Theme toggle
    cx.bind_keys([gpui::KeyBinding::new("ctrl-t", ToggleTheme, None)]);

    // Sidebar toggle
    cx.bind_keys([gpui::KeyBinding::new("ctrl-b", ToggleSidebar, None)]);

    // Navigation
    cx.bind_keys([
        gpui::KeyBinding::new("up", NavigateUp, None),
        gpui::KeyBinding::new("down", NavigateDown, None),
        gpui::KeyBinding::new("left", NavigateLeft, None),
        gpui::KeyBinding::new("right", NavigateRight, None),
        gpui::KeyBinding::new("k", NavigateUp, None), // vim
        gpui::KeyBinding::new("j", NavigateDown, None), // vim
        gpui::KeyBinding::new("h", NavigateLeft, None), // vim
        gpui::KeyBinding::new("l", NavigateRight, None), // vim
        gpui::KeyBinding::new("pageup", PageUp, None),
        gpui::KeyBinding::new("pagedown", PageDown, None),
        gpui::KeyBinding::new("home", GoHome, None),
        gpui::KeyBinding::new("end", GoEnd, None),
        gpui::KeyBinding::new("space", Select, None),
        gpui::KeyBinding::new("enter", Select, None),
    ]);

    // Watchlist navigation
    cx.bind_keys([
        gpui::KeyBinding::new("w", WatchlistPrev, None),
        gpui::KeyBinding::new("s", WatchlistNext, None),
        gpui::KeyBinding::new("alt-up", WatchlistPrev, None),
        gpui::KeyBinding::new("alt-down", WatchlistNext, None),
    ]);

    // Help
    cx.bind_keys([
        gpui::KeyBinding::new("shift-?", ShowShortcuts, None),
        gpui::KeyBinding::new("f1", ShowHelp, None),
    ]);

    // Settings
    cx.bind_keys([gpui::KeyBinding::new("ctrl-,", OpenSettings, None)]);

    // Notes Editor shortcuts (active when in Notes Editor view)
    // Note: These use ctrl- prefix to match standard editor conventions
    // They will be handled by the app based on current active view
    cx.bind_keys([
        gpui::KeyBinding::new("ctrl-shift-b", NotesEditorBold, None),
        gpui::KeyBinding::new("ctrl-i", NotesEditorItalic, None),
        gpui::KeyBinding::new("ctrl-`", NotesEditorCode, None),
        gpui::KeyBinding::new("ctrl-s", NotesEditorSave, None),
        gpui::KeyBinding::new("ctrl-shift-p", NotesEditorPreview, None),
        gpui::KeyBinding::new("ctrl-n", NotesEditorNewNote, None),
        gpui::KeyBinding::new("ctrl-tab", NotesEditorNextTab, None),
        gpui::KeyBinding::new("ctrl-shift-tab", NotesEditorPrevTab, None),
    ]);
}

// ============================================================================
// KEYBOARD NAVIGATION STATE FOR STANLEY APP
// ============================================================================

/// Extended state for keyboard-enabled ZeeApp
///
/// This struct is a placeholder for future integration with ZeeApp.
/// It provides comprehensive keyboard state management including theme,
/// sidebar visibility, and zoom level.
#[allow(dead_code)]
pub struct KeyboardState {
    pub manager: KeyboardManager,
    pub sidebar_visible: bool,
    pub current_theme: ThemeMode,
    pub zoom_level: f32,
}

/// Theme mode for the application (placeholder for future theming support)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[allow(dead_code)]
pub enum ThemeMode {
    #[default]
    Dark,
    Light,
}

impl Default for KeyboardState {
    fn default() -> Self {
        Self {
            manager: KeyboardManager::new(),
            sidebar_visible: true,
            current_theme: ThemeMode::Dark,
            zoom_level: 1.0,
        }
    }
}

#[allow(dead_code)]
impl KeyboardState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn toggle_theme(&mut self) {
        self.current_theme = match self.current_theme {
            ThemeMode::Dark => ThemeMode::Light,
            ThemeMode::Light => ThemeMode::Dark,
        };
    }

    pub fn toggle_sidebar(&mut self) {
        self.sidebar_visible = !self.sidebar_visible;
    }

    pub fn zoom_in(&mut self) {
        self.zoom_level = (self.zoom_level + 0.1).min(2.0);
    }

    pub fn zoom_out(&mut self) {
        self.zoom_level = (self.zoom_level - 0.1).max(0.5);
    }

    pub fn reset_zoom(&mut self) {
        self.zoom_level = 1.0;
    }
}

// ============================================================================
// KEYBOARD-ENABLED APP EXTENSION TRAIT
// ============================================================================

/// Extension trait for adding keyboard handling to ZeeApp
///
/// This trait is designed to be implemented by ZeeApp in the future
/// to enable comprehensive keyboard navigation support.
#[allow(dead_code)]
pub trait KeyboardEnabled {
    fn keyboard_state(&self) -> &KeyboardState;
    fn keyboard_state_mut(&mut self) -> &mut KeyboardState;

    /// Handle a keyboard action
    fn handle_keyboard_action(&mut self, action: KeyboardAction, cx: &mut Context<Self>)
    where
        Self: Sized;
}

// ============================================================================
// SYMBOL SEARCH IMPLEMENTATION
// ============================================================================

/// Common stock symbols for quick search
pub const COMMON_SYMBOLS: &[(&str, &str)] = &[
    ("AAPL", "Apple Inc."),
    ("MSFT", "Microsoft Corporation"),
    ("GOOGL", "Alphabet Inc."),
    ("AMZN", "Amazon.com Inc."),
    ("NVDA", "NVIDIA Corporation"),
    ("META", "Meta Platforms Inc."),
    ("TSLA", "Tesla Inc."),
    ("BRK.B", "Berkshire Hathaway"),
    ("JPM", "JPMorgan Chase & Co."),
    ("V", "Visa Inc."),
    ("JNJ", "Johnson & Johnson"),
    ("WMT", "Walmart Inc."),
    ("PG", "Procter & Gamble"),
    ("MA", "Mastercard Inc."),
    ("UNH", "UnitedHealth Group"),
    ("HD", "Home Depot Inc."),
    ("DIS", "Walt Disney Co."),
    ("BAC", "Bank of America"),
    ("ADBE", "Adobe Inc."),
    ("CRM", "Salesforce Inc."),
    ("NFLX", "Netflix Inc."),
    ("AMD", "Advanced Micro Devices"),
    ("INTC", "Intel Corporation"),
    ("PYPL", "PayPal Holdings"),
    ("CSCO", "Cisco Systems"),
    // ETFs
    ("SPY", "SPDR S&P 500 ETF"),
    ("QQQ", "Invesco QQQ Trust"),
    ("IWM", "iShares Russell 2000"),
    ("DIA", "SPDR Dow Jones"),
    ("VTI", "Vanguard Total Stock"),
    ("XLK", "Technology Select Sector"),
    ("XLF", "Financial Select Sector"),
    ("XLE", "Energy Select Sector"),
    ("XLV", "Health Care Select Sector"),
    ("XLI", "Industrial Select Sector"),
    ("XLC", "Communication Services"),
];

/// Search for symbols matching query
pub fn search_symbols(query: &str) -> Vec<(&'static str, &'static str)> {
    if query.is_empty() {
        return COMMON_SYMBOLS.iter().take(10).copied().collect();
    }

    let query_upper = query.to_uppercase();
    let query_lower = query.to_lowercase();

    let mut results: Vec<_> = COMMON_SYMBOLS
        .iter()
        .filter(|(symbol, name)| {
            symbol.contains(&query_upper) || name.to_lowercase().contains(&query_lower)
        })
        .copied()
        .collect();

    // Sort by relevance (exact symbol match first, then by position)
    results.sort_by(|(sym_a, _), (sym_b, _)| {
        let a_exact = *sym_a == query_upper;
        let b_exact = *sym_b == query_upper;
        if a_exact && !b_exact {
            std::cmp::Ordering::Less
        } else if !a_exact && b_exact {
            std::cmp::Ordering::Greater
        } else {
            sym_a.cmp(sym_b)
        }
    });

    results.into_iter().take(10).collect()
}

// ============================================================================
// SHORTCUTS HELP DISPLAY
// ============================================================================

/// Category order for display
pub const CATEGORY_ORDER: &[&str] = &[
    "Navigation",
    "Search",
    "Watchlist",
    "Table",
    "Data",
    "UI",
    "Focus",
    "Vim",
    "Quick Actions",
    "Quick Actions Panel",
    "Notes Editor",
    "Modal",
    "Help",
];

/// Get formatted help text for shortcuts panel
pub fn get_shortcuts_help() -> Vec<(&'static str, Vec<(&'static str, &'static str)>)> {
    let bindings = KeyboardManager::get_bindings_by_category();
    let mut result = Vec::new();

    for category in CATEGORY_ORDER {
        if let Some(category_bindings) = bindings.get(category) {
            let shortcuts: Vec<_> = category_bindings
                .iter()
                .map(|b| {
                    let key_str = format_key_binding(b);
                    // Leak the string to get a static lifetime (acceptable for help text)
                    let key_static: &'static str = Box::leak(key_str.into_boxed_str());
                    (key_static, b.description)
                })
                .collect();
            result.push((*category, shortcuts));
        }
    }

    result
}

/// Format a key binding for display
fn format_key_binding(binding: &KeyBinding) -> String {
    let mut parts = Vec::new();

    if binding.modifiers.cmd {
        parts.push("Cmd");
    }
    if binding.modifiers.ctrl {
        parts.push("Ctrl");
    }
    if binding.modifiers.alt {
        parts.push("Alt");
    }
    if binding.modifiers.shift {
        parts.push("Shift");
    }

    // Format key nicely
    let key = match binding.key {
        "escape" => "Esc",
        "return" | "enter" => "Enter",
        "space" => "Space",
        "pageup" => "PgUp",
        "pagedown" => "PgDn",
        "up" => "^",
        "down" => "v",
        "left" => "<",
        "right" => ">",
        k => k,
    };
    parts.push(key);

    parts.join(" + ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_symbol_search() {
        let results = search_symbols("AAP");
        assert!(!results.is_empty());
        assert_eq!(results[0].0, "AAPL");

        let results = search_symbols("apple");
        assert!(!results.is_empty());
        assert_eq!(results[0].0, "AAPL");

        let results = search_symbols("");
        assert_eq!(results.len(), 10);
    }

    #[test]
    fn test_table_navigation() {
        let mut state = TableState::new(100, 5);
        assert_eq!(state.row_index, 0);

        state.move_down();
        assert_eq!(state.row_index, 1);

        state.page_down();
        assert_eq!(state.row_index, 21);

        state.go_home();
        assert_eq!(state.row_index, 0);

        state.go_end();
        assert_eq!(state.row_index, 99);
    }

    #[test]
    fn test_keyboard_config() {
        let config = KeyboardConfig::default();
        assert!(config.vim_mode_enabled);
        assert!(config.vim_mode_active);
    }
}
