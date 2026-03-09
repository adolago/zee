//! Minimal HTTP runtime for Investing.

use crate::research::{
    build_dcf, build_earnings, build_peers, build_report, build_summary, build_valuation,
    DcfOptions,
};
use crate::runtime::{
    CloseTradeRequest, CreateEventRequest, CreatePersonRequest, CreateSectorRequest,
    CreateThesisRequest, CreateTradeRequest, InvestingRuntime,
};
use crate::surface::*;
use crate::{Error, Result};
use chrono::Utc;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::collections::BTreeMap;
use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct ServerOptions {
    pub host: String,
    pub port: u16,
    pub data_dir: PathBuf,
}

impl Default for ServerOptions {
    fn default() -> Self {
        let host = std::env::var("ZEE_INVESTING_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
        let port = std::env::var("ZEE_INVESTING_PORT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(8000);

        Self {
            host,
            port,
            data_dir: InvestingRuntime::default_data_dir(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemHealth {
    status: String,
    version: String,
    uptime: u64,
    services: BTreeMap<String, String>,
    core: bool,
}

#[derive(Debug, Clone, Serialize)]
struct PingResponse {
    pong: bool,
    timestamp: String,
}

#[derive(Debug, Clone, Serialize)]
struct SystemInfo {
    version: String,
    environment: String,
    features: Vec<String>,
    endpoints: usize,
}

#[derive(Debug, Clone, Serialize)]
struct ApiEnvelope<T> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
    timestamp: String,
}

impl<T> ApiEnvelope<T> {
    fn ok(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
            timestamp: Utc::now().to_rfc3339(),
        }
    }

    fn err(error: impl Into<String>) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(error.into()),
            timestamp: Utc::now().to_rfc3339(),
        }
    }
}

#[derive(Debug, Clone)]
struct ServerState {
    runtime: InvestingRuntime,
    started_at: Instant,
}

#[derive(Debug, serde::Deserialize)]
struct SaveNoteRequest {
    content: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HttpMethod {
    Get,
    Post,
    Put,
    Other,
}

impl HttpMethod {
    fn parse(value: &str) -> Self {
        match value {
            "GET" => Self::Get,
            "POST" => Self::Post,
            "PUT" => Self::Put,
            _ => Self::Other,
        }
    }
}

#[derive(Debug)]
struct HttpRequest {
    method: HttpMethod,
    path: String,
    query: Option<String>,
    body: Vec<u8>,
}

#[derive(Debug)]
struct HttpReply {
    status: u16,
    reason: &'static str,
    body: Vec<u8>,
}

impl HttpReply {
    fn json<T: Serialize>(status: u16, reason: &'static str, payload: ApiEnvelope<T>) -> Self {
        let body = serde_json::to_vec(&payload).unwrap_or_else(|error| {
            format!(
                "{{\"success\":false,\"data\":null,\"error\":\"serialization failed: {error}\",\"timestamp\":\"{}\"}}",
                Utc::now().to_rfc3339()
            )
            .into_bytes()
        });

        Self {
            status,
            reason,
            body,
        }
    }
}

pub fn serve(options: ServerOptions) -> Result<()> {
    let listener = TcpListener::bind((options.host.as_str(), options.port))?;
    let state = Arc::new(ServerState {
        runtime: InvestingRuntime::new(options.data_dir),
        started_at: Instant::now(),
    });

    println!(
        "Investing runtime listening on http://{}:{}",
        options.host, options.port
    );

    for stream in listener.incoming() {
        let stream = stream?;
        let state = Arc::clone(&state);

        thread::spawn(move || {
            if let Err(error) = handle_connection(stream, state) {
                eprintln!("Investing connection error: {error}");
            }
        });
    }

    Ok(())
}

fn handle_connection(mut stream: TcpStream, state: Arc<ServerState>) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    let request = read_request(&mut stream)?;
    let reply = dispatch(
        &state,
        request.method,
        &request.path,
        request.query.as_deref(),
        &request.body,
    );
    write_response(&mut stream, &reply)
}

fn read_request(stream: &mut TcpStream) -> io::Result<HttpRequest> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    let mut header_end = None;
    let mut content_length = 0_usize;

    loop {
        let bytes_read = stream.read(&mut chunk)?;
        if bytes_read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..bytes_read]);

