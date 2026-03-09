//! Filesystem-backed persistence for Investing notes, theses, trades, events, people, and sectors.

use crate::{Error, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

type JsonMap = BTreeMap<String, Value>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NoteResponse {
    pub name: String,
    pub path: String,
    pub frontmatter: JsonMap,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub path: String,
    pub name: String,
    pub title: String,
    pub note_type: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GraphResponse {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    pub node_type: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateThesisRequest {
    pub symbol: String,
    pub company_name: Option<String>,
    pub sector: Option<String>,
    pub conviction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTradeRequest {
    pub symbol: String,
    pub direction: String,
    pub entry_price: f64,
    pub shares: f64,
    pub entry_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseTradeRequest {
    pub exit_price: f64,
    pub exit_date: Option<String>,
    pub exit_reason: Option<String>,
    pub lessons: Option<String>,
    pub grade: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEventRequest {
    pub symbol: String,
    pub company_name: Option<String>,
    pub event_type: String,
    pub event_date: Option<String>,
    pub host: Option<String>,
    #[serde(default)]
    pub participants: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePersonRequest {
    pub full_name: String,
    pub current_role: Option<String>,
    pub current_company: Option<String>,
    pub linkedin_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSectorRequest {
    pub sector_name: String,
    #[serde(default)]
    pub sub_sectors: Vec<String>,
    #[serde(default)]
    pub companies: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TradeStatsResponse {
    pub total_trades: usize,
    pub winners: usize,
    pub losers: usize,
    pub win_rate: f64,
    pub total_pnl: f64,
    pub avg_win: f64,
    pub avg_loss: f64,
    pub profit_factor: f64,
}

#[derive(Debug, Clone)]
pub struct InvestingRuntime {
    data_dir: PathBuf,
}

impl InvestingRuntime {
    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        let runtime = Self {
            data_dir: data_dir.into(),
        };
        let _ = runtime.initialize();
        runtime
    }

    pub fn from_env() -> Self {
        Self::new(Self::default_data_dir())
    }

    pub fn default_data_dir() -> PathBuf {
        if let Ok(path) = std::env::var("ZEE_INVESTING_DATA_DIR") {
            return PathBuf::from(path);
        }

        if let Some(dirs) = directories::BaseDirs::new() {
            if let Some(state_dir) = dirs.state_dir() {
                return state_dir.join("zee/investing");
            }
        }

        PathBuf::from(".zee/investing")
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    fn initialize(&self) -> Result<()> {
        fs::create_dir_all(&self.data_dir)?;
        self.import_legacy_vault_if_needed()
    }

    pub fn list_notes(&self) -> Result<Vec<NoteResponse>> {
        self.load_category(Category::Notes)
            .map(|docs| docs.into_iter().map(Document::response).collect())
    }

    pub fn get_note(&self, name: &str) -> Result<NoteResponse> {
        self.load_document(Category::Notes, name)
            .map(Document::response)
    }

    pub fn save_note(&self, name: &str, content: String) -> Result<NoteResponse> {
        let slug = slugify(name);
        let existing = self.load_document(Category::Notes, &slug).ok();
        let now = Utc::now();

        let mut frontmatter = existing
            .as_ref()
            .map(|doc| doc.frontmatter.clone())
            .unwrap_or_else(|| {
                BTreeMap::from([
                    ("title".to_string(), Value::String(name.trim().to_string())),
                    ("noteType".to_string(), Value::String("note".to_string())),
                ])
            });
        frontmatter.insert("title".to_string(), Value::String(name.trim().to_string()));
        frontmatter.insert("noteType".to_string(), Value::String("note".to_string()));

        let document = Document {
            name: slug.clone(),
            path: Self::relative_path(Category::Notes, &slug),
            note_type: Category::Notes.note_type().to_string(),
            frontmatter,
            content,
            created_at: existing.as_ref().map(|doc| doc.created_at).unwrap_or(now),
            updated_at: now,
        };

        self.write_document(Category::Notes, &document)?;
        Ok(document.response())
    }

    pub fn search_notes(&self, query: &str) -> Result<Vec<SearchResult>> {
        let query = query.trim().to_lowercase();
        let docs = self.load_all_documents()?;

        let mut results = docs
            .into_iter()
            .filter_map(|doc| {
                if query.is_empty() || doc.search_blob().contains(&query) {
                    Some(SearchResult {
                        path: doc.path.clone(),
                        name: doc.name.clone(),
                        title: doc.title(),
                        note_type: doc.note_type.clone(),
                        snippet: doc.snippet(&query),
                    })
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();

        results.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(results)
    }

    pub fn list_theses(&self) -> Result<Vec<NoteResponse>> {
        self.list_theses_filtered(None, None)
    }

    pub fn list_theses_filtered(
        &self,
        status: Option<&str>,
        symbol: Option<&str>,
    ) -> Result<Vec<NoteResponse>> {
        self.filtered_category(Category::Theses, |doc| {
            match_frontmatter(doc, "status", status) && match_frontmatter(doc, "symbol", symbol)
        })
    }

    pub fn create_thesis(&self, request: CreateThesisRequest) -> Result<NoteResponse> {
        if request.conviction.trim().is_empty() {
            return Err(Error::InvalidOperation(
                "conviction must not be empty".to_string(),
            ));
        }

        let symbol = sanitize_symbol(&request.symbol);
        let title = format!("{symbol} Investment Thesis");
        let slug = slugify(&title);
        let company_name = request
            .company_name
            .clone()
            .unwrap_or_else(|| format!("{symbol} Holdings"));
        let sector = request
            .sector
            .clone()
            .unwrap_or_else(|| "Unclassified".to_string());
        let now = Utc::now();

        let document = Document {
            name: slug.clone(),
            path: Self::relative_path(Category::Theses, &slug),
            note_type: Category::Theses.note_type().to_string(),
            frontmatter: BTreeMap::from([
                ("title".to_string(), Value::String(title.clone())),
                ("symbol".to_string(), Value::String(symbol.clone())),
                ("companyName".to_string(), Value::String(company_name.clone())),
                ("sector".to_string(), Value::String(sector.clone())),
                ("status".to_string(), Value::String("active".to_string())),
                ("conviction".to_string(), Value::String(request.conviction.clone())),
                ("noteType".to_string(), Value::String("thesis".to_string())),
            ]),
            content: format!(
                "# {title}\n\n## Snapshot\n- Symbol: {symbol}\n- Company: {company_name}\n- Sector: {sector}\n- Conviction: {}\n\n## Thesis\nDeterministic Investing runtime thesis scaffold for {symbol}.\n\n## Key Questions\n- What must happen for the thesis to strengthen?\n- What would invalidate the thesis?\n",
                request.conviction
            ),
            created_at: now,
            updated_at: now,
        };

        self.write_document(Category::Theses, &document)?;
        Ok(document.response())
    }

    pub fn list_trades(&self) -> Result<Vec<NoteResponse>> {
        self.list_trades_filtered(None, None)
    }

    pub fn list_trades_filtered(
        &self,
        status: Option<&str>,
        symbol: Option<&str>,
    ) -> Result<Vec<NoteResponse>> {
        self.filtered_category(Category::Trades, |doc| {
            match_frontmatter(doc, "status", status) && match_frontmatter(doc, "symbol", symbol)
        })
    }

    pub fn create_trade(&self, request: CreateTradeRequest) -> Result<NoteResponse> {
        if request.entry_price <= 0.0 {
            return Err(Error::InvalidOperation(
                "entryPrice must be greater than zero".to_string(),
            ));
        }
        if request.shares <= 0.0 {
            return Err(Error::InvalidOperation(
                "shares must be greater than zero".to_string(),
            ));
        }
        if request.direction.trim().is_empty() {
            return Err(Error::InvalidOperation(
                "direction must not be empty".to_string(),
            ));
        }

        let symbol = sanitize_symbol(&request.symbol);
        let direction = request.direction.trim().to_lowercase();
        let entry_date = request
            .entry_date
            .clone()
            .unwrap_or_else(|| Utc::now().date_naive().to_string());
        let title = format!("{symbol} {} Trade", direction.to_uppercase());
        let slug = slugify(&format!("{symbol}-{entry_date}-{direction}"));
        let now = Utc::now();

        let document = Document {
            name: slug.clone(),
            path: Self::relative_path(Category::Trades, &slug),
            note_type: Category::Trades.note_type().to_string(),
            frontmatter: BTreeMap::from([
                ("title".to_string(), Value::String(title.clone())),
                ("symbol".to_string(), Value::String(symbol.clone())),
                ("direction".to_string(), Value::String(direction.clone())),
                ("status".to_string(), Value::String("open".to_string())),
                ("entryPrice".to_string(), Value::from(request.entry_price)),
                ("shares".to_string(), Value::from(request.shares)),
                ("entryDate".to_string(), Value::String(entry_date.clone())),
                ("noteType".to_string(), Value::String("trade".to_string())),
            ]),
            content: format!(
                "# {title}\n\n## Entry\n- Date: {entry_date}\n- Price: {:.2}\n- Shares: {:.2}\n- Direction: {direction}\n\n## Plan\nDocument setup, risk, and exit criteria here.\n",
                request.entry_price, request.shares
            ),
            created_at: now,
            updated_at: now,
        };

        self.write_document(Category::Trades, &document)?;
        Ok(document.response())
    }

    pub fn close_trade(&self, name: &str, request: CloseTradeRequest) -> Result<NoteResponse> {
        if request.exit_price <= 0.0 {
            return Err(Error::InvalidOperation(
                "exitPrice must be greater than zero".to_string(),
            ));
        }

        let slug = slugify(name);
        let mut document = self.load_document(Category::Trades, &slug)?;
        let entry_price = document
            .frontmatter
            .get("entryPrice")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let shares = document
            .frontmatter
            .get("shares")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let direction = document
            .frontmatter
            .get("direction")
            .and_then(Value::as_str)
            .unwrap_or("long")
            .to_ascii_lowercase();
        let exit_date = request
            .exit_date
            .clone()
            .unwrap_or_else(|| Utc::now().date_naive().to_string());
        let pnl = if direction == "short" {
            (entry_price - request.exit_price) * shares
        } else {
            (request.exit_price - entry_price) * shares
        };
        let pnl_percent = if entry_price <= 0.0 || shares <= 0.0 {
            0.0
        } else {
            (pnl / (entry_price * shares)) * 100.0
        };

        document
            .frontmatter
            .insert("status".to_string(), Value::String("closed".to_string()));
        document
            .frontmatter
            .insert("exitPrice".to_string(), Value::from(request.exit_price));
        document
            .frontmatter
            .insert("exitDate".to_string(), Value::String(exit_date.clone()));
        document
            .frontmatter
            .insert("pnl".to_string(), Value::from(round2(pnl)));
        document
            .frontmatter
            .insert("pnlPercent".to_string(), Value::from(round2(pnl_percent)));

        if let Some(reason) = request.exit_reason.as_ref().filter(|value| !value.trim().is_empty()) {
            document
                .frontmatter
                .insert("exitReason".to_string(), Value::String(reason.trim().to_string()));
        }
        if let Some(lessons) = request.lessons.as_ref().filter(|value| !value.trim().is_empty()) {
            document
                .frontmatter
                .insert("lessons".to_string(), Value::String(lessons.trim().to_string()));
        }
        if let Some(grade) = request.grade.as_ref().filter(|value| !value.trim().is_empty()) {
            document
                .frontmatter
                .insert("grade".to_string(), Value::String(grade.trim().to_string()));
        }

        document.content = format!(
            "{}\n\n## Exit\n- Date: {}\n- Price: {:.2}\n- P&L: {:.2}\n- Return: {:.2}%{}\n{}{}\n",
            document.content.trim_end(),
            exit_date,
            request.exit_price,
            round2(pnl),
            round2(pnl_percent),
            request
                .exit_reason
                .as_ref()
                .filter(|value| !value.trim().is_empty())
                .map(|reason| format!("\n- Exit Reason: {}", reason.trim()))
                .unwrap_or_default(),
            request
                .lessons
                .as_ref()
                .filter(|value| !value.trim().is_empty())
                .map(|value| format!("## Lessons\n{}\n", value.trim()))
                .unwrap_or_default(),
            request
                .grade
                .as_ref()
                .filter(|value| !value.trim().is_empty())
                .map(|value| format!("Grade: {}\n", value.trim()))
                .unwrap_or_default(),
        );
        document.updated_at = Utc::now();

        self.write_document(Category::Trades, &document)?;
        Ok(document.response())
    }

    pub fn list_events_filtered(
        &self,
        event_type: Option<&str>,
        symbol: Option<&str>,
        company: Option<&str>,
    ) -> Result<Vec<NoteResponse>> {
        self.filtered_category(Category::Events, |doc| {
            match_frontmatter(doc, "eventType", event_type)
                && match_frontmatter(doc, "symbol", symbol)
                && match_contains_frontmatter(doc, "companyName", company)
        })
    }

    pub fn create_event(&self, request: CreateEventRequest) -> Result<NoteResponse> {
        if request.event_type.trim().is_empty() {
            return Err(Error::InvalidOperation(
                "eventType must not be empty".to_string(),
            ));
        }

        let symbol = sanitize_symbol(&request.symbol);
        let company_name = request
            .company_name
            .clone()
            .unwrap_or_else(|| format!("{symbol} Holdings"));
        let event_type = request.event_type.trim().to_string();
        let event_date = request
            .event_date
            .clone()
            .unwrap_or_else(|| Utc::now().date_naive().to_string());
        let title = format!("{symbol} {} {}", event_date, event_type.replace('_', " "));
        let slug = slugify(&title);
        let now = Utc::now();

        let document = Document {
            name: slug.clone(),
            path: Self::relative_path(Category::Events, &slug),
            note_type: Category::Events.note_type().to_string(),
            frontmatter: BTreeMap::from([
                ("title".to_string(), Value::String(title.clone())),
                ("symbol".to_string(), Value::String(symbol.clone())),
                ("companyName".to_string(), Value::String(company_name.clone())),
                ("eventType".to_string(), Value::String(event_type.clone())),
                ("eventDate".to_string(), Value::String(event_date.clone())),
                (
                    "host".to_string(),
                    Value::String(request.host.clone().unwrap_or_default()),
                ),
                (
                    "participants".to_string(),
                    Value::Array(
                        request
                            .participants
                            .iter()
                            .map(|item| Value::String(item.clone()))
                            .collect(),
                    ),
                ),
                ("completed".to_string(), Value::Bool(false)),
                ("noteType".to_string(), Value::String("event".to_string())),
            ]),
            content: format!(
                "# {title}\n\n## Event\n- Symbol: {symbol}\n- Company: {company_name}\n- Type: {event_type}\n- Date: {event_date}\n- Host: {}\n- Participants: {}\n",
                request.host.clone().unwrap_or_else(|| "N/A".to_string()),
                if request.participants.is_empty() {
                    "None".to_string()
                } else {
                    request.participants.join(", ")
                }
            ),
            created_at: now,
            updated_at: now,
        };

        self.write_document(Category::Events, &document)?;
        Ok(document.response())
    }

    pub fn list_people_filtered(
        &self,
        company: Option<&str>,
        role: Option<&str>,
    ) -> Result<Vec<NoteResponse>> {
        self.filtered_category(Category::People, |doc| {
            match_contains_frontmatter(doc, "currentCompany", company)
                && match_contains_frontmatter(doc, "currentRole", role)
        })
    }

    pub fn create_person(&self, request: CreatePersonRequest) -> Result<NoteResponse> {
        if request.full_name.trim().is_empty() {
            return Err(Error::InvalidOperation(
                "fullName must not be empty".to_string(),
            ));
        }

        let title = request.full_name.trim().to_string();
        let slug = slugify(&title);
        let current_role = request.current_role.clone().unwrap_or_default();
        let current_company = request.current_company.clone().unwrap_or_default();
        let now = Utc::now();

        let document = Document {
            name: slug.clone(),
            path: Self::relative_path(Category::People, &slug),
            note_type: Category::People.note_type().to_string(),
            frontmatter: BTreeMap::from([
                ("title".to_string(), Value::String(title.clone())),
                ("fullName".to_string(), Value::String(title.clone())),
                ("currentRole".to_string(), Value::String(current_role.clone())),
                (
                    "currentCompany".to_string(),
                    Value::String(current_company.clone()),
                ),
                (
                    "linkedinUrl".to_string(),
                    Value::String(request.linkedin_url.clone().unwrap_or_default()),
                ),
                ("noteType".to_string(), Value::String("person".to_string())),
            ]),
            content: format!(
                "# {title}\n\n## Current Role\n- Role: {}\n- Company: {}\n- LinkedIn: {}\n",
                if current_role.is_empty() { "N/A" } else { &current_role },
                if current_company.is_empty() {
                    "N/A"
                } else {
                    &current_company
                },
                request.linkedin_url.clone().unwrap_or_default()
            ),
            created_at: now,
            updated_at: now,
        };

        self.write_document(Category::People, &document)?;
        Ok(document.response())
    }

    pub fn list_sectors(&self) -> Result<Vec<NoteResponse>> {
        self.filtered_category(Category::Sectors, |_| true)
    }

    pub fn create_sector(&self, request: CreateSectorRequest) -> Result<NoteResponse> {
        if request.sector_name.trim().is_empty() {
            return Err(Error::InvalidOperation(
                "sectorName must not be empty".to_string(),
            ));
        }

        let title = request.sector_name.trim().to_string();
        let slug = slugify(&title);
        let now = Utc::now();

        let document = Document {
            name: slug.clone(),
            path: Self::relative_path(Category::Sectors, &slug),
            note_type: Category::Sectors.note_type().to_string(),
            frontmatter: BTreeMap::from([
                ("title".to_string(), Value::String(title.clone())),
                ("sectorName".to_string(), Value::String(title.clone())),
                (
                    "subSectors".to_string(),
                    Value::Array(
                        request
                            .sub_sectors
                            .iter()
                            .map(|item| Value::String(item.clone()))
                            .collect(),
                    ),
                ),
                (
                    "companies".to_string(),
                    Value::Array(
                        request
                            .companies
                            .iter()
                            .map(|item| Value::String(item.clone()))
                            .collect(),
                    ),
                ),
                ("noteType".to_string(), Value::String("sector".to_string())),
            ]),
            content: format!(
                "# {title}\n\n## Coverage\n- Sub-sectors: {}\n- Companies: {}\n",
                if request.sub_sectors.is_empty() {
                    "None".to_string()
                } else {
                    request.sub_sectors.join(", ")
                },
                if request.companies.is_empty() {
                    "None".to_string()
                } else {
                    request.companies.join(", ")
                }
            ),
            created_at: now,
            updated_at: now,
        };

        self.write_document(Category::Sectors, &document)?;
        Ok(document.response())
    }

    pub fn trade_stats(&self) -> Result<TradeStatsResponse> {
        let trades = self.load_category(Category::Trades)?;
        let pnls = trades
            .iter()
            .filter_map(|trade| trade.frontmatter.get("pnl").and_then(Value::as_f64))
            .collect::<Vec<_>>();
        let winners = pnls.iter().filter(|value| **value > 0.0).count();
        let losers = pnls.iter().filter(|value| **value < 0.0).count();
        let total_pnl = round2(pnls.iter().sum());
        let gross_wins: f64 = pnls.iter().copied().filter(|value| *value > 0.0).sum();
        let gross_losses_abs: f64 = pnls
            .iter()
            .copied()
            .filter(|value| *value < 0.0)
            .map(f64::abs)
            .sum();
        let avg_win = if winners == 0 {
            0.0
        } else {
            round2(gross_wins / winners as f64)
        };
        let avg_loss = if losers == 0 {
            0.0
        } else {
            round2(
                pnls.iter()
                    .copied()
                    .filter(|value| *value < 0.0)
                    .sum::<f64>()
                    / losers as f64,
            )
        };

        Ok(TradeStatsResponse {
            total_trades: trades.len(),
            winners,
            losers,
            win_rate: if trades.is_empty() {
                0.0
            } else {
                round2((winners as f64 / trades.len() as f64) * 100.0)
            },
            total_pnl,
            avg_win,
            avg_loss,
            profit_factor: if gross_losses_abs == 0.0 {
                0.0
            } else {
                round2(gross_wins / gross_losses_abs)
            },
        })
    }

    pub fn graph(&self) -> Result<GraphResponse> {
        let docs = self.load_all_documents()?;
        let mut nodes = Vec::with_capacity(docs.len());
        let mut edges = Vec::new();

        for doc in &docs {
            nodes.push(GraphNode {
                id: doc.name.clone(),
                label: doc.title(),
                node_type: doc.note_type.clone(),
                tags: doc.tags(),
            });

            for target in extract_links(&doc.content) {
                edges.push(GraphEdge {
                    source: doc.name.clone(),
                    target: slugify(&target),
                });
            }
        }

        nodes.sort_by(|left, right| left.id.cmp(&right.id));
        edges.sort_by(|left, right| {
            left.source
                .cmp(&right.source)
                .then(left.target.cmp(&right.target))
        });

        Ok(GraphResponse { nodes, edges })
    }

    fn load_all_documents(&self) -> Result<Vec<Document>> {
        let mut docs = Vec::new();
        docs.extend(self.load_category(Category::Notes)?);
        docs.extend(self.load_category(Category::Theses)?);
        docs.extend(self.load_category(Category::Trades)?);
        docs.extend(self.load_category(Category::Events)?);
        docs.extend(self.load_category(Category::People)?);
        docs.extend(self.load_category(Category::Sectors)?);
        docs.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(docs)
    }

    fn filtered_category<F>(&self, category: Category, predicate: F) -> Result<Vec<NoteResponse>>
    where
        F: Fn(&Document) -> bool,
    {
        let mut docs = self
            .load_category(category)?
            .into_iter()
            .filter(|doc| predicate(doc))
            .map(Document::response)
            .collect::<Vec<_>>();
        docs.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(docs)
    }

    fn load_category(&self, category: Category) -> Result<Vec<Document>> {
        let dir = self.category_dir(category);
        if !dir.exists() {
            return Ok(Vec::new());
        }

        let mut docs = Vec::new();
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }

            let raw = fs::read_to_string(&path)?;
            let document: Document = serde_json::from_str(&raw)?;
            docs.push(document);
        }

        docs.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(docs)
    }

    fn load_document(&self, category: Category, name: &str) -> Result<Document> {
        let slug = slugify(name);
        let path = self.document_path(category, &slug);
        if !path.exists() {
            return Err(Error::NotFound(format!(
                "{} not found: {}",
                category.folder(),
                slug
            )));
        }

        let raw = fs::read_to_string(path)?;
        Ok(serde_json::from_str(&raw)?)
    }

    fn write_document(&self, category: Category, document: &Document) -> Result<()> {
        let path = self.document_path(category, &document.name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let payload = serde_json::to_vec_pretty(document)?;
        atomic_write(&path, &payload)?;
        Ok(())
    }

    fn category_dir(&self, category: Category) -> PathBuf {
        self.data_dir.join(category.folder())
    }

    fn document_path(&self, category: Category, name: &str) -> PathBuf {
        self.category_dir(category).join(format!("{name}.json"))
    }

    fn relative_path(category: Category, name: &str) -> String {
        format!("{}/{}.json", category.folder(), name)
    }

    fn import_legacy_vault_if_needed(&self) -> Result<()> {
        let marker = self.data_dir.join(".legacy-import-v1.json");
        if marker.exists() {
            return Ok(());
        }

        let legacy_root = legacy_vault_path();
        if legacy_root.exists() {
            self.import_legacy_vault(&legacy_root)?;
        }

        let payload = serde_json::json!({
            "importedAt": Utc::now().to_rfc3339(),
            "source": legacy_root,
            "sourceExists": legacy_root.exists(),
        });
        atomic_write(&marker, &serde_json::to_vec_pretty(&payload)?)?;
        Ok(())
    }

    fn import_legacy_vault(&self, legacy_root: &Path) -> Result<()> {
        for path in legacy_markdown_files(legacy_root)? {
            let category = legacy_category(&path, legacy_root);
            let raw = fs::read_to_string(&path)?;
            let (frontmatter, content) = parse_markdown_document(&raw);
            let stem = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("note");
            let title = frontmatter
                .get("title")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| stem.to_string());
            let slug = slugify(stem);

            if self.document_path(category, &slug).exists() {
                continue;
            }

            let mut normalized = normalize_frontmatter(frontmatter);
            normalized
                .entry("title".to_string())
                .or_insert_with(|| Value::String(title.clone()));
            normalized
                .entry("noteType".to_string())
                .or_insert_with(|| Value::String(category.note_type().to_string()));

            let metadata = fs::metadata(&path)?;
            let modified = metadata
                .modified()
                .ok()
                .map(DateTime::<Utc>::from)
                .unwrap_or_else(Utc::now);
            let created = metadata
                .created()
                .ok()
                .map(DateTime::<Utc>::from)
                .unwrap_or(modified);

            let document = Document {
                name: slug.clone(),
                path: Self::relative_path(category, &slug),
                note_type: category.note_type().to_string(),
                frontmatter: normalized,
                content,
                created_at: created,
                updated_at: modified,
            };

            self.write_document(category, &document)?;
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Document {
    name: String,
    path: String,
    note_type: String,
    frontmatter: JsonMap,
    content: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl Document {
    fn response(self) -> NoteResponse {
        NoteResponse {
            name: self.name,
            path: self.path,
            frontmatter: self.frontmatter,
            content: self.content,
        }
    }

    fn title(&self) -> String {
        self.frontmatter
            .get("title")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| self.name.clone())
    }

    fn tags(&self) -> Vec<String> {
        let mut tags = Vec::new();
        if let Some(symbol) = self.frontmatter.get("symbol").and_then(Value::as_str) {
            tags.push(symbol.to_string());
        }
        if let Some(items) = self.frontmatter.get("tags").and_then(Value::as_array) {
            tags.extend(
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToOwned::to_owned),
            );
        }
        tags.sort();
        tags.dedup();
        tags
    }

    fn search_blob(&self) -> String {
        format!(
            "{} {} {} {}",
            self.name,
            self.title(),
            serde_json::to_string(&self.frontmatter).unwrap_or_default(),
            self.content.to_lowercase()
        )
        .to_lowercase()
    }

    fn snippet(&self, query: &str) -> String {
        if query.is_empty() {
            return truncate(&self.content, 160);
        }

        let haystack = self.content.to_lowercase();
        if let Some(index) = haystack.find(query) {
            let mut start = index.saturating_sub(48);
            while start > 0 && !self.content.is_char_boundary(start) {
                start -= 1;
            }

            let mut end = (index + query.len() + 96).min(self.content.len());
            while end < self.content.len() && !self.content.is_char_boundary(end) {
                end += 1;
            }

            return self.content[start..end].trim().to_string();
        }

        truncate(&self.content, 160)
    }
}

#[derive(Debug, Clone, Copy)]
enum Category {
    Notes,
    Theses,
    Trades,
    Events,
    People,
    Sectors,
}

impl Category {
    fn folder(self) -> &'static str {
        match self {
            Self::Notes => "notes",
            Self::Theses => "theses",
            Self::Trades => "trades",
            Self::Events => "events",
            Self::People => "people",
            Self::Sectors => "sectors",
        }
    }

    fn note_type(self) -> &'static str {
        match self {
            Self::Notes => "note",
            Self::Theses => "thesis",
            Self::Trades => "trade",
            Self::Events => "event",
            Self::People => "person",
            Self::Sectors => "sector",
        }
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

fn slugify(value: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = false;

    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_was_dash = false;
        } else if !last_was_dash && !slug.is_empty() {
            slug.push('-');
            last_was_dash = true;
        }
    }

    let trimmed = slug.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "note".to_string()
    } else {
        trimmed
    }
}

fn extract_links(content: &str) -> Vec<String> {
    let mut links = Vec::new();
    let mut start_index = 0;

    while let Some(open) = content[start_index..].find("[[") {
        let open = start_index + open + 2;
        let remainder = &content[open..];
        if let Some(close) = remainder.find("]]") {
            let raw = remainder[..close].trim();
            if !raw.is_empty() {
                let target = raw.split('|').next().unwrap_or(raw).trim();
                links.push(target.to_string());
            }
            start_index = open + close + 2;
        } else {
            break;
        }
    }

    links
}

fn truncate(content: &str, max_chars: usize) -> String {
    content
        .chars()
        .take(max_chars)
        .collect::<String>()
        .trim()
        .to_string()
}

fn match_frontmatter(doc: &Document, key: &str, expected: Option<&str>) -> bool {
    match expected.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => doc
            .frontmatter
            .get(key)
            .and_then(Value::as_str)
            .map(|item| item.eq_ignore_ascii_case(value))
            .unwrap_or(false),
        None => true,
    }
}

fn match_contains_frontmatter(doc: &Document, key: &str, expected: Option<&str>) -> bool {
    match expected.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => doc
            .frontmatter
            .get(key)
            .and_then(Value::as_str)
            .map(|item| item.to_ascii_lowercase().contains(&value.to_ascii_lowercase()))
            .unwrap_or(false),
        None => true,
    }
}

fn legacy_vault_path() -> PathBuf {
    if let Some(dirs) = directories::BaseDirs::new() {
        return dirs.home_dir().join(".zee/investing").join("vault");
    }
    PathBuf::from(".investing/vault")
}

fn legacy_markdown_files(root: &Path) -> Result<Vec<PathBuf>> {
    let mut items = Vec::new();
    visit_markdown_files(root, &mut items)?;
    items.sort();
    Ok(items)
}

fn visit_markdown_files(dir: &Path, items: &mut Vec<PathBuf>) -> Result<()> {
    if !dir.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            visit_markdown_files(&path, items)?;
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) == Some("md") {
            items.push(path);
        }
    }
    Ok(())
}

fn legacy_category(path: &Path, root: &Path) -> Category {
    let first = path
        .strip_prefix(root)
        .ok()
        .and_then(|value| value.components().next())
        .and_then(|component| component.as_os_str().to_str())
        .unwrap_or_default();

    match first {
        "Theses" => Category::Theses,
        "Trades" => Category::Trades,
        "Events" => Category::Events,
        "People" => Category::People,
        "Sectors" => Category::Sectors,
        _ => Category::Notes,
    }
}

fn parse_markdown_document(raw: &str) -> (JsonMap, String) {
    if !raw.starts_with("---\n") {
        return (BTreeMap::new(), raw.trim().to_string());
    }

    let mut parts = raw.splitn(3, "---\n");
    let _ = parts.next();
    let frontmatter_raw = parts.next().unwrap_or_default();
    let content = parts.next().unwrap_or_default().trim().to_string();
    (parse_frontmatter(frontmatter_raw), content)
}

fn parse_frontmatter(raw: &str) -> JsonMap {
    let mut map = BTreeMap::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with("- ") {
            continue;
        }
        if let Some((key, value)) = line.split_once(':') {
            map.insert(key.trim().to_string(), parse_frontmatter_value(value.trim()));
        }
    }
    map
}

fn parse_frontmatter_value(value: &str) -> Value {
    if value.is_empty() {
        return Value::String(String::new());
    }
    if value.eq_ignore_ascii_case("true") {
        return Value::Bool(true);
    }
    if value.eq_ignore_ascii_case("false") {
        return Value::Bool(false);
    }
    if let Ok(number) = value.parse::<i64>() {
        return Value::from(number);
    }
    if let Ok(number) = value.parse::<f64>() {
        return Value::from(number);
    }
    if value.starts_with('[') && value.ends_with(']') {
        let items = value
            .trim_matches(['[', ']'])
            .split(',')
            .map(|item| item.trim().trim_matches('"').trim_matches('\''))
            .filter(|item| !item.is_empty())
            .map(|item| Value::String(item.to_string()))
            .collect::<Vec<_>>();
        return Value::Array(items);
    }
    Value::String(value.trim_matches('"').trim_matches('\'').to_string())
}

fn normalize_frontmatter(input: JsonMap) -> JsonMap {
    let mut normalized = BTreeMap::new();
    for (key, value) in input {
        let mapped = match key.as_str() {
            "note_type" | "type" => "noteType",
            "company_name" => "companyName",
            "entry_price" => "entryPrice",
            "target_price" => "targetPrice",
            "stop_loss" => "stopLoss",
            "entry_date" => "entryDate",
            "exit_price" => "exitPrice",
            "exit_date" => "exitDate",
            "event_type" => "eventType",
            "event_date" => "eventDate",
            "current_role" => "currentRole",
            "current_company" => "currentCompany",
            "linkedin_url" => "linkedinUrl",
            "full_name" => "fullName",
            "sector_name" => "sectorName",
            "sub_sectors" => "subSectors",
            "updated_at" => "updatedAt",
            "created_at" => "createdAt",
            other => other,
        };
        normalized.insert(mapped.to_string(), value);
    }
    normalized
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, bytes)?;
    fs::rename(tmp_path, path)?;
    Ok(())
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn runtime() -> InvestingRuntime {
        let dir = tempdir().unwrap();
        InvestingRuntime::new(dir.keep())
    }

    #[test]
    fn save_and_read_note_round_trips() {
        let runtime = runtime();
        let saved = runtime
            .save_note("My Alpha Note", "Research body".to_string())
            .unwrap();

        assert_eq!(saved.name, "my-alpha-note");
        let fetched = runtime.get_note("my alpha note").unwrap();
        assert_eq!(fetched, saved);
    }

    #[test]
    fn search_scans_all_categories() {
        let runtime = runtime();
        runtime
            .save_note("Watchlist", "Tracking AAPL".to_string())
            .unwrap();
        runtime
            .create_thesis(CreateThesisRequest {
                symbol: "MSFT".to_string(),
                company_name: Some("Microsoft".to_string()),
                sector: None,
                conviction: "high".to_string(),
            })
            .unwrap();

        let results = runtime.search_notes("microsoft").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].note_type, "thesis");
    }

    #[test]
    fn graph_extracts_wiki_links() {
        let runtime = runtime();
        runtime
            .save_note("Source", "See [[Target Note]]".to_string())
            .unwrap();
        runtime
            .save_note("Target Note", "destination".to_string())
            .unwrap();

        let graph = runtime.graph().unwrap();
        assert_eq!(graph.edges.len(), 1);
        assert_eq!(graph.edges[0].target, "target-note");
    }

    #[test]
    fn trade_stats_handle_open_positions() {
        let runtime = runtime();
        runtime
            .create_trade(CreateTradeRequest {
                symbol: "NVDA".to_string(),
                direction: "long".to_string(),
                entry_price: 120.0,
                shares: 10.0,
                entry_date: Some("2026-03-01".to_string()),
            })
            .unwrap();

        let stats = runtime.trade_stats().unwrap();
        assert_eq!(
            stats,
            TradeStatsResponse {
                total_trades: 1,
                winners: 0,
                losers: 0,
                win_rate: 0.0,
                total_pnl: 0.0,
                avg_win: 0.0,
                avg_loss: 0.0,
                profit_factor: 0.0,
            }
        );
    }
}
