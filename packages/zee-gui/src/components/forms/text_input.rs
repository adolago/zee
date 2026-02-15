//! Text input component with validation
//!
//! A styled text input field with support for validation, placeholders,
//! labels, and error states.

#![allow(dead_code)]

use crate::components::modals::render_tooltip;
use crate::theme::Theme;
use gpui::prelude::*;
use gpui::*;
use std::sync::Arc;

use super::validation::{FieldMeta, FieldState, ValidationResult, ValidatorChain};

/// Text input field state
pub struct TextInput {
    /// Current input value
    value: String,
    /// Placeholder text
    placeholder: String,
    /// Field label
    label: Option<String>,
    /// Helper text shown below input
    helper_text: Option<String>,
    /// Whether the field is disabled
    disabled: bool,
    /// Whether the field is required
    required: bool,
    /// Whether the field has a clear button
    clearable: bool,
    /// Field metadata (state, validation)
    meta: FieldMeta,
    /// Validators to run
    validators: ValidatorChain<String>,
    /// Maximum character length
    max_length: Option<usize>,
    /// Input type (text, password, email)
    input_type: TextInputType,
    /// Callback when value changes
    on_change: Option<Arc<dyn Fn(&str) + Send + Sync>>,
    /// Callback when input is submitted (Enter pressed)
    on_submit: Option<Box<dyn Fn(&str) + Send + Sync>>,
}

/// Text input type variants
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum TextInputType {
    #[default]
    Text,
    Password,
    Email,
}

impl TextInput {
    pub fn new() -> Self {
        Self {
            value: String::new(),
            placeholder: String::new(),
            label: None,
            helper_text: None,
            disabled: false,
            required: false,
            clearable: false,
            meta: FieldMeta::default(),
            validators: ValidatorChain::new(),
            max_length: None,
            input_type: TextInputType::Text,
            on_change: None,
            on_submit: None,
        }
    }

    pub fn value(mut self, value: impl Into<String>) -> Self {
        self.value = value.into();
        self
    }

    pub fn placeholder(mut self, placeholder: impl Into<String>) -> Self {
        self.placeholder = placeholder.into();
        self
    }

    pub fn label(mut self, label: impl Into<String>) -> Self {
        self.label = Some(label.into());
        self
    }

    pub fn helper_text(mut self, text: impl Into<String>) -> Self {
        self.helper_text = Some(text.into());
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn required(mut self, required: bool) -> Self {
        self.required = required;
        self
    }

    pub fn clearable(mut self, clearable: bool) -> Self {
        self.clearable = clearable;
        self
    }

    pub fn max_length(mut self, max: usize) -> Self {
        self.max_length = Some(max);
        self
    }

    pub fn input_type(mut self, input_type: TextInputType) -> Self {
        self.input_type = input_type;
        self
    }

    pub fn validators(mut self, validators: ValidatorChain<String>) -> Self {
        self.validators = validators;
        self
    }

    pub fn on_change(mut self, callback: impl Fn(&str) + Send + Sync + 'static) -> Self {
        self.on_change = Some(Arc::new(callback));
        self
    }

    pub fn on_submit(mut self, callback: impl Fn(&str) + Send + Sync + 'static) -> Self {
        self.on_submit = Some(Box::new(callback));
        self
    }

    /// Validate the current value
    pub fn validate(&mut self) -> ValidationResult {
        self.meta.validation = self.validators.validate(&self.value);
        self.meta.show_error = true;
        self.meta.validation.clone()
    }

    /// Get current value
    pub fn get_value(&self) -> &str {
        &self.value
    }

    /// Set value programmatically
    pub fn set_value(&mut self, value: impl Into<String>) {
        self.value = value.into();
        self.meta.state = FieldState::Dirty;
    }

    /// Check if field has errors
    pub fn has_error(&self) -> bool {
        !self.meta.validation.is_valid()
    }

    /// Build the text input element with theme
    pub fn build(self, theme: &Theme) -> impl IntoElement {
        let has_error = self.meta.should_show_error();
        let is_focused = matches!(self.meta.state, FieldState::Focused);

        // Prepare callback for clear button
        let on_change = self.on_change.clone();

        let border_color = if has_error {
            theme.negative
        } else if is_focused {
            theme.accent
        } else {
            theme.border
        };

        let bg_color = if self.disabled {
            theme.card_bg
        } else {
            theme.card_bg_elevated
        };

        div()
            .flex()
            .flex_col()
            .gap(px(6.0))
            // Label
            .when_some(self.label.clone(), |el, label| {
                el.child(
                    div()
                        .flex()
                        .gap(px(2.0))
                        .child(
                            div()
                                .text_size(px(12.0))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(theme.text_secondary)
                                .child(label),
                        )
                        .when(self.required, |el| {
                            el.child(
                                div()
                                    .text_size(px(12.0))
                                    .text_color(theme.negative)
                                    .child("*"),
                            )
                        }),
                )
            })
            // Input container
            .child(
                div()
                    .h(px(40.0))
                    .px(px(12.0))
                    .rounded(px(6.0))
                    .bg(bg_color)
                    .border_1()
                    .border_color(border_color)
                    .flex()
                    .items_center()
                    .when(is_focused, |el| el.border_color(theme.accent))
                    .when(self.disabled, |el| el.opacity(0.5).cursor_not_allowed())
                    .when(!self.disabled, |el| el.cursor_text())
                    .child(
                        div()
                            .flex_grow()
                            .text_size(px(13.0))
                            .text_color(if self.value.is_empty() {
                                theme.text_dimmed
                            } else {
                                theme.text
                            })
                            .child(if self.value.is_empty() {
                                self.placeholder.clone()
                            } else if matches!(self.input_type, TextInputType::Password) {
                                "*".repeat(self.value.len())
                            } else {
                                self.value.clone()
                            }),
                    )
                    // Clear button
                    .when(
                        !self.value.is_empty() && on_change.is_some() && !self.disabled,
                        |el| {
                            let on_change = on_change.clone();
                            el.child(
                                div()
                                    .relative()
                                    .group("input-clear-btn")
                                    .id("clear-input")
                                    .px(px(4.0))
                                    .py(px(2.0))
                                    .rounded(px(4.0))
                                    .cursor_pointer()
                                    .hover(|s| s.bg(theme.hover_bg))
                                    .on_click(move |_, _, _| {
                                        if let Some(callback) = on_change.as_ref() {
                                            callback("");
                                        }
                                    })
                                    .child(
                                        div()
                                            .text_size(px(12.0))
                                            .text_color(theme.text_dimmed)
                                            .child("✕"),
                                    )
                                    .child(
                                        render_tooltip(theme, "Clear", "input-clear-btn")
                                            .absolute()
                                            .bottom(px(25.0))
                                            .right(px(0.0)),
                                    ),
                            )
                        },
                    )
                    .when_some(self.max_length, |el, max| {
                        let len = self.value.len();
                        let color = if len >= max {
                            theme.negative
                        } else if len as f32 / max as f32 >= 0.9 {
                            theme.warning
                        } else {
                            theme.text_dimmed
                        };

                        el.child(
                            div()
                                .text_size(px(10.0))
                                .text_color(color)
                                .child(format!("{}/{}", len, max)),
                        )
                    }),
            )
            // Helper text or error message
            .when(self.helper_text.is_some() || has_error, |el| {
                let text = if has_error {
                    self.meta
                        .validation
                        .error_message()
                        .unwrap_or("")
                        .to_string()
                } else {
                    self.helper_text.clone().unwrap_or_default()
                };

                el.child(
                    div()
                        .text_size(px(11.0))
                        .text_color(if has_error {
                            theme.negative
                        } else {
                            theme.text_dimmed
                        })
                        .child(text),
                )
            })
    }
}

impl Default for TextInput {
    fn default() -> Self {
        Self::new()
    }
}

/// Stateful text input component for use with Entity
pub struct TextInputState {
    pub value: String,
    pub placeholder: String,
    pub label: Option<String>,
    pub helper_text: Option<String>,
    pub disabled: bool,
    pub focused: bool,
    pub touched: bool,
    pub error: Option<String>,
}

impl TextInputState {
    pub fn new() -> Self {
        Self {
            value: String::new(),
            placeholder: String::new(),
            label: None,
            helper_text: None,
            disabled: false,
            focused: false,
            touched: false,
            error: None,
        }
    }

