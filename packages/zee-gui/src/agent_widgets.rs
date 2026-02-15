//! Agent Widgets for Stanley GUI
//!
//! Rich widgets for agent responses including:
//! - Inline chart rendering in agent responses
//! - Interactive data tables with sorting/filtering
//! - Clickable citations linking to research
//! - Expandable tool call details
//! - Code block with syntax highlighting

use crate::components::streaming::{CatppuccinMocha, SyntaxHighlighter};
use crate::theme::Theme;
use gpui::prelude::*;
use gpui::{div, px, Div, FontWeight, Hsla, IntoElement, StyleRefinement, Stateful};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// =============================================================================
// Inline Chart Widget
// =============================================================================

/// Type of inline chart
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InlineChartType {
    Line,
    Bar,
    Sparkline,
    Candlestick,
    Pie,
    Heatmap,
}

/// Data point for charts
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartDataPoint {
    pub label: String,
    pub value: f64,
    pub color: Option<String>,
    pub metadata: Option<HashMap<String, String>>,
}

/// Inline chart configuration
#[derive(Debug, Clone)]
pub struct InlineChart {
    pub id: String,
    pub chart_type: InlineChartType,
    pub title: Option<String>,
    pub data: Vec<ChartDataPoint>,
    pub width: f32,
    pub height: f32,
    pub show_legend: bool,
    pub show_grid: bool,
    pub interactive: bool,
}

impl InlineChart {
    pub fn new(chart_type: InlineChartType, data: Vec<ChartDataPoint>) -> Self {
        Self {
            id: generate_widget_id("chart"),
            chart_type,
            title: None,
            data,
            width: 300.0,
            height: 150.0,
            show_legend: false,
            show_grid: true,
            interactive: true,
        }
    }

    pub fn sparkline(data: Vec<f64>) -> Self {
        let data_points = data
            .into_iter()
            .enumerate()
            .map(|(i, v)| ChartDataPoint {
                label: i.to_string(),
                value: v,
                color: None,
                metadata: None,
            })
            .collect();

        Self {
            chart_type: InlineChartType::Sparkline,
            width: 120.0,
            height: 24.0,
            show_legend: false,
            show_grid: false,
            ..Self::new(InlineChartType::Sparkline, data_points)
        }
    }

    pub fn with_title(mut self, title: &str) -> Self {
        self.title = Some(title.to_string());
        self
    }

    pub fn with_size(mut self, width: f32, height: f32) -> Self {
        self.width = width;
        self.height = height;
        self
    }

    /// Get min and max values for scaling
    fn get_range(&self) -> (f64, f64) {
        let min = self.data.iter().map(|d| d.value).fold(f64::INFINITY, f64::min);
        let max = self.data.iter().map(|d| d.value).fold(f64::NEG_INFINITY, f64::max);
        (min, max)
    }
}

/// Render an inline chart widget
pub fn render_inline_chart<F>(
    theme: &Theme,
    chart: &InlineChart,
    on_point_click: Option<F>,
) -> Div
where
    F: Fn(&ChartDataPoint) + Clone + 'static,
{
    match chart.chart_type {
        InlineChartType::Sparkline => render_sparkline(theme, chart),
        InlineChartType::Bar => render_bar_chart(theme, chart, on_point_click),
        InlineChartType::Line => render_line_chart(theme, chart),
        InlineChartType::Pie => render_pie_chart(theme, chart),
        _ => render_placeholder_chart(theme, chart),
    }
}

/// Render a sparkline chart (compact trend indicator)
fn render_sparkline(theme: &Theme, chart: &InlineChart) -> Div {
    let (min, max) = chart.get_range();
    let range = (max - min).max(0.01);
    let width = chart.width;
    let height = chart.height;
    let point_count = chart.data.len();

    // Determine trend color
    let trend_color = if point_count >= 2 {
        let first = chart.data.first().map(|d| d.value).unwrap_or(0.0);
        let last = chart.data.last().map(|d| d.value).unwrap_or(0.0);
        if last >= first {
            CatppuccinMocha::green()
        } else {
            CatppuccinMocha::red()
        }
    } else {
        CatppuccinMocha::blue()
    };

    div()
        .id(chart.id.clone())
        .w(px(width))
        .h(px(height))
        .flex()
        .items_end()
        .gap(px(1.0))
        .rounded(px(4.0))
        .bg(CatppuccinMocha::surface0().opacity(0.5))
        .overflow_hidden()
        .children(chart.data.iter().enumerate().map(|(i, point)| {
            let normalized = ((point.value - min) / range) as f32;
            let bar_height = (normalized * height * 0.9).max(2.0);

            div()
                .flex_grow()
                .h(px(bar_height))
                .bg(trend_color.opacity(0.6 + (0.4 * (i as f32 / point_count as f32))))
        }))
}