        if header_end.is_none() {
            if let Some(end) = find_header_end(&buffer) {
                header_end = Some(end);
                content_length = parse_content_length(&buffer[..end]);
            }
        }

        if let Some(end) = header_end {
            if buffer.len() >= end + content_length {
                break;
            }
        }

        if buffer.len() > 1_048_576 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "request exceeds 1MB limit",
            ));
        }
    }

    let header_end = header_end
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing request headers"))?;
    let header_text = String::from_utf8_lossy(&buffer[..header_end]);
    let mut lines = header_text.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing request line"))?;
    let mut parts = request_line.split_whitespace();
    let method = HttpMethod::parse(parts.next().unwrap_or_default());
    let target = parts.next().unwrap_or("/");

    let mut target_parts = target.splitn(2, '?');
    let path = target_parts.next().unwrap_or("/").to_string();
    let query = target_parts.next().map(ToOwned::to_owned);
    let body = buffer[header_end..header_end + content_length].to_vec();

    Ok(HttpRequest {
        method,
        path,
        query,
        body,
    })
}

fn write_response(stream: &mut TcpStream, reply: &HttpReply) -> io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        reply.status,
        reply.reason,
        reply.body.len()
    )?;
    stream.write_all(&reply.body)?;
    stream.flush()
}

