//! Number input component with formatting
//!
//! A styled numeric input field with support for min/max ranges,
//! step increments, currency/percentage formatting, and validation.

#![allow(dead_code)]

use crate::theme::Theme;
use gpui::prelude::*;
use gpui::*;

/// Number format type
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum NumberFormat {
    #[default]
    Plain,
    Currency,
    Percentage,
    Compact,
}

/// Number input state
pub struct NumberInput {
    /// Current numeric value
    value: Option<f64>,
    /// Placeholder text
    placeholder: String,
    /// Field label
    label: Option<String>,
    /// Helper text
    helper_text: Option<String>,
    /// Minimum value
    min: Option<f64>,
    /// Maximum value
    max: Option<f64>,
    /// Step increment
    step: f64,
    /// Decimal precision
    precision: usize,
    /// Display format
    format: NumberFormat,
    /// Currency symbol (for Currency format)
    currency_symbol: String,
    /// Whether the field is disabled
    disabled: bool,
    /// Whether the field is focused
    focused: bool,
    /// Error message
    error: Option<String>,
}

impl NumberInput {
    pub fn new() -> Self {
        Self {
            value: None,
            placeholder: "0".to_string(),
            label: None,
            helper_text: None,
            min: None,
            max: None,
            step: 1.0,
            precision: 2,
            format: NumberFormat::Plain,
            currency_symbol: "$".to_string(),
            disabled: false,
            focused: false,
            error: None,
        }
    }

