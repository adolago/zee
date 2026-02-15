//! Form validation utilities
//!
//! Provides validation rules and error handling for form inputs.

#![allow(dead_code)]

/// Validation result
#[derive(Debug, Clone, PartialEq)]
pub enum ValidationResult {
    Valid,
    Invalid(String),
}

impl ValidationResult {
    pub fn is_valid(&self) -> bool {
        matches!(self, ValidationResult::Valid)
    }

    pub fn error_message(&self) -> Option<&str> {
        match self {
            ValidationResult::Valid => None,
            ValidationResult::Invalid(msg) => Some(msg),
        }
    }
}

/// Validation rule trait
pub trait ValidationRule<T>: Send + Sync {
    fn validate(&self, value: &T) -> ValidationResult;
    fn description(&self) -> &str;
}

/// Required field validator
pub struct Required {
    message: String,
}

impl Required {
    pub fn new() -> Self {
        Self {
            message: "This field is required".to_string(),
        }
    }

    pub fn with_message(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Default for Required {
    fn default() -> Self {
        Self::new()
    }
}

impl ValidationRule<String> for Required {
    fn validate(&self, value: &String) -> ValidationResult {
        if value.trim().is_empty() {
            ValidationResult::Invalid(self.message.clone())
        } else {
            ValidationResult::Valid
        }
    }

    fn description(&self) -> &str {
        "Required field"
    }
}

/// Minimum length validator
pub struct MinLength {
    min: usize,
    message: String,
}

impl MinLength {
    pub fn new(min: usize) -> Self {
        Self {
            min,
            message: format!("Must be at least {} characters", min),
        }
    }

    pub fn with_message(min: usize, message: impl Into<String>) -> Self {
        Self {
            min,
            message: message.into(),
        }
    }
}

impl ValidationRule<String> for MinLength {
    fn validate(&self, value: &String) -> ValidationResult {
        if value.len() < self.min {
            ValidationResult::Invalid(self.message.clone())
        } else {
            ValidationResult::Valid
        }
    }

    fn description(&self) -> &str {
        "Minimum length"
    }
}

/// Maximum length validator
pub struct MaxLength {
    max: usize,
    message: String,
}

impl MaxLength {
    pub fn new(max: usize) -> Self {
        Self {
            max,
            message: format!("Must be at most {} characters", max),
        }
    }

    pub fn with_message(max: usize, message: impl Into<String>) -> Self {
        Self {
            max,
            message: message.into(),
        }
    }
}

impl ValidationRule<String> for MaxLength {
    fn validate(&self, value: &String) -> ValidationResult {
        if value.len() > self.max {
            ValidationResult::Invalid(self.message.clone())
        } else {
            ValidationResult::Valid
        }
    }

    fn description(&self) -> &str {
        "Maximum length"
    }
}

/// Pattern validator (regex)
pub struct Pattern {
    pattern: regex::Regex,
    message: String,
}

impl Pattern {
    pub fn new(pattern: &str) -> Result<Self, regex::Error> {
        Ok(Self {
            pattern: regex::Regex::new(pattern)?,
            message: "Invalid format".to_string(),
        })
    }

    pub fn with_message(pattern: &str, message: impl Into<String>) -> Result<Self, regex::Error> {
        Ok(Self {
            pattern: regex::Regex::new(pattern)?,
            message: message.into(),
        })
    }

    /// Email pattern validator
    pub fn email() -> Self {
        Self {
            pattern: regex::Regex::new(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")
                .unwrap(),
            message: "Invalid email address".to_string(),
        }
    }

    /// Stock symbol pattern (1-5 uppercase letters)
    pub fn stock_symbol() -> Self {
        Self {
            pattern: regex::Regex::new(r"^[A-Z]{1,5}$").unwrap(),
            message: "Invalid stock symbol (1-5 uppercase letters)".to_string(),
        }
    }
}

impl ValidationRule<String> for Pattern {
    fn validate(&self, value: &String) -> ValidationResult {
        if value.is_empty() || self.pattern.is_match(value) {
            ValidationResult::Valid
        } else {
            ValidationResult::Invalid(self.message.clone())
        }
    }

    fn description(&self) -> &str {
        "Pattern match"
    }
}

/// Numeric range validator
pub struct NumericRange {
    min: Option<f64>,
    max: Option<f64>,
    message: String,
}

impl NumericRange {
    pub fn new(min: Option<f64>, max: Option<f64>) -> Self {
        let message = match (min, max) {
            (Some(min), Some(max)) => format!("Must be between {} and {}", min, max),
            (Some(min), None) => format!("Must be at least {}", min),
            (None, Some(max)) => format!("Must be at most {}", max),
            (None, None) => "Invalid value".to_string(),
        };
        Self { min, max, message }
    }

    pub fn min(min: f64) -> Self {
        Self::new(Some(min), None)
    }

    pub fn max(max: f64) -> Self {
        Self::new(None, Some(max))
    }

    pub fn between(min: f64, max: f64) -> Self {
        Self::new(Some(min), Some(max))
    }
}

impl ValidationRule<f64> for NumericRange {
    fn validate(&self, value: &f64) -> ValidationResult {
        if let Some(min) = self.min {
            if *value < min {
                return ValidationResult::Invalid(self.message.clone());
            }
        }
        if let Some(max) = self.max {
            if *value > max {
                return ValidationResult::Invalid(self.message.clone());
            }
        }
        ValidationResult::Valid
    }

    fn description(&self) -> &str {
        "Numeric range"
    }
}

/// Validator chain - combines multiple validators
pub struct ValidatorChain<T> {
    validators: Vec<Box<dyn ValidationRule<T>>>,
}

impl<T> ValidatorChain<T> {
    pub fn new() -> Self {
        Self {
            validators: Vec::new(),
        }
    }

    pub fn add(mut self, validator: impl ValidationRule<T> + 'static) -> Self {
        self.validators.push(Box::new(validator));
        self
    }

    pub fn validate(&self, value: &T) -> ValidationResult {
        for validator in &self.validators {
            let result = validator.validate(value);
            if !result.is_valid() {
                return result;
            }
        }
        ValidationResult::Valid
    }
}

impl<T> Default for ValidatorChain<T> {
    fn default() -> Self {
        Self::new()
    }
}

/// Field state tracking
#[derive(Debug, Clone, PartialEq)]
#[derive(Default)]
pub enum FieldState {
    /// Field has not been interacted with
    #[default]
    Pristine,
    /// Field is currently focused
    Focused,
    /// Field has been touched (focused then blurred)
    Touched,
    /// Field value has been modified
    Dirty,
}


/// Form field metadata
#[derive(Clone)]
pub struct FieldMeta {
    pub state: FieldState,
    pub validation: ValidationResult,
    pub show_error: bool,
}

impl Default for FieldMeta {
    fn default() -> Self {
        Self {
            state: FieldState::Pristine,
            validation: ValidationResult::Valid,
            show_error: false,
        }
    }
}

impl FieldMeta {
    pub fn should_show_error(&self) -> bool {
        self.show_error
            && matches!(self.state, FieldState::Touched | FieldState::Dirty)
            && !self.validation.is_valid()
    }
}
