//! Investing HTTP surface builders for market, portfolio, macro, and analytics routes.

use crate::portfolio::calculate_risk_metrics;
use crate::research::{build_report, build_summary};
use chrono::{Duration, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{hash_map::DefaultHasher, BTreeMap};
use std::hash::{Hash, Hasher};

#[derive(Debug, Clone, Deserialize)]
pub struct PortfolioHoldingInput {
    pub symbol: String,
    pub shares: f64,
    #[serde(default)]
    pub average_cost: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PortfolioAnalyticsRequest {
    pub holdings: Vec<PortfolioHoldingInput>,
    #[serde(default)]
    pub benchmark: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PortfolioRiskRequest {
    pub holdings: Vec<PortfolioHoldingInput>,
    #[serde(default = "default_confidence")]
    pub confidence_level: f64,
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default = "default_lookback")]
    pub lookback_days: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PortfolioCorrelationRequest {
    pub holdings: Vec<PortfolioHoldingInput>,
    #[serde(default = "default_lookback")]
    pub lookback_days: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PortfolioAttributionRequest {
    pub holdings: Vec<PortfolioHoldingInput>,
    #[serde(default = "default_period")]
    pub period: String,
    #[serde(default)]
    pub benchmark: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MoneyFlowRequest {
    #[serde(default)]
    pub sectors: Vec<String>,
    #[serde(default)]
    pub lookback_days: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SignalRequest {
    #[serde(default)]
    pub symbols: Vec<String>,
    #[serde(default)]
    pub min_conviction: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BacktestRequest {
    #[serde(default)]
    pub symbols: Vec<String>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub end_date: Option<String>,
    #[serde(default = "default_holding_period")]
    pub holding_period_days: u32,
    #[serde(default = "default_initial_capital")]
    pub initial_capital: f64,
}

const DEFAULT_SECTORS: &[(&str, &str)] = &[
    ("XLK", "Technology"),
    ("XLF", "Financials"),
    ("XLE", "Energy"),
    ("XLV", "Health Care"),
    ("XLY", "Consumer Discretionary"),
    ("XLP", "Consumer Staples"),
    ("XLI", "Industrials"),
    ("XLB", "Materials"),
    ("XLU", "Utilities"),
    ("VNQ", "Real Estate"),
];

const ETF_FLOW_FIXTURES: &[(&str, &str)] = &[
    ("SPY", "SPDR S&P 500 ETF Trust"),
    ("QQQ", "Invesco QQQ Trust"),
    ("IWM", "iShares Russell 2000 ETF"),
    ("XLF", "Financial Select Sector SPDR Fund"),
    ("XLK", "Technology Select Sector SPDR Fund"),
    ("XLE", "Energy Select Sector SPDR Fund"),
];

const COMMODITY_FIXTURES: &[(&str, &str, &str)] = &[
    ("GC", "Gold", "Precious Metals"),
    ("SI", "Silver", "Precious Metals"),
    ("CL", "Crude Oil", "Energy"),
    ("NG", "Natural Gas", "Energy"),
    ("HG", "Copper", "Base Metals"),
    ("ZC", "Corn", "Agriculture"),
];

const POLYMARKET_FIXTURES: &[(&str, &str, &str, &str)] = &[
    (
        "fed-holds-rates-next-meeting",
        "Will the Fed hold rates at the next meeting?",
        "pm-fed-hold-yes",
        "pm-fed-hold-no",
    ),
    (
        "sp500-above-6000-year-end",
        "Will the S&P 500 finish above 6000 this year?",
        "pm-spx-6000-yes",
        "pm-spx-6000-no",
    ),
    (
        "brent-above-90-next-quarter",
        "Will Brent crude trade above $90 next quarter?",
        "pm-brent-90-yes",
        "pm-brent-90-no",
    ),
];

const KALSHI_FIXTURES: &[(&str, &str)] = &[
    ("INFLATION-2026-MAR", "Will CPI inflation print above consensus this month?"),
    ("FED-2026-NEXTCUT", "Will the next Fed move be a rate cut?"),
    ("SPX-2026-YE", "Will the S&P 500 close above 6000 this year?"),
];

pub fn build_market_data(symbol: &str) -> Value {
    let summary = build_summary(symbol);
    let change_pct = signed_percent(&summary.symbol, 3.6);
    let price = round2(summary.current_price);
    let change = round2(price * change_pct / 100.0);
    let volume = integer(&format!("{}:volume", summary.symbol), 1_500_000, 28_000_000);
    let avg_volume = integer(
        &format!("{}:avg-volume", summary.symbol),
        2_000_000,
        24_000_000,
    );

    json!({
        "symbol": summary.symbol,
        "price": price,
        "change": change,
        "changePercent": change_pct,
        "volume": volume,
        "avgVolume": avg_volume,
        "marketCap": round2(summary.market_cap),
        "peRatio": round2(metric_number(&summary.key_metrics, "forwardPe", 18.0)),
        "dividendYield": round2(number(&format!("{}:dividend", symbol), 0.0, 3.4)),
        "high52w": round2(price * 1.19),
        "low52w": round2(price * 0.82),
        "timestamp": now(),
    })
}

pub fn build_market_quote(symbol: &str) -> Value {
    let data = build_market_data(symbol);
    let price = value_f64(&data, "price");
    let change = value_f64(&data, "change");
    json!({
        "symbol": data["symbol"],
        "price": price,
        "change": change,
        "changePercent": data["changePercent"],
        "volume": data["volume"],
        "open": round2(price - (change * 0.35)),
        "high": round2(price * 1.011),
        "low": round2(price * 0.989),
        "previousClose": round2(price - change),
        "timestamp": now(),
    })
}

pub fn build_market_history(symbol: &str, period: Option<&str>, interval: Option<&str>) -> Value {
    let period = period.unwrap_or("3M");
    let interval = interval.unwrap_or("1d");
    let bars = synthetic_bars(symbol, period_to_points(period), interval);
    let start = bars
        .first()
        .and_then(|item| item.get("date"))
        .cloned()
        .unwrap_or_else(|| Value::String(Utc::now().date_naive().to_string()));
    let end = bars
        .last()
        .and_then(|item| item.get("date"))
        .cloned()
        .unwrap_or_else(|| Value::String(Utc::now().date_naive().to_string()));

    json!({
        "symbol": normalize_symbol(symbol),
        "interval": interval,
        "dataPoints": bars,
        "startDate": start,
        "endDate": end,
    })
}

pub fn build_market_overview() -> Value {
    let indices = BTreeMap::from([
        ("SPY".to_string(), build_market_data("SPY")),
        ("QQQ".to_string(), build_market_data("QQQ")),
        ("DIA".to_string(), build_market_data("DIA")),
        ("IWM".to_string(), build_market_data("IWM")),
    ]);

    let mut sectors = BTreeMap::new();
    for (symbol, name) in DEFAULT_SECTORS {
        let sector_key = (*name).to_string();
        sectors.insert(sector_key, signed_percent(symbol, 2.8));
    }

    json!({
        "indices": indices,
        "sectors": sectors,
        "breadth": {
            "advanceDeclineRatio": round2(number("breadth:ad", 0.84, 1.48)),
            "advancingVolume": integer("breadth:advancing-volume", 1_200_000_000, 4_800_000_000),
            "decliningVolume": integer("breadth:declining-volume", 900_000_000, 4_300_000_000),
            "newHighsNewLows": integer("breadth:new-highs", 120, 420) as i64 - integer("breadth:new-lows", 30, 240) as i64,
            "percentAbove50DMA": round2(number("breadth:50dma", 38.0, 79.0)),
            "percentAbove200DMA": round2(number("breadth:200dma", 44.0, 81.0)),
            "mcclellanOscillator": round2(signed_number("breadth:mcclellan", 96.0)),
            "breadthThrust": round2(number("breadth:thrust", 0.42, 0.74)),
            "interpretation": "Broad participation remains constructive with cyclicals leading defensives.",
            "timestamp": now(),
        },
        "timestamp": now(),
    })
}

pub fn build_institutional_holdings(symbol: &str, limit: usize) -> Value {
    let normalized = normalize_symbol(symbol);
    let count = limit.clamp(1, 25);
    let price = value_f64(&build_market_data(symbol), "price");
    let total_shares = integer(&format!("{}:shares-outstanding", normalized), 900_000_000, 5_500_000_000) as f64;
    let managers = [
        "Vanguard Group",
        "BlackRock",
        "State Street",
        "Capital Research",
        "Fidelity Management",
        "T. Rowe Price",
        "Geode Capital",
        "Morgan Stanley IM",
        "Norges Bank",
        "JP Morgan AM",
    ];

    Value::Array(
        managers
            .iter()
            .take(count)
            .enumerate()
            .map(|(index, name)| {
                let ownership = round2(number(
                    &format!("{}:{}:ownership", normalized, index),
                    0.7,
                    7.4,
                ));
                let shares = ((ownership / 100.0) * total_shares).round();
                json!({
                    "managerName": name,
                    "managerCik": format!("{:010}", integer(&format!("{}:{}:cik", normalized, index), 10_000, 999_999)),
                    "sharesHeld": shares,
                    "valueHeld": round2(shares * price),
                    "ownershipPercentage": ownership,
                    "changeFromLastQuarter": round2(signed_percent(&format!("{}:{}:change", normalized, index), 18.0)),
                })
            })
            .collect(),
    )
}

pub fn build_ownership(symbol: &str) -> Value {
    let normalized = normalize_symbol(symbol);
    let institutional = round2(number(&format!("{}:inst", normalized), 48.0, 86.0));
    let insider = round2(number(&format!("{}:insider", normalized), 0.5, 12.0));
    let retail = round2((100.0 - institutional - insider).max(4.0));
    let shares = integer(
        &format!("{}:shares-outstanding", normalized),
        900_000_000,
        5_500_000_000,
    );
    json!({
        "symbol": normalized,
        "institutionalOwnership": institutional,
        "retailOwnership": retail,
        "insiderOwnership": insider,
        "top10Concentration": round2(number(&format!("{}:top10", symbol), 26.0, 61.0)),
        "totalHolders": integer(&format!("{}:holders", symbol), 420, 2800),
        "sharesOutstanding": shares,
        "floatShares": ((shares as f64) * (1.0 - insider / 100.0)).round() as i64,
    })
}

pub fn build_institutional_sentiment(symbol: &str) -> Value {
    let normalized = normalize_symbol(symbol);
    let score = round2(number(&format!("{}:sentiment", normalized), 28.0, 88.0));
    let classification = if score >= 72.0 {
        "bullish"
    } else if score >= 52.0 {
        "constructive"
    } else {
        "cautious"
    };

    json!({
        "symbol": normalized,
        "score": score,
        "classification": classification,
        "confidence": round2(number(&format!("{}:confidence", normalized), 0.56, 0.92)),
        "contributingFactors": {
            "ownershipTrend": round2(number(&format!("{}:ownership-trend", normalized), 0.2, 0.9)),
            "positionConcentration": round2(number(&format!("{}:concentration", normalized), 0.2, 0.8)),
            "managerQuality": round2(number(&format!("{}:quality", normalized), 0.3, 0.9)),
            "filingMomentum": round2(number(&format!("{}:filing-momentum", normalized), 0.2, 0.8)),
        },
        "weightsUsed": {
            "ownershipTrend": 0.35,
            "positionConcentration": 0.2,
            "managerQuality": 0.25,
            "filingMomentum": 0.2,
        }
    })
}

pub fn build_smart_money_flow(symbol: &str) -> Value {
    let normalized = normalize_symbol(symbol);
    let net_flow = round2(signed_number(&format!("{}:net-flow", normalized), 480_000_000.0));
    let signal = if net_flow >= 0.0 { "accumulation" } else { "distribution" };
    let buying_count = integer(&format!("{}:buyers", normalized), 3, 11) as usize;
    let selling_count = integer(&format!("{}:sellers", normalized), 2, 9) as usize;

    let buying_activity = (0..buying_count)
        .map(|index| {
            json!({
                "managerName": format!("{} Capital {}", sector_prefix(&normalized), index + 1),
                "managerCik": format!("{:010}", integer(&format!("{}:buy-cik:{}", normalized, index), 10_000, 999_999)),
                "sharesAdded": integer(&format!("{}:shares-added:{}", normalized, index), 40_000, 780_000),
                "valueAdded": round2(number(&format!("{}:value-added:{}", normalized, index), 8_000_000.0, 260_000_000.0)),
                "performanceScore": round2(number(&format!("{}:perf-buy:{}", normalized, index), 0.52, 0.91)),
            })
        })
        .collect::<Vec<_>>();

    let selling_activity = (0..selling_count)
        .map(|index| {
            json!({
                "managerName": format!("{} Partners {}", sector_prefix(&normalized), index + 1),
                "managerCik": format!("{:010}", integer(&format!("{}:sell-cik:{}", normalized, index), 10_000, 999_999)),
                "sharesSold": integer(&format!("{}:shares-sold:{}", normalized, index), 30_000, 620_000),
                "valueSold": round2(number(&format!("{}:value-sold:{}", normalized, index), 5_000_000.0, 210_000_000.0)),
                "performanceScore": round2(number(&format!("{}:perf-sell:{}", normalized, index), 0.44, 0.88)),
            })
        })
        .collect::<Vec<_>>();

    json!({
        "symbol": normalized,
        "netFlow": net_flow,
        "weightedFlow": round2(net_flow * number(&format!("{}:weighted-flow", normalized), 0.82, 1.24)),
        "signal": signal,
        "signalStrength": round2(number(&format!("{}:signal-strength", normalized), 0.45, 0.94)),
        "buyersCount": buying_count,
        "sellersCount": selling_count,
        "buyingActivity": buying_activity,
        "sellingActivity": selling_activity,
        "coordinatedBuying": net_flow > 0.0 && buying_count >= 5,
        "coordinatedSelling": net_flow < 0.0 && selling_count >= 4,
    })
}

pub fn build_whale_activity(symbol: &str) -> Value {
    let normalized = normalize_symbol(symbol);
    Value::Array(
        (0..6)
            .map(|index| {
                let added = index % 2 == 0;
                json!({
                    "managerName": format!("{} Macro {}", sector_prefix(&normalized), index + 1),
                    "action": if added { "buy" } else { "sell" },
                    "sharesChanged": integer(&format!("{}:whale-shares:{}", normalized, index), 50_000, 950_000),
                    "valueChanged": round2(number(&format!("{}:whale-value:{}", normalized, index), 7_000_000.0, 310_000_000.0)),
                    "percentOfPortfolio": round2(number(&format!("{}:whale-weight:{}", normalized, index), 0.2, 4.4)),
                    "filingDate": (Utc::now() - Duration::days((index * 11) as i64)).date_naive().to_string(),
                })
            })
            .collect(),
    )
}

pub fn build_money_flow(request: &MoneyFlowRequest) -> Value {
    let sectors = if request.sectors.is_empty() {
        DEFAULT_SECTORS
            .iter()
            .map(|(symbol, _)| (*symbol).to_string())
            .collect::<Vec<_>>()
    } else {
        request
            .sectors
            .iter()
            .map(|value| normalize_symbol(value))
            .collect::<Vec<_>>()
    };

    let mut sector_map = BTreeMap::new();
    let mut net_flows = BTreeMap::new();
    let mut momentum = BTreeMap::new();

    for sector in sectors {
        let net_1m = round2(signed_number(&format!("{}:net1m", sector), 2_600_000_000.0));
        let net_3m = round2(net_1m * number(&format!("{}:net3m-mult", sector), 1.3, 2.4));
        sector_map.insert(
            sector.clone(),
            json!({
                "symbol": sector,
                "netFlow1m": net_1m,
                "netFlow3m": net_3m,
                "institutionalChange": round2(signed_percent(&format!("{}:inst-change", sector), 14.0)),
                "smartMoneySentiment": round2(number(&format!("{}:sentiment", sector), 0.18, 0.92)),
                "flowAcceleration": round2(signed_percent(&format!("{}:accel", sector), 22.0)),
                "confidenceScore": round2(number(&format!("{}:confidence", sector), 0.46, 0.94)),
            }),
        );
        net_flows.insert(sector.clone(), net_1m);
        momentum.insert(
            sector.clone(),
            round2(signed_percent(&format!("{}:momentum", sector), 18.0)),
        );
    }

    json!({
        "sectors": sector_map,
        "netFlows": net_flows,
        "momentum": momentum,
        "timestamp": now(),
    })
}

pub fn build_dark_pool(symbol: &str) -> Value {
    let normalized = normalize_symbol(symbol);
    let rows = (0..10)
        .map(|offset| {
            let total_volume = integer(
                &format!("{}:dp-total:{}", normalized, offset),
                8_000_000,
                42_000_000,
            );
            let dark_share = number(&format!("{}:dp-share:{}", normalized, offset), 0.28, 0.47);
            let dark_volume = (total_volume as f64 * dark_share).round() as i64;
            json!({
                "symbol": normalized,
                "date": (Utc::now() - Duration::days(offset)).date_naive().to_string(),
                "darkPoolVolume": dark_volume,
                "totalVolume": total_volume,
                "darkPoolPercentage": round2(dark_share * 100.0),
                "largeBlockActivity": round2(number(&format!("{}:blocks:{}", normalized, offset), 0.22, 0.86)),
                "darkPoolSignal": round2(signed_number(&format!("{}:signal:{}", normalized, offset), 1.0)),
            })
        })
        .collect::<Vec<_>>();

    let avg_pct = rows
        .iter()
        .filter_map(|row| row.get("darkPoolPercentage").and_then(Value::as_f64))
        .sum::<f64>()
        / rows.len() as f64;
    let avg_blocks = rows
        .iter()
        .filter_map(|row| row.get("largeBlockActivity").and_then(Value::as_f64))
        .sum::<f64>()
        / rows.len() as f64;
    let total_dark = rows
        .iter()
        .filter_map(|row| row.get("darkPoolVolume").and_then(Value::as_i64))
        .sum::<i64>();

    json!({
        "symbol": normalized,
        "data": rows,
        "summary": {
            "averageDarkPoolPercentage": round2(avg_pct),
            "averageBlockActivity": round2(avg_blocks),
            "totalDarkPoolVolume": total_dark,
            "signalBias": round2(signed_number(&format!("{}:bias", normalized), 1.0)),
        },
        "timestamp": now(),
    })
}

pub fn build_equity_flow(symbol: &str) -> Value {
    let normalized = normalize_symbol(symbol);
    json!({
        "symbol": normalized,
        "moneyFlowScore": round2(number(&format!("{}:money-flow-score", normalized), 24.0, 92.0)),
        "institutionalSentiment": round2(number(&format!("{}:inst-sentiment", normalized), 18.0, 88.0)),
        "smartMoneyActivity": round2(number(&format!("{}:smart-money", normalized), 22.0, 94.0)),
        "shortPressure": round2(number(&format!("{}:short-pressure", normalized), 8.0, 74.0)),
        "accumulationDistribution": round2(signed_number(&format!("{}:acc-dist", normalized), 1.0)),
        "confidence": round2(number(&format!("{}:confidence", normalized), 0.42, 0.96)),
    })
}

pub fn build_sector_rotation() -> Value {
    Value::Array(
        DEFAULT_SECTORS
            .iter()
            .map(|(symbol, name)| {
                let relative_strength = round2(number(&format!("{}:rs", symbol), 35.0, 88.0));
                let momentum_score = round2(number(&format!("{}:momentum-score", symbol), 30.0, 90.0));
                let flow_score = round2(number(&format!("{}:flow-score", symbol), 28.0, 92.0));
                let rotation_phase = if flow_score >= 72.0 {
                    "leading"
                } else if flow_score >= 58.0 {
                    "improving"
                } else {
                    "lagging"
                };
                json!({
                    "sector": symbol,
                    "sectorName": name,
                    "relativeStrength": relative_strength,
                    "momentumScore": momentum_score,
                    "flowScore": flow_score,
                    "rotationPhase": rotation_phase,
                    "recommendation": if flow_score >= 68.0 { "overweight" } else if flow_score >= 55.0 { "neutral" } else { "underweight" },
                    "oneMonthReturn": round2(signed_percent(&format!("{}:1m", symbol), 12.0)),
                    "threeMonthReturn": round2(signed_percent(&format!("{}:3m", symbol), 22.0)),
                })
            })
            .collect(),
    )
}

pub fn build_options_flow(symbol: &str) -> Value {
    let normalized = normalize_symbol(symbol);
    let call_volume = integer(&format!("{}:call-volume", normalized), 18_000, 220_000);
    let put_volume = integer(&format!("{}:put-volume", normalized), 12_000, 180_000);
    let total = call_volume + put_volume;
    json!({
        "symbol": normalized,
        "totalVolume": total,
        "callVolume": call_volume,
        "putVolume": put_volume,
        "putCallRatio": round2(put_volume as f64 / call_volume.max(1) as f64),
        "netPremium": round2(signed_number(&format!("{}:net-premium", normalized), 58_000_000.0)),
        "unusualTrades": build_unusual_activity(Some(symbol)),
        "timestamp": now(),
    })
}

pub fn build_options_chain(symbol: &str, expiry: Option<&str>) -> Value {
    let normalized = normalize_symbol(symbol);
    let price = value_f64(&build_market_data(symbol), "price");
    let expirations = match expiry {
        Some(value) => vec![value.to_string()],
        None => vec![
            (Utc::now() + Duration::days(14)).date_naive().to_string(),
            (Utc::now() + Duration::days(35)).date_naive().to_string(),
            (Utc::now() + Duration::days(63)).date_naive().to_string(),
        ],
    };
    let selected_expiry = expirations.first().cloned().unwrap_or_else(|| now());
    let calls = option_contracts(&normalized, price, &selected_expiry, true);
    let puts = option_contracts(&normalized, price, &selected_expiry, false);

    json!({
        "symbol": normalized,
        "expirations": expirations,
        "calls": calls,
        "puts": puts,
        "underlyingPrice": round2(price),
    })
}

pub fn build_gamma_exposure(symbol: &str) -> Value {
    let normalized = normalize_symbol(symbol);
    let price = value_f64(&build_market_data(symbol), "price");
    let gamma_by_strike = (-4..=4)
        .map(|step| {
            let strike = round2(price * (1.0 + (step as f64 * 0.04)));
            json!({
                "strike": strike,
                "gamma": round2(signed_number(&format!("{}:gamma:{}", normalized, step), 4_200_000.0)),
            })
        })
        .collect::<Vec<_>>();
    json!({
        "symbol": normalized,
        "netGamma": round2(signed_number(&format!("{}:net-gamma", normalized), 18_000_000.0)),
        "gammaByStrike": gamma_by_strike,
        "flipPoint": round2(price * 0.97),
        "maxPain": round2(price * 1.01),
        "timestamp": now(),
    })
}

pub fn build_unusual_activity(symbol: Option<&str>) -> Value {
    let scopes = symbol
        .map(|value| vec![normalize_symbol(value)])
        .unwrap_or_else(|| vec!["SPY".to_string(), "QQQ".to_string(), "NVDA".to_string()]);

    Value::Array(
        scopes
            .iter()
            .flat_map(|scope| {
                (0..3).map(move |index| {
                    let call = index % 2 == 0;
                    json!({
                        "symbol": scope,
                        "type": if call { "call" } else { "put" },
                        "strike": round2(number(&format!("{}:strike:{}", scope, index), 40.0, 420.0)),
                        "expiry": (Utc::now() + Duration::days((index + 1) as i64 * 21)).date_naive().to_string(),
                        "volume": integer(&format!("{}:unusual-volume:{}", scope, index), 400, 14_000),
                        "openInterest": integer(&format!("{}:oi:{}", scope, index), 600, 20_000),
                        "premium": round2(number(&format!("{}:premium:{}", scope, index), 450_000.0, 8_400_000.0)),
                        "sentiment": if call { "bullish" } else { "bearish" },
                        "timestamp": now(),
                    })
                })
            })
            .collect(),
    )
}

pub fn build_put_call(symbol: &str) -> Value {
    let normalized = normalize_symbol(symbol);
    let ratio = round2(number(&format!("{}:put-call", normalized), 0.58, 1.34));
    json!({
        "symbol": normalized,
        "ratio": ratio,
        "signal": if ratio < 0.85 { "bullish" } else if ratio < 1.1 { "neutral" } else { "defensive" },
        "historicalAvg": round2(number(&format!("{}:pc-avg", normalized), 0.75, 1.05)),
        "percentile": round2(number(&format!("{}:pc-percentile", normalized), 22.0, 88.0)),
    })
}

pub fn build_max_pain(symbol: &str, _expiry: Option<&str>) -> Value {
    let price = value_f64(&build_market_data(symbol), "price");
    json!({
        "strike": round2(price * number(&format!("{}:max-pain", symbol), 0.96, 1.05)),
        "value": round2(number(&format!("{}:max-pain-value", symbol), 2_500_000.0, 34_000_000.0)),
    })
}

pub fn build_etf_flows() -> Value {
    Value::Array(
        ETF_FLOW_FIXTURES
            .iter()
            .map(|(symbol, name)| {
                json!({
                    "symbol": symbol,
                    "name": name,
                    "flow1d": round2(signed_number(&format!("{}:flow1d", symbol), 1_400_000_000.0)),
                    "flow1w": round2(signed_number(&format!("{}:flow1w", symbol), 3_800_000_000.0)),
                    "flow1m": round2(signed_number(&format!("{}:flow1m", symbol), 9_200_000_000.0)),
                    "flowPct": round2(signed_percent(&format!("{}:flow-pct", symbol), 3.4)),
                    "aum": round2(number(&format!("{}:aum", symbol), 18_000_000_000.0, 540_000_000_000.0)),
                })
            })
            .collect(),
    )
}

pub fn build_etf_sector_rotation() -> Value {
    Value::Array(
        DEFAULT_SECTORS
            .iter()
            .map(|(etf, sector)| {
                json!({
                    "sector": sector,
                    "etf": etf,
                    "momentumScore": round2(number(&format!("{}:etf-momentum", etf), 32.0, 89.0)),
                    "signal": if signed_percent(&format!("{}:etf-signal", etf), 4.0) >= 0.0 { "improving" } else { "weakening" },
                    "relativeStrength": round2(number(&format!("{}:etf-rs", etf), 30.0, 88.0)),
                })
            })
            .collect(),
    )
}

pub fn build_smart_beta() -> Value {
    Value::Array(vec![
        json!({"factor":"quality","etfs":["QUAL","SPHQ"],"totalAum":78_000_000_000.0,"netFlow1m":1_280_000_000.0,"performance":6.4,"crowding":0.42}),
        json!({"factor":"value","etfs":["VLUE","IWD"],"totalAum":62_000_000_000.0,"netFlow1m":920_000_000.0,"performance":4.1,"crowding":0.36}),
        json!({"factor":"momentum","etfs":["MTUM","PDP"],"totalAum":31_000_000_000.0,"netFlow1m":1_050_000_000.0,"performance":8.7,"crowding":0.58}),
    ])
}

pub fn build_thematic() -> Value {
    Value::Array(vec![
        json!({"theme":"AI Infrastructure","etfs":["BOTZ","AIQ"],"totalAum":12_400_000_000.0,"netFlow1m":540_000_000.0,"momentum":0.74,"trend":"expanding"}),
        json!({"theme":"Energy Security","etfs":["XLE","IXC"],"totalAum":85_200_000_000.0,"netFlow1m":860_000_000.0,"momentum":0.61,"trend":"improving"}),
        json!({"theme":"Industrial Automation","etfs":["ROBO","ARKQ"],"totalAum":6_900_000_000.0,"netFlow1m":180_000_000.0,"momentum":0.57,"trend":"stable"}),
    ])
}

pub fn build_macro_indicators(country: &str, category: Option<&str>) -> Value {
    let snapshot = macro_snapshot(country);
    let codes = macro_indicator_rows(&snapshot.country);
    let filtered = codes
        .into_iter()
        .filter(|row| match category.map(|item| item.trim().to_ascii_lowercase()) {
            Some(ref kind) if !kind.is_empty() => row
                .get("category")
                .and_then(Value::as_str)
                .map(|value| value.eq_ignore_ascii_case(kind))
                .unwrap_or(false),
            _ => true,
        })
        .map(|mut row| {
            if let Some(object) = row.as_object_mut() {
                object.remove("category");
            }
            row
        })
        .collect::<Vec<_>>();

    json!({
        "country": snapshot.country,
        "indicators": filtered,
        "snapshot": snapshot.snapshot,
        "timestamp": now(),
    })
}

pub fn build_macro_snapshot(country: &str) -> Value {
    macro_snapshot(country).snapshot
}

pub fn build_macro_regime(country: Option<&str>) -> Value {
    let snapshot = macro_snapshot(country.unwrap_or("US"));
    let regime_score = round2(
        (snapshot.gdp_growth * 14.0)
            - (snapshot.inflation * 5.0)
            - (snapshot.unemployment * 2.5)
            + (snapshot.policy_rate * 1.2)
            + 48.0,
    );
    let current_regime = if regime_score >= 64.0 {
        "goldilocks"
    } else if snapshot.inflation >= 4.0 {
        "stagflation"
    } else if snapshot.gdp_growth < 1.0 {
        "risk_off"
    } else {
        "transition"
    };

    json!({
        "currentRegime": current_regime,
        "confidence": if regime_score >= 70.0 { "high" } else if regime_score >= 55.0 { "medium" } else { "low" },
        "regimeScore": regime_score,
        "components": {
            "growth": if snapshot.gdp_growth >= 2.0 { "supportive" } else { "mixed" },
            "inflation": if snapshot.inflation <= 2.8 { "contained" } else { "sticky" },
            "labor": if snapshot.unemployment <= 4.5 { "resilient" } else { "softening" },
            "policy": if snapshot.policy_rate >= 3.0 { "restrictive" } else { "accommodative" },
        },
        "metrics": {
            "gdpGrowth": snapshot.gdp_growth,
            "inflation": snapshot.inflation,
            "unemployment": snapshot.unemployment,
            "policyRate": snapshot.policy_rate,
            "currentAccount": snapshot.current_account,
        },
        "risk": {
            "recessionProbability12m": build_recession_probability(&snapshot.country)["probability12m"],
            "inflationPersistence": round2(number(&format!("{}:inflation-persistence", snapshot.country), 0.2, 0.84)),
        },
        "positioning": {
            "equity": if current_regime == "goldilocks" { "pro-cyclical" } else if current_regime == "stagflation" { "quality and defensives" } else { "balanced" },
            "duration": if snapshot.policy_rate >= 3.5 { "neutral to long" } else { "short to neutral" },
            "credit": if regime_score >= 58.0 { "selective IG overweight" } else { "defensive" },
            "volatility": if current_regime == "risk_off" { "own protection" } else { "sell spikes selectively" },
        },
        "signals": [
            {"source":"growth","signal": if snapshot.gdp_growth >= 2.0 { "expanding" } else { "slowing" }, "strength": round2(number("macro:signal:growth", 0.32, 0.88)), "confidence": 0.76, "details": {"gdpGrowth": snapshot.gdp_growth}},
            {"source":"inflation","signal": if snapshot.inflation <= 3.0 { "benign" } else { "sticky" }, "strength": round2(number("macro:signal:inflation", 0.28, 0.84)), "confidence": 0.71, "details": {"inflation": snapshot.inflation}},
            {"source":"rates","signal": if snapshot.policy_rate >= 3.5 { "restrictive" } else { "accommodative" }, "strength": round2(number("macro:signal:rates", 0.26, 0.81)), "confidence": 0.68, "details": {"policyRate": snapshot.policy_rate}},
        ],
        "regimeDurationDays": integer(&format!("{}:regime-duration", snapshot.country), 38, 286),
        "timestamp": now(),
    })
}

pub fn build_yield_curve(country: &str) -> Value {
    let (normalized, base_10y, spread_2y10y, spread_3m10y) = curve_inputs(country);
    let snapshot = macro_snapshot(country);
    let curve = vec![
        ("3M", round2(base_10y - spread_3m10y)),
        ("2Y", round2(base_10y - spread_2y10y)),
        ("5Y", round2(base_10y - 0.28)),
        ("10Y", round2(base_10y)),
        ("30Y", round2(base_10y + 0.34)),
    ]
    .into_iter()
    .map(|(tenor, value)| {
        json!({
            "tenor": tenor,
            "yield": value,
            "priorYield": round2(value - signed_percent(&format!("{}:{}:prior", normalized, tenor), 0.18)),
            "change": round2(signed_percent(&format!("{}:{}:chg", normalized, tenor), 0.22)),
        })
    })
    .collect::<Vec<_>>();
    let shape = if spread_2y10y < -0.05 {
        "inverted"
    } else if spread_2y10y < 0.15 {
        "flat"
    } else {
        "steepening"
    };
    let recession_probability = round2(
        ((snapshot.unemployment * 9.0)
            + (snapshot.inflation * 5.0)
            - (snapshot.gdp_growth * 7.0)
            + if spread_3m10y < 0.0 { 12.0 } else { 0.0 }
            + 18.0)
            .clamp(8.0, 64.0),
    );

    json!({
        "country": normalized,
        "shape": shape,
        "spread2y10y": spread_2y10y,
        "spread3m10y": spread_3m10y,
        "recessionSignal": if spread_3m10y < 0.0 { "active" } else { "benign" },
        "recessionProbability12m": recession_probability,
        "inversionDurationDays": if spread_3m10y < 0.0 { integer(&format!("{}:inversion-days", normalized), 45, 420) as i64 } else { 0 },
        "curve": curve,
        "dynamic": if shape == "steepening" { "growth-sensitive curve steepening" } else { "policy and growth uncertainty keep the curve compressed" },
        "timestamp": now(),
    })
}

pub fn build_recession_probability(country: &str) -> Value {
    let snapshot = macro_snapshot(country);
    let (_, _, _, spread_3m10y) = curve_inputs(country);
    let base = (snapshot.unemployment * 9.0)
        + (snapshot.inflation * 5.0)
        - (snapshot.gdp_growth * 7.0)
        + if spread_3m10y < 0.0 { 12.0 } else { 0.0 }
        + 18.0;
    let probability_12m = round2(base.clamp(8.0, 64.0));
    let probability_6m = round2((probability_12m * 0.62).clamp(4.0, 48.0));
    let risk_level = if probability_12m >= 45.0 {
        "high"
    } else if probability_12m >= 28.0 {
        "moderate"
    } else {
        "low"
    };
    json!({
        "country": snapshot.country,
        "probability12m": probability_12m,
        "probability6m": probability_6m,
        "riskLevel": risk_level,
        "riskScore": round2(probability_12m / 100.0),
        "factors": [
            {"factor":"labor_market","severity": if snapshot.unemployment > 5.0 { "elevated" } else { "contained" }, "description":"Labor slack and hiring momentum", "contribution": round2(snapshot.unemployment / 10.0)},
            {"factor":"yield_curve","severity": if value_f64(&build_yield_curve(&snapshot.country), "spread3m10y") < 0.0 { "elevated" } else { "contained" }, "description":"Term structure signal", "contribution": round2(number(&format!("{}:yield-risk", snapshot.country), 0.08, 0.26))},
            {"factor":"inflation","severity": if snapshot.inflation >= 3.5 { "sticky" } else { "moderating" }, "description":"Inflation persistence and policy response", "contribution": round2(snapshot.inflation / 12.0)},
            {"factor":"growth","severity": if snapshot.gdp_growth < 1.0 { "weak" } else { "stable" }, "description":"Real activity momentum", "contribution": round2((3.0 - snapshot.gdp_growth).max(0.0) / 6.0)},
        ],
        "modelVersion":"investing-core-regime-v1",
        "confidence": round2(number(&format!("{}:recession-confidence", snapshot.country), 0.48, 0.86)),
        "timestamp": now(),
    })
}

pub fn build_macro_calendar() -> Value {
    Value::Array(vec![
        json!({"date": (Utc::now() + Duration::days(2)).date_naive().to_string(), "event": "CPI", "country":"US", "importance":"high", "consensus":"0.3% m/m"}),
        json!({"date": (Utc::now() + Duration::days(4)).date_naive().to_string(), "event": "Retail Sales", "country":"US", "importance":"medium", "consensus":"0.2% m/m"}),
        json!({"date": (Utc::now() + Duration::days(7)).date_naive().to_string(), "event": "FOMC Minutes", "country":"US", "importance":"high", "consensus":"n/a"}),
    ])
}

pub fn build_commodities_overview() -> Value {
    let mut categories: BTreeMap<String, Value> = BTreeMap::new();

    for category in ["Precious Metals", "Energy", "Base Metals", "Agriculture"] {
        let items = COMMODITY_FIXTURES
            .iter()
            .filter(|(_, _, group)| *group == category)
            .map(|(symbol, name, _)| commodity_price(symbol, name))
            .collect::<Vec<_>>();
        let avg_change = round2(
            items.iter()
                .filter_map(|item| item.get("changePercent").and_then(Value::as_f64))
                .sum::<f64>()
                / items.len().max(1) as f64,
        );
        let mut sorted = items.clone();
        sorted.sort_by(|left, right| {
            value_f64(left, "changePercent")
                .partial_cmp(&value_f64(right, "changePercent"))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        categories.insert(
            category.to_string(),
            json!({
                "category": category,
                "count": items.len(),
                "avgChange": avg_change,
                "leader": sorted.last().cloned(),
                "laggard": sorted.first().cloned(),
                "commodities": items,
            }),
        );
    }

    let avg_change = categories
        .values()
        .filter_map(|item| item.get("avgChange").and_then(Value::as_f64))
        .sum::<f64>()
        / categories.len().max(1) as f64;

    json!({
        "timestamp": now(),
        "sentiment": if avg_change >= 0.0 { "firm" } else { "softening" },
        "avgChange": round2(avg_change),
        "categories": categories,
    })
}

pub fn build_commodity_detail(symbol: &str) -> Value {
    let normalized = normalize_symbol(symbol);
    if let Some((_, name, category)) = COMMODITY_FIXTURES
        .iter()
        .find(|(item_symbol, _, _)| item_symbol.eq_ignore_ascii_case(&normalized))
    {
        let price = value_f64(&commodity_price(&normalized, name), "price");
        return json!({
            "symbol": normalized,
            "name": name,
            "category": category,
            "price": price,
            "change1d": round2(signed_percent(&format!("{}:1d", normalized), 3.8)),
            "change1w": round2(signed_percent(&format!("{}:1w", normalized), 6.4)),
            "change1m": round2(signed_percent(&format!("{}:1m", normalized), 12.0)),
            "changeYtd": round2(signed_percent(&format!("{}:ytd", normalized), 20.0)),
            "volatility30d": round2(number(&format!("{}:vol30", normalized), 12.0, 38.0)),
            "trend": if signed_percent(&format!("{}:trend", normalized), 1.0) >= 0.0 { "uptrend" } else { "downtrend" },
            "relativeStrength": round2(number(&format!("{}:rs", normalized), 34.0, 91.0)),
        });
    }

    json!({
        "symbol": normalized,
        "name": format!("{normalized} Commodity"),
        "category": "Unclassified",
        "price": round2(number(&format!("{}:price", normalized), 20.0, 220.0)),
        "change1d": 0.0,
        "change1w": 0.0,
        "change1m": 0.0,
        "changeYtd": 0.0,
        "volatility30d": 18.0,
        "trend": "stable",
        "relativeStrength": 50.0,
    })
}

pub fn build_commodities_correlations() -> Value {
    let symbols = COMMODITY_FIXTURES
        .iter()
        .map(|(symbol, _, _)| (*symbol).to_string())
        .collect::<Vec<_>>();
    let matrix = correlation_matrix_from_symbols(&symbols);
    json!({
        "symbols": symbols,
        "matrix": matrix,
    })
}

pub fn build_commodity_macro(symbol: &str) -> Value {
    let detail = build_commodity_detail(symbol);
    let commodity = detail["symbol"].as_str().unwrap_or("GC").to_string();
    json!({
        "commodity": commodity,
        "name": detail["name"],
        "category": detail["category"],
        "linkages": [
            {"commodity": detail["symbol"], "macroIndicator":"real_rates", "correlation": round2(signed_number(&format!("{}:real-rates", symbol), 0.88)), "leadLagDays": -6, "relationship":"inverse", "strength":"high"},
            {"commodity": detail["symbol"], "macroIndicator":"usd_index", "correlation": round2(signed_number(&format!("{}:usd", symbol), 0.82)), "leadLagDays": -3, "relationship":"inverse", "strength":"medium"},
            {"commodity": detail["symbol"], "macroIndicator":"global_pmi", "correlation": round2(signed_number(&format!("{}:pmi", symbol), 0.79)), "leadLagDays": 10, "relationship":"pro-cyclical", "strength":"medium"},
        ],
        "primaryDriver": if detail["category"] == "Energy" { "global demand and inventories" } else { "real rates and USD" },
    })
}

pub fn build_filings(symbol: &str) -> Value {
    let normalized = normalize_symbol(symbol);
    let cik = format!("{:010}", integer(&format!("{}:sec-cik", normalized), 100_000, 999_999));
    Value::Array(vec![
        json!({"formType":"10-K","filedDate":"2026-02-14","periodEnd":"2025-12-31","description":format!("{normalized} annual report"),"url":format!("https://www.sec.gov/Archives/edgar/data/{cik}/10k.htm")}),
        json!({"formType":"10-Q","filedDate":"2025-11-07","periodEnd":"2025-09-30","description":format!("{normalized} quarterly report"),"url":format!("https://www.sec.gov/Archives/edgar/data/{cik}/10q.htm")}),
        json!({"formType":"8-K","filedDate":"2025-10-23","periodEnd":"2025-10-23","description":"Current report on material update","url":format!("https://www.sec.gov/Archives/edgar/data/{cik}/8k.htm")}),
    ])
}

pub fn build_earnings_quality(symbol: &str) -> Value {
    let report = build_report(symbol);
    json!({
        "mScore": round2(number(&format!("{}:m-score", report.symbol), -2.6, -1.4)),
        "fScore": integer(&format!("{}:f-score", report.symbol), 4, 9),
        "zScore": round2(number(&format!("{}:z-score", report.symbol), 1.8, 4.4)),
        "accrualsRatio": round2(number(&format!("{}:accruals", report.symbol), -0.06, 0.18)),
        "manipulationRisk": if report.earnings_quality_score >= 72.0 { "low" } else if report.earnings_quality_score >= 56.0 { "moderate" } else { "elevated" },
    })
}

pub fn build_red_flags(symbol: &str) -> Value {
    let normalized = normalize_symbol(symbol);
    let risk_score = round2(number(&format!("{}:risk-score", normalized), 18.0, 74.0));
    json!({
        "symbol": normalized,
        "overallRisk": if risk_score >= 60.0 { "high" } else if risk_score >= 38.0 { "medium" } else { "low" },
        "riskScore": risk_score,
        "flags": [
            {"category":"working_capital","severity":"medium","description":"Receivables growth is outpacing revenue growth.","metric":"receivablesDays","value": round2(number(&format!("{}:receivables", normalized), 42.0, 86.0))},
            {"category":"margin_quality","severity":"low","description":"Gross margin expansion is slowing sequentially.","metric":"grossMargin","value": round2(number(&format!("{}:gross-margin", normalized), 28.0, 76.0))},
            {"category":"balance_sheet","severity":"medium","description":"Net leverage remains above sector median.","metric":"debtToEquity","value": round2(number(&format!("{}:debt-equity", normalized), 0.18, 1.6))},
        ],
        "timestamp": now(),
    })
}

pub fn build_piotroski(symbol: &str) -> Value {
    let normalized = normalize_symbol(symbol);
    let score = integer(&format!("{}:piotroski", normalized), 4, 9);
    json!({
        "symbol": normalized,
        "score": score,
        "components": {
            "positiveRoa": score >= 5,
            "positiveCfo": true,
            "improvingRoa": score >= 6,
            "cfoExceedsNetIncome": score >= 5,
            "lowerLeverage": score >= 7,
            "betterLiquidity": score >= 6,
            "noDilution": score >= 4,
            "higherGrossMargin": score >= 5,
            "higherAssetTurnover": score >= 6,
        },
        "interpretation": if score >= 8 { "strong fundamental quality" } else if score >= 6 { "above-average quality" } else { "mixed quality profile" },
    })
}

pub fn build_altman(symbol: &str) -> Value {
    let normalized = normalize_symbol(symbol);
    let score = round2(number(&format!("{}:altman", normalized), 1.9, 4.8));
    json!({
        "symbol": normalized,
        "score": score,
        "zone": if score >= 3.0 { "safe" } else if score >= 1.8 { "grey" } else { "distress" },
        "components": {
            "workingCapitalToAssets": round2(number(&format!("{}:wc-assets", normalized), 0.04, 0.32)),
            "retainedEarningsToAssets": round2(number(&format!("{}:re-assets", normalized), 0.06, 0.42)),
            "ebitToAssets": round2(number(&format!("{}:ebit-assets", normalized), 0.03, 0.24)),
            "marketValueToLiabilities": round2(number(&format!("{}:mv-liab", normalized), 0.8, 3.6)),
            "salesToAssets": round2(number(&format!("{}:sales-assets", normalized), 0.5, 2.4)),
        },
        "interpretation": if score >= 3.0 { "comfortable solvency profile" } else if score >= 1.8 { "monitor leverage and liquidity closely" } else { "heightened distress risk" },
    })
}

pub fn build_signal(symbol: &str) -> Value {
    let normalized = normalize_symbol(symbol);
    let report = build_summary(symbol);
    let conviction = round2(number(&format!("{}:conviction", normalized), 0.38, 0.92));
    let change_pct = signed_percent(&format!("{}:signal-change", normalized), 3.0);
    let signal_type = if report.overall_score >= 72.0 && change_pct >= 0.0 {
        "buy"
    } else if report.overall_score < 48.0 {
        "sell"
    } else {
        "watch"
    };
    json!({
        "signalId": format!("sig-{}-{}", normalized.to_lowercase(), integer(&format!("{}:signal-id", normalized), 1000, 9999)),
        "symbol": normalized,
        "signalType": signal_type,
        "strength": if conviction >= 0.75 { "strong" } else if conviction >= 0.55 { "moderate" } else { "tentative" },
        "conviction": conviction,
        "factors": {
            "valuation": round2(report.overall_score / 100.0),
            "momentum": round2((change_pct + 5.0) / 10.0),
            "quality": round2(number(&format!("{}:quality-factor", normalized), 0.35, 0.9)),
            "flow": round2(number(&format!("{}:flow-factor", normalized), 0.28, 0.86)),
        },
        "priceAtSignal": report.current_price,
        "targetPrice": round2(report.current_price * number(&format!("{}:target", normalized), 1.08, 1.34)),
        "stopLoss": round2(report.current_price * number(&format!("{}:stop", normalized), 0.84, 0.94)),
        "reasoning": format!("Signal blends valuation score {:.0}, sector leadership, and flow backdrop for {}.", report.overall_score, normalized),
        "timestamp": now(),
    })
}

pub fn build_signals(request: &SignalRequest) -> Value {
    let min_conviction = request.min_conviction.unwrap_or(0.5);
    let signals = request
        .symbols
        .iter()
        .map(|symbol| build_signal(symbol))
        .filter(|signal| value_f64(signal, "conviction") >= min_conviction)
        .collect::<Vec<_>>();
    json!({
        "signals": signals,
        "totalRequested": request.symbols.len(),
        "signalsGenerated": signals.len(),
    })
}

pub fn build_signal_backtest(request: &BacktestRequest) -> Value {
    let trades = (request.symbols.len().max(1) as f64 * 6.0).round() as i64;
    let return_base = signed_percent(&format!("backtest:return:{:?}", request.symbols), 28.0);
    json!({
        "totalReturn": round2(return_base),
        "sharpeRatio": round2(number(&format!("backtest:sharpe:{:?}", request.symbols), 0.6, 1.9)),
        "maxDrawdown": round2(number(&format!("backtest:mdd:{:?}", request.symbols), 4.0, 22.0)),
        "winRate": round2(number(&format!("backtest:winrate:{:?}", request.symbols), 44.0, 72.0)),
        "trades": trades,
    })
}

pub fn build_signal_performance() -> Value {
    json!({
        "totalSignals": integer("signals:total", 180, 940),
        "winRate": round2(number("signals:winrate", 48.0, 67.0)),
        "avgReturn": round2(number("signals:avg-return", 2.2, 9.8)),
        "profitFactor": round2(number("signals:profit-factor", 1.1, 2.6)),
    })
}

pub fn build_prediction_markets_health() -> Value {
    json!({
        "status": "ok",
        "provider": "investing-core",
        "polymarket_sample_size": POLYMARKET_FIXTURES.len(),
    })
}

pub fn build_polymarket_markets(
    search: Option<&str>,
    status: Option<&str>,
    min_volume: Option<f64>,
    limit: usize,
    offset: usize,
) -> Value {
    let search = search.unwrap_or_default().to_ascii_lowercase();
    let desired_status = status.unwrap_or("open").to_ascii_lowercase();
    let min_volume = min_volume.unwrap_or(0.0);

    let mut markets = POLYMARKET_FIXTURES
        .iter()
        .enumerate()
        .map(|(index, (slug, title, yes_id, no_id))| {
            let volume = round2(number(&format!("poly:{slug}:volume"), 220_000.0, 8_400_000.0));
            let state = if index % 3 == 2 { "resolved" } else { "open" };
            json!({
                "market_slug": slug,
                "condition_id": format!("cond-{slug}"),
                "title": title,
                "start_time": (Utc::now() - Duration::days((index * 6) as i64)).timestamp(),
                "end_time": (Utc::now() + Duration::days((index * 25 + 14) as i64)).timestamp(),
                "status": state,
                "volume_total": volume,
                "tags": ["macro", "markets", if title.contains("Fed") { "rates" } else { "equities" }],
                "side_a": {"id": yes_id, "label":"Yes"},
                "side_b": {"id": no_id, "label":"No"},
            })
        })
        .filter(|item| {
            let title = item["title"].as_str().unwrap_or_default().to_ascii_lowercase();
            let slug = item["market_slug"].as_str().unwrap_or_default().to_ascii_lowercase();
            let state = item["status"].as_str().unwrap_or_default().to_ascii_lowercase();
            let volume = item["volume_total"].as_f64().unwrap_or(0.0);
            (search.is_empty() || title.contains(&search) || slug.contains(&search))
                && (desired_status.is_empty() || state == desired_status)
                && volume >= min_volume
        })
        .collect::<Vec<_>>();

    let slice = slice_window(&mut markets, offset, limit.max(1));
    json!({ "markets": slice })
}

pub fn build_polymarket_market_price(token_id: &str) -> Value {
    json!({
        "price": round4(number(&format!("poly-price:{token_id}"), 0.08, 0.92)),
        "at_time": Utc::now().timestamp(),
    })
}

pub fn build_kalshi_markets(
    search: Option<&str>,
    status: Option<&str>,
    min_volume: Option<f64>,
    limit: usize,
    offset: usize,
) -> Value {
    let search = search.unwrap_or_default().to_ascii_lowercase();
    let desired_status = status.unwrap_or("open").to_ascii_lowercase();
    let min_volume = min_volume.unwrap_or(0.0);
    let mut markets = KALSHI_FIXTURES
        .iter()
        .enumerate()
        .map(|(index, (ticker, title))| {
            let volume = round2(number(&format!("kalshi:{ticker}:volume"), 140_000.0, 4_600_000.0));
            json!({
                "event_ticker": ticker.split('-').next(),
                "market_ticker": ticker,
                "title": title,
                "start_time": (Utc::now() - Duration::days((index * 8) as i64)).timestamp(),
                "end_time": (Utc::now() + Duration::days((index * 14 + 10) as i64)).timestamp(),
                "close_time": (Utc::now() + Duration::days((index * 14 + 9) as i64)).timestamp(),
                "status": if index == 2 { "open" } else { "active" },
                "last_price": round4(number(&format!("kalshi:{ticker}:last"), 0.11, 0.89)),
                "volume": volume,
                "volume_24h": round2(volume * number(&format!("kalshi:{ticker}:v24h"), 0.08, 0.24)),
            })
        })
        .filter(|item| {
            let title = item["title"].as_str().unwrap_or_default().to_ascii_lowercase();
            let ticker = item["market_ticker"].as_str().unwrap_or_default().to_ascii_lowercase();
            let state = item["status"].as_str().unwrap_or_default().to_ascii_lowercase();
            let volume = item["volume"].as_f64().unwrap_or(0.0);
            (search.is_empty() || title.contains(&search) || ticker.contains(&search))
                && (desired_status.is_empty() || state == desired_status || (desired_status == "open" && state == "active"))
                && volume >= min_volume
        })
        .collect::<Vec<_>>();

    let slice = slice_window(&mut markets, offset, limit.max(1));
    json!({ "markets": slice })
}

pub fn build_kalshi_market_price(market_ticker: &str) -> Value {
    let yes = round4(number(&format!("kalshi-price:{market_ticker}"), 0.09, 0.91));
    json!({
        "yes": {
            "price": yes,
            "at_time": Utc::now().timestamp(),
        },
        "no": {
            "price": round4(1.0 - yes),
            "at_time": Utc::now().timestamp(),
        }
    })
}

pub fn build_portfolio_analytics(request: &PortfolioAnalyticsRequest) -> Value {
    let holdings = normalized_holdings(&request.holdings);
    let benchmark = request
        .benchmark
        .clone()
        .unwrap_or_else(|| "SPY".to_string());
    let enriched = enrich_holdings(&holdings);
    let total_value = round2(enriched.iter().map(|item| item.market_value).sum());
    let total_cost = round2(enriched.iter().map(|item| item.cost).sum());
    let total_return = round2(total_value - total_cost);
    let total_return_pct = if total_cost <= 0.0 {
        0.0
    } else {
        round2((total_return / total_cost) * 100.0)
    };
    let (portfolio_returns, _) = portfolio_returns(&holdings, 252);
    let benchmark_returns = bar_returns(&synthetic_bars(&benchmark, 252, "1d"));
    let beta = round2(beta_of(&portfolio_returns, &benchmark_returns));
    let alpha = round2(total_return_pct - signed_percent(&format!("{benchmark}:alpha-ref"), 12.0));
    let risk_95 = calculate_risk_metrics(&portfolio_returns, total_value.max(1.0), 0.95, 0.04)
        .ok();
    let risk_99 = calculate_risk_metrics(&portfolio_returns, total_value.max(1.0), 0.99, 0.04)
        .ok();
    let sector_exposure = sector_weights(&enriched);
    let top_holdings = enriched
        .iter()
        .take(8)
        .map(|item| {
            json!({
                "symbol": item.symbol,
                "shares": item.shares,
                "averageCost": round2(item.average_cost),
                "currentPrice": round2(item.price),
                "marketValue": round2(item.market_value),
                "weight": round2(item.weight * 100.0),
            })
        })
        .collect::<Vec<_>>();

    json!({
        "totalValue": total_value,
        "totalCost": total_cost,
        "totalReturn": total_return,
        "totalReturnPercent": total_return_pct,
        "beta": beta,
        "alpha": alpha,
        "sharpeRatio": round2(risk_95.as_ref().map(|value| value.sharpe_ratio).unwrap_or(0.0)),
        "sortinoRatio": round2(risk_95.as_ref().map(|value| value.sortino_ratio).unwrap_or(0.0)),
        "var95": round2(risk_95.as_ref().map(|value| value.var).unwrap_or(0.0)),
        "var99": round2(risk_99.as_ref().map(|value| value.var).unwrap_or(0.0)),
        "var95Percent": round2(risk_95.as_ref().map(|value| value.var_percent).unwrap_or(0.0)),
        "var99Percent": round2(risk_99.as_ref().map(|value| value.var_percent).unwrap_or(0.0)),
        "volatility": round2(risk_95.as_ref().map(|value| value.volatility_percent).unwrap_or(0.0)),
        "maxDrawdown": round2(risk_95.as_ref().map(|value| value.max_drawdown_percent).unwrap_or(0.0)),
        "sectorExposure": sector_exposure,
        "topHoldings": top_holdings,
    })
}

pub fn build_portfolio_risk(request: &PortfolioRiskRequest) -> Value {
    let holdings = normalized_holdings(&request.holdings);
    let enriched = enrich_holdings(&holdings);
    let total_value = enriched.iter().map(|item| item.market_value).sum::<f64>().max(1.0);
    let (portfolio_returns, _) = portfolio_returns(&holdings, request.lookback_days.max(30) as usize);
    let benchmark_returns = bar_returns(&synthetic_bars("SPY", request.lookback_days.max(30) as usize, "1d"));
    let risk_95 = calculate_risk_metrics(&portfolio_returns, total_value, 0.95, 0.04).ok();
    let risk_99 = calculate_risk_metrics(&portfolio_returns, total_value, 0.99, 0.04).ok();
    let beta = round2(beta_of(&portfolio_returns, &benchmark_returns));

    json!({
        "var95": round2(risk_95.as_ref().map(|value| value.var).unwrap_or(0.0)),
        "var99": round2(risk_99.as_ref().map(|value| value.var).unwrap_or(0.0)),
        "var95Percent": round2(risk_95.as_ref().map(|value| value.var_percent).unwrap_or(0.0)),
        "var99Percent": round2(risk_99.as_ref().map(|value| value.var_percent).unwrap_or(0.0)),
        "cvar95": round2(risk_95.as_ref().map(|value| value.cvar).unwrap_or(0.0)),
        "cvar99": round2(risk_99.as_ref().map(|value| value.cvar).unwrap_or(0.0)),
        "maxDrawdown": round2(risk_95.as_ref().map(|value| value.max_drawdown_percent).unwrap_or(0.0)),
        "volatility": round2(risk_95.as_ref().map(|value| value.volatility_percent).unwrap_or(0.0)),
        "sharpeRatio": round2(risk_95.as_ref().map(|value| value.sharpe_ratio).unwrap_or(0.0)),
        "sortinoRatio": round2(risk_95.as_ref().map(|value| value.sortino_ratio).unwrap_or(0.0)),
        "beta": beta,
        "method": request.method,
        "lookbackDays": request.lookback_days,
    })
}

pub fn build_portfolio_correlation(request: &PortfolioCorrelationRequest) -> Value {
    let holdings = normalized_holdings(&request.holdings);
    let symbols = holdings.iter().map(|item| item.symbol.clone()).collect::<Vec<_>>();
    let matrix = correlation_matrix_from_symbols(&symbols);
    let highly = high_correlation_pairs(&symbols, &matrix);
    let avg_abs = highly
        .iter()
        .map(|pair| pair["correlation"].as_f64().unwrap_or(0.0).abs())
        .sum::<f64>()
        / highly.len().max(1) as f64;
    let diversification = round2((100.0 - (avg_abs * 38.0)).clamp(22.0, 92.0));
    json!({
        "symbols": symbols,
        "matrix": matrix,
        "highlyCorrelated": highly,
        "diversificationScore": diversification,
    })
}

pub fn build_portfolio_attribution(request: &PortfolioAttributionRequest) -> Value {
    let holdings = normalized_holdings(&request.holdings);
    let benchmark = request
        .benchmark
        .clone()
        .unwrap_or_else(|| "SPY".to_string());
    let enriched = enrich_holdings(&holdings);
    let days = period_to_points(&request.period);
    let benchmark_return = total_return_pct(&synthetic_bars(&benchmark, days, "1d"));
    let by_holding = enriched
        .iter()
        .map(|item| {
            let returns = synthetic_bars(&item.symbol, days, "1d");
            let return_pct = total_return_pct(&returns);
            json!({
                "symbol": item.symbol,
                "weight": round2(item.weight * 100.0),
                "returnPct": round2(return_pct),
                "contribution": round2(return_pct * item.weight),
                "sector": item.sector,
            })
        })
        .collect::<Vec<_>>();

    let total_return = round2(
        by_holding
            .iter()
            .filter_map(|item| item.get("contribution").and_then(Value::as_f64))
            .sum::<f64>(),
    );
    let by_sector = aggregate_sector_contributions(&by_holding);

    json!({
        "period": request.period,
        "totalReturn": total_return,
        "benchmarkReturn": round2(benchmark_return),
        "activeReturn": round2(total_return - benchmark_return),
        "bySector": by_sector,
        "byHolding": by_holding,
    })
}

pub fn build_sector_exposure(request: &PortfolioAnalyticsRequest) -> Value {
    let holdings = normalized_holdings(&request.holdings);
    let enriched = enrich_holdings(&holdings);
    let portfolio_weights = sector_weights(&enriched);
    let benchmark_weights = benchmark_sector_weights(
        request
            .benchmark
            .clone()
            .unwrap_or_else(|| "SPY".to_string())
            .as_str(),
    );
    let active_weights = merge_active_weights(&portfolio_weights, &benchmark_weights);

    json!({
        "portfolioWeights": portfolio_weights,
        "benchmarkWeights": benchmark_weights,
        "activeWeights": active_weights,
    })
}

fn default_confidence() -> f64 {
    0.95
}

fn default_method() -> String {
    "historical".to_string()
}

fn default_lookback() -> u32 {
    252
}

fn default_period() -> String {
    "1M".to_string()
}

fn default_holding_period() -> u32 {
    30
}

fn default_initial_capital() -> f64 {
    100_000.0
}

#[derive(Debug, Clone)]
struct MacroSnapshot {
    country: String,
    snapshot: Value,
    gdp_growth: f64,
    inflation: f64,
    unemployment: f64,
    policy_rate: f64,
    current_account: f64,
}

#[derive(Debug, Clone)]
struct EnrichedHolding {
    symbol: String,
    shares: f64,
    average_cost: f64,
    price: f64,
    cost: f64,
    market_value: f64,
    weight: f64,
    sector: String,
}

fn macro_snapshot(country: &str) -> MacroSnapshot {
    let normalized = normalize_country(country);
    let (gdp_growth, inflation, unemployment, policy_rate, current_account, regime) =
        match normalized.as_str() {
            "DEU" => (0.8, 2.6, 5.9, 3.25, 6.2, "transition"),
            "GBR" => (1.1, 3.1, 4.4, 4.50, -2.4, "risk_off"),
            "JPN" => (0.9, 2.3, 2.6, 0.50, 3.4, "reflation"),
            "CHN" => (4.2, 1.1, 5.2, 2.35, 1.3, "transition"),
            "FRA" => (1.0, 2.4, 7.2, 3.25, 0.2, "transition"),
            "CAN" => (1.4, 2.7, 6.0, 4.25, -0.8, "transition"),
            "AUS" => (2.0, 3.0, 4.1, 4.35, -1.1, "goldilocks"),
            _ => (2.1, 2.9, 4.2, 4.50, -3.1, "goldilocks"),
        };

    MacroSnapshot {
        country: normalized.clone(),
        snapshot: json!({
            "country": normalized,
            "gdpGrowth": round2(gdp_growth),
            "inflation": round2(inflation),
            "unemployment": round2(unemployment),
            "policyRate": round2(policy_rate),
            "currentAccount": round2(current_account),
            "regime": regime,
            "timestamp": now(),
        }),
        gdp_growth,
        inflation,
        unemployment,
        policy_rate,
        current_account,
    }
}

fn macro_indicator_rows(country: &str) -> Vec<Value> {
    let snapshot = macro_snapshot(country);
    vec![
        json!({"category":"growth","code":"GDP_GROWTH","name":"GDP Growth","value": round2(snapshot.gdp_growth),"previousValue": round2(snapshot.gdp_growth - 0.2),"change":0.2,"unit":"%","frequency":"quarterly","lastUpdate":now(),"source":"investing-core"}),
        json!({"category":"inflation","code":"CPI","name":"Inflation","value": round2(snapshot.inflation),"previousValue": round2(snapshot.inflation + 0.1),"change":-0.1,"unit":"%","frequency":"monthly","lastUpdate":now(),"source":"investing-core"}),
        json!({"category":"labor","code":"UNEMPLOYMENT","name":"Unemployment","value": round2(snapshot.unemployment),"previousValue": round2(snapshot.unemployment + 0.1),"change":-0.1,"unit":"%","frequency":"monthly","lastUpdate":now(),"source":"investing-core"}),
        json!({"category":"rates","code":"POLICY_RATE","name":"Policy Rate","value": round2(snapshot.policy_rate),"previousValue": round2(snapshot.policy_rate),"change":0.0,"unit":"%","frequency":"meeting","lastUpdate":now(),"source":"investing-core"}),
        json!({"category":"external","code":"CURRENT_ACCOUNT","name":"Current Account","value": round2(snapshot.current_account),"previousValue": round2(snapshot.current_account - 0.2),"change":0.2,"unit":"% GDP","frequency":"quarterly","lastUpdate":now(),"source":"investing-core"}),
    ]
}

fn commodity_price(symbol: &str, name: &str) -> Value {
    let normalized = normalize_symbol(symbol);
    let price = round2(number(&format!("{}:commodity-price", normalized), 24.0, 210.0));
    json!({
        "symbol": normalized,
        "name": name,
        "price": price,
        "change": round2(price * signed_percent(&format!("{}:commodity-change", normalized), 3.8) / 100.0),
        "changePercent": round2(signed_percent(&format!("{}:commodity-change-pct", normalized), 3.8)),
        "high": round2(price * 1.024),
        "low": round2(price * 0.976),
        "volume": integer(&format!("{}:commodity-volume", normalized), 40_000, 620_000),
        "openInterest": integer(&format!("{}:commodity-oi", normalized), 60_000, 1_800_000),
        "timestamp": now(),
    })
}

fn option_contracts(symbol: &str, underlying_price: f64, expiry: &str, calls: bool) -> Vec<Value> {
    (-4..=4)
        .map(|step| {
            let strike = round2(underlying_price * (1.0 + (step as f64 * 0.05)));
            let intrinsic = if calls {
                (underlying_price - strike).max(0.0)
            } else {
                (strike - underlying_price).max(0.0)
            };
            let time_value = number(&format!("{symbol}:{expiry}:{step}:time-value"), 0.6, 8.6);
            let last = round2(intrinsic + time_value);
            json!({
                "strike": strike,
                "expiry": expiry,
                "bid": round2((last * 0.96).max(0.05)),
                "ask": round2(last * 1.04),
                "last": last,
                "volume": integer(&format!("{symbol}:{expiry}:{step}:volume"), 50, 4_200),
                "openInterest": integer(&format!("{symbol}:{expiry}:{step}:oi"), 80, 8_400),
                "impliedVolatility": round2(number(&format!("{symbol}:{expiry}:{step}:iv"), 0.18, 0.78)),
                "delta": round2(if calls { (0.52 - (step as f64 * 0.08)).clamp(0.08, 0.92) } else { (-0.48 - (step as f64 * 0.08)).clamp(-0.92, -0.08) }),
                "gamma": round4(number(&format!("{symbol}:{expiry}:{step}:gamma"), 0.01, 0.14)),
                "theta": round4(-number(&format!("{symbol}:{expiry}:{step}:theta"), 0.01, 0.12)),
                "vega": round4(number(&format!("{symbol}:{expiry}:{step}:vega"), 0.02, 0.22)),
            })
        })
        .collect()
}

fn normalized_holdings(holdings: &[PortfolioHoldingInput]) -> Vec<PortfolioHoldingInput> {
    holdings
        .iter()
        .filter(|item| item.shares > 0.0)
        .map(|item| PortfolioHoldingInput {
            symbol: normalize_symbol(&item.symbol),
            shares: item.shares,
            average_cost: item.average_cost,
        })
        .collect()
}

fn enrich_holdings(holdings: &[PortfolioHoldingInput]) -> Vec<EnrichedHolding> {
    let mut enriched = holdings
        .iter()
        .map(|item| {
            let market = build_market_data(&item.symbol);
            let price = value_f64(&market, "price");
            let average_cost = item.average_cost.unwrap_or_else(|| round2(price * 0.91));
            let market_value = item.shares * price;
            let cost = item.shares * average_cost;
            let sector = build_summary(&item.symbol).sector;
            EnrichedHolding {
                symbol: item.symbol.clone(),
                shares: item.shares,
                average_cost,
                price,
                cost,
                market_value,
                weight: 0.0,
                sector,
            }
        })
        .collect::<Vec<_>>();

    let total_value = enriched.iter().map(|item| item.market_value).sum::<f64>().max(1.0);
    for item in &mut enriched {
        item.weight = item.market_value / total_value;
    }
    enriched.sort_by(|left, right| {
        right
            .market_value
            .partial_cmp(&left.market_value)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    enriched
}

fn portfolio_returns(holdings: &[PortfolioHoldingInput], days: usize) -> (Vec<f64>, f64) {
    let enriched = enrich_holdings(holdings);
    let total_value = enriched.iter().map(|item| item.market_value).sum::<f64>().max(1.0);
    let mut combined = vec![0.0; days.saturating_sub(1)];

    for item in enriched {
        let bars = synthetic_bars(&item.symbol, days, "1d");
        let returns = bar_returns(&bars);
        for (index, value) in returns.iter().enumerate() {
            combined[index] += value * item.market_value / total_value;
        }
    }

    (combined, total_value)
}

fn sector_weights(holdings: &[EnrichedHolding]) -> BTreeMap<String, f64> {
    let mut weights = BTreeMap::new();
    for item in holdings {
        *weights.entry(item.sector.clone()).or_insert(0.0) += item.weight * 100.0;
    }
    weights.values_mut().for_each(|value| *value = round2(*value));
    weights
}

fn benchmark_sector_weights(benchmark: &str) -> BTreeMap<String, f64> {
    let key = normalize_symbol(benchmark);
    let base = if key == "QQQ" {
        vec![
            ("Technology", 48.0),
            ("Communication Services", 15.0),
            ("Consumer Discretionary", 12.0),
            ("Health Care", 7.0),
        ]
    } else {
        vec![
            ("Technology", 29.0),
            ("Financials", 13.0),
            ("Health Care", 12.0),
            ("Consumer Discretionary", 10.0),
            ("Industrials", 8.0),
            ("Energy", 4.0),
            ("Utilities", 3.0),
        ]
    };
    base.into_iter()
        .map(|(sector, weight)| (sector.to_string(), weight))
        .collect()
}

fn merge_active_weights(
    portfolio: &BTreeMap<String, f64>,
    benchmark: &BTreeMap<String, f64>,
) -> BTreeMap<String, f64> {
    let mut active = BTreeMap::new();
    for key in portfolio.keys().chain(benchmark.keys()) {
        let portfolio_weight = portfolio.get(key).copied().unwrap_or(0.0);
        let benchmark_weight = benchmark.get(key).copied().unwrap_or(0.0);
        active.insert(key.clone(), round2(portfolio_weight - benchmark_weight));
    }
    active
}

fn correlation_matrix_from_symbols(symbols: &[String]) -> Vec<Vec<f64>> {
    symbols
        .iter()
        .enumerate()
        .map(|(row_index, left)| {
            symbols
                .iter()
                .enumerate()
                .map(|(col_index, right)| {
                    if row_index == col_index {
                        1.0
                    } else {
                        let left_sector = build_summary(left).sector;
                        let right_sector = build_summary(right).sector;
                        let base = if left_sector == right_sector { 0.72 } else { 0.38 };
                        round2((base + signed_number(&format!("{left}:{right}:corr"), 0.16)).clamp(-0.2, 0.96))
                    }
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

fn high_correlation_pairs(symbols: &[String], matrix: &[Vec<f64>]) -> Vec<Value> {
    let mut pairs = Vec::new();
    for row in 0..symbols.len() {
        for col in row + 1..symbols.len() {
            let corr = matrix
                .get(row)
                .and_then(|item| item.get(col))
                .copied()
                .unwrap_or(0.0);
            if corr.abs() >= 0.68 {
                pairs.push(json!({
                    "symbol1": symbols[row],
                    "symbol2": symbols[col],
                    "correlation": round2(corr),
                }));
            }
        }
    }
    pairs
}

fn aggregate_sector_contributions(by_holding: &[Value]) -> Vec<Value> {
    let mut totals: BTreeMap<String, (f64, f64)> = BTreeMap::new();
    for holding in by_holding {
        let sector = holding
            .get("sector")
            .and_then(Value::as_str)
            .unwrap_or("Unknown")
            .to_string();
        let weight = holding.get("weight").and_then(Value::as_f64).unwrap_or(0.0);
        let contribution = holding
            .get("contribution")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let entry = totals.entry(sector).or_insert((0.0, 0.0));
        entry.0 += weight;
        entry.1 += contribution;
    }
    totals
        .into_iter()
        .map(|(sector, (weight, contribution))| {
            json!({
                "sector": sector,
                "weight": round2(weight),
                "contribution": round2(contribution),
            })
        })
        .collect()
}

fn synthetic_bars(symbol: &str, points: usize, interval: &str) -> Vec<Value> {
    let normalized = normalize_symbol(symbol);
    let summary = build_summary(&normalized);
    let price = summary.current_price.max(10.0);
    let count = points.max(12).min(365);
    let time_scale = if interval.eq_ignore_ascii_case("1h") { 1.0 } else { 0.32 };
    let drift = signed_number(&format!("{normalized}:drift"), 0.14) / count as f64;
    let final_offset = drift * count as f64
        + (((count - 1) as f64 * 0.37 * time_scale) + number(&format!("{normalized}:phase"), 0.0, 1.8)).sin() * 0.028;

    (0..count)
        .map(|index| {
            let wave = (((index as f64 * 0.37 * time_scale)
                + number(&format!("{normalized}:phase"), 0.0, 1.8))
                .sin())
                * 0.028;
            let trend = drift * index as f64;
            let ratio = 1.0 + wave + trend - final_offset;
            let close = round2((price * ratio).max(1.0));
            let open = round2((close * (1.0 - signed_number(&format!("{normalized}:open:{index}"), 0.008))).max(1.0));
            let high = round2(close.max(open) * (1.0 + number(&format!("{normalized}:high:{index}"), 0.002, 0.016)));
            let low = round2((close.min(open) * (1.0 - number(&format!("{normalized}:low:{index}"), 0.002, 0.016))).max(0.5));
            let days_ago = (count - index - 1) as i64;
            json!({
                "date": (Utc::now() - Duration::days(days_ago)).date_naive().to_string(),
                "open": open,
                "high": high,
                "low": low,
                "close": close,
                "volume": integer(&format!("{normalized}:bar-volume:{index}"), 900_000, 36_000_000),
                "adjClose": close,
            })
        })
        .collect()
}

fn bar_returns(bars: &[Value]) -> Vec<f64> {
    let closes = bars
        .iter()
        .filter_map(|bar| bar.get("close").and_then(Value::as_f64))
        .collect::<Vec<_>>();
    closes
        .windows(2)
        .filter_map(|window| {
            let prev = *window.first()?;
            let next = *window.get(1)?;
            Some((next - prev) / prev.max(0.01))
        })
        .collect()
}

fn total_return_pct(bars: &[Value]) -> f64 {
    let first = bars
        .first()
        .and_then(|item| item.get("close"))
        .and_then(Value::as_f64)
        .unwrap_or(1.0);
    let last = bars
        .last()
        .and_then(|item| item.get("close"))
        .and_then(Value::as_f64)
        .unwrap_or(first);
    if first <= 0.0 {
        0.0
    } else {
        round2(((last - first) / first) * 100.0)
    }
}

fn beta_of(returns: &[f64], benchmark: &[f64]) -> f64 {
    let count = returns.len().min(benchmark.len());
    if count < 5 {
        return 1.0;
    }

    let left = &returns[..count];
    let right = &benchmark[..count];
    let mean_left = left.iter().sum::<f64>() / count as f64;
    let mean_right = right.iter().sum::<f64>() / count as f64;
    let covariance = left
        .iter()
        .zip(right.iter())
        .map(|(lhs, rhs)| (lhs - mean_left) * (rhs - mean_right))
        .sum::<f64>()
        / count as f64;
    let variance = right
        .iter()
        .map(|value| (value - mean_right).powi(2))
        .sum::<f64>()
        / count as f64;

    if variance <= 0.0 {
        1.0
    } else {
        covariance / variance
    }
}

fn period_to_points(period: &str) -> usize {
    match period.trim().to_ascii_uppercase().as_str() {
        "1D" => 12,
        "1W" => 20,
        "1M" => 22,
        "3M" => 66,
        "6M" => 132,
        "1Y" => 252,
        other => other
            .parse::<usize>()
            .ok()
            .map(|value| value.clamp(12, 365))
            .unwrap_or(66),
    }
}

fn sector_prefix(symbol: &str) -> &'static str {
    match build_summary(symbol).sector.as_str() {
        "Technology" => "Atlas",
        "Financials" => "Keystone",
        "Energy" => "Harbor",
        "Health Care" => "Beacon",
        "Industrials" => "Forge",
        _ => "North",
    }
}

fn curve_inputs(country: &str) -> (String, f64, f64, f64) {
    let normalized = normalize_country(country);
    let base_10y = match normalized.as_str() {
        "DEU" => 2.42,
        "GBR" => 4.08,
        "JPN" => 1.34,
        "CHN" => 2.31,
        _ => 4.18,
    };
    let spread_2y10y = round2(number(&format!("{}:2s10s", normalized), -0.42, 0.68));
    let spread_3m10y = round2(number(&format!("{}:3m10y", normalized), -0.78, 0.92));
    (normalized, base_10y, spread_2y10y, spread_3m10y)
}

fn metric_number(
    metrics: &BTreeMap<String, Option<f64>>,
    key: &str,
    fallback: f64,
) -> f64 {
    metrics
        .get(key)
        .copied()
        .flatten()
        .unwrap_or(fallback)
}

fn slice_window(items: &mut [Value], offset: usize, limit: usize) -> Vec<Value> {
    items
        .iter()
        .skip(offset)
        .take(limit)
        .cloned()
        .collect()
}

fn normalize_symbol(value: &str) -> String {
    let filtered = value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '.')
        .collect::<String>()
        .to_ascii_uppercase();
    if filtered.is_empty() {
        "UNKNOWN".to_string()
    } else {
        filtered
    }
}

fn normalize_country(value: &str) -> String {
    match value.trim().to_ascii_uppercase().as_str() {
        "US" | "USA" | "UNITED STATES" => "USA".to_string(),
        "DE" | "DEU" | "GERMANY" => "DEU".to_string(),
        "UK" | "GB" | "GBR" | "UNITED KINGDOM" => "GBR".to_string(),
        "JP" | "JPN" | "JAPAN" => "JPN".to_string(),
        "CN" | "CHN" | "CHINA" => "CHN".to_string(),
        "FR" | "FRA" | "FRANCE" => "FRA".to_string(),
        "CA" | "CAN" | "CANADA" => "CAN".to_string(),
        "AU" | "AUS" | "AUSTRALIA" => "AUS".to_string(),
        other => other.to_string(),
    }
}

fn value_f64(value: &Value, key: &str) -> f64 {
    value.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn integer(key: &str, min: i64, max: i64) -> i64 {
    let range = (max - min).max(1) as f64;
    (min as f64 + number(key, 0.0, range)).round() as i64
}

fn number(key: &str, min: f64, max: f64) -> f64 {
    let base = hash_fraction(key);
    min + ((max - min) * base)
}

fn signed_number(key: &str, amplitude: f64) -> f64 {
    (hash_fraction(key) * 2.0 - 1.0) * amplitude
}

fn signed_percent(key: &str, amplitude: f64) -> f64 {
    round2(signed_number(key, amplitude))
}

fn hash_fraction(value: &str) -> f64 {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    let hashed = hasher.finish();
    (hashed % 10_000) as f64 / 10_000.0
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn round4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}
