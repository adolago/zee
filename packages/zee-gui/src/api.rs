//! API client for communicating with Zee's Stanley-backed API surface.
//!
//! Provides async methods for fetching money flow data, institutional
//! holdings, and other analytics from the Stanley runtime service.

#![allow(dead_code)]

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::net::IpAddr;
use std::sync::Arc;
use url::Url;

/// API client for Zee/Stanley backend (async version)
#[derive(Clone)]
pub struct ZeeApiClient {
    pub base_url: String,
    pub client: reqwest::Client,
}

impl ZeeApiClient {
    /// Create a new client, connecting to Zee's API server.
    pub fn new() -> Self {
        let base_url =
            std::env::var("ZEE_SERVER_URL").unwrap_or_else(|_| "http://localhost:3210".to_string());
        Self::with_url(base_url)
    }

    /// Create a new client with custom base URL
    pub fn with_url(base_url: String) -> Self {
        Self {
            base_url,
            client: reqwest::Client::new(),
        }
    }

    /// Create a new client wrapped in Arc for sharing across async tasks
    pub fn new_shared() -> Arc<Self> {
        Arc::new(Self::new())
    }

    fn allow_remote_env() -> bool {
        match env::var("ZEE_ALLOW_REMOTE") {
            Ok(value) => matches!(
                value.to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            ),
            Err(_) => {
                // Fall back to legacy env var
                match env::var("STANLEY_ALLOW_REMOTE") {
                    Ok(value) => matches!(
                        value.to_ascii_lowercase().as_str(),
                        "1" | "true" | "yes" | "on"
                    ),
                    Err(_) => false,
                }
            }
        }
    }

    fn is_localhost_host(host: &str) -> bool {
        if host.eq_ignore_ascii_case("localhost") {
            return true;
        }

        host.parse::<IpAddr>()
            .map(|ip| ip.is_loopback())
            .unwrap_or(false)
    }

    fn ensure_safe_base_url(&self) -> Result<(), ApiError> {
        let url = Url::parse(&self.base_url)
            .map_err(|e| ApiError::Safety(format!("Invalid base URL: {}", e)))?;

        if !url.username().is_empty() || url.password().is_some() {
            return Err(ApiError::Safety(
                "Base URL must not include credentials".to_string(),
            ));
        }

        let scheme = url.scheme();
        if scheme != "http" && scheme != "https" {
            return Err(ApiError::Safety(
                "Base URL must use http or https".to_string(),
            ));
        }

        let host = url
            .host_str()
            .ok_or_else(|| ApiError::Safety("Base URL must include a host".to_string()))?;

        if Self::is_localhost_host(host) {
            return Ok(());
        }

        if !Self::allow_remote_env() {
            return Err(ApiError::Safety(
                "Remote base URL blocked. Set ZEE_ALLOW_REMOTE=1 to allow".to_string(),
            ));
        }

        if scheme != "https" {
            return Err(ApiError::Safety(
                "Remote base URL requires https".to_string(),
            ));
        }

        Ok(())
    }

    fn build_url(&self, path: &str) -> Result<String, ApiError> {
        self.ensure_safe_base_url()?;
        let base = self.base_url.trim_end_matches('/');
        let path = path.trim_start_matches('/');
        Ok(format!("{}/{}", base, path))
    }