fn dispatch(
    state: &ServerState,
    method: HttpMethod,
    path: &str,
    query: Option<&str>,
    body: &[u8],
) -> HttpReply {
    let segments = decode_segments(path);
    let segments = segments.iter().map(String::as_str).collect::<Vec<_>>();
    let query = parse_query(query);

    match (method, segments.as_slice()) {
        (HttpMethod::Get, ["api", "health"]) => ok_response(health_payload(state)),
        (HttpMethod::Get, ["api", "ping"]) => ok_response(PingResponse {
            pong: true,
            timestamp: Utc::now().to_rfc3339(),
        }),
        (HttpMethod::Get, ["api", "system", "info"]) => ok_response(SystemInfo {
            version: env!("CARGO_PKG_VERSION").to_string(),
            environment: "rust".to_string(),
            features: vec![
                "health".to_string(),
                "market".to_string(),
                "research".to_string(),
                "institutional".to_string(),
                "analytics".to_string(),
                "portfolio".to_string(),
                "options".to_string(),
                "etf".to_string(),
                "macro".to_string(),
                "commodities".to_string(),
                "accounting".to_string(),
                "signals".to_string(),
                "notes".to_string(),
                "prediction_markets".to_string(),
            ],
            endpoints: 61,
        }),
        (HttpMethod::Get, ["api", "market", "overview"]) => ok_response(build_market_overview()),
        (HttpMethod::Get, ["api", "market", symbol, "quote"]) => {
            ok_response(build_market_quote(symbol))
        }
        (HttpMethod::Get, ["api", "market", symbol, "history"]) => ok_response(
            build_market_history(
                symbol,
                query.get("period").map(String::as_str),
                query.get("interval").map(String::as_str),
            ),
        ),
        (HttpMethod::Get, ["api", "market", symbol]) => ok_response(build_market_data(symbol)),
        (HttpMethod::Get, ["api", "research", symbol, "dcf"]) => {
            let options = DcfOptions {
                discount_rate: parse_f64(query.get("discount_rate"), 0.10),
                terminal_growth: parse_f64(query.get("terminal_growth"), 0.025),
                projection_years: parse_u32(query.get("projection_years"), 5),
            };
            ok_response(build_dcf(symbol, options))
        }
        (HttpMethod::Get, ["api", "research", symbol, "summary"]) => {
            ok_response(build_summary(symbol))
        }
        (HttpMethod::Get, ["api", "research", symbol]) => ok_response(build_report(symbol)),
        (HttpMethod::Get, ["api", "valuation", symbol]) => {
            let include_dcf = parse_bool(query.get("include_dcf"));
            ok_response(build_valuation(symbol, include_dcf))
        }
        (HttpMethod::Get, ["api", "earnings", symbol]) => {
            let quarters = parse_usize(query.get("quarters"), 12);
            ok_response(build_earnings(symbol, quarters))
        }
        (HttpMethod::Get, ["api", "peers", symbol]) => {
            ok_response(build_peers(symbol, query.get("peers").map(String::as_str)))
        }
        (HttpMethod::Get, ["api", "institutional", symbol, "ownership"]) => {
            ok_response(build_ownership(symbol))
        }
        (HttpMethod::Get, ["api", "institutional", symbol, "sentiment"]) => {
            ok_response(build_institutional_sentiment(symbol))
        }
        (HttpMethod::Get, ["api", "institutional", symbol, "smart-money"])
        | (HttpMethod::Get, ["api", "institutional", symbol, "smart-money-flow"]) => {
            ok_response(build_smart_money_flow(symbol))
        }
        (HttpMethod::Get, ["api", "institutional", symbol, "whales"]) => {
            ok_response(build_whale_activity(symbol))
        }
        (HttpMethod::Get, ["api", "institutional", symbol]) => ok_response(
            build_institutional_holdings(symbol, parse_usize(query.get("limit"), 10)),
        ),
        (HttpMethod::Post, ["api", "money-flow"]) => match parse_json::<MoneyFlowRequest>(body) {
            Ok(request) => ok_response(build_money_flow(&request)),
            Err(reply) => reply,
        },
        (HttpMethod::Get, ["api", "dark-pool", symbol]) => ok_response(build_dark_pool(symbol)),
        (HttpMethod::Get, ["api", "equity-flow", symbol]) => {
            ok_response(build_equity_flow(symbol))
        }
        (HttpMethod::Get, ["api", "analytics", "sector-rotation"])
        | (HttpMethod::Get, ["api", "sector-rotation"]) => ok_response(build_sector_rotation()),
        (HttpMethod::Post, ["api", "portfolio", "analytics"]) => {
            match parse_json::<PortfolioAnalyticsRequest>(body) {
                Ok(request) => ok_response(build_portfolio_analytics(&request)),
                Err(reply) => reply,
            }
        }
        (HttpMethod::Post, ["api", "portfolio", "risk"]) => {
            match parse_json::<PortfolioRiskRequest>(body) {
                Ok(request) => ok_response(build_portfolio_risk(&request)),
                Err(reply) => reply,
            }
        }
        (HttpMethod::Post, ["api", "portfolio", "correlation"]) => {
            match parse_json::<PortfolioCorrelationRequest>(body) {
                Ok(request) => ok_response(build_portfolio_correlation(&request)),
                Err(reply) => reply,
            }
        }
        (HttpMethod::Post, ["api", "portfolio", "attribution"]) => {
            match parse_json::<PortfolioAttributionRequest>(body) {
                Ok(request) => ok_response(build_portfolio_attribution(&request)),
                Err(reply) => reply,
            }
        }
        (HttpMethod::Post, ["api", "portfolio", "sector-exposure"]) => {
            match parse_json::<PortfolioAnalyticsRequest>(body) {
                Ok(request) => ok_response(build_sector_exposure(&request)),
                Err(reply) => reply,
            }
        }
        (HttpMethod::Get, ["api", "options", "unusual"]) => {
            ok_response(build_unusual_activity(None))
        }
        (HttpMethod::Get, ["api", "options", symbol, "flow"]) => {
            ok_response(build_options_flow(symbol))
        }
        (HttpMethod::Get, ["api", "options", symbol, "chain"]) => ok_response(
            build_options_chain(symbol, query.get("expiry").map(String::as_str)),
        ),
        (HttpMethod::Get, ["api", "options", symbol, "gamma"]) => {
            ok_response(build_gamma_exposure(symbol))
        }
        (HttpMethod::Get, ["api", "options", symbol, "unusual"]) => {
            ok_response(build_unusual_activity(Some(symbol)))
        }
        (HttpMethod::Get, ["api", "options", symbol, "put-call"]) => {
            ok_response(build_put_call(symbol))
        }
        (HttpMethod::Get, ["api", "options", symbol, "max-pain"]) => ok_response(
            build_max_pain(symbol, query.get("expiry").map(String::as_str)),
        ),
        (HttpMethod::Get, ["api", "etf", "flows"]) => ok_response(build_etf_flows()),
        (HttpMethod::Get, ["api", "etf", "sector-rotation"]) => {
            ok_response(build_etf_sector_rotation())
        }
        (HttpMethod::Get, ["api", "etf", "smart-beta"]) => ok_response(build_smart_beta()),
        (HttpMethod::Get, ["api", "etf", "thematic"]) => ok_response(build_thematic()),
        (HttpMethod::Get, ["api", "macro", "indicators"]) => ok_response(
            build_macro_indicators(
                query
                    .get("country")
                    .map(String::as_str)
                    .unwrap_or("US"),
                query.get("category").map(String::as_str),
            ),
        ),
        (HttpMethod::Get, ["api", "macro", "snapshot", country]) => {
            ok_response(build_macro_snapshot(country))
        }
        (HttpMethod::Get, ["api", "macro", "regime"]) => ok_response(build_macro_regime(
            query.get("country").map(String::as_str),
        )),
        (HttpMethod::Get, ["api", "macro", "yield-curve"]) => ok_response(build_yield_curve(
            query
                .get("country")
                .map(String::as_str)
                .unwrap_or("US"),
        )),
        (HttpMethod::Get, ["api", "macro", "yield-curve", country]) => {
            ok_response(build_yield_curve(country))
        }
        (HttpMethod::Get, ["api", "macro", "recession-probability"]) => ok_response(
            build_recession_probability(
                query
                    .get("country")
                    .map(String::as_str)
                    .unwrap_or("US"),
            ),
        ),
        (HttpMethod::Get, ["api", "macro", "calendar"]) => ok_response(build_macro_calendar()),
        (HttpMethod::Get, ["api", "commodities"]) => ok_response(build_commodities_overview()),
        (HttpMethod::Get, ["api", "commodities", "correlations"]) => {
            ok_response(build_commodities_correlations())
        }
        (HttpMethod::Get, ["api", "commodities", symbol, "macro"]) => {
            ok_response(build_commodity_macro(symbol))
        }
        (HttpMethod::Get, ["api", "commodities", symbol]) => {
            ok_response(build_commodity_detail(symbol))
        }
        (HttpMethod::Get, ["api", "accounting", symbol, "filings"]) => {
            ok_response(build_filings(symbol))
        }
        (HttpMethod::Get, ["api", "accounting", symbol, "quality"]) => {
            ok_response(build_earnings_quality(symbol))
        }
        (HttpMethod::Get, ["api", "accounting", symbol, "red-flags"]) => {
            ok_response(build_red_flags(symbol))
        }
        (HttpMethod::Get, ["api", "accounting", symbol, "piotroski"]) => {
            ok_response(build_piotroski(symbol))
        }
        (HttpMethod::Get, ["api", "accounting", symbol, "altman"]) => {
            ok_response(build_altman(symbol))
        }
        (HttpMethod::Get, ["api", "signals", "performance", "stats"]) => {
            ok_response(build_signal_performance())
        }
        (HttpMethod::Post, ["api", "signals", "backtest"]) => {
            match parse_json::<BacktestRequest>(body) {
                Ok(request) => ok_response(build_signal_backtest(&request)),
                Err(reply) => reply,
            }
        }
        (HttpMethod::Post, ["api", "signals"]) => match parse_json::<SignalRequest>(body) {
            Ok(request) => ok_response(build_signals(&request)),
            Err(reply) => reply,
        },
        (HttpMethod::Get, ["api", "signals", symbol]) => ok_response(build_signal(symbol)),
        (HttpMethod::Get, ["api", "notes"]) => runtime_response(state.runtime.list_notes()),
        (HttpMethod::Get, ["api", "notes", "search"]) => {
            let query_value = query
                .get("query")
                .or_else(|| query.get("q"))
                .cloned()
                .unwrap_or_default();
            runtime_response(state.runtime.search_notes(&query_value))
        }
        (HttpMethod::Get, ["api", "notes", "graph"]) => runtime_response(state.runtime.graph()),
        (HttpMethod::Get, ["api", "notes", note @ ..]) if !note.is_empty() => {
            runtime_response(state.runtime.get_note(&note.join("/")))
        }
        (HttpMethod::Put, ["api", "notes", note @ ..]) if !note.is_empty() => {
            match parse_json::<SaveNoteRequest>(body) {
                Ok(request) => {
                    runtime_response(state.runtime.save_note(&note.join("/"), request.content))
                }
                Err(reply) => reply,
            }
        }
        (HttpMethod::Get, ["api", "theses"]) => runtime_response(
            state.runtime.list_theses_filtered(
                query.get("status").map(String::as_str),
                query.get("symbol").map(String::as_str),
            ),
        ),
        (HttpMethod::Post, ["api", "theses"]) => match parse_json::<CreateThesisRequest>(body) {
            Ok(request) => runtime_response_with_status(201, state.runtime.create_thesis(request)),
            Err(reply) => reply,
        },
        (HttpMethod::Get, ["api", "trades"]) => runtime_response(
            state.runtime.list_trades_filtered(
                query.get("status").map(String::as_str),
                query.get("symbol").map(String::as_str),
            ),
        ),
        (HttpMethod::Post, ["api", "trades"]) => match parse_json::<CreateTradeRequest>(body) {
            Ok(request) => runtime_response_with_status(201, state.runtime.create_trade(request)),
            Err(reply) => reply,
        },
        (HttpMethod::Post, ["api", "trades", name, "close"]) => {
            match parse_json::<CloseTradeRequest>(body) {
                Ok(request) => runtime_response(state.runtime.close_trade(name, request)),
                Err(reply) => reply,
            }
        }
        (HttpMethod::Get, ["api", "trades", "stats"]) => {
            runtime_response(state.runtime.trade_stats())
        }
        (HttpMethod::Get, ["api", "events"]) => runtime_response(
            state.runtime.list_events_filtered(
                query.get("event_type").map(String::as_str),
                query.get("symbol").map(String::as_str),
                query.get("company").map(String::as_str),
            ),
        ),
        (HttpMethod::Post, ["api", "events"]) => match parse_json::<CreateEventRequest>(body) {
            Ok(request) => runtime_response_with_status(201, state.runtime.create_event(request)),
            Err(reply) => reply,
        },
        (HttpMethod::Get, ["api", "people"]) => runtime_response(
            state.runtime.list_people_filtered(
                query.get("company").map(String::as_str),
                query.get("role").map(String::as_str),
            ),
        ),
        (HttpMethod::Post, ["api", "people"]) => match parse_json::<CreatePersonRequest>(body) {
            Ok(request) => runtime_response_with_status(201, state.runtime.create_person(request)),
            Err(reply) => reply,
        },
        (HttpMethod::Get, ["api", "sectors"]) => runtime_response(state.runtime.list_sectors()),
        (HttpMethod::Post, ["api", "sectors"]) => match parse_json::<CreateSectorRequest>(body) {
            Ok(request) => runtime_response_with_status(201, state.runtime.create_sector(request)),
            Err(reply) => reply,
        },
        (HttpMethod::Get, ["api", "prediction-markets", "health"]) => {
            ok_response(build_prediction_markets_health())
        }
        (HttpMethod::Get, ["api", "prediction-markets", "polymarket", "markets"]) => ok_response(
            build_polymarket_markets(
                query.get("search").map(String::as_str),
                query.get("status").map(String::as_str),
                query.get("min_volume").and_then(|value| value.parse().ok()),
                parse_usize(query.get("limit"), 20),
                parse_usize(query.get("offset"), 0),
            ),
        ),
        (HttpMethod::Get, ["api", "prediction-markets", "polymarket", "market-price", token_id]) => {
            ok_response(build_polymarket_market_price(token_id))
        }
        (HttpMethod::Get, ["api", "prediction-markets", "kalshi", "markets"]) => ok_response(
            build_kalshi_markets(
                query.get("search").map(String::as_str),
                query.get("status").map(String::as_str),
                query.get("min_volume").and_then(|value| value.parse().ok()),
                parse_usize(query.get("limit"), 20),
                parse_usize(query.get("offset"), 0),
            ),
        ),
        (HttpMethod::Get, ["api", "prediction-markets", "kalshi", "market-price", market_ticker]) => {
            ok_response(build_kalshi_market_price(market_ticker))
        }
        (_, ["api", "health"])
        | (_, ["api", "ping"])
        | (_, ["api", "system", "info"])
        | (_, ["api", "market", ..])
        | (_, ["api", "research", ..])
        | (_, ["api", "valuation", ..])
        | (_, ["api", "earnings", ..])
        | (_, ["api", "peers", ..])
        | (_, ["api", "institutional", ..])
        | (_, ["api", "money-flow", ..])
        | (_, ["api", "dark-pool", ..])
        | (_, ["api", "equity-flow", ..])
        | (_, ["api", "analytics", ..])
        | (_, ["api", "sector-rotation", ..])
        | (_, ["api", "portfolio", ..])
        | (_, ["api", "options", ..])
        | (_, ["api", "etf", ..])
        | (_, ["api", "macro", ..])
        | (_, ["api", "commodities", ..])
        | (_, ["api", "accounting", ..])
        | (_, ["api", "signals", ..])
        | (_, ["api", "notes", ..])
        | (_, ["api", "theses", ..])
        | (_, ["api", "trades", ..])
        | (_, ["api", "events", ..])
        | (_, ["api", "people", ..])
        | (_, ["api", "sectors", ..])
        | (_, ["api", "prediction-markets", ..]) => error_response(
            405,
            "Method Not Allowed",
            format!("method not allowed for {path}"),
        ),
        _ => error_response(404, "Not Found", format!("unknown route: {path}")),
    }
}

