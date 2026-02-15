//! Theme configuration for Stanley GUI
//!
//! Provides dark and light theme variants with consistent color schemes
//! for the institutional investment analysis interface.

use gpui::*;

/// Theme colors for the application
#[allow(dead_code)]
#[derive(Clone)]
pub struct Theme {
    // Backgrounds - layered for visual hierarchy
    pub background: Hsla,
    pub sidebar_bg: Hsla,
    pub card_bg: Hsla,
    pub card_bg_elevated: Hsla,
    pub hover_bg: Hsla,
    pub active_bg: Hsla,

    // Text - improved contrast hierarchy
    pub text: Hsla,
    pub text_secondary: Hsla,
    pub text_muted: Hsla,
    pub text_dimmed: Hsla,

    // Borders - subtle layering
    pub border: Hsla,
    pub border_subtle: Hsla,
    pub border_strong: Hsla,

    // Shadows (as transparent colors for overlay effects)
    pub shadow: Hsla,
    pub shadow_lg: Hsla,

    // Accent colors
    pub accent: Hsla,
    pub accent_hover: Hsla,
    pub accent_subtle: Hsla,
    pub accent_muted: Hsla,
    pub accent_glow: Hsla,

    // Semantic colors with better saturation
    pub positive: Hsla,
    pub positive_hover: Hsla,
    pub positive_subtle: Hsla,
    pub positive_muted: Hsla,
    pub negative: Hsla,
    pub negative_hover: Hsla,
    pub negative_subtle: Hsla,
    pub negative_muted: Hsla,
    pub warning: Hsla,
    pub warning_hover: Hsla,
    pub warning_subtle: Hsla,

    // Navigation
    pub nav_active_indicator: Hsla,
    pub nav_hover: Hsla,
}

impl Theme {
    /// Dark theme optimized for financial data display
    /// Uses a refined color palette with better contrast ratios
    pub fn dark() -> Self {
        Self {
            // Dark backgrounds - layered for depth
            // Base: darkest, used for main canvas
            background: hsla(222.0 / 360.0, 0.15, 0.08, 1.0),
            // Sidebar: slightly darker for visual separation
            sidebar_bg: hsla(222.0 / 360.0, 0.18, 0.06, 1.0),
            // Card: elevated surface
            card_bg: hsla(222.0 / 360.0, 0.14, 0.12, 1.0),
            // Elevated card: for nested or highlighted cards
            card_bg_elevated: hsla(222.0 / 360.0, 0.14, 0.14, 1.0),
            // Hover: subtle lift effect
            hover_bg: hsla(222.0 / 360.0, 0.16, 0.16, 1.0),
            // Active: pressed/selected state
            active_bg: hsla(222.0 / 360.0, 0.18, 0.18, 1.0),

            // Text - improved contrast hierarchy (WCAG AA compliant)
            text: hsla(0.0, 0.0, 0.97, 1.0), // Primary: pure white
            text_secondary: hsla(220.0 / 360.0, 0.08, 0.82, 1.0), // Secondary: soft white
            text_muted: hsla(220.0 / 360.0, 0.12, 0.60, 1.0), // Muted: visible but subdued
            text_dimmed: hsla(220.0 / 360.0, 0.10, 0.45, 1.0), // Dimmed: labels, hints

            // Borders - layered for subtle depth
            border: hsla(222.0 / 360.0, 0.14, 0.20, 1.0), // Default
            border_subtle: hsla(222.0 / 360.0, 0.12, 0.15, 1.0), // Subtle dividers
            border_strong: hsla(222.0 / 360.0, 0.16, 0.28, 1.0), // Emphasized borders

            // Shadows - for card elevation
            shadow: hsla(222.0 / 360.0, 0.50, 0.02, 0.40),
            shadow_lg: hsla(222.0 / 360.0, 0.60, 0.01, 0.60),

            // Accent - Vibrant blue (financial confidence color)
            accent: hsla(210.0 / 360.0, 0.92, 0.58, 1.0),
            accent_hover: hsla(210.0 / 360.0, 0.95, 0.65, 1.0),
            accent_subtle: hsla(210.0 / 360.0, 0.80, 0.55, 0.18),
            accent_muted: hsla(210.0 / 360.0, 0.60, 0.50, 0.40),
            accent_glow: hsla(210.0 / 360.0, 0.90, 0.60, 0.08),

            // Positive - Refined green (growth/profit)
            positive: hsla(152.0 / 360.0, 0.72, 0.48, 1.0),
            positive_hover: hsla(152.0 / 360.0, 0.75, 0.55, 1.0),
            positive_subtle: hsla(152.0 / 360.0, 0.65, 0.45, 0.18),
            positive_muted: hsla(152.0 / 360.0, 0.50, 0.40, 0.60),

            // Negative - Refined red (loss/decline)
            negative: hsla(4.0 / 360.0, 0.75, 0.55, 1.0),
            negative_hover: hsla(4.0 / 360.0, 0.78, 0.62, 1.0),
            negative_subtle: hsla(4.0 / 360.0, 0.70, 0.50, 0.18),
            negative_muted: hsla(4.0 / 360.0, 0.55, 0.45, 0.60),

            // Warning - Amber (caution)
            warning: hsla(40.0 / 360.0, 0.92, 0.52, 1.0),
            warning_hover: hsla(40.0 / 360.0, 0.95, 0.58, 1.0),
            warning_subtle: hsla(40.0 / 360.0, 0.85, 0.50, 0.18),

            // Navigation
            nav_active_indicator: hsla(210.0 / 360.0, 0.92, 0.58, 1.0),
            nav_hover: hsla(222.0 / 360.0, 0.20, 0.14, 1.0),
        }
    }