    async fn decode_api_response<T: DeserializeOwned>(
        response: reqwest::Response,
    ) -> Result<ApiResponse<T>, ApiError> {
        let body = response
            .text()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))?;

        match serde_json::from_str::<EnvelopeOrRaw<T>>(&body)
            .map_err(|e| ApiError::Parse(e.to_string()))?
        {
            EnvelopeOrRaw::Envelope(envelope) => Ok(envelope),
            EnvelopeOrRaw::Raw(data) => Ok(ApiResponse {
                success: true,
                data: Some(data),
                error: None,
                timestamp: String::new(),
            }),
        }
    }

    async fn decode_payload<T: DeserializeOwned>(
        response: reqwest::Response,
    ) -> Result<T, ApiError> {
        let envelope = Self::decode_api_response(response).await?;
        if !envelope.success {
            return Err(ApiError::Server(
                envelope
                    .error
                    .unwrap_or_else(|| "Unknown server error".to_string()),
            ));
        }

        envelope
            .data
            .ok_or_else(|| ApiError::Server("Missing response data".to_string()))
    }

    pub async fn get_enveloped<T: DeserializeOwned>(
        &self,
        path: &str,
    ) -> Result<ApiResponse<T>, ApiError> {
        let url = self.build_url(path)?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        Self::decode_api_response(response).await
    }

    /// Get money flow analysis for selected sectors
    pub async fn get_money_flow(
        &self,
        sectors: Vec<String>,
    ) -> Result<ApiResponse<MoneyFlowResponse>, ApiError> {
        let url = self.build_url("/api/money-flow")?;
        let response = self
            .client
            .post(&url)
            .json(&SectorFlowRequest { sectors })
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get institutional holdings for a symbol
    pub async fn get_institutional_ownership(
        &self,
        symbol: &str,
    ) -> Result<ApiResponse<InstitutionalOwnershipResponse>, ApiError> {
        let url = self.build_url(&format!("/api/institutional/{}/ownership", symbol))?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get equity money flow analysis
    pub async fn get_equity_flow(&self, symbol: &str) -> Result<EquityFlowResponse, ApiError> {
        let url = self.build_url(&format!("/api/equity-flow/{}", symbol))?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        Self::decode_payload(response).await
    }

    /// Get dark pool activity
    pub async fn get_dark_pool_activity(&self, symbol: &str) -> Result<DarkPoolResponse, ApiError> {
        let url = self.build_url(&format!("/api/dark-pool/{}", symbol))?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        Self::decode_payload(response).await
    }

    /// Health check
    pub async fn health_check(&self) -> Result<HealthResponse, ApiError> {
        let url = self.build_url("/api/health")?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        Self::decode_payload(response).await
    }

    /// Prediction markets health check
    pub async fn prediction_markets_health(
        &self,
    ) -> Result<ApiResponse<PredictionMarketsHealth>, ApiError> {
        let url = self.build_url("/api/prediction-markets/health")?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get Polymarket markets (prediction markets)
    pub async fn get_polymarket_markets(
        &self,
        search: Option<&str>,
        status: Option<&str>,
        min_volume: Option<f64>,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<ApiResponse<PolymarketMarketsResponse>, ApiError> {
        let url = self.build_url("/api/prediction-markets/polymarket/markets")?;
        let mut url = Url::parse(&url).map_err(|e| ApiError::Parse(e.to_string()))?;

        {
            let mut pairs = url.query_pairs_mut();
            if let Some(search) = search {
                pairs.append_pair("search", search);
            }
            if let Some(status) = status {
                pairs.append_pair("status", status);
            }
            if let Some(min_volume) = min_volume {
                pairs.append_pair("min_volume", &min_volume.to_string());
            }
            if let Some(limit) = limit {
                pairs.append_pair("limit", &limit.to_string());
            }
            if let Some(offset) = offset {
                pairs.append_pair("offset", &offset.to_string());
            }
        }

        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get Polymarket market price by token id
    pub async fn get_polymarket_market_price(
        &self,
        token_id: &str,
    ) -> Result<ApiResponse<MarketPricePoint>, ApiError> {
        let url = self.build_url(&format!(
            "/api/prediction-markets/polymarket/market-price/{}",
            token_id
        ))?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get Kalshi markets (prediction markets)
    pub async fn get_kalshi_markets(
        &self,
        search: Option<&str>,
        status: Option<&str>,
        min_volume: Option<f64>,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<ApiResponse<KalshiMarketsResponse>, ApiError> {
        let url = self.build_url("/api/prediction-markets/kalshi/markets")?;
        let mut url = Url::parse(&url).map_err(|e| ApiError::Parse(e.to_string()))?;

        {
            let mut pairs = url.query_pairs_mut();
            if let Some(search) = search {
                pairs.append_pair("search", search);
            }
            if let Some(status) = status {
                pairs.append_pair("status", status);
            }
            if let Some(min_volume) = min_volume {
                pairs.append_pair("min_volume", &min_volume.to_string());
            }
            if let Some(limit) = limit {
                pairs.append_pair("limit", &limit.to_string());
            }
            if let Some(offset) = offset {
                pairs.append_pair("offset", &offset.to_string());
            }
        }

        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get Kalshi market price by ticker
    pub async fn get_kalshi_market_price(
        &self,
        market_ticker: &str,
    ) -> Result<ApiResponse<KalshiMarketPrice>, ApiError> {
        let url = self.build_url(&format!(
            "/api/prediction-markets/kalshi/market-price/{}",
            market_ticker
        ))?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    // Notes API methods

    /// Get list of theses
    pub async fn get_theses(
        &self,
        status: Option<&str>,
        symbol: Option<&str>,
    ) -> Result<Vec<NoteResponse>, ApiError> {
        let mut url = self.build_url("/api/theses")?;
        let mut params = Vec::new();
        if let Some(s) = status {
            params.push(format!("status={}", s));
        }
        if let Some(s) = symbol {
            params.push(format!("symbol={}", s));
        }
        if !params.is_empty() {
            url = format!("{}?{}", url, params.join("&"));
        }

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        Self::decode_payload(response).await
    }

    /// Create a new thesis
    pub async fn create_thesis(
        &self,
        request: CreateThesisRequest,
    ) -> Result<NoteResponse, ApiError> {
        let url = self.build_url("/api/theses")?;
        let response = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        Self::decode_payload(response).await
    }

    /// Get list of trades
    pub async fn get_trades(
        &self,
        status: Option<&str>,
        symbol: Option<&str>,
    ) -> Result<Vec<NoteResponse>, ApiError> {
        let mut url = self.build_url("/api/trades")?;
        let mut params = Vec::new();
        if let Some(s) = status {
            params.push(format!("status={}", s));
        }
        if let Some(s) = symbol {
            params.push(format!("symbol={}", s));
        }
        if !params.is_empty() {
            url = format!("{}?{}", url, params.join("&"));
        }

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        Self::decode_payload(response).await
    }

    /// Create a new trade
    pub async fn create_trade(
        &self,
        request: CreateTradeRequest,
    ) -> Result<NoteResponse, ApiError> {
        let url = self.build_url("/api/trades")?;
        let response = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        Self::decode_payload(response).await
    }

    /// Close a trade
    pub async fn close_trade(
        &self,
        name: &str,
        request: CloseTradeRequest,
    ) -> Result<NoteResponse, ApiError> {
        let url = self.build_url(&format!("/api/trades/{}/close", name))?;
        let response = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        Self::decode_payload(response).await
    }

    /// Get trade statistics
    pub async fn get_trade_stats(&self) -> Result<TradeStatsResponse, ApiError> {
        let url = self.build_url("/api/trades/stats")?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        Self::decode_payload(response).await
    }

    /// Search notes
    pub async fn search_notes(
        &self,
        query: &str,
        limit: Option<u32>,
    ) -> Result<Vec<SearchResult>, ApiError> {
        let limit = limit.unwrap_or(50);
        let base_url = self.build_url("/api/notes/search")?;
        let url = format!("{base_url}?query={}&limit={}", query, limit);
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        Self::decode_payload(response).await
    }

    /// Get notes graph
    pub async fn get_notes_graph(&self) -> Result<GraphResponse, ApiError> {
        let url = self.build_url("/api/notes/graph")?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        Self::decode_payload(response).await
    }

    // Events API methods

    /// Get list of events
    pub async fn get_events(
        &self,
        event_type: Option<&str>,
        symbol: Option<&str>,
        company: Option<&str>,
    ) -> Result<Vec<NoteResponse>, ApiError> {
        let mut url = self.build_url("/api/events")?;
        let mut params = Vec::new();
        if let Some(t) = event_type {
            params.push(format!("event_type={}", t));
        }
        if let Some(s) = symbol {
            params.push(format!("symbol={}", s));
        }
        if let Some(c) = company {
            params.push(format!("company={}", c));
        }
        if !params.is_empty() {
            url = format!("{}?{}", url, params.join("&"));
        }

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        Self::decode_payload(response).await
    }

    /// Create a new event
    pub async fn create_event(
        &self,
        request: CreateEventRequest,
    ) -> Result<NoteResponse, ApiError> {
        let url = self.build_url("/api/events")?;
        let response = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        Self::decode_payload(response).await
    }

    // People API methods

    /// Get list of people
    pub async fn get_people(
        &self,
        company: Option<&str>,
        role: Option<&str>,
    ) -> Result<Vec<NoteResponse>, ApiError> {
        let mut url = self.build_url("/api/people")?;
        let mut params = Vec::new();
        if let Some(c) = company {
            params.push(format!("company={}", c));
        }
        if let Some(r) = role {
            params.push(format!("role={}", r));
        }
        if !params.is_empty() {
            url = format!("{}?{}", url, params.join("&"));
        }

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        Self::decode_payload(response).await
    }

    /// Create a new person profile
    pub async fn create_person(
        &self,
        request: CreatePersonRequest,
    ) -> Result<NoteResponse, ApiError> {
        let url = self.build_url("/api/people")?;
        let response = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        Self::decode_payload(response).await
    }

    // Sectors API methods

    /// Get list of sectors
    pub async fn get_sectors(&self) -> Result<Vec<NoteResponse>, ApiError> {
        let url = self.build_url("/api/sectors")?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        Self::decode_payload(response).await
    }

    /// Create a new sector overview
    pub async fn create_sector(
        &self,
        request: CreateSectorRequest,
    ) -> Result<NoteResponse, ApiError> {
        let url = self.build_url("/api/sectors")?;
        let response = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        Self::decode_payload(response).await
    }

    // Portfolio API methods

    /// Get portfolio analytics (VaR, sector exposure, top holdings)
    pub async fn get_portfolio_analytics(
        &self,
        holdings: Vec<PortfolioHolding>,
        benchmark: Option<&str>,
    ) -> Result<ApiResponse<PortfolioAnalytics>, ApiError> {
        let url = self.build_url("/api/portfolio/analytics")?;
        let request = PortfolioRequest {
            holdings,
            benchmark: benchmark.unwrap_or("SPY").to_string(),
        };
        let response = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get correlation matrix for a portfolio universe
    pub async fn get_portfolio_correlation(
        &self,
        holdings: Vec<PortfolioHolding>,
        lookback_days: u32,
    ) -> Result<ApiResponse<PortfolioCorrelationResponse>, ApiError> {
        let url = self.build_url("/api/portfolio/correlation")?;
        let request = CorrelationRequest {
            holdings,
            lookback_days,
        };
        let response = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get portfolio risk metrics
    pub async fn get_portfolio_risk(
        &self,
        holdings: Vec<PortfolioHolding>,
        confidence_level: Option<f64>,
        method: Option<&str>,
    ) -> Result<ApiResponse<ApiRiskMetrics>, ApiError> {
        let url = self.build_url("/api/portfolio/risk")?;
        let request = RiskRequest {
            holdings,
            confidence_level: confidence_level.unwrap_or(0.95),
            method: method.unwrap_or("historical").to_string(),
            lookback_days: 252,
        };
        let response = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get sector exposure for portfolio
    pub async fn get_sector_exposure(
        &self,
        holdings: Vec<PortfolioHolding>,
    ) -> Result<ApiResponse<SectorExposureResponse>, ApiError> {
        let url = self.build_url("/api/portfolio/sector-exposure")?;
        let request = PortfolioRequest {
            holdings,
            benchmark: "SPY".to_string(),
        };
        let response = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    // =========================================================================
    // COMMODITIES ENDPOINTS
    // =========================================================================

    /// Get commodities market overview
    pub async fn get_commodities_overview(
        &self,
    ) -> Result<ApiResponse<CommoditiesOverview>, ApiError> {
        let url = self.build_url("/api/commodities")?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get commodity detail by symbol
    pub async fn get_commodity_detail(
        &self,
        symbol: &str,
    ) -> Result<ApiResponse<CommoditySummary>, ApiError> {
        let url = self.build_url(&format!("/api/commodities/{}", symbol))?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get macro-commodity linkage analysis
    pub async fn get_commodity_macro(
        &self,
        symbol: &str,
    ) -> Result<ApiResponse<MacroAnalysis>, ApiError> {
        let url = self.build_url(&format!("/api/commodities/{}/macro", symbol))?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get commodity correlation matrix
    pub async fn get_commodities_correlations(
        &self,
    ) -> Result<ApiResponse<CorrelationMatrix>, ApiError> {
        let url = self.build_url("/api/commodities/correlations")?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    // =========================================================================
    // DASHBOARD DATA ENDPOINTS
    // =========================================================================

    /// Get market data for a symbol
    pub async fn get_market_data(&self, symbol: &str) -> Result<ApiResponse<MarketData>, ApiError> {
        let url = self.build_url(&format!("/api/market/{}", symbol))?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get historical market data for a symbol
    pub async fn get_market_history(
        &self,
        symbol: &str,
        period_days: u32,
        interval: &str,
    ) -> Result<ApiResponse<MarketHistoryResponse>, ApiError> {
        let base_url = self.build_url(&format!("/api/market/{}/history", symbol))?;
        let mut url = Url::parse(&base_url).map_err(|e| ApiError::Parse(e.to_string()))?;
        {
            let mut pairs = url.query_pairs_mut();
            pairs.append_pair("period", &period_days.to_string());
            pairs.append_pair("interval", interval);
        }

        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get institutional holders for a symbol
    pub async fn get_institutional(
        &self,
        symbol: &str,
    ) -> Result<ApiResponse<Vec<InstitutionalHolder>>, ApiError> {
        let url = self.build_url(&format!("/api/institutional/{}", symbol))?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get valuation data for peer comparison
    pub async fn get_valuation(
        &self,
        symbol: &str,
    ) -> Result<ApiResponse<serde_json::Value>, ApiError> {
        let base_url = self.build_url(&format!("/api/valuation/{}", symbol))?;
        let mut url = Url::parse(&base_url).map_err(|e| ApiError::Parse(e.to_string()))?;
        {
            let mut pairs = url.query_pairs_mut();
            pairs.append_pair("include_dcf", "false");
        }

        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    // =========================================================================
    // AGENT ENDPOINTS
    // =========================================================================

    /// Check agent availability and status
    pub async fn agent_status(&self) -> Result<AgentStatusResponse, ApiError> {
        let url = self.build_url("/api/agent/status")?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        if response.status().is_success() {
            response
                .json()
                .await
                .map_err(|e| ApiError::Parse(e.to_string()))
        } else {
            // Return mock status if endpoint not available
            Ok(AgentStatusResponse {
                available: true,
                model: "claude-3-opus".to_string(),
                capabilities: vec![
                    "market_analysis".to_string(),
                    "portfolio_review".to_string(),
                    "research".to_string(),
                    "sec_filings".to_string(),
                ],
            })
        }
    }

    /// Send a chat message to the agent
    pub async fn agent_chat(
        &self,
        request: AgentChatRequest,
    ) -> Result<AgentChatResponse, ApiError> {
        let url = self.build_url("/api/agent/chat")?;
        let response = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        if response.status().is_success() {
            response
                .json()
                .await
                .map_err(|e| ApiError::Parse(e.to_string()))
        } else {
            // Return mock response if endpoint not available
            let last_message = request
                .messages
                .last()
                .map(|m| m.content.clone())
                .unwrap_or_default();
            Ok(AgentChatResponse {
                content: format!(
                    "I received your message: \"{}\"\n\n\
                    I'm currently running in demo mode. In production, I would:\n\
                    - Analyze market data for relevant symbols\n\
                    - Review institutional holdings and money flow\n\
                    - Provide research insights and recommendations\n\
                    - Execute analysis workflows\n\n\
                    Try asking about specific stocks, portfolio analysis, or market trends!",
                    truncate(&last_message, 50)
                ),
                tool_calls: Vec::new(),
                finished: true,
            })
        }
    }

    /// Execute a tool call
    pub async fn agent_execute_tool(
        &self,
        request: ToolExecuteRequest,
    ) -> Result<ToolExecuteResponse, ApiError> {
        let url = self.build_url("/api/agent/tool")?;
        let response = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;

        if response.status().is_success() {
            response
                .json()
                .await
                .map_err(|e| ApiError::Parse(e.to_string()))
        } else {
            // Return mock tool response
            Ok(ToolExecuteResponse {
                tool_id: request.tool_id,
                success: true,
                result: Some(serde_json::json!({
                    "message": "Tool executed in demo mode",
                    "tool": request.tool_name
                })),
                error: None,
            })
        }
    }

    // =========================================================================
    // ETF ENDPOINTS
    // =========================================================================

    /// Get ETF flows for all tracked ETFs
    pub async fn get_etf_flows(&self) -> Result<ApiResponse<Vec<EtfFlow>>, ApiError> {
        let url = self.build_url("/api/etf/flows")?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get sector rotation signals
    pub async fn get_sector_rotation(&self) -> Result<ApiResponse<Vec<SectorRotation>>, ApiError> {
        let url = self.build_url("/api/etf/sector-rotation")?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get smart beta factor flows
    pub async fn get_smart_beta_flows(
        &self,
    ) -> Result<ApiResponse<Vec<SmartBetaFactor>>, ApiError> {
        let url = self.build_url("/api/etf/smart-beta")?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get thematic ETF flows
    pub async fn get_thematic_flows(&self) -> Result<ApiResponse<Vec<ThematicEtf>>, ApiError> {
        let url = self.build_url("/api/etf/thematic")?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    // =========================================================================
    // SIGNALS ENDPOINTS
    // =========================================================================

    /// Generate signal for a single symbol
    pub async fn get_signal(&self, symbol: &str) -> Result<ApiResponse<Signal>, ApiError> {
        let url = self.build_url(&format!("/api/signals/{}", symbol))?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Generate signals for multiple symbols
    pub async fn generate_signals(
        &self,
        symbols: Vec<String>,
        min_conviction: f64,
    ) -> Result<ApiResponse<SignalsResponse>, ApiError> {
        let url = self.build_url("/api/signals")?;
        let request = SignalRequest {
            symbols,
            min_conviction,
        };
        let response = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Run signal backtest
    pub async fn backtest_signals(
        &self,
        request: BacktestRequest,
    ) -> Result<ApiResponse<BacktestResult>, ApiError> {
        let url = self.build_url("/api/signals/backtest")?;
        let response = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get signal performance statistics
    pub async fn get_signal_performance(&self) -> Result<ApiResponse<PerformanceStats>, ApiError> {
        let url = self.build_url("/api/signals/performance/stats")?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    // =========================================================================
    // ACCOUNTING ENDPOINTS
    // =========================================================================

    /// Get SEC filings for a symbol
    pub async fn get_filings(&self, symbol: &str) -> Result<ApiResponse<Vec<Filing>>, ApiError> {
        let url = self.build_url(&format!("/api/accounting/{}/filings", symbol))?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get earnings quality metrics for a symbol
    pub async fn get_earnings_quality(
        &self,
        symbol: &str,
    ) -> Result<ApiResponse<EarningsQuality>, ApiError> {
        let url = self.build_url(&format!("/api/accounting/{}/quality", symbol))?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get red flags for a symbol
    pub async fn get_red_flags(
        &self,
        symbol: &str,
    ) -> Result<ApiResponse<RedFlagsResponse>, ApiError> {
        let url = self.build_url(&format!("/api/accounting/{}/red-flags", symbol))?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }
}

/// Helper function to truncate text
fn truncate(s: &str, max_len: usize) -> &str {
    if s.len() <= max_len {
        s
    } else {
        &s[..max_len]
    }
}

impl Default for ZeeApiClient {
    fn default() -> Self {
        Self::new()
    }
}

/// API error types
#[derive(Debug)]
pub enum ApiError {
    Network(String),
    Parse(String),
    Server(String),
    Safety(String),
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApiError::Network(msg) => write!(f, "Network error: {}", msg),
            ApiError::Parse(msg) => write!(f, "Parse error: {}", msg),
            ApiError::Server(msg) => write!(f, "Server error: {}", msg),
            ApiError::Safety(msg) => write!(f, "Safety error: {}", msg),
        }
    }
}

// Request/Response types

#[derive(Debug, Serialize)]
pub struct SectorFlowRequest {
    pub sectors: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MoneyFlowResponse {
    pub sectors: HashMap<String, SectorFlow>,
    pub net_flows: HashMap<String, f64>,
    pub momentum: HashMap<String, f64>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SectorFlow {
    pub symbol: String,
    #[serde(rename = "netFlow1m")]
    pub net_flow_1m: f64,
    #[serde(rename = "netFlow3m")]
    pub net_flow_3m: f64,
    #[serde(rename = "institutionalChange")]
    pub institutional_change: f64,
    #[serde(rename = "smartMoneySentiment")]
    pub smart_money_sentiment: f64,
    #[serde(rename = "flowAcceleration")]
    pub flow_acceleration: f64,
    #[serde(rename = "confidenceScore")]
    pub confidence_score: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InstitutionalOwnershipResponse {
    pub symbol: String,
    #[serde(rename = "institutionalOwnership")]
    pub institutional_ownership: f64,
    #[serde(rename = "retailOwnership")]
    pub retail_ownership: f64,
    #[serde(rename = "insiderOwnership")]
    pub insider_ownership: f64,
    #[serde(rename = "top10Concentration")]
    pub top10_concentration: f64,
    #[serde(rename = "totalHolders")]
    pub total_holders: u32,
    #[serde(rename = "sharesOutstanding")]
    pub shares_outstanding: i64,
    #[serde(rename = "floatShares")]
    pub float_shares: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InstitutionalHolder {
    #[serde(rename = "managerName")]
    pub manager_name: String,
    #[serde(rename = "valueHeld")]
    pub value_held: f64,
    #[serde(rename = "ownershipPercentage")]
    pub ownership_percentage: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EquityFlowResponse {
    pub symbol: String,
    #[serde(alias = "moneyFlowScore")]
    pub money_flow_score: f64,
    #[serde(alias = "institutionalSentiment")]
    pub institutional_sentiment: f64,
    #[serde(alias = "smartMoneyActivity")]
    pub smart_money_activity: f64,
    #[serde(alias = "shortPressure")]
    pub short_pressure: f64,
    #[serde(alias = "accumulationDistribution")]
    pub accumulation_distribution: f64,
    pub confidence: f64,
}

/// Alias for equity flow data used in comparison views
pub type EquityFlowData = EquityFlowResponse;

/// Market data for a symbol (prices, volume, change)
#[derive(Debug, Clone, Deserialize, Default)]
pub struct MarketData {
    pub symbol: String,
    pub price: f64,
    pub change: f64,
    #[serde(rename = "changePercent")]
    pub change_percent: f64,
    pub volume: u64,
    #[serde(rename = "avgVolume")]
    pub avg_volume: Option<u64>,
    #[serde(rename = "marketCap")]
    pub market_cap: Option<f64>,
    #[serde(rename = "peRatio")]
    pub pe_ratio: Option<f64>,
    #[serde(rename = "dividendYield")]
    pub dividend_yield: Option<f64>,
    #[serde(rename = "high52w")]
    pub high_52w: Option<f64>,
    #[serde(rename = "low52w")]
    pub low_52w: Option<f64>,
    pub timestamp: Option<String>,
}

/// Historical OHLCV data point
#[derive(Debug, Clone, Deserialize)]
pub struct MarketHistoryPoint {
    pub date: String,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: i64,
}

/// Historical market response payload
#[derive(Debug, Clone, Deserialize)]
pub struct MarketHistoryResponse {
    pub symbol: String,
    pub interval: String,
    #[serde(rename = "dataPoints")]
    pub data_points: Vec<MarketHistoryPoint>,
    #[serde(rename = "startDate")]
    pub start_date: String,
    #[serde(rename = "endDate")]
    pub end_date: String,
}

/// Valuation data for research analysis
#[derive(Debug, Clone, Deserialize, Default)]
pub struct ValuationData {
    pub pe_ratio: f64,
    pub forward_pe: f64,
    pub peg_ratio: f64,
    pub price_to_sales: f64,
    pub pb_ratio: f64,
    pub ps_ratio: f64,
    pub ev_ebitda: f64,
    pub dcf_value: f64,
}

/// Research data for fundamental analysis
#[derive(Debug, Clone, Deserialize, Default)]
pub struct ResearchData {
    pub symbol: String,
    pub company_name: String,
    pub sector: String,
    pub industry: String,
    pub analyst_rating: Option<String>,
    pub price_target: Option<f64>,
    pub eps_estimate: Option<f64>,
    pub revenue_estimate: Option<f64>,
    pub valuation: Option<ValuationData>,
}

#[derive(Debug, Deserialize)]
pub struct DarkPoolResponse {
    pub symbol: String,
    pub data: Vec<DarkPoolData>,
}

#[derive(Debug, Deserialize)]
pub struct DarkPoolData {
    pub date: String,
    #[serde(alias = "darkPoolVolume")]
    pub dark_pool_volume: u64,
    #[serde(alias = "totalVolume")]
    pub total_volume: u64,
    #[serde(alias = "darkPoolPercentage")]
    pub dark_pool_percentage: f64,
    #[serde(alias = "darkPoolSignal")]
    pub dark_pool_signal: i8,
}

#[derive(Debug, Deserialize)]
pub struct HealthResponse {
    pub core: bool,
    pub status: String,
}

// Notes API types

#[derive(Debug, Serialize)]
pub struct CreateThesisRequest {
    pub symbol: String,
    pub company_name: Option<String>,
    pub sector: Option<String>,
    pub conviction: String,
}

#[derive(Debug, Serialize)]
pub struct CreateTradeRequest {
    pub symbol: String,
    pub direction: String,
    pub entry_price: f64,
    pub shares: f64,
    pub entry_date: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CloseTradeRequest {
    pub exit_price: f64,
    pub exit_date: Option<String>,
    pub exit_reason: Option<String>,
    pub lessons: Option<String>,
    pub grade: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CreateEventRequest {
    pub symbol: String,
    pub company_name: Option<String>,
    pub event_type: String,
    pub event_date: Option<String>,
    pub host: Option<String>,
    pub participants: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct CreatePersonRequest {
    pub full_name: String,
    pub current_role: Option<String>,
    pub current_company: Option<String>,
    pub linkedin_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CreateSectorRequest {
    pub sector_name: String,
    pub sub_sectors: Vec<String>,
    pub companies: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct NoteFrontmatter {
    pub title: String,
    #[serde(rename = "type")]
    pub note_type: String,
    pub created: String,
    pub modified: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct ThesisFrontmatter {
    pub title: String,
    pub symbol: String,
    #[serde(alias = "companyName")]
    pub company_name: Option<String>,
    pub sector: Option<String>,
    pub status: String,
    pub conviction: String,
    #[serde(alias = "entryPrice")]
    pub entry_price: Option<f64>,
    #[serde(alias = "targetPrice")]
    pub target_price: Option<f64>,
    #[serde(alias = "stopLoss")]
    pub stop_loss: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct TradeFrontmatter {
    pub title: String,
    pub symbol: String,
    pub direction: String,
    pub status: String,
    #[serde(alias = "entryPrice")]
    pub entry_price: f64,
    #[serde(alias = "exitPrice")]
    pub exit_price: Option<f64>,
    pub shares: f64,
    pub pnl: Option<f64>,
    #[serde(alias = "pnlPercent")]
    pub pnl_percent: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct NoteResponse {
    pub name: String,
    pub path: String,
    pub frontmatter: serde_json::Value,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct SearchResult {
    pub path: String,
    pub name: String,
    pub title: String,
    #[serde(rename = "type")]
    pub note_type: String,
    pub snippet: String,
}

#[derive(Debug, Deserialize)]
pub struct TradeStatsResponse {
    #[serde(alias = "totalTrades")]
    pub total_trades: u32,
    pub winners: u32,
    pub losers: u32,
    #[serde(alias = "winRate")]
    pub win_rate: f64,
    #[serde(alias = "totalPnl")]
    pub total_pnl: f64,
    #[serde(alias = "avgWin")]
    pub avg_win: f64,
    #[serde(alias = "avgLoss")]
    pub avg_loss: f64,
    #[serde(alias = "profitFactor")]
    pub profit_factor: f64,
}

#[derive(Debug, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Deserialize)]
pub struct GraphResponse {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

// Portfolio API types

/// Portfolio holding for API requests
#[derive(Debug, Clone, Serialize)]
pub struct PortfolioHolding {
    pub symbol: String,
    pub shares: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub average_cost: Option<f64>,
}

/// Request for portfolio analytics
#[derive(Debug, Clone, Serialize)]
pub struct PortfolioRequest {
    pub holdings: Vec<PortfolioHolding>,
    pub benchmark: String,
}

/// Request for portfolio risk analysis
#[derive(Debug, Clone, Serialize)]
pub struct RiskRequest {
    pub holdings: Vec<PortfolioHolding>,
    pub confidence_level: f64,
    pub method: String,
    pub lookback_days: i32,
}

/// Request for portfolio correlation analysis
#[derive(Debug, Clone, Serialize)]
pub struct CorrelationRequest {
    pub holdings: Vec<PortfolioHolding>,
    pub lookback_days: u32,
}

/// Portfolio analytics response data
#[derive(Debug, Clone, Deserialize)]
pub struct PortfolioAnalytics {
    #[serde(alias = "totalValue")]
    pub total_value: f64,
    #[serde(alias = "sectorExposure")]
    pub sector_exposure: std::collections::HashMap<String, f64>,
    #[serde(alias = "topHoldings")]
    pub top_holdings: Vec<HoldingInfo>,
}

/// Individual holding info from API
#[derive(Debug, Clone, Deserialize)]
pub struct HoldingInfo {
    pub symbol: String,
    pub weight: f64,
    pub value: f64,
    #[serde(alias = "returnPct")]
    pub return_pct: Option<f64>,
}

/// Risk metrics from API
#[derive(Debug, Clone, Deserialize)]
pub struct ApiRiskMetrics {
    #[serde(alias = "var95")]
    pub var_95: f64,
    #[serde(alias = "var99")]
    pub var_99: f64,
    #[serde(alias = "cvar95")]
    pub cvar_95: f64,
    #[serde(alias = "maxDrawdown")]
    pub max_drawdown: f64,
    #[serde(alias = "sharpeRatio")]
    pub sharpe_ratio: f64,
    #[serde(alias = "sortinoRatio")]
    pub sortino_ratio: f64,
    pub beta: f64,
}

/// Sector exposure response
#[derive(Debug, Clone, Deserialize)]
pub struct SectorExposureResponse {
    #[serde(alias = "portfolioWeights")]
    pub portfolio_weights: std::collections::HashMap<String, f64>,
}

/// Correlation pair entry
#[derive(Debug, Clone, Deserialize)]
pub struct CorrelationMatrixEntry {
    pub symbol1: String,
    pub symbol2: String,
    pub correlation: f64,
}

/// Correlation matrix response
#[derive(Debug, Clone, Deserialize)]
pub struct PortfolioCorrelationResponse {
    pub symbols: Vec<String>,
    pub matrix: Vec<Vec<f64>>,
    #[serde(default, alias = "highlyCorrelated")]
    pub highly_correlated: Vec<CorrelationMatrixEntry>,
    #[serde(alias = "diversificationScore")]
    pub diversification_score: f64,
}

/// Generic API response wrapper
#[derive(Debug, Clone, Deserialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum EnvelopeOrRaw<T> {
    Envelope(ApiResponse<T>),
    Raw(T),
}

// Prediction Markets API types

#[derive(Debug, Deserialize, Clone)]
pub struct MarketPricePoint {
    pub price: f64,
    #[serde(rename = "at_time", alias = "atTime")]
    pub at_time: i64,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PolymarketOutcome {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PolymarketMarket {
    pub market_slug: String,
    pub condition_id: Option<String>,
    pub title: String,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub status: Option<String>,
    pub volume_total: Option<f64>,
    pub tags: Option<Vec<String>>,
    pub side_a: Option<PolymarketOutcome>,
    pub side_b: Option<PolymarketOutcome>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PolymarketMarketsResponse {
    pub markets: Vec<PolymarketMarket>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct KalshiMarket {
    pub event_ticker: Option<String>,
    pub market_ticker: String,
    pub title: String,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub close_time: Option<i64>,
    pub status: Option<String>,
    pub last_price: Option<f64>,
    pub volume: Option<f64>,
    pub volume_24h: Option<f64>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct KalshiMarketsResponse {
    pub markets: Vec<KalshiMarket>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct KalshiMarketPrice {
    pub yes: MarketPricePoint,
    pub no: MarketPricePoint,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PredictionMarketsHealth {
    pub status: String,
    pub provider: String,
    #[serde(rename = "polymarket_sample_size", alias = "polymarketSampleSize")]
    pub polymarket_sample_size: Option<usize>,
}

// Commodities API types

/// Commodity price data from API
#[derive(Debug, Deserialize, Clone)]
pub struct CommodityPrice {
    pub symbol: String,
    pub name: String,
    pub price: f64,
    pub change: f64,
    #[serde(rename = "changePercent")]
    pub change_percent: f64,
    pub high: f64,
    pub low: f64,
    pub volume: i64,
    #[serde(rename = "openInterest")]
    pub open_interest: i64,
    pub timestamp: String,
}

/// Commodity summary with analytics
#[derive(Debug, Deserialize, Clone)]
pub struct CommoditySummary {
    pub symbol: String,
    pub name: String,
    pub category: String,
    pub price: f64,
    #[serde(rename = "change1d")]
    pub change_1d: f64,
    #[serde(rename = "change1w")]
    pub change_1w: f64,
    #[serde(rename = "change1m")]
    pub change_1m: f64,
    #[serde(rename = "changeYtd")]
    pub change_ytd: f64,
    #[serde(rename = "volatility30d")]
    pub volatility_30d: f64,
    pub trend: String,
    #[serde(rename = "relativeStrength")]
    pub relative_strength: f64,
}

/// Category overview data
#[derive(Debug, Deserialize, Clone)]
pub struct CategoryOverview {
    pub category: String,
    pub count: i32,
    #[serde(rename = "avgChange")]
    pub avg_change: f64,
    pub leader: Option<CommodityPrice>,
    pub laggard: Option<CommodityPrice>,
    pub commodities: Vec<CommodityPrice>,
}

/// Market overview response
#[derive(Debug, Deserialize, Clone)]
pub struct CommoditiesOverview {
    pub timestamp: String,
    pub sentiment: String,
    #[serde(rename = "avgChange")]
    pub avg_change: f64,
    pub categories: std::collections::HashMap<String, CategoryOverview>,
}

/// Macro linkage data
#[derive(Debug, Deserialize, Clone)]
pub struct MacroLinkage {
    pub commodity: String,
    #[serde(rename = "macroIndicator")]
    pub macro_indicator: String,
    pub correlation: f64,
    #[serde(rename = "leadLagDays")]
    pub lead_lag_days: i32,
    pub relationship: String,
    pub strength: String,
}

/// Macro linkage analysis response
#[derive(Debug, Deserialize, Clone)]
pub struct MacroAnalysis {
    pub commodity: String,
    pub name: String,
    pub category: String,
    pub linkages: Vec<MacroLinkage>,
    #[serde(rename = "primaryDriver")]
    pub primary_driver: Option<String>,
}

/// Correlation matrix data
#[derive(Debug, Deserialize, Clone)]
pub struct CorrelationMatrix {
    pub symbols: Vec<String>,
    pub matrix: Vec<Vec<f64>>,
}

// =============================================================================
// Agent API Types
// =============================================================================

/// Agent chat message for API communication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMessage {
    pub role: String,
    pub content: String,
}

/// Agent chat request
#[derive(Debug, Clone, Serialize)]
pub struct AgentChatRequest {
    pub messages: Vec<AgentMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<AgentTool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<AgentContext>,
}

/// Agent tool definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTool {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

/// Agent context for additional information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentContext {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_symbol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub portfolio_symbols: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_view: Option<String>,
}

/// Agent chat response
#[derive(Debug, Clone, Deserialize)]
pub struct AgentChatResponse {
    pub content: String,
    #[serde(default)]
    pub tool_calls: Vec<AgentToolCall>,
    #[serde(default)]
    pub finished: bool,
}

/// Agent tool call in response
#[derive(Debug, Clone, Deserialize)]
pub struct AgentToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

/// Tool execution request
#[derive(Debug, Clone, Serialize)]
pub struct ToolExecuteRequest {
    pub tool_id: String,
    pub tool_name: String,
    pub arguments: serde_json::Value,
}

/// Tool execution response
#[derive(Debug, Clone, Deserialize)]
pub struct ToolExecuteResponse {
    pub tool_id: String,
    pub success: bool,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

/// Agent status response
#[derive(Debug, Clone, Deserialize)]
pub struct AgentStatusResponse {
    pub available: bool,
    pub model: String,
    pub capabilities: Vec<String>,
}

// =============================================================================
// ETF API Types
// =============================================================================

/// ETF flow data
#[derive(Debug, Clone, Deserialize)]
pub struct EtfFlow {
    pub symbol: String,
    pub name: String,
    #[serde(rename = "flow1d")]
    pub flow_1d: f64,
    #[serde(rename = "flow1w")]
    pub flow_1w: f64,
    #[serde(rename = "flow1m")]
    pub flow_1m: f64,
    #[serde(rename = "flowPct")]
    pub flow_pct: f64,
    pub aum: f64,
}

/// Sector rotation signal
#[derive(Debug, Clone, Deserialize)]
pub struct SectorRotation {
    pub sector: String,
    pub etf: String,
    #[serde(rename = "momentumScore")]
    pub momentum_score: f64,
    pub signal: String,
    #[serde(rename = "relativeStrength")]
    pub relative_strength: f64,
}

/// Smart beta factor data
#[derive(Debug, Clone, Deserialize)]
pub struct SmartBetaFactor {
    pub factor: String,
    pub etfs: Vec<String>,
    #[serde(rename = "totalAum")]
    pub total_aum: f64,
    #[serde(rename = "netFlow1m")]
    pub net_flow_1m: f64,
    pub performance: f64,
    pub crowding: f64,
}

/// Thematic ETF data
#[derive(Debug, Clone, Deserialize)]
pub struct ThematicEtf {
    pub theme: String,
    pub etfs: Vec<String>,
    #[serde(rename = "totalAum")]
    pub total_aum: f64,
    #[serde(rename = "netFlow1m")]
    pub net_flow_1m: f64,
    pub momentum: f64,
    pub trend: String,
}

// =============================================================================
// Signals API Types
// =============================================================================

/// Signal request
#[derive(Debug, Clone, Serialize)]
pub struct SignalRequest {
    pub symbols: Vec<String>,
    #[serde(rename = "minConviction")]
    pub min_conviction: f64,
}

/// Investment signal
#[derive(Debug, Clone, Deserialize)]
pub struct Signal {
    #[serde(rename = "signalId")]
    pub signal_id: String,
    pub symbol: String,
    #[serde(rename = "signalType")]
    pub signal_type: String,
    pub strength: String,
    pub conviction: f64,
    pub factors: std::collections::HashMap<String, f64>,
    #[serde(rename = "priceAtSignal")]
    pub price_at_signal: Option<f64>,
    #[serde(rename = "targetPrice")]
    pub target_price: Option<f64>,
    #[serde(rename = "stopLoss")]
    pub stop_loss: Option<f64>,
    pub reasoning: Option<String>,
    pub timestamp: String,
}

/// Multiple signals response
#[derive(Debug, Clone, Deserialize)]
pub struct SignalsResponse {
    pub signals: Vec<Signal>,
    #[serde(rename = "totalRequested")]
    pub total_requested: i32,
    #[serde(rename = "signalsGenerated")]
    pub signals_generated: i32,
}

/// Backtest request
#[derive(Debug, Clone, Serialize)]
pub struct BacktestRequest {
    pub symbols: Vec<String>,
    #[serde(rename = "startDate")]
    pub start_date: Option<String>,
    #[serde(rename = "endDate")]
    pub end_date: Option<String>,
    #[serde(rename = "holdingPeriodDays")]
    pub holding_period_days: i32,
    #[serde(rename = "initialCapital")]
    pub initial_capital: f64,
}

/// Backtest result
#[derive(Debug, Clone, Deserialize)]
pub struct BacktestResult {
    #[serde(rename = "totalReturn")]
    pub total_return: f64,
    #[serde(rename = "sharpeRatio")]
    pub sharpe_ratio: f64,
    #[serde(rename = "maxDrawdown")]
    pub max_drawdown: f64,
    #[serde(rename = "winRate")]
    pub win_rate: f64,
    pub trades: i32,
    #[serde(rename = "profitFactor")]
    pub profit_factor: Option<f64>,
    #[serde(rename = "avgHoldingDays")]
    pub avg_holding_days: Option<f64>,
    #[serde(rename = "equityCurve", default)]
    pub equity_curve: Vec<EquityCurvePoint>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EquityCurvePoint {
    pub date: String,
    pub value: f64,
}

/// Performance statistics
#[derive(Debug, Clone, Deserialize)]
pub struct PerformanceStats {
    #[serde(rename = "totalSignals")]
    pub total_signals: i32,
    #[serde(rename = "winRate")]
    pub win_rate: f64,
    #[serde(rename = "avgReturn")]
    pub avg_return: f64,
    #[serde(rename = "profitFactor")]
    pub profit_factor: f64,
}

// =============================================================================
// Accounting API Types
// =============================================================================

/// SEC filing data
#[derive(Debug, Clone, Deserialize)]
pub struct Filing {
    #[serde(rename = "formType")]
    pub form_type: String,
    #[serde(rename = "filedDate")]
    pub filed_date: String,
    #[serde(rename = "periodEnd")]
    pub period_end: String,
    pub description: String,
    pub url: Option<String>,
}

/// Earnings quality metrics
#[derive(Debug, Clone, Deserialize)]
pub struct EarningsQuality {
    #[serde(rename = "mScore")]
    pub m_score: f64,
    #[serde(rename = "fScore")]
    pub f_score: i32,
    #[serde(rename = "zScore")]
    pub z_score: f64,
    #[serde(rename = "accrualsRatio")]
    pub accruals_ratio: f64,
    #[serde(rename = "manipulationRisk")]
    pub manipulation_risk: String,
}

/// Red flag item
#[derive(Debug, Clone, Deserialize)]
pub struct RedFlag {
    pub category: String,
    pub severity: String,
    pub description: String,
    pub metric: Option<String>,
    pub value: Option<f64>,
}

/// Red flags response
#[derive(Debug, Clone, Deserialize)]
pub struct RedFlagsResponse {
    pub symbol: String,
    #[serde(rename = "overallRisk")]
    pub overall_risk: String,
    #[serde(rename = "riskScore")]
    pub risk_score: f64,
    pub flags: Vec<RedFlag>,
}