fn health_payload(state: &ServerState) -> SystemHealth {
    SystemHealth {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        uptime: state.started_at.elapsed().as_secs(),
        services: BTreeMap::from([
            ("research".to_string(), "available".to_string()),
            ("runtime".to_string(), "available".to_string()),
            ("storage".to_string(), "filesystem".to_string()),
        ]),
        core: true,
    }
}

fn runtime_response<T: Serialize>(result: Result<T>) -> HttpReply {
    runtime_response_with_status(200, result)
}

fn runtime_response_with_status<T: Serialize>(status: u16, result: Result<T>) -> HttpReply {
    match result {
        Ok(value) => json_response(status, ApiEnvelope::ok(value)),
        Err(error) => error_from_runtime(error),
    }
}

fn error_from_runtime(error: Error) -> HttpReply {
    match error {
        Error::NotFound(message) => error_response(404, "Not Found", message),
        Error::InvalidOperation(message) => error_response(400, "Bad Request", message),
        Error::Json(error) => error_response(
            500,
            "Internal Server Error",
            format!("invalid stored payload: {error}"),
        ),
        Error::Io(error) => error_response(500, "Internal Server Error", error.to_string()),
        other => error_response(400, "Bad Request", other.to_string()),
    }
}

fn parse_json<T: DeserializeOwned>(body: &[u8]) -> std::result::Result<T, HttpReply> {
    serde_json::from_slice(body).map_err(|error| {
        error_response(
            400,
            "Bad Request",
            format!("invalid JSON request body: {error}"),
        )
    })
}