/// Render a bar chart
fn render_bar_chart<F>(
    theme: &Theme,
    chart: &InlineChart,
    on_point_click: Option<F>,
) -> Div
where
    F: Fn(&ChartDataPoint) + Clone + 'static,
{
    let (min, max) = chart.get_range();
    let range = (max - min.min(0.0)).max(0.01);
    let zero_line = if min < 0.0 { (-min / range) as f32 } else { 0.0 };

    div()
        .id(chart.id.clone())
        .w(px(chart.width))
        .flex()
        .flex_col()
        .gap(px(8.0))
        .p(px(12.0))
        .rounded(px(8.0))
        .bg(CatppuccinMocha::surface0())
        .border_1()
        .border_color(CatppuccinMocha::surface1())
        // Title
        .when_some(chart.title.clone(), |el, title| {
            el.child(
                div()
                    .text_size(px(12.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(CatppuccinMocha::text())
                    .child(title)
            )
        })
        // Bars
        .child(
            div()
                .h(px(chart.height))
                .flex()
                .items_end()
                .gap(px(4.0))
                .children(chart.data.iter().map(|point| {
                    let normalized = ((point.value - min.min(0.0)) / range) as f32;
                    let bar_height = (normalized * chart.height * 0.9).max(4.0);
                    let is_positive = point.value >= 0.0;
                    let bar_color = if is_positive {
                        CatppuccinMocha::green()
                    } else {
                        CatppuccinMocha::red()
                    };

                    let callback = on_point_click.clone();
                    let point_clone = point.clone();

                    div()
                        .id(format!("bar-{}", point.label))
                        .flex_grow()
                        .flex()
                        .flex_col()
                        .items_center()
                        .gap(px(4.0))
                        .cursor_pointer()
                        .when_some(callback, |el, cb| {
                            el.on_click(move |_event, _window, _cx| {
                                cb(&point_clone);
                            })
                        })
                        // Bar
                        .child(
                            div()
                                .w_full()
                                .h(px(bar_height))
                                .rounded_t(px(4.0))
                                .bg(bar_color)
                                .hover(|s| s.bg(bar_color.opacity(0.8)))
                        )
                        // Label
                        .child(
                            div()
                                .text_size(px(9.0))
                                .text_color(CatppuccinMocha::overlay1())
                                .child(truncate_label(&point.label, 6))
                        )
                }))
        )
}

/// Render a simple line chart representation
fn render_line_chart(theme: &Theme, chart: &InlineChart) -> Div {
    let (_min, _max) = chart.get_range();

    div()
        .id(chart.id.clone())
        .w(px(chart.width))
        .h(px(chart.height + 40.0))
        .flex()
        .flex_col()
        .gap(px(8.0))
        .p(px(12.0))
        .rounded(px(8.0))
        .bg(CatppuccinMocha::surface0())
        .border_1()
        .border_color(CatppuccinMocha::surface1())
        // Title
        .when_some(chart.title.clone(), |el, title| {
            el.child(
                div()
                    .text_size(px(12.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(CatppuccinMocha::text())
                    .child(title)
            )
        })
        // Chart area (simplified as point plot)
        .child(render_sparkline(theme, chart))
        // Legend
        .when(chart.show_legend && !chart.data.is_empty(), |el| {
            el.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.0))
                    .text_size(px(10.0))
                    .text_color(CatppuccinMocha::subtext0())
                    .child(format!(
                        "Range: {:.2} - {:.2}",
                        chart.data.iter().map(|d| d.value).fold(f64::INFINITY, f64::min),
                        chart.data.iter().map(|d| d.value).fold(f64::NEG_INFINITY, f64::max)
                    ))
            )
        })
}

/// Render a simple pie chart representation
fn render_pie_chart(theme: &Theme, chart: &InlineChart) -> Div {
    let total: f64 = chart.data.iter().map(|d| d.value.abs()).sum();
    let colors = [
        CatppuccinMocha::blue(),
        CatppuccinMocha::green(),
        CatppuccinMocha::peach(),
        CatppuccinMocha::mauve(),
        CatppuccinMocha::yellow(),
        CatppuccinMocha::teal(),
    ];

    div()
        .id(chart.id.clone())
        .w(px(chart.width))
        .flex()
        .flex_col()
        .gap(px(12.0))
        .p(px(12.0))
        .rounded(px(8.0))
        .bg(CatppuccinMocha::surface0())
        .border_1()
        .border_color(CatppuccinMocha::surface1())
        // Title
        .when_some(chart.title.clone(), |el, title| {
            el.child(
                div()
                    .text_size(px(12.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(CatppuccinMocha::text())
                    .child(title)
            )
        })
        // Legend items (since we can't render true circles)
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(6.0))
                .children(chart.data.iter().enumerate().map(|(i, point)| {
                    let color = colors[i % colors.len()];
                    let percent = if total > 0.0 { (point.value / total * 100.0) } else { 0.0 };

                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        // Color indicator
                        .child(
                            div()
                                .size(px(12.0))
                                .rounded(px(3.0))
                                .bg(color)
                        )
                        // Label
                        .child(
                            div()
                                .flex_grow()
                                .text_size(px(11.0))
                                .text_color(CatppuccinMocha::subtext1())
                                .child(point.label.clone())
                        )
                        // Value bar
                        .child(
                            div()
                                .w(px(60.0))
                                .h(px(8.0))
                                .rounded_full()
                                .bg(CatppuccinMocha::surface1())
                                .child(
                                    div()
                                        .h_full()
                                        .rounded_full()
                                        .bg(color)
                                        .w(px((percent as f32 / 100.0 * 60.0).max(2.0)))
                                )
                        )
                        // Percentage
                        .child(
                            div()
                                .w(px(40.0))
                                .text_size(px(10.0))
                                .text_color(CatppuccinMocha::overlay1())
                                .child(format!("{:.1}%", percent))
                        )
                }))
        )
}

/// Render a placeholder for unsupported chart types
fn render_placeholder_chart(theme: &Theme, chart: &InlineChart) -> Div {
    div()
        .id(chart.id.clone())
        .w(px(chart.width))
        .h(px(chart.height))
        .rounded(px(8.0))
        .bg(CatppuccinMocha::surface0())
        .border_1()
        .border_color(CatppuccinMocha::surface1())
        .flex()
        .items_center()
        .justify_center()
        .child(
            div()
                .text_size(px(11.0))
                .text_color(CatppuccinMocha::overlay1())
                .child(format!("{:?} chart", chart.chart_type))
        )
}

// =============================================================================
// Interactive Data Table Widget
// =============================================================================

/// Sort direction for table columns
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SortDirection {
    #[default]
    None,
    Ascending,
    Descending,
}

impl SortDirection {
    pub fn toggle(&self) -> Self {
        match self {
            SortDirection::None => SortDirection::Ascending,
            SortDirection::Ascending => SortDirection::Descending,
            SortDirection::Descending => SortDirection::None,
        }
    }

    pub fn indicator(&self) -> &'static str {
        match self {
            SortDirection::None => "",
            SortDirection::Ascending => " ^",
            SortDirection::Descending => " v",
        }
    }
}

