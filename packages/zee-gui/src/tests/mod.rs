//! Test modules for Stanley GUI
//!
//! This module contains comprehensive tests for the Stanley GUI application,
//! including unit tests, integration tests, and performance benchmarks.
//!
//! ## Test Categories
//!
//! - **Unit Tests**: Individual module functionality
//!   - `notes_test` - Notes view data structures
//!   - `notes_editor_test` - Notes editor buffer and state
//!   - `api_test` - API client and data types
//!   - `app_test` - Application state management
//!
//! - **Integration Tests**: Cross-module functionality
//!   - `integration_test` - Data flow and state coordination
//!
//! - **Performance Tests**: Benchmarks and stress tests
//!   - `benchmark_test` - Performance benchmarks
//!
//! ## Running Tests
//!
//! ```bash
//! # Run all tests
//! cargo test
//!
//! # Run specific test module
//! cargo test notes_test
//!
//! # Run with output
//! cargo test -- --nocapture
//!
//! # Run benchmarks
//! cargo test bench -- --nocapture
//! ```

#[cfg(test)]
pub mod notes_test;

#[cfg(test)]
pub mod notes_editor_test;

#[cfg(test)]
pub mod api_test;

#[cfg(test)]
pub mod app_test;

#[cfg(test)]
pub mod integration_test;

#[cfg(test)]
pub mod benchmark_test;
