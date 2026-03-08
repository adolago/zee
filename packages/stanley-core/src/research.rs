//! Deterministic research payload generation for the Stanley HTTP runtime.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{hash_map::DefaultHasher, BTreeMap};
use std::hash::{Hash, Hasher};

type JsonMap = BTreeMap<String, Value>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValueRange {
    pub low: f64,
    pub high: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchReport {
    pub symbol: String,
    pub company_name: String,
    pub sector: String,
    pub industry: String,
    pub current_price: f64,
    pub market_cap: f64,
    pub valuation: JsonMap,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dcf: Option<JsonMap>,
    pub fair_value_range: ValueRange,
    pub valuation_rating: String,
    pub earnings: JsonMap,
    pub earnings_quality_score: f64,
    pub revenue_growth5yr: f64,
    pub eps_growth5yr: f64,
    pub gross_margin: f64,
    pub operating_margin: f64,
    pub net_margin: f64,
    pub roe: f64,
    pub roic: f64,
    pub debt_to_equity: f64,
    pub current_ratio: f64,
    pub overall_score: f64,
    pub strengths: Vec<String>,
    pub weaknesses: Vec<String>,
    pub catalysts: Vec<String>,
    pub risks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValuationData {
    pub symbol: String,
    pub method: String,
    pub valuation: JsonMap,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dcf: Option<JsonMap>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sensitivity: Option<JsonMap>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fair_value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_price: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upside_percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assumptions: Option<JsonMap>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EarningsAnalysis {
    pub symbol: String,
    pub quarters: Vec<JsonMap>,
    pub eps_growth_yoy: f64,
    pub eps_growth3yr_cagr: f64,
    pub avg_eps_surprise_percent: f64,
    pub beat_rate: f64,
    pub consecutive_beats: u32,
    pub earnings_volatility: f64,
    pub earnings_consistency: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerComparison {
    pub target: JsonMap,
    pub peer_averages: BTreeMap<String, f64>,
    pub premium_discount: BTreeMap<String, f64>,
    pub peers: Vec<JsonMap>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fair_value_range: Option<ValueRange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DcfPayload {
    pub intrinsic_value: f64,
    pub current_price: f64,
    pub upside_percentage: f64,
    pub margin_of_safety: f64,
    pub discount_rate: f64,
    pub terminal_growth_rate: f64,
    pub projection_years: u32,
    pub pv_cash_flows: f64,
    pub pv_terminal_value: f64,
    pub net_debt: f64,
    pub shares_outstanding: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DcfResult {
    pub symbol: String,
    pub dcf: DcfPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sensitivity: Option<JsonMap>,
    pub assumptions: JsonMap,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchSummary {
    pub symbol: String,
    pub company_name: String,
    pub sector: String,
    pub industry: String,
    pub current_price: f64,
    pub market_cap: f64,
    pub valuation_rating: String,
    pub overall_score: f64,
    pub key_metrics: BTreeMap<String, Option<f64>>,
    pub growth: BTreeMap<String, f64>,
    pub margins: BTreeMap<String, f64>,
    pub fair_value_range: ValueRange,
    pub top_strengths: Vec<String>,
    pub top_risks: Vec<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct DcfOptions {
    pub discount_rate: f64,
    pub terminal_growth: f64,
    pub projection_years: u32,
}

impl Default for DcfOptions {
    fn default() -> Self {
        Self {
            discount_rate: 0.10,
            terminal_growth: 0.025,
            projection_years: 5,
        }
    }
}

pub fn build_report(symbol: &str) -> ResearchReport {
    let profile = SymbolProfile::new(symbol);
    let dcf = build_dcf(symbol, DcfOptions::default());

    ResearchReport {
        symbol: profile.symbol.clone(),
        company_name: profile.company_name(),
        sector: profile.sector().to_string(),
        industry: profile.industry().to_string(),
        current_price: profile.current_price,
        market_cap: profile.market_cap,
        valuation: object(vec![
            ("forwardPe", json!(profile.forward_pe)),
            ("evToEbitda", json!(profile.ev_to_ebitda)),
            ("priceToSales", json!(profile.price_to_sales)),
            ("freeCashFlowYield", json!(profile.free_cash_flow_yield)),
            ("qualityScore", json!(profile.quality_score)),
        ]),
        dcf: Some(object(vec![
            ("intrinsicValue", json!(dcf.dcf.intrinsic_value)),
            ("currentPrice", json!(dcf.dcf.current_price)),
            ("upsidePercentage", json!(dcf.dcf.upside_percentage)),
        ])),
        fair_value_range: profile.fair_value_range(),
        valuation_rating: profile.valuation_rating(),
        earnings: object(vec![
            ("nextQuarterEps", json!(profile.next_quarter_eps)),
            ("nextQuarterRevenue", json!(profile.next_quarter_revenue)),
            (
                "lastQuarterSurprisePercent",
                json!(profile.last_quarter_surprise),
            ),
            ("fiscalYear", json!(2026)),
        ]),
        earnings_quality_score: profile.earnings_quality_score,
        revenue_growth5yr: profile.revenue_growth5yr,
        eps_growth5yr: profile.eps_growth5yr,
        gross_margin: profile.gross_margin,
        operating_margin: profile.operating_margin,
        net_margin: profile.net_margin,
        roe: profile.roe,
        roic: profile.roic,
        debt_to_equity: profile.debt_to_equity,
        current_ratio: profile.current_ratio,
        overall_score: profile.overall_score,
        strengths: profile.strengths(),
        weaknesses: profile.weaknesses(),
        catalysts: profile.catalysts(),
        risks: profile.risks(),
    }
}

pub fn build_summary(symbol: &str) -> ResearchSummary {
    let report = build_report(symbol);

    ResearchSummary {
        symbol: report.symbol.clone(),
        company_name: report.company_name.clone(),
        sector: report.sector.clone(),
        industry: report.industry.clone(),
        current_price: report.current_price,
        market_cap: report.market_cap,
        valuation_rating: report.valuation_rating.clone(),
        overall_score: report.overall_score,
        key_metrics: BTreeMap::from([
            (
                "forwardPe".to_string(),
                Some(number_from_map(&report.valuation, "forwardPe")),
            ),
            (
                "evToEbitda".to_string(),
                Some(number_from_map(&report.valuation, "evToEbitda")),
            ),
            (
                "freeCashFlowYield".to_string(),
                Some(number_from_map(&report.valuation, "freeCashFlowYield")),
            ),
            ("roe".to_string(), Some(report.roe)),
            ("roic".to_string(), Some(report.roic)),
        ]),
        growth: BTreeMap::from([
            ("revenue5yr".to_string(), report.revenue_growth5yr),
            ("eps5yr".to_string(), report.eps_growth5yr),
        ]),
        margins: BTreeMap::from([
            ("gross".to_string(), report.gross_margin),
            ("operating".to_string(), report.operating_margin),
            ("net".to_string(), report.net_margin),
        ]),
        fair_value_range: report.fair_value_range,
        top_strengths: report.strengths.into_iter().take(3).collect(),
        top_risks: report.risks.into_iter().take(3).collect(),
    }
}

pub fn build_valuation(symbol: &str, include_dcf: bool) -> ValuationData {
    let profile = SymbolProfile::new(symbol);
    let dcf = build_dcf(symbol, DcfOptions::default());
    let upside_percent =
        round2(((dcf.dcf.intrinsic_value - profile.current_price) / profile.current_price) * 100.0);

    ValuationData {
        symbol: profile.symbol.clone(),
        method: "deterministic_core_model".to_string(),
        valuation: object(vec![
            ("forwardPe", json!(profile.forward_pe)),
            ("evToEbitda", json!(profile.ev_to_ebitda)),
            ("priceToSales", json!(profile.price_to_sales)),
            ("fairValueLow", json!(profile.fair_value_range().low)),
            ("fairValueHigh", json!(profile.fair_value_range().high)),
        ]),
        dcf: include_dcf.then(|| {
            object(vec![
                ("intrinsicValue", json!(dcf.dcf.intrinsic_value)),
                ("marginOfSafety", json!(dcf.dcf.margin_of_safety)),
                ("discountRate", json!(dcf.dcf.discount_rate)),
            ])
        }),
        sensitivity: include_dcf.then(|| {
            object(vec![
                (
                    "discountRate",
                    json!([
                        {"value": round2(dcf.dcf.discount_rate - 0.01), "intrinsicValue": round2(dcf.dcf.intrinsic_value * 1.06)},
                        {"value": round2(dcf.dcf.discount_rate), "intrinsicValue": dcf.dcf.intrinsic_value},
                        {"value": round2(dcf.dcf.discount_rate + 0.01), "intrinsicValue": round2(dcf.dcf.intrinsic_value * 0.94)},
                    ]),
                ),
            ])
        }),
        fair_value: Some(round2((profile.fair_value_range().low + profile.fair_value_range().high) / 2.0)),
        current_price: Some(profile.current_price),
        upside_percent: Some(upside_percent),
        assumptions: Some(object(vec![
            ("currency", json!("USD")),
            ("modelVersion", json!("stanley-core-minimal")),
            ("deterministic", json!(true)),
        ])),
    }
}

pub fn build_earnings(symbol: &str, quarters: usize) -> EarningsAnalysis {
    let profile = SymbolProfile::new(symbol);
    let quarter_count = quarters.max(1).min(20);
    let mut items = Vec::with_capacity(quarter_count);

    for index in 0..quarter_count {
        let revenue = round2(profile.next_quarter_revenue * (1.0 - (index as f64 * 0.018)));
        let eps = round2(profile.next_quarter_eps * (1.0 - (index as f64 * 0.022)));
        let surprise = round2(profile.last_quarter_surprise - (index as f64 * 0.35));
        items.push(object(vec![
            (
                "quarter",
                json!(format!("Q{} FY{}", 4 - (index % 4), 2026 - (index / 4))),
            ),
            ("revenue", json!(revenue)),
            ("eps", json!(eps)),
            ("surprisePercent", json!(surprise)),
        ]));
    }

    EarningsAnalysis {
        symbol: profile.symbol.clone(),
        quarters: items,
        eps_growth_yoy: profile.eps_growth5yr,
        eps_growth3yr_cagr: round2(profile.eps_growth5yr * 0.82),
        avg_eps_surprise_percent: round2(profile.last_quarter_surprise * 0.73),
        beat_rate: round2(55.0 + profile.fraction(16.0)),
        consecutive_beats: (2 + (profile.seed % 5)) as u32,
        earnings_volatility: round2(8.0 + profile.fraction(14.0)),
        earnings_consistency: round2(68.0 + profile.fraction(20.0)),
    }
}

pub fn build_peers(symbol: &str, peers: Option<&str>) -> PeerComparison {
    let profile = SymbolProfile::new(symbol);
    let peer_symbols = if let Some(peers) = peers {
        peers
            .split(',')
            .map(|value| sanitize_symbol(value))
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
    } else {
        default_peers(&profile.symbol)
    };

    let peer_profiles = peer_symbols
        .iter()
        .map(|peer| SymbolProfile::new(peer))
        .collect::<Vec<_>>();

    let averages = BTreeMap::from([
        (
            "forwardPe".to_string(),
            round2(avg(peer_profiles.iter().map(|profile| profile.forward_pe))),
        ),
        (
            "evToEbitda".to_string(),
            round2(avg(peer_profiles
                .iter()
                .map(|profile| profile.ev_to_ebitda))),
        ),
        (
            "priceToSales".to_string(),
            round2(avg(peer_profiles
                .iter()
                .map(|profile| profile.price_to_sales))),
        ),
        (
            "freeCashFlowYield".to_string(),
            round2(avg(peer_profiles
                .iter()
                .map(|profile| profile.free_cash_flow_yield))),
        ),
    ]);

    let premium_discount = BTreeMap::from([
        (
            "forwardPe".to_string(),
            premium_discount(profile.forward_pe, averages["forwardPe"]),
        ),
        (
            "evToEbitda".to_string(),
            premium_discount(profile.ev_to_ebitda, averages["evToEbitda"]),
        ),
        (
            "priceToSales".to_string(),
            premium_discount(profile.price_to_sales, averages["priceToSales"]),
        ),
    ]);

    PeerComparison {
        target: object(vec![
            ("symbol", json!(profile.symbol)),
            ("companyName", json!(profile.company_name())),
            ("forwardPe", json!(profile.forward_pe)),
            ("evToEbitda", json!(profile.ev_to_ebitda)),
            ("priceToSales", json!(profile.price_to_sales)),
        ]),
        peer_averages: averages,
        premium_discount,
        peers: peer_profiles
            .into_iter()
            .map(|peer| {
                object(vec![
                    ("symbol", json!(peer.symbol)),
                    ("companyName", json!(peer.company_name())),
                    ("forwardPe", json!(peer.forward_pe)),
                    ("evToEbitda", json!(peer.ev_to_ebitda)),
                    ("priceToSales", json!(peer.price_to_sales)),
                    ("sector", json!(peer.sector())),
                ])
            })
            .collect(),
        fair_value_range: Some(profile.fair_value_range()),
    }
}

pub fn build_dcf(symbol: &str, options: DcfOptions) -> DcfResult {
    let profile = SymbolProfile::new(symbol);
    let discount_rate = options.discount_rate.clamp(0.03, 0.30);
    let terminal_growth = options.terminal_growth.clamp(0.0, 0.08);
    let projection_years = options.projection_years.clamp(3, 10);

    let cash_flow_base = profile.market_cap * 0.045;
    let pv_cash_flows =
        round2(cash_flow_base * (1.0 + profile.revenue_growth5yr / 100.0) / (1.0 + discount_rate));
    let pv_terminal_value = round2(
        cash_flow_base * (1.0 + terminal_growth) * 8.0
            / (1.0 + discount_rate).powi(projection_years as i32),
    );
    let net_debt = round2(profile.market_cap * (0.08 + profile.fraction(0.06) / 100.0));
    let shares_outstanding = round2((profile.market_cap / profile.current_price) / 1_000_000.0);
    let intrinsic_value =
        round2(((pv_cash_flows + pv_terminal_value - net_debt) / shares_outstanding).max(1.0));
    let upside_percentage =
        round2(((intrinsic_value - profile.current_price) / profile.current_price) * 100.0);

    DcfResult {
        symbol: profile.symbol.clone(),
        dcf: DcfPayload {
            intrinsic_value,
            current_price: profile.current_price,
            upside_percentage,
            margin_of_safety: round2(((intrinsic_value / profile.current_price) - 1.0) * 100.0),
            discount_rate: round4(discount_rate),
            terminal_growth_rate: round4(terminal_growth),
            projection_years,
            pv_cash_flows,
            pv_terminal_value,
            net_debt,
            shares_outstanding,
        },
        sensitivity: Some(object(vec![(
            "terminalGrowth",
            json!([
                {"value": round4((terminal_growth - 0.005).max(0.0)), "intrinsicValue": round2(intrinsic_value * 0.96)},
                {"value": round4(terminal_growth), "intrinsicValue": intrinsic_value},
                {"value": round4((terminal_growth + 0.005).min(0.08)), "intrinsicValue": round2(intrinsic_value * 1.04)},
            ]),
        )])),
        assumptions: object(vec![
            ("discountRate", json!(round4(discount_rate))),
            ("terminalGrowth", json!(round4(terminal_growth))),
            ("projectionYears", json!(projection_years)),
            ("deterministic", json!(true)),
        ]),
    }
}

#[derive(Debug, Clone)]
struct SymbolProfile {
    symbol: String,
    seed: u64,
    current_price: f64,
    market_cap: f64,
    forward_pe: f64,
    ev_to_ebitda: f64,
    price_to_sales: f64,
    free_cash_flow_yield: f64,
    quality_score: f64,
    earnings_quality_score: f64,
    revenue_growth5yr: f64,
    eps_growth5yr: f64,
    gross_margin: f64,
    operating_margin: f64,
    net_margin: f64,
    roe: f64,
    roic: f64,
    debt_to_equity: f64,
    current_ratio: f64,
    overall_score: f64,
    next_quarter_eps: f64,
    next_quarter_revenue: f64,
    last_quarter_surprise: f64,
}

impl SymbolProfile {
    fn new(symbol: &str) -> Self {
        let symbol = sanitize_symbol(symbol);
        let seed = symbol_seed(&symbol);

        Self {
            symbol,
            seed,
            current_price: round2(25.0 + scaled(seed, 0, 0.0, 225.0)),
            market_cap: round2(5_000_000_000.0 + scaled(seed, 1, 0.0, 850_000_000_000.0)),
            forward_pe: round2(8.0 + scaled(seed, 2, 0.0, 26.0)),
            ev_to_ebitda: round2(5.5 + scaled(seed, 3, 0.0, 18.0)),
            price_to_sales: round2(1.2 + scaled(seed, 4, 0.0, 10.0)),
            free_cash_flow_yield: round2(2.0 + scaled(seed, 5, 0.0, 9.0)),
            quality_score: round2(55.0 + scaled(seed, 6, 0.0, 40.0)),
            earnings_quality_score: round2(58.0 + scaled(seed, 7, 0.0, 36.0)),
            revenue_growth5yr: round2(3.0 + scaled(seed, 8, 0.0, 18.0)),
            eps_growth5yr: round2(4.0 + scaled(seed, 9, 0.0, 22.0)),
            gross_margin: round2(28.0 + scaled(seed, 10, 0.0, 36.0)),
            operating_margin: round2(9.0 + scaled(seed, 11, 0.0, 24.0)),
            net_margin: round2(7.0 + scaled(seed, 12, 0.0, 20.0)),
            roe: round2(10.0 + scaled(seed, 13, 0.0, 24.0)),
            roic: round2(8.0 + scaled(seed, 14, 0.0, 20.0)),
            debt_to_equity: round2(0.15 + scaled(seed, 15, 0.0, 1.35)),
            current_ratio: round2(1.0 + scaled(seed, 16, 0.0, 1.6)),
            overall_score: round2(60.0 + scaled(seed, 17, 0.0, 35.0)),
            next_quarter_eps: round2(0.45 + scaled(seed, 18, 0.0, 5.8)),
            next_quarter_revenue: round2(1_000_000_000.0 + scaled(seed, 19, 0.0, 75_000_000_000.0)),
            last_quarter_surprise: round2(-2.0 + scaled(seed, 20, 0.0, 9.0)),
        }
    }

    fn fraction(&self, max: f64) -> f64 {
        scaled(self.seed, 21, 0.0, max)
    }

    fn company_name(&self) -> String {
        format!("{} Holdings", self.symbol)
    }

    fn sector(&self) -> &'static str {
        const SECTORS: [&str; 7] = [
            "Technology",
            "Healthcare",
            "Industrials",
            "Consumer",
            "Financials",
            "Energy",
            "Materials",
        ];

        SECTORS[self.seed as usize % SECTORS.len()]
    }

    fn industry(&self) -> &'static str {
        match self.sector() {
            "Technology" => "Software",
            "Healthcare" => "Medical Devices",
            "Industrials" => "Automation",
            "Consumer" => "Consumer Discretionary",
            "Financials" => "Asset Management",
            "Energy" => "Integrated Energy",
            _ => "Specialty Chemicals",
        }
    }

    fn fair_value_range(&self) -> ValueRange {
        let midpoint = self.current_price * (0.92 + self.fraction(0.24));
        let spread = midpoint * 0.12;
        ValueRange {
            low: round2(midpoint - spread),
            high: round2(midpoint + spread),
        }
    }

    fn valuation_rating(&self) -> String {
        let fair_value = (self.fair_value_range().low + self.fair_value_range().high) / 2.0;
        let ratio = fair_value / self.current_price;

        if ratio > 1.08 {
            "undervalued".to_string()
        } else if ratio < 0.94 {
            "overvalued".to_string()
        } else {
            "fairly valued".to_string()
        }
    }

    fn strengths(&self) -> Vec<String> {
        vec![
            format!("{} maintains above-sector margin discipline", self.symbol),
            "Cash generation remains consistent in the model".to_string(),
            "Balance sheet flexibility supports downside resilience".to_string(),
        ]
    }

    fn weaknesses(&self) -> Vec<String> {
        vec![
            "Deterministic model uses synthetic fundamentals only".to_string(),
            "No live market or filing connectivity in this runtime".to_string(),
            format!("{} valuation depends on simplified peer sets", self.symbol),
        ]
    }

    fn catalysts(&self) -> Vec<String> {
        vec![
            "Margin expansion from operating leverage".to_string(),
            "Multiple re-rating toward peer averages".to_string(),
            "Execution against roadmap assumptions".to_string(),
        ]
    }

    fn risks(&self) -> Vec<String> {
        vec![
            "Macro slowdown compresses demand assumptions".to_string(),
            "Execution miss versus deterministic growth profile".to_string(),
            "Higher discount rates pressure fair value estimates".to_string(),
        ]
    }
}

fn sanitize_symbol(value: &str) -> String {
    let filtered = value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '.')
        .collect::<String>()
        .to_uppercase();

    if filtered.is_empty() {
        "UNKNOWN".to_string()
    } else {
        filtered
    }
}

fn default_peers(symbol: &str) -> Vec<String> {
    let base = symbol.chars().take(3).collect::<String>();
    vec![format!("{base}A"), format!("{base}B"), format!("{base}C")]
}

fn object(entries: Vec<(&str, Value)>) -> JsonMap {
    entries
        .into_iter()
        .map(|(key, value)| (key.to_string(), value))
        .collect()
}

fn number_from_map(map: &JsonMap, key: &str) -> f64 {
    map.get(key).and_then(Value::as_f64).unwrap_or_default()
}

fn symbol_seed(symbol: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    symbol.hash(&mut hasher);
    hasher.finish()
}

fn scaled(seed: u64, salt: u64, min: f64, max: f64) -> f64 {
    let mixed = seed.rotate_left((salt % 31) as u32) ^ (salt * 0x9E37_79B1);
    let fraction = (mixed % 10_000) as f64 / 10_000.0;
    min + ((max - min) * fraction)
}

fn avg(values: impl Iterator<Item = f64>) -> f64 {
    let mut total = 0.0;
    let mut count = 0.0;
    for value in values {
        total += value;
        count += 1.0;
    }

    if count == 0.0 {
        0.0
    } else {
        total / count
    }
}

fn premium_discount(target: f64, peer_average: f64) -> f64 {
    if peer_average == 0.0 {
        0.0
    } else {
        round2(((target - peer_average) / peer_average) * 100.0)
    }
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn round4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_is_deterministic() {
        let first = serde_json::to_value(build_report("AAPL")).unwrap();
        let second = serde_json::to_value(build_report("aapl")).unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn dcf_respects_explicit_options() {
        let result = build_dcf(
            "MSFT",
            DcfOptions {
                discount_rate: 0.12,
                terminal_growth: 0.03,
                projection_years: 7,
            },
        );

        assert_eq!(result.symbol, "MSFT");
        assert_eq!(result.dcf.discount_rate, 0.12);
        assert_eq!(result.dcf.terminal_growth_rate, 0.03);
        assert_eq!(result.dcf.projection_years, 7);
    }
}