fn ok_response<T: Serialize>(value: T) -> HttpReply {
    json_response(200, ApiEnvelope::ok(value))
}

fn error_response(status: u16, reason: &'static str, message: impl Into<String>) -> HttpReply {
    HttpReply::json(
        status,
        reason,
        ApiEnvelope::<serde_json::Value>::err(message),
    )
}

fn json_response<T: Serialize>(status: u16, payload: ApiEnvelope<T>) -> HttpReply {
    HttpReply::json(status, reason_phrase(status), payload)
}

fn reason_phrase(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Internal Server Error",
    }
}

fn parse_query(query: Option<&str>) -> BTreeMap<String, String> {
    let mut params = BTreeMap::new();

    if let Some(query) = query {
        for pair in query.split('&').filter(|pair| !pair.is_empty()) {
            let mut parts = pair.splitn(2, '=');
            let key = decode_component(parts.next().unwrap_or_default(), true);
            let value = decode_component(parts.next().unwrap_or_default(), true);
            params.insert(key, value);
        }
    }

    params
}

fn decode_segments(path: &str) -> Vec<String> {
    path.trim_matches('/')
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(|segment| decode_component(segment, false))
        .collect()
}

fn decode_component(value: &str, plus_as_space: bool) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        match bytes[index] {
            b'+' if plus_as_space => {
                decoded.push(b' ');
                index += 1;
            }
            b'%' if index + 2 < bytes.len() => {
                if let (Some(high), Some(low)) =
                    (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
                {
                    decoded.push((high << 4) | low);
                    index += 3;
                } else {
                    decoded.push(bytes[index]);
                    index += 1;
                }
            }
            byte => {
                decoded.push(byte);
                index += 1;
            }
        }
    }

    String::from_utf8_lossy(&decoded).into_owned()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn parse_bool(value: Option<&String>) -> bool {
    value
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

fn parse_f64(value: Option<&String>, default: f64) -> f64 {
    value
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn parse_usize(value: Option<&String>, default: usize) -> usize {
    value
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn parse_u32(value: Option<&String>, default: u32) -> u32 {
    value
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|position| position + 4)
}

fn parse_content_length(headers: &[u8]) -> usize {
    let text = String::from_utf8_lossy(headers);
    for line in text.lines() {
        if let Some(value) = line.strip_prefix("Content-Length:") {
            return value.trim().parse().unwrap_or(0);
        }
        if let Some(value) = line.strip_prefix("content-length:") {
            return value.trim().parse().unwrap_or(0);
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::GraphResponse;
    use serde_json::Value;
    use tempfile::tempdir;

    fn state() -> ServerState {
        let dir = tempdir().unwrap();
        ServerState {
            runtime: InvestingRuntime::new(dir.keep()),
            started_at: Instant::now(),
        }
    }

    fn response_json(reply: HttpReply) -> Value {
        serde_json::from_slice(&reply.body).unwrap()
    }

    #[test]
    fn health_endpoint_matches_sdk_envelope() {
        let reply = dispatch(&state(), HttpMethod::Get, "/api/health", None, &[]);
        assert_eq!(reply.status, 200);

        let json = response_json(reply);
        assert_eq!(json["success"], Value::Bool(true));
        assert_eq!(json["data"]["status"], Value::String("ok".to_string()));
        assert_eq!(json["data"]["core"], Value::Bool(true));
    }

    #[test]
    fn research_summary_endpoint_is_available() {
        let reply = dispatch(
            &state(),
            HttpMethod::Get,
            "/api/research/aapl/summary",
            None,
            &[],
        );
        assert_eq!(reply.status, 200);

        let json = response_json(reply);
        assert_eq!(json["data"]["symbol"], Value::String("AAPL".to_string()));
        assert!(json["data"]["topStrengths"].is_array());
    }

    #[test]
    fn notes_endpoints_persist_documents() {
        let state = state();
        let save = dispatch(
            &state,
            HttpMethod::Put,
            "/api/notes/My%20Note",
            None,
            br#"{"content":"hello investing"}"#,
        );
        assert_eq!(save.status, 200);

        let fetch = dispatch(&state, HttpMethod::Get, "/api/notes/my-note", None, &[]);
        let json = response_json(fetch);
        assert_eq!(json["data"]["name"], Value::String("my-note".to_string()));
        assert_eq!(
            json["data"]["content"],
            Value::String("hello investing".to_string())
        );
    }

    #[test]
    fn graph_endpoint_returns_payload() {
        let state = state();
        let _ = dispatch(
            &state,
            HttpMethod::Put,
            "/api/notes/Source",
            None,
            br#"{"content":"see [[Target]]"}"#,
        );
        let _ = dispatch(
            &state,
            HttpMethod::Put,
            "/api/notes/Target",
            None,
            br#"{"content":"done"}"#,
        );

        let reply = dispatch(&state, HttpMethod::Get, "/api/notes/graph", None, &[]);
        let json = response_json(reply);
        let graph: GraphResponse = serde_json::from_value(json["data"].clone()).unwrap();
        assert_eq!(graph.edges.len(), 1);
    }

    #[test]
    fn macro_yield_curve_query_alias_is_available() {
        let reply = dispatch(
            &state(),
            HttpMethod::Get,
            "/api/macro/yield-curve",
            Some("country=USA"),
            &[],
        );

        assert_eq!(reply.status, 200);
        let json = response_json(reply);
        assert_eq!(json["data"]["country"], Value::String("USA".to_string()));
        assert!(json["data"]["curve"].is_array());
    }

    #[test]
    fn portfolio_route_returns_camel_case_payload() {
        let body = br#"{"holdings":[{"symbol":"AAPL","shares":10,"average_cost":150},{"symbol":"MSFT","shares":5,"average_cost":310}],"benchmark":"SPY"}"#;
        let reply = dispatch(
            &state(),
            HttpMethod::Post,
            "/api/portfolio/analytics",
            None,
            body,
        );

        assert_eq!(reply.status, 200);
        let json = response_json(reply);
        assert!(json["data"]["totalValue"].is_number());
        assert!(json["data"]["sectorExposure"].is_object());
        assert!(json["data"]["topHoldings"].is_array());
    }

    #[test]
    fn prediction_markets_routes_are_available() {
        let markets = dispatch(
            &state(),
            HttpMethod::Get,
            "/api/prediction-markets/polymarket/markets",
            Some("status=open&limit=2"),
            &[],
        );
        let markets_json = response_json(markets);
        assert!(markets_json["data"]["markets"].is_array());

        let price = dispatch(
            &state(),
            HttpMethod::Get,
            "/api/prediction-markets/kalshi/market-price/INFLATION-2026-MAR",
            None,
            &[],
        );
        let price_json = response_json(price);
        assert!(price_json["data"]["yes"]["price"].is_number());
        assert!(price_json["data"]["no"]["price"].is_number());
    }

    #[test]
    fn event_and_trade_close_routes_round_trip() {
        let state = state();
        let created_trade = dispatch(
            &state,
            HttpMethod::Post,
            "/api/trades",
            None,
            br#"{"symbol":"NVDA","direction":"long","entryPrice":120,"shares":10}"#,
        );
        assert_eq!(created_trade.status, 201);
        let trade_json = response_json(created_trade);
        let name = trade_json["data"]["name"].as_str().unwrap().to_string();

        let closed = dispatch(
            &state,
            HttpMethod::Post,
            &format!("/api/trades/{name}/close"),
            None,
            br#"{"exitPrice":138,"exitReason":"target hit"}"#,
        );
        assert_eq!(closed.status, 200);
        let closed_json = response_json(closed);
        assert_eq!(
            closed_json["data"]["frontmatter"]["status"],
            Value::String("closed".to_string())
        );

        let event = dispatch(
            &state,
            HttpMethod::Post,
            "/api/events",
            None,
            br#"{"symbol":"MSFT","eventType":"earnings_call","participants":["CEO","CFO"]}"#,
        );
        assert_eq!(event.status, 201);

        let listed = dispatch(
            &state,
            HttpMethod::Get,
            "/api/events",
            Some("symbol=MSFT"),
            &[],
        );
        let listed_json = response_json(listed);
        assert_eq!(listed_json["data"].as_array().map(Vec::len), Some(1));
    }
}