    /// Light theme variant
    #[allow(dead_code)]
    pub fn light() -> Self {
        Self {
            // Light backgrounds - clean and professional
            background: hsla(220.0 / 360.0, 0.10, 0.97, 1.0),
            sidebar_bg: hsla(220.0 / 360.0, 0.08, 0.94, 1.0),
            card_bg: hsla(0.0, 0.0, 1.0, 1.0),
            card_bg_elevated: hsla(220.0 / 360.0, 0.05, 0.99, 1.0),
            hover_bg: hsla(220.0 / 360.0, 0.12, 0.92, 1.0),
            active_bg: hsla(220.0 / 360.0, 0.15, 0.90, 1.0),

            // Text
            text: hsla(222.0 / 360.0, 0.25, 0.12, 1.0),
            text_secondary: hsla(222.0 / 360.0, 0.15, 0.30, 1.0),
            text_muted: hsla(222.0 / 360.0, 0.10, 0.45, 1.0),
            text_dimmed: hsla(222.0 / 360.0, 0.08, 0.58, 1.0),

            // Borders
            border: hsla(220.0 / 360.0, 0.14, 0.86, 1.0),
            border_subtle: hsla(220.0 / 360.0, 0.10, 0.92, 1.0),
            border_strong: hsla(220.0 / 360.0, 0.16, 0.78, 1.0),

            // Shadows
            shadow: hsla(222.0 / 360.0, 0.20, 0.20, 0.08),
            shadow_lg: hsla(222.0 / 360.0, 0.25, 0.15, 0.12),

            // Accent - Blue
            accent: hsla(210.0 / 360.0, 0.90, 0.45, 1.0),
            accent_hover: hsla(210.0 / 360.0, 0.92, 0.50, 1.0),
            accent_subtle: hsla(210.0 / 360.0, 0.85, 0.45, 0.12),
            accent_muted: hsla(210.0 / 360.0, 0.55, 0.40, 0.35),
            accent_glow: hsla(210.0 / 360.0, 0.80, 0.50, 0.06),

            // Positive - Green
            positive: hsla(152.0 / 360.0, 0.68, 0.38, 1.0),
            positive_hover: hsla(152.0 / 360.0, 0.70, 0.42, 1.0),
            positive_subtle: hsla(152.0 / 360.0, 0.60, 0.38, 0.12),
            positive_muted: hsla(152.0 / 360.0, 0.45, 0.35, 0.50),

            // Negative - Red
            negative: hsla(4.0 / 360.0, 0.70, 0.50, 1.0),
            negative_hover: hsla(4.0 / 360.0, 0.72, 0.55, 1.0),
            negative_subtle: hsla(4.0 / 360.0, 0.65, 0.50, 0.12),
            negative_muted: hsla(4.0 / 360.0, 0.50, 0.45, 0.50),

            // Warning - Yellow
            warning: hsla(40.0 / 360.0, 0.88, 0.48, 1.0),
            warning_hover: hsla(40.0 / 360.0, 0.90, 0.52, 1.0),
            warning_subtle: hsla(40.0 / 360.0, 0.80, 0.48, 0.12),

            // Navigation
            nav_active_indicator: hsla(210.0 / 360.0, 0.90, 0.45, 1.0),
            nav_hover: hsla(220.0 / 360.0, 0.12, 0.90, 1.0),
        }
    }
}