/// Table column definition
#[derive(Debug, Clone)]
pub struct TableColumn {
    pub key: String,
    pub label: String,
    pub width: Option<f32>,
    pub sortable: bool,
    pub align: TextAlign,
}

/// Text alignment for table cells
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TextAlign {
    #[default]
    Left,
    Center,
    Right,
}

/// Interactive data table
#[derive(Debug, Clone)]
pub struct InteractiveTable {
    pub id: String,
    pub columns: Vec<TableColumn>,
    pub rows: Vec<HashMap<String, String>>,
    pub sort_column: Option<String>,
    pub sort_direction: SortDirection,
    pub filter_text: String,
    pub selected_row: Option<usize>,
    pub page_size: usize,
    pub current_page: usize,
    pub striped: bool,
    pub hoverable: bool,
}

impl InteractiveTable {
    pub fn new(columns: Vec<TableColumn>, rows: Vec<HashMap<String, String>>) -> Self {
        Self {
            id: generate_widget_id("table"),
            columns,
            rows,
            sort_column: None,
            sort_direction: SortDirection::None,
            filter_text: String::new(),
            selected_row: None,
            page_size: 10,
            current_page: 0,
            striped: true,
            hoverable: true,
        }
    }

    /// Get filtered and sorted rows
    pub fn get_visible_rows(&self) -> Vec<&HashMap<String, String>> {
        let mut rows: Vec<_> = self.rows.iter()
            .filter(|row| {
                if self.filter_text.is_empty() {
                    return true;
                }
                let filter = self.filter_text.to_lowercase();
                row.values().any(|v| v.to_lowercase().contains(&filter))
            })
            .collect();

        // Sort if needed
        if let Some(sort_col) = &self.sort_column {
            rows.sort_by(|a, b| {
                let a_val = a.get(sort_col).map(|s| s.as_str()).unwrap_or("");
                let b_val = b.get(sort_col).map(|s| s.as_str()).unwrap_or("");

                // Try numeric comparison first
                if let (Ok(a_num), Ok(b_num)) = (a_val.parse::<f64>(), b_val.parse::<f64>()) {
                    match self.sort_direction {
                        SortDirection::Ascending => a_num.partial_cmp(&b_num).unwrap_or(std::cmp::Ordering::Equal),
                        SortDirection::Descending => b_num.partial_cmp(&a_num).unwrap_or(std::cmp::Ordering::Equal),
                        SortDirection::None => std::cmp::Ordering::Equal,
                    }
                } else {
                    match self.sort_direction {
                        SortDirection::Ascending => a_val.cmp(b_val),
                        SortDirection::Descending => b_val.cmp(a_val),
                        SortDirection::None => std::cmp::Ordering::Equal,
                    }
                }
            });
        }

        // Paginate
        let start = self.current_page * self.page_size;
        let end = (start + self.page_size).min(rows.len());
        rows.get(start..end).map(|s| s.to_vec()).unwrap_or_default()
    }

