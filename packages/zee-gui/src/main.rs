//! Zee GUI - GPUI-based desktop interface
//!
//! This application provides a graphical interface for the Zee unified
//! assistant engine, with investment analysis, portfolio management,
//! and market data visualization powered by the Stanley backend.
//!
//! ## Enhanced GUI-Agent Interaction Features
//!
//! This version includes enhanced bidirectional communication between the GUI
//! and the Zee agent:
//!
//! - **Streaming Response Renderer**: Token-by-token display with typing animation,
//!   markdown rendering during stream, code block syntax highlighting
//! - **Inline Suggestions**: Agent suggestions overlay on data views with
//!   "Ask about this" buttons on charts/tables
//! - **Quick Actions Panel**: Predefined prompts for common tasks, recent queries
//!   history, and favorite queries bookmarking
//! - **Agent Status Widget**: Connection status indicator, current model display,
//!   token usage meter, and active tools indicator

#![recursion_limit = "4096"]

#[cfg(not(test))]
mod accounting;
#[cfg(not(test))]
mod agent;
#[cfg(not(test))]
mod agent_core;
#[cfg(not(test))]
mod agent_status;
// mod agent_widgets; // Temporarily disabled - GPUI API incompatibility
#[cfg(not(test))]
mod api;
#[cfg(not(test))]
mod app;
#[cfg(not(test))]
mod commodities;
#[cfg(not(test))]
mod comparison;
#[cfg(not(test))]
mod components;
#[cfg(not(test))]
mod etf;
#[cfg(not(test))]
mod keyboard;
#[cfg(not(test))]
mod notes;
#[cfg(not(test))]
mod notes_editor;
#[cfg(not(test))]
mod observability;
#[cfg(not(test))]
mod portfolio;
#[cfg(not(test))]
mod quick_actions;
#[cfg(not(test))]
mod signals;
#[cfg(not(test))]
mod suggestions;
#[cfg(not(test))]
mod sync;
#[cfg(not(test))]
mod theme;
#[cfg(not(test))]
mod runtime;

// Tests temporarily disabled - GPUI macro stack overflow in compiler
// The individual module tests (agent_state, keyboard, etc.) can still run
// #[cfg(test)]
// mod tests;

#[cfg(not(test))]
use app::ZeeApp;
#[cfg(not(test))]
use gpui::*;
#[cfg(not(test))]
use keyboard::register_keyboard_bindings;

// Re-export new modules for use in other parts of the application
#[cfg(not(test))]
pub use agent_status::{
    render_status_compact, render_status_expanded, AgentConnectionStatus, AgentStatusState,
    ModelInfo, TokenUsage,
};
#[cfg(not(test))]
pub use quick_actions::{
    render_quick_actions_compact, render_quick_actions_full, ActionCategory, QuickAction,
    QuickActionsState, RecentQuery,
};
#[cfg(not(test))]
pub use suggestions::{
    generate_chart_suggestions, generate_insights, generate_table_suggestions,
    render_ask_about_button, render_contextual_actions, render_suggestions_overlay, Suggestion,
    SuggestionContext, SuggestionType, SuggestionsState,
};

#[cfg(test)]
fn main() {}

#[cfg(not(test))]
fn main() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_name("zee-gui-tokio")
        .build()
        .expect("failed to initialize Tokio runtime");
    let _runtime_guard = runtime.enter();

    Application::new().run(|cx: &mut App| {
        // Register keyboard bindings
        register_keyboard_bindings(cx);

        // Set up window options
        let window_options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds {
                origin: Point::default(),
                size: Size {
                    width: px(1400.0),
                    height: px(900.0),
                },
            })),
            titlebar: Some(TitlebarOptions {
                title: Some("Zee".into()),
                appears_transparent: false,
                ..Default::default()
            }),
            ..Default::default()
        };

        cx.open_window(window_options, |_window, cx| cx.new(ZeeApp::new))
            .unwrap();
    });
}