    pub fn with_label(mut self, label: impl Into<String>) -> Self {
        self.label = Some(label.into());
        self
    }

    pub fn with_placeholder(mut self, placeholder: impl Into<String>) -> Self {
        self.placeholder = placeholder.into();
        self
    }

    pub fn set_value(&mut self, value: impl Into<String>) {
        self.value = value.into();
    }

    pub fn set_error(&mut self, error: Option<String>) {
        self.error = error;
    }

    pub fn focus(&mut self) {
        self.focused = true;
    }

    pub fn blur(&mut self) {
        self.focused = false;
        self.touched = true;
    }

    pub fn render(&self, theme: &Theme) -> impl IntoElement {
        let has_error = self.touched && self.error.is_some();

        let border_color = if has_error {
            theme.negative
        } else if self.focused {
            theme.accent
        } else {
            theme.border
        };

        let bg_color = if self.disabled {
            theme.card_bg
        } else {
            theme.card_bg_elevated
        };

        div()
            .flex()
            .flex_col()
            .gap(px(6.0))
            // Label
            .when_some(self.label.clone(), |el, label| {
                el.child(
                    div()
                        .text_size(px(12.0))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(theme.text_secondary)
                        .child(label),
                )
            })
            // Input container
            .child(
                div()
                    .h(px(40.0))
                    .px(px(12.0))
                    .rounded(px(6.0))
                    .bg(bg_color)
                    .border_1()
                    .border_color(border_color)
                    .flex()
                    .items_center()
                    .when(self.disabled, |el| el.opacity(0.5).cursor_not_allowed())
                    .when(!self.disabled, |el| el.cursor_text())
                    .child(
                        div()
                            .flex_grow()
                            .text_size(px(13.0))
                            .text_color(if self.value.is_empty() {
                                theme.text_dimmed
                            } else {
                                theme.text
                            })
                            .child(if self.value.is_empty() {
                                self.placeholder.clone()
                            } else {
                                self.value.clone()
                            }),
                    ),
            )
            // Error or helper text
            .when(has_error || self.helper_text.is_some(), |el| {
                let (text, color) = if has_error {
                    (self.error.clone().unwrap_or_default(), theme.negative)
                } else {
                    (
                        self.helper_text.clone().unwrap_or_default(),
                        theme.text_dimmed,
                    )
                };

                el.child(div().text_size(px(11.0)).text_color(color).child(text))
            })
    }
}

impl Default for TextInputState {
    fn default() -> Self {
        Self::new()
    }
}