    /// Get total number of pages
    pub fn total_pages(&self) -> usize {
        let filtered_count = self.rows.iter()
            .filter(|row| {
                if self.filter_text.is_empty() { return true; }
                let filter = self.filter_text.to_lowercase();
                row.values().any(|v| v.to_lowercase().contains(&filter))
            })
            .count();
        (filtered_count + self.page_size - 1) / self.page_size
    }
}

/// Render an interactive data table
pub fn render_interactive_table<F, G>(
    theme: &Theme,
    table: &InteractiveTable,
    on_row_click: Option<F>,
    on_sort: Option<G>,
) -> Div
where
    F: Fn(usize, &HashMap<String, String>) + Clone + 'static,
    G: Fn(&str) + Clone + 'static,
{
    let visible_rows = table.get_visible_rows();
    let total_pages = table.total_pages();

    div()
        .id(table.id.clone())
        .flex()
        .flex_col()
        .rounded(px(8.0))
        .bg(CatppuccinMocha::surface0())
        .border_1()
        .border_color(CatppuccinMocha::surface1())
        .overflow_hidden()
        // Header row
        .child(
            div()
                .flex()
                .items_center()
                .bg(CatppuccinMocha::mantle())
                .border_b_1()
                .border_color(CatppuccinMocha::surface1())
                .children(table.columns.iter().map(|col| {
                    let sort_callback = on_sort.clone();
                    let col_key = col.key.clone();
                    let is_sorted = table.sort_column.as_ref() == Some(&col.key);
                    let sort_indicator = if is_sorted {
                        table.sort_direction.indicator()
                    } else {
                        ""
                    };

                    div()
                        .id(format!("th-{}", col.key))
                        .flex_grow()
                        .px(px(12.0))
                        .py(px(10.0))
                        .when_some(col.width, |el, w| el.w(px(w)))
                        .when(col.sortable, |el| {
                            el.cursor_pointer()
                                .hover(|s| s.bg(CatppuccinMocha::surface0()))
                                .when_some(sort_callback, |el, cb| {
                                    el.on_click(move |_event, _window, _cx| {
                                        cb(&col_key);
                                    })
                                })
                        })
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(4.0))
                                .child(
                                    div()
                                        .text_size(px(11.0))
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .text_color(CatppuccinMocha::subtext0())
                                        .child(col.label.clone())
                                )
                                .when(!sort_indicator.is_empty(), |el| {
                                    el.child(
                                        div()
                                            .text_size(px(10.0))
                                            .text_color(CatppuccinMocha::blue())
                                            .child(sort_indicator)
                                    )
                                })
                        )
                }))
        )
        // Data rows
        .child(
            div()
                .flex()
                .flex_col()
                .children(visible_rows.iter().enumerate().map(|(idx, row)| {
                    let row_callback = on_row_click.clone();
                    let row_clone = (*row).clone();
                    let is_striped = table.striped && idx % 2 == 1;
                    let is_selected = table.selected_row == Some(idx);

                    div()
                        .id(format!("row-{}", idx))
                        .flex()
                        .items_center()
                        .bg(if is_selected {
                            CatppuccinMocha::surface1()
                        } else if is_striped {
                            CatppuccinMocha::surface0().opacity(0.5)
                        } else {
                            CatppuccinMocha::surface0().opacity(0.0)
                        })
                        .border_b_1()
                        .border_color(CatppuccinMocha::surface0())
                        .when(table.hoverable, |el| {
                            el.cursor_pointer()
                                .hover(|s| s.bg(CatppuccinMocha::surface1()))
                        })
                        .when_some(row_callback, |el, cb| {
                            el.on_click(move |_event, _window, _cx| {
                                cb(idx, &row_clone);
                            })
                        })
                        .children(table.columns.iter().map(|col| {
                            let value = row.get(&col.key).cloned().unwrap_or_default();
                            let is_numeric = value.parse::<f64>().is_ok();
                            let is_negative = value.starts_with('-');

                            div()
                                .flex_grow()
                                .px(px(12.0))
                                .py(px(8.0))
                                .when_some(col.width, |el, w| el.w(px(w)))
                                .child(
                                    div()
                                        .text_size(px(12.0))
                                        .text_color(if is_numeric && is_negative {
                                            CatppuccinMocha::red()
                                        } else if is_numeric {
                                            CatppuccinMocha::text()
                                        } else {
                                            CatppuccinMocha::subtext1()
                                        })
                                        .child(value)
                                )
                        }))
                }))
        )
        // Pagination footer
        .when(total_pages > 1, |el| {
            el.child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .px(px(12.0))
                    .py(px(8.0))
                    .bg(CatppuccinMocha::mantle())
                    .border_t_1()
                    .border_color(CatppuccinMocha::surface1())
                    .child(
                        div()
                            .text_size(px(11.0))
                            .text_color(CatppuccinMocha::overlay1())
                            .child(format!("Page {} of {}", table.current_page + 1, total_pages))
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(4.0))
                            .child(render_page_button(theme, "<", table.current_page > 0))
                            .child(render_page_button(theme, ">", table.current_page < total_pages - 1))
                    )
            )
        })
}