    pub fn value(mut self, value: f64) -> Self {
        self.value = Some(value);
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

    pub fn min(mut self, min: f64) -> Self {
        self.min = Some(min);
        self
    }

    pub fn max(mut self, max: f64) -> Self {
        self.max = Some(max);
        self
    }

    pub fn range(mut self, min: f64, max: f64) -> Self {
        self.min = Some(min);
        self.max = Some(max);
        self
    }

    pub fn step(mut self, step: f64) -> Self {
        self.step = step;
        self
    }

    pub fn precision(mut self, precision: usize) -> Self {
        self.precision = precision;
        self
    }

    pub fn format(mut self, format: NumberFormat) -> Self {
        self.format = format;
        self
    }

    pub fn currency(mut self, symbol: impl Into<String>) -> Self {
        self.format = NumberFormat::Currency;
        self.currency_symbol = symbol.into();
        self
    }

    pub fn percentage(mut self) -> Self {
        self.format = NumberFormat::Percentage;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn error(mut self, error: impl Into<String>) -> Self {
        self.error = Some(error.into());
        self
    }

    /// Get the current value
    pub fn get_value(&self) -> Option<f64> {
        self.value
    }

    /// Set value and clamp to range
    pub fn set_value(&mut self, value: f64) {
        let mut v = value;
        if let Some(min) = self.min {
            v = v.max(min);
        }
        if let Some(max) = self.max {
            v = v.min(max);
        }
        self.value = Some(v);
    }

    /// Increment value by step
    pub fn increment(&mut self) {
        let current = self.value.unwrap_or(0.0);
        self.set_value(current + self.step);
    }

    /// Decrement value by step
    pub fn decrement(&mut self) {
        let current = self.value.unwrap_or(0.0);
        self.set_value(current - self.step);
    }

    /// Format the display value
    fn format_value(&self, value: f64) -> String {
        match self.format {
            NumberFormat::Plain => format!("{:.prec$}", value, prec = self.precision),
            NumberFormat::Currency => {
                if value >= 1_000_000_000.0 {
                    format!("{}{}B", self.currency_symbol, value / 1_000_000_000.0)
                } else if value >= 1_000_000.0 {
                    format!("{}{}M", self.currency_symbol, value / 1_000_000.0)
                } else if value >= 1_000.0 {
                    format!("{}{}K", self.currency_symbol, value / 1_000.0)
                } else {
                    format!(
                        "{}{:.prec$}",
                        self.currency_symbol,
                        value,
                        prec = self.precision
                    )
                }
            }
            NumberFormat::Percentage => {
                format!("{:.prec$}%", value * 100.0, prec = self.precision)
            }
            NumberFormat::Compact => {
                if value.abs() >= 1_000_000_000.0 {
                    format!("{:.1}B", value / 1_000_000_000.0)
                } else if value.abs() >= 1_000_000.0 {
                    format!("{:.1}M", value / 1_000_000.0)
                } else if value.abs() >= 1_000.0 {
                    format!("{:.1}K", value / 1_000.0)
                } else {
                    format!("{:.prec$}", value, prec = self.precision)
                }
            }
        }
    }

    /// Validate the current value
    pub fn validate(&self) -> Option<String> {
        if let Some(value) = self.value {
            if let Some(min) = self.min {
                if value < min {
                    return Some(format!("Value must be at least {}", self.format_value(min)));
                }
            }
            if let Some(max) = self.max {
                if value > max {
                    return Some(format!("Value must be at most {}", self.format_value(max)));
                }
            }
        }
        None
    }

    /// Build the number input element
    pub fn build(self, theme: &Theme) -> impl IntoElement {
        let has_error = self.error.is_some();

        let border_color = if has_error {
            theme.negative
        } else if self.focused {
            theme.accent
        } else {
            theme.border
        };

        let display_value = self
            .value
            .map(|v| self.format_value(v))
            .unwrap_or_else(|| self.placeholder.clone());

        let can_decrement = self
            .value
            .map_or(true, |v| self.min.map_or(true, |min| v > min));
        let can_increment = self
            .value
            .map_or(true, |v| self.max.map_or(true, |max| v < max));

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
            // Input container with stepper buttons
            .child(
                div()
                    .h(px(40.0))
                    .rounded(px(6.0))
                    .bg(theme.card_bg_elevated)
                    .border_1()
                    .border_color(border_color)
                    .flex()
                    .items_center()
                    .when(self.disabled, |el| el.opacity(0.5))
                    // Decrement button
                    .child(
                        div()
                            .w(px(36.0))
                            .h_full()
                            .flex()
                            .items_center()
                            .justify_center()
                            .border_r_1()
                            .border_color(theme.border_subtle)
                            .cursor_pointer()
                            .text_size(px(16.0))
                            .text_color(if can_decrement && !self.disabled {
                                theme.text_secondary
                            } else {
                                theme.text_dimmed
                            })
                            .hover(|s| {
                                if can_decrement && !self.disabled {
                                    s.bg(theme.hover_bg)
                                } else {
                                    s
                                }
                            })
                            .child("-"),
                    )
                    // Value display
                    .child(
                        div()
                            .flex_grow()
                            .px(px(12.0))
                            .text_size(px(13.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(if self.value.is_some() {
                                theme.text
                            } else {
                                theme.text_dimmed
                            })
                            .text_align(gpui::TextAlign::Center)
                            .child(display_value),
                    )
                    // Increment button
                    .child(
                        div()
                            .w(px(36.0))
                            .h_full()
                            .flex()
                            .items_center()
                            .justify_center()
                            .border_l_1()
                            .border_color(theme.border_subtle)
                            .cursor_pointer()
                            .text_size(px(16.0))
                            .text_color(if can_increment && !self.disabled {
                                theme.text_secondary
                            } else {
                                theme.text_dimmed
                            })
                            .hover(|s| {
                                if can_increment && !self.disabled {
                                    s.bg(theme.hover_bg)
                                } else {
                                    s
                                }
                            })
                            .child("+"),
                    ),
            )
            // Range indicator (optional)
            .when(self.min.is_some() || self.max.is_some(), |el| {
                let range_text = match (self.min, self.max) {
                    (Some(min), Some(max)) => {
                        format!("{} - {}", self.format_value(min), self.format_value(max))
                    }
                    (Some(min), None) => format!("Min: {}", self.format_value(min)),
                    (None, Some(max)) => format!("Max: {}", self.format_value(max)),
                    _ => String::new(),
                };

                el.child(
                    div()
                        .text_size(px(10.0))
                        .text_color(theme.text_dimmed)
                        .child(range_text),
                )
            })
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

impl Default for NumberInput {
    fn default() -> Self {
        Self::new()
    }
}

/// Stateful number input for Entity-based usage
pub struct NumberInputState {
    pub value: Option<f64>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: f64,
    pub precision: usize,
    pub format: NumberFormat,
    pub currency_symbol: String,
    pub label: Option<String>,
    pub disabled: bool,
    pub focused: bool,
    pub error: Option<String>,
}

impl NumberInputState {
    pub fn new() -> Self {
        Self {
            value: None,
            min: None,
            max: None,
            step: 1.0,
            precision: 2,
            format: NumberFormat::Plain,
            currency_symbol: "$".to_string(),
            label: None,
            disabled: false,
            focused: false,
            error: None,
        }
    }

    pub fn with_value(mut self, value: f64) -> Self {
        self.value = Some(value);
        self
    }

    pub fn with_range(mut self, min: f64, max: f64) -> Self {
        self.min = Some(min);
        self.max = Some(max);
        self
    }

    pub fn with_format(mut self, format: NumberFormat) -> Self {
        self.format = format;
        self
    }

    pub fn with_label(mut self, label: impl Into<String>) -> Self {
        self.label = Some(label.into());
        self
    }

    pub fn set_value(&mut self, value: f64) {
        let mut v = value;
        if let Some(min) = self.min {
            v = v.max(min);
        }
        if let Some(max) = self.max {
            v = v.min(max);
        }
        self.value = Some(v);
    }

    pub fn increment(&mut self) {
        let current = self.value.unwrap_or(0.0);
        self.set_value(current + self.step);
    }

    pub fn decrement(&mut self) {
        let current = self.value.unwrap_or(0.0);
        self.set_value(current - self.step);
    }

    fn format_value(&self, value: f64) -> String {
        match self.format {
            NumberFormat::Plain => format!("{:.prec$}", value, prec = self.precision),
            NumberFormat::Currency => format!(
                "{}{:.prec$}",
                self.currency_symbol,
                value,
                prec = self.precision
            ),
            NumberFormat::Percentage => {
                format!("{:.prec$}%", value * 100.0, prec = self.precision)
            }
            NumberFormat::Compact => {
                if value.abs() >= 1_000_000_000.0 {
                    format!("{:.1}B", value / 1_000_000_000.0)
                } else if value.abs() >= 1_000_000.0 {
                    format!("{:.1}M", value / 1_000_000.0)
                } else if value.abs() >= 1_000.0 {
                    format!("{:.1}K", value / 1_000.0)
                } else {
                    format!("{:.prec$}", value, prec = self.precision)
                }
            }
        }
    }

    pub fn render(&self, theme: &Theme) -> impl IntoElement {
        let has_error = self.error.is_some();
        let border_color = if has_error {
            theme.negative
        } else if self.focused {
            theme.accent
        } else {
            theme.border
        };

        let display = self
            .value
            .map(|v| self.format_value(v))
            .unwrap_or_else(|| "0".to_string());

        div()
            .flex()
            .flex_col()
            .gap(px(6.0))
            .when_some(self.label.clone(), |el, label| {
                el.child(
                    div()
                        .text_size(px(12.0))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(theme.text_secondary)
                        .child(label),
                )
            })
            .child(
                div()
                    .h(px(40.0))
                    .rounded(px(6.0))
                    .bg(theme.card_bg_elevated)
                    .border_1()
                    .border_color(border_color)
                    .flex()
                    .items_center()
                    .when(self.disabled, |el| el.opacity(0.5))
                    .child(
                        div()
                            .w(px(36.0))
                            .h_full()
                            .flex()
                            .items_center()
                            .justify_center()
                            .border_r_1()
                            .border_color(theme.border_subtle)
                            .cursor_pointer()
                            .text_color(theme.text_secondary)
                            .hover(|s| s.bg(theme.hover_bg))
                            .child("-"),
                    )
                    .child(
                        div()
                            .flex_grow()
                            .text_size(px(13.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(theme.text)
                            .text_align(gpui::TextAlign::Center)
                            .child(display),
                    )
                    .child(
                        div()
                            .w(px(36.0))
                            .h_full()
                            .flex()
                            .items_center()
                            .justify_center()
                            .border_l_1()
                            .border_color(theme.border_subtle)
                            .cursor_pointer()
                            .text_color(theme.text_secondary)
                            .hover(|s| s.bg(theme.hover_bg))
                            .child("+"),
                    ),
            )
            .when(has_error, |el| {
                el.child(
                    div()
                        .text_size(px(11.0))
                        .text_color(theme.negative)
                        .child(self.error.clone().unwrap_or_default()),
                )
            })
    }
}

impl Default for NumberInputState {
    fn default() -> Self {
        Self::new()
    }
}