fn render_page_button(theme: &Theme, label: &str, enabled: bool) -> Div {
    div()
        .px(px(10.0))
        .py(px(4.0))
        .rounded(px(4.0))
        .bg(if enabled {
            CatppuccinMocha::surface1()
        } else {
            CatppuccinMocha::surface0()
        })
        .when(enabled, |el| {
            el.cursor_pointer()
                .hover(|s| s.bg(CatppuccinMocha::surface2()))
        })
        .child(
            div()
                .text_size(px(11.0))
                .text_color(if enabled {
                    CatppuccinMocha::text()
                } else {
                    CatppuccinMocha::overlay0()
                })
                .child(label.to_string())
        )
}

// =============================================================================
// Clickable Citation Widget
// =============================================================================

/// Citation source type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CitationSource {
    SECFiling,
    EarningsCall,
    NewsArticle,
    ResearchReport,
    CompanyWebsite,
    DataProvider,
    Other,
}

impl CitationSource {
    pub fn label(&self) -> &'static str {
        match self {
            CitationSource::SECFiling => "SEC Filing",
            CitationSource::EarningsCall => "Earnings Call",
            CitationSource::NewsArticle => "News",
            CitationSource::ResearchReport => "Research",
            CitationSource::CompanyWebsite => "Company",
            CitationSource::DataProvider => "Data",
            CitationSource::Other => "Source",
        }
    }

    pub fn icon(&self) -> &'static str {
        match self {
            CitationSource::SECFiling => "S",
            CitationSource::EarningsCall => "E",
            CitationSource::NewsArticle => "N",
            CitationSource::ResearchReport => "R",
            CitationSource::CompanyWebsite => "C",
            CitationSource::DataProvider => "D",
            CitationSource::Other => "*",
        }
    }

    pub fn color(&self) -> Hsla {
        match self {
            CitationSource::SECFiling => CatppuccinMocha::blue(),
            CitationSource::EarningsCall => CatppuccinMocha::green(),
            CitationSource::NewsArticle => CatppuccinMocha::peach(),
            CitationSource::ResearchReport => CatppuccinMocha::mauve(),
            CitationSource::CompanyWebsite => CatppuccinMocha::teal(),
            CitationSource::DataProvider => CatppuccinMocha::yellow(),
            CitationSource::Other => CatppuccinMocha::overlay1(),
        }
    }
}

/// Citation reference
#[derive(Debug, Clone)]
pub struct Citation {
    pub id: String,
    pub source: CitationSource,
    pub title: String,
    pub url: Option<String>,
    pub date: Option<String>,
    pub snippet: Option<String>,
    pub relevance_score: Option<f32>,
}

impl Citation {
    pub fn new(source: CitationSource, title: &str) -> Self {
        Self {
            id: generate_widget_id("cite"),
            source,
            title: title.to_string(),
            url: None,
            date: None,
            snippet: None,
            relevance_score: None,
        }
    }

    pub fn with_url(mut self, url: &str) -> Self {
        self.url = Some(url.to_string());
        self
    }

    pub fn with_date(mut self, date: &str) -> Self {
        self.date = Some(date.to_string());
        self
    }

    pub fn with_snippet(mut self, snippet: &str) -> Self {
        self.snippet = Some(snippet.to_string());
        self
    }
}

/// Render a clickable citation badge (inline)
pub fn render_citation_badge<F>(
    _theme: &Theme,
    citation: &Citation,
    on_click: F,
) -> impl IntoElement
where
    F: Fn(&Citation) + 'static,
{
    let color = citation.source.color();
    let citation_clone = citation.clone();

    div()
        .id(citation.id.clone())
        .flex()
        .items_center()
        .gap(px(4.0))
        .px(px(6.0))
        .py(px(2.0))
        .rounded(px(4.0))
        .bg(color.opacity(0.12))
        .border_1()
        .border_color(color.opacity(0.25))
        .cursor_pointer()
        .hover(|s: &mut StyleRefinement| {
            s.background = Some(color.opacity(0.2).into());
        })
        .on_click(move |_event, _window, _cx| {
            on_click(&citation_clone);
        })
        .child(
            div()
                .text_size(px(9.0))
                .font_weight(FontWeight::BOLD)
                .text_color(color)
                .child(citation.source.icon())
        )
        .child(
            div()
                .text_size(px(10.0))
                .text_color(CatppuccinMocha::subtext0())
                .child(truncate_label(&citation.title, 20))
        )
}

/// Render a full citation card (expanded view)
pub fn render_citation_card<F>(
    theme: &Theme,
    citation: &Citation,
    on_click: F,
) -> Div
where
    F: Fn(&Citation) + 'static,
{
    let color = citation.source.color();
    let citation_clone = citation.clone();

    div()
        .id(citation.id.clone())
        .w_full()
        .p(px(12.0))
        .rounded(px(8.0))
        .bg(CatppuccinMocha::surface0())
        .border_1()
        .border_color(CatppuccinMocha::surface1())
        .cursor_pointer()
        .hover(|s| s.border_color(color.opacity(0.5)))
        .on_click(move |_event, _window, _cx| {
            on_click(&citation_clone);
        })
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                // Header
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        // Source badge
                        .child(
                            div()
                                .px(px(6.0))
                                .py(px(2.0))
                                .rounded(px(4.0))
                                .bg(color.opacity(0.15))
                                .child(
                                    div()
                                        .text_size(px(9.0))
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .text_color(color)
                                        .child(citation.source.label())
                                )
                        )
                        // Date
                        .when_some(citation.date.clone(), |el, date| {
                            el.child(
                                div()
                                    .text_size(px(10.0))
                                    .text_color(CatppuccinMocha::overlay1())
                                    .child(date)
                            )
                        })
                )
                // Title
                .child(
                    div()
                        .text_size(px(12.0))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(CatppuccinMocha::text())
                        .child(citation.title.clone())
                )
                // Snippet
                .when_some(citation.snippet.clone(), |el, snippet| {
                    el.child(
                        div()
                            .text_size(px(11.0))
                            .text_color(CatppuccinMocha::subtext0())
                            .child(truncate_label(&snippet, 120))
                    )
                })
        )
}

// =============================================================================
// Expandable Tool Call Details Widget
// =============================================================================

/// Tool call state for expandable details
#[derive(Debug, Clone)]
pub struct ExpandableToolCall {
    pub id: String,
    pub name: String,
    pub status: ToolCallStatus,
    pub arguments: String,
    pub result: Option<String>,
    pub duration_ms: Option<u64>,
    pub expanded: bool,
    pub error: Option<String>,
}

/// Tool call execution status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolCallStatus {
    Pending,
    Running,
    Success,
    Failed,
}

impl ToolCallStatus {
    pub fn label(&self) -> &'static str {
        match self {
            ToolCallStatus::Pending => "Pending",
            ToolCallStatus::Running => "Running",
            ToolCallStatus::Success => "Success",
            ToolCallStatus::Failed => "Failed",
        }
    }

    pub fn color(&self) -> Hsla {
        match self {
            ToolCallStatus::Pending => CatppuccinMocha::overlay1(),
            ToolCallStatus::Running => CatppuccinMocha::blue(),
            ToolCallStatus::Success => CatppuccinMocha::green(),
            ToolCallStatus::Failed => CatppuccinMocha::red(),
        }
    }
}

impl ExpandableToolCall {
    pub fn new(name: &str, arguments: &str) -> Self {
        Self {
            id: generate_widget_id("tool"),
            name: name.to_string(),
            status: ToolCallStatus::Pending,
            arguments: arguments.to_string(),
            result: None,
            duration_ms: None,
            expanded: false,
            error: None,
        }
    }

    pub fn toggle_expanded(&mut self) {
        self.expanded = !self.expanded;
    }
}

/// Render an expandable tool call widget
pub fn render_expandable_tool_call<F>(
    theme: &Theme,
    tool_call: &ExpandableToolCall,
    on_toggle: F,
) -> Div
where
    F: Fn() + 'static,
{
    let color = tool_call.status.color();

    div()
        .id(tool_call.id.clone())
        .w_full()
        .rounded(px(8.0))
        .bg(CatppuccinMocha::surface0())
        .border_1()
        .border_color(CatppuccinMocha::surface1())
        .overflow_hidden()
        // Header (always visible)
        .child(
            div()
                .id(format!("{}-header", tool_call.id))
                .flex()
                .items_center()
                .justify_between()
                .px(px(12.0))
                .py(px(10.0))
                .cursor_pointer()
                .hover(|s| s.bg(CatppuccinMocha::surface1()))
                .on_click(move |_event, _window, _cx| {
                    on_toggle();
                })
                // Left side: icon + name
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(10.0))
                        // Status indicator
                        .child(
                            div()
                                .size(px(24.0))
                                .rounded(px(6.0))
                                .bg(color.opacity(0.15))
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(
                                    div()
                                        .text_size(px(10.0))
                                        .font_weight(FontWeight::BOLD)
                                        .text_color(color)
                                        .child("T")
                                )
                        )
                        // Tool name
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(2.0))
                                .child(
                                    div()
                                        .text_size(px(12.0))
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(CatppuccinMocha::text())
                                        .child(tool_call.name.clone())
                                )
                                .when_some(tool_call.duration_ms, |el, ms| {
                                    el.child(
                                        div()
                                            .text_size(px(10.0))
                                            .text_color(CatppuccinMocha::overlay1())
                                            .child(format!("{}ms", ms))
                                    )
                                })
                        )
                )
                // Right side: status + expand icon
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        // Status badge
                        .child(
                            div()
                                .px(px(8.0))
                                .py(px(3.0))
                                .rounded(px(4.0))
                                .bg(color.opacity(0.15))
                                .child(
                                    div()
                                        .text_size(px(10.0))
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(color)
                                        .child(tool_call.status.label())
                                )
                        )
                        // Expand indicator
                        .child(
                            div()
                                .text_size(px(12.0))
                                .text_color(CatppuccinMocha::overlay1())
                                .child(if tool_call.expanded { "v" } else { ">" })
                        )
                )
        )
        // Expanded content
        .when(tool_call.expanded, |el| {
            el.child(
                div()
                    .px(px(12.0))
                    .py(px(10.0))
                    .border_t_1()
                    .border_color(CatppuccinMocha::surface1())
                    .flex()
                    .flex_col()
                    .gap(px(12.0))
                    // Arguments section
                    .child(render_code_section("Arguments", &tool_call.arguments))
                    // Result section
                    .when_some(tool_call.result.clone(), |el, result| {
                        el.child(render_code_section("Result", &result))
                    })
                    // Error section
                    .when_some(tool_call.error.clone(), |el, error| {
                        el.child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(4.0))
                                .child(
                                    div()
                                        .text_size(px(10.0))
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .text_color(CatppuccinMocha::red())
                                        .child("Error")
                                )
                                .child(
                                    div()
                                        .p(px(8.0))
                                        .rounded(px(6.0))
                                        .bg(CatppuccinMocha::red().opacity(0.1))
                                        .border_1()
                                        .border_color(CatppuccinMocha::red().opacity(0.2))
                                        .child(
                                            div()
                                                .text_size(px(11.0))
                                                .text_color(CatppuccinMocha::red())
                                                .child(error)
                                        )
                                )
                        )
                    })
            )
        })
}

fn render_code_section(label: &str, code: &str) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(4.0))
        .child(
            div()
                .text_size(px(10.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(CatppuccinMocha::overlay0())
                .child(label.to_string())
        )
        .child(
            div()
                .p(px(8.0))
                .rounded(px(6.0))
                .bg(CatppuccinMocha::mantle())
                .overflow_x_scroll()
                .child(
                    div()
                        .text_size(px(11.0))
                        .font_family("monospace")
                        .text_color(CatppuccinMocha::subtext1())
                        .child(code.to_string())
                )
        )
}

// =============================================================================
// Syntax Highlighted Code Block Widget
// =============================================================================

/// Syntax highlighted code block with features
#[derive(Debug, Clone)]
pub struct CodeBlock {
    pub id: String,
    pub language: Option<String>,
    pub code: String,
    pub show_line_numbers: bool,
    pub highlight_lines: Vec<usize>,
    pub collapsible: bool,
    pub collapsed: bool,
    pub max_height: Option<f32>,
}

impl CodeBlock {
    pub fn new(code: &str) -> Self {
        Self {
            id: generate_widget_id("code"),
            language: None,
            code: code.to_string(),
            show_line_numbers: true,
            highlight_lines: Vec::new(),
            collapsible: false,
            collapsed: false,
            max_height: None,
        }
    }

    pub fn with_language(mut self, language: &str) -> Self {
        self.language = Some(language.to_string());
        self
    }

    pub fn with_line_numbers(mut self, show: bool) -> Self {
        self.show_line_numbers = show;
        self
    }

    pub fn with_max_height(mut self, height: f32) -> Self {
        self.max_height = Some(height);
        self
    }

    pub fn collapsible(mut self) -> Self {
        self.collapsible = true;
        self
    }
}

/// Render a syntax highlighted code block
pub fn render_code_block<F>(
    theme: &Theme,
    block: &CodeBlock,
    on_copy: Option<F>,
) -> Div
where
    F: Fn(&str) + 'static,
{
    let lines: Vec<&str> = block.code.lines().collect();
    let code_clone = block.code.clone();

    div()
        .id(block.id.clone())
        .w_full()
        .rounded(px(8.0))
        .bg(CatppuccinMocha::mantle())
        .border_1()
        .border_color(CatppuccinMocha::surface1())
        .overflow_hidden()
        // Header
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .px(px(12.0))
                .py(px(8.0))
                .bg(CatppuccinMocha::surface0())
                .border_b_1()
                .border_color(CatppuccinMocha::surface1())
                // Language badge
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        // Window buttons (decoration)
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(4.0))
                                .child(div().size(px(10.0)).rounded_full().bg(CatppuccinMocha::red()))
                                .child(div().size(px(10.0)).rounded_full().bg(CatppuccinMocha::yellow()))
                                .child(div().size(px(10.0)).rounded_full().bg(CatppuccinMocha::green()))
                        )
                        .child(
                            div()
                                .text_size(px(11.0))
                                .text_color(CatppuccinMocha::overlay1())
                                .child(block.language.clone().unwrap_or_else(|| "code".to_string()))
                        )
                )
                // Copy button
                .when_some(on_copy, |el, copy_fn| {
                    el.child(
                        div()
                            .id(format!("{}-copy", block.id))
                            .px(px(8.0))
                            .py(px(4.0))
                            .rounded(px(4.0))
                            .bg(CatppuccinMocha::surface1())
                            .cursor_pointer()
                            .hover(|s| s.bg(CatppuccinMocha::surface2()))
                            .on_click(move |_event, _window, _cx| {
                                copy_fn(&code_clone);
                            })
                            .child(
                                div()
                                    .text_size(px(10.0))
                                    .text_color(CatppuccinMocha::subtext0())
                                    .child("Copy")
                            )
                    )
                })
        )
        // Code content
        .child(
            div()
                .flex()
                .when_some(block.max_height, |el, h| {
                    el.max_h(px(h)).overflow_y_scroll()
                })
                // Line numbers column
                .when(block.show_line_numbers, |el| {
                    el.child(
                        div()
                            .flex()
                            .flex_col()
                            .py(px(8.0))
                            .px(px(8.0))
                            .bg(CatppuccinMocha::crust())
                            .children(lines.iter().enumerate().map(|(i, _)| {
                                div()
                                    .text_size(px(11.0))
                                    .font_family("monospace")
                                    .text_color(CatppuccinMocha::overlay0())
                                    .child(format!("{}", i + 1))
                            }))
                    )
                })
                // Code column
                .child(
                    div()
                        .flex_grow()
                        .flex()
                        .flex_col()
                        .py(px(8.0))
                        .px(px(12.0))
                        .overflow_x_scroll()
                        .children(lines.iter().enumerate().map(|(i, line)| {
                            let is_highlighted = block.highlight_lines.contains(&(i + 1));
                            let tokens = SyntaxHighlighter::highlight_line(line, block.language.as_deref());

                            div()
                                .flex()
                                .items_center()
                                .w_full()
                                .when(is_highlighted, |el| {
                                    el.bg(CatppuccinMocha::yellow().opacity(0.1))
                                })
                                .child(
                                    div()
                                        .flex()
                                        .children(tokens.into_iter().map(|token| {
                                            div()
                                                .text_size(px(12.0))
                                                .font_family("monospace")
                                                .text_color(token.token_type.color())
                                                .child(token.text)
                                        }))
                                )
                        }))
                )
        )
}

// =============================================================================
// Utility Functions
// =============================================================================

/// Generate unique widget ID
fn generate_widget_id(prefix: &str) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}-{:x}-{:x}", prefix, now.as_secs(), now.subsec_nanos())
}

/// Truncate label text
fn truncate_label(text: &str, max_len: usize) -> String {
    if text.len() <= max_len {
        text.to_string()
    } else {
        format!("{}...", &text[..max_len.saturating_sub(3)])
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inline_chart_creation() {
        let data = vec![
            ChartDataPoint {
                label: "A".to_string(),
                value: 10.0,
                color: None,
                metadata: None,
            },
            ChartDataPoint {
                label: "B".to_string(),
                value: 20.0,
                color: None,
                metadata: None,
            },
        ];
        let chart = InlineChart::new(InlineChartType::Bar, data);
        assert_eq!(chart.data.len(), 2);
        assert!(!chart.id.is_empty());
    }

    #[test]
    fn test_sparkline_creation() {
        let data = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let chart = InlineChart::sparkline(data);
        assert_eq!(chart.chart_type, InlineChartType::Sparkline);
        assert_eq!(chart.data.len(), 5);
    }

    #[test]
    fn test_interactive_table() {
        let columns = vec![
            TableColumn {
                key: "name".to_string(),
                label: "Name".to_string(),
                width: None,
                sortable: true,
                align: TextAlign::Left,
            },
        ];
        let mut rows = Vec::new();
        let mut row = HashMap::new();
        row.insert("name".to_string(), "Test".to_string());
        rows.push(row);

        let table = InteractiveTable::new(columns, rows);
        assert_eq!(table.get_visible_rows().len(), 1);
    }

    #[test]
    fn test_citation_creation() {
        let citation = Citation::new(CitationSource::SECFiling, "10-K Filing")
            .with_url("https://sec.gov/...")
            .with_date("2024-01-15");

        assert!(citation.url.is_some());
        assert!(citation.date.is_some());
    }

    #[test]
    fn test_code_block() {
        let block = CodeBlock::new("let x = 42;")
            .with_language("rust")
            .with_line_numbers(true);

        assert_eq!(block.language, Some("rust".to_string()));
        assert!(block.show_line_numbers);
    }

    #[test]
    fn test_sort_direction_toggle() {
        assert_eq!(SortDirection::None.toggle(), SortDirection::Ascending);
        assert_eq!(SortDirection::Ascending.toggle(), SortDirection::Descending);
        assert_eq!(SortDirection::Descending.toggle(), SortDirection::None);
    }
}
