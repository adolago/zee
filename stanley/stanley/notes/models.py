"""
Note Models Module

Data models for the Stanley notes system, following Obsidian-style
markdown notes with YAML frontmatter and wiki-style linking.
"""

import re
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

import yaml


class NoteType(Enum):
    """Types of notes in the vault."""

    GENERAL = "general"
    THESIS = "thesis"  # Investment thesis
    TRADE = "trade"  # Trade journal entry
    COMPANY = "company"  # Company research (MOC)
    SECTOR = "sector"  # Sector analysis
    MACRO = "macro"  # Macro research
    MEETING = "meeting"  # Meeting notes
    DAILY = "daily"  # Daily notes
    EVENT = "event"  # Conference call, investor day, earnings
    PERSON = "person"  # Management/executive profile


class AssetClass(Enum):
    """Asset classes for multi-asset support."""

    EQUITY = "equity"
    FIXED_INCOME = "fixed_income"
    COMMODITY = "commodity"
    CURRENCY = "currency"
    CRYPTO = "crypto"
    REAL_ESTATE = "real_estate"
    DERIVATIVE = "derivative"


class MoatSource(Enum):
    """Morningstar's 5 sources of competitive advantage."""

    INTANGIBLE_ASSETS = "intangible_assets"  # Brands, patents, licenses
    COST_ADVANTAGE = "cost_advantage"  # Scale, process, location
    SWITCHING_COSTS = "switching_costs"  # Customer lock-in
    NETWORK_EFFECT = "network_effect"  # Platform value
    EFFICIENT_SCALE = "efficient_scale"  # Limited market size


class MoatRating(Enum):
    """Morningstar moat rating based on ROIC sustainability."""

    NONE = "none"  # <10 years excess returns
    NARROW = "narrow"  # 10-20 years excess returns
    WIDE = "wide"  # >20 years excess returns


class EventType(Enum):
    """Types of corporate events."""

    EARNINGS_CALL = "earnings_call"
    INVESTOR_DAY = "investor_day"
    CONFERENCE = "conference"
    ANALYST_MEETING = "analyst_meeting"
    SITE_VISIT = "site_visit"
    AGM = "agm"  # Annual General Meeting
    GUIDANCE_UPDATE = "guidance_update"
    M_AND_A = "m_and_a"  # M&A announcement
    OTHER = "other"


class ConvictionLevel(Enum):
    """Conviction level for investment theses."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    VERY_HIGH = "very_high"


class ThesisStatus(Enum):
    """Status of an investment thesis."""

    RESEARCH = "research"  # Still researching
    WATCHLIST = "watchlist"  # On watchlist
    ACTIVE = "active"  # Active position
    CLOSED = "closed"  # Position closed
    INVALIDATED = "invalidated"  # Thesis was wrong


class TradeDirection(Enum):
    """Trade direction."""

    LONG = "long"
    SHORT = "short"


class TradeStatus(Enum):
    """Trade status."""

    OPEN = "open"
    CLOSED = "closed"
    PARTIAL = "partial"


@dataclass
class NoteFrontmatter:
    """YAML frontmatter for a note."""

    title: str
    note_type: NoteType = NoteType.GENERAL
    created: datetime = field(default_factory=datetime.now)
    modified: datetime = field(default_factory=datetime.now)
    tags: List[str] = field(default_factory=list)
    aliases: List[str] = field(default_factory=list)
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_yaml(self) -> str:
        """Convert to YAML string."""
        data = {
            "title": self.title,
            "type": self.note_type.value,
            "created": self.created.isoformat(),
            "modified": self.modified.isoformat(),
            "tags": self.tags,
            "aliases": self.aliases,
            **self.extra,
        }
        return yaml.dump(data, default_flow_style=False, sort_keys=False)

    @classmethod
    def from_yaml(cls, yaml_str: str) -> "NoteFrontmatter":
        """Parse from YAML string."""
        data = yaml.safe_load(yaml_str) or {}

        note_type = NoteType.GENERAL
        if "type" in data:
            try:
                note_type = NoteType(data.pop("type"))
            except ValueError:
                pass

        created = datetime.now()
        if "created" in data:
            try:
                created = datetime.fromisoformat(data.pop("created"))
            except (ValueError, TypeError):
                pass

        modified = datetime.now()
        if "modified" in data:
            try:
                modified = datetime.fromisoformat(data.pop("modified"))
            except (ValueError, TypeError):
                pass

        return cls(
            title=data.pop("title", "Untitled"),
            note_type=note_type,
            created=created,
            modified=modified,
            tags=data.pop("tags", []),
            aliases=data.pop("aliases", []),
            extra=data,
        )


@dataclass
class ThesisFrontmatter(NoteFrontmatter):
    """Frontmatter for investment thesis notes."""

    symbol: str = ""
    company_name: str = ""
    sector: str = ""
    asset_class: AssetClass = AssetClass.EQUITY
    currency: str = "USD"  # Base currency for valuation
    status: ThesisStatus = ThesisStatus.RESEARCH
    conviction: ConvictionLevel = ConvictionLevel.MEDIUM
    entry_price: Optional[float] = None
    target_price: Optional[float] = None
    stop_loss: Optional[float] = None
    position_size_percent: Optional[float] = None
    time_horizon: str = ""  # e.g., "6-12 months"
    catalyst: str = ""
    key_risks: List[str] = field(default_factory=list)
    bull_case: str = ""
    bear_case: str = ""
    base_case: str = ""
    # Moat analysis (Morningstar framework)
    moat_rating: MoatRating = MoatRating.NONE
    moat_sources: List[MoatSource] = field(default_factory=list)
    moat_trend: str = ""  # "stable", "positive", "negative"
    # Fundamental metrics
    roic: Optional[float] = None  # Return on Invested Capital
    wacc: Optional[float] = None  # Weighted Average Cost of Capital
    roic_wacc_spread: Optional[float] = None  # Excess returns
    # Management quality
    management_quality: Optional[int] = None  # 1-10 rating
    capital_allocation_score: Optional[int] = None  # 1-10 rating
    # Competitors for comparison
    competitors: List[str] = field(default_factory=list)  # [[Competitor A]]

    def __post_init__(self):
        self.note_type = NoteType.THESIS
        # Calculate ROIC-WACC spread if both values are present
        if self.roic is not None and self.wacc is not None:
            self.roic_wacc_spread = self.roic - self.wacc

    def to_yaml(self) -> str:
        """Convert to YAML string."""
        data = {
            "title": self.title,
            "type": self.note_type.value,
            "symbol": self.symbol,
            "company_name": self.company_name,
            "sector": self.sector,
            "asset_class": self.asset_class.value,
            "currency": self.currency,
            "status": self.status.value,
            "conviction": self.conviction.value,
            "entry_price": self.entry_price,
            "target_price": self.target_price,
            "stop_loss": self.stop_loss,
            "position_size_percent": self.position_size_percent,
            "time_horizon": self.time_horizon,
            "catalyst": self.catalyst,
            "key_risks": self.key_risks,
            "bull_case": self.bull_case,
            "bear_case": self.bear_case,
            "base_case": self.base_case,
            # Moat analysis
            "moat_rating": self.moat_rating.value,
            "moat_sources": [m.value for m in self.moat_sources],
            "moat_trend": self.moat_trend,
            # Fundamentals
            "roic": self.roic,
            "wacc": self.wacc,
            "roic_wacc_spread": self.roic_wacc_spread,
            # Management
            "management_quality": self.management_quality,
            "capital_allocation_score": self.capital_allocation_score,
            "competitors": self.competitors,
            "created": self.created.isoformat(),
            "modified": self.modified.isoformat(),
            "tags": self.tags,
            "aliases": self.aliases,
            **self.extra,
        }
        # Remove None values and empty lists
        data = {k: v for k, v in data.items() if v is not None and v != []}
        return yaml.dump(data, default_flow_style=False, sort_keys=False)

    @classmethod
    def from_yaml(cls, yaml_str: str) -> "ThesisFrontmatter":
        """Parse from YAML string."""
        data = yaml.safe_load(yaml_str) or {}

        status = ThesisStatus.RESEARCH
        if "status" in data:
            try:
                status = ThesisStatus(data.pop("status"))
            except ValueError:
                pass

        conviction = ConvictionLevel.MEDIUM
        if "conviction" in data:
            try:
                conviction = ConvictionLevel(data.pop("conviction"))
            except ValueError:
                pass

        created = datetime.now()
        if "created" in data:
            try:
                created = datetime.fromisoformat(data.pop("created"))
            except (ValueError, TypeError):
                pass

        modified = datetime.now()
        if "modified" in data:
            try:
                modified = datetime.fromisoformat(data.pop("modified"))
            except (ValueError, TypeError):
                pass

        return cls(
            title=data.pop("title", "Untitled"),
            symbol=data.pop("symbol", ""),
            company_name=data.pop("company_name", ""),
            sector=data.pop("sector", ""),
            status=status,
            conviction=conviction,
            entry_price=data.pop("entry_price", None),
            target_price=data.pop("target_price", None),
            stop_loss=data.pop("stop_loss", None),
            position_size_percent=data.pop("position_size_percent", None),
            time_horizon=data.pop("time_horizon", ""),
            catalyst=data.pop("catalyst", ""),
            key_risks=data.pop("key_risks", []),
            bull_case=data.pop("bull_case", ""),
            bear_case=data.pop("bear_case", ""),
            base_case=data.pop("base_case", ""),
            created=created,
            modified=modified,
            tags=data.pop("tags", []),
            aliases=data.pop("aliases", []),
            extra=data,
        )


@dataclass
class TradeFrontmatter(NoteFrontmatter):
    """Frontmatter for trade journal entries."""

    symbol: str = ""
    direction: TradeDirection = TradeDirection.LONG
    status: TradeStatus = TradeStatus.OPEN
    entry_date: Optional[datetime] = None
    exit_date: Optional[datetime] = None
    entry_price: float = 0.0
    exit_price: Optional[float] = None
    shares: float = 0.0
    commission: float = 0.0
    thesis_link: str = ""  # [[Link to thesis]]
    entry_reason: str = ""
    exit_reason: str = ""
    lessons_learned: str = ""
    emotional_state: str = ""  # e.g., "confident", "fearful", "fomo"
    grade: str = ""  # A-F self-assessment

    def __post_init__(self):
        self.note_type = NoteType.TRADE

    @property
    def pnl(self) -> Optional[float]:
        """Calculate P&L if trade is closed."""
        if self.exit_price is None:
            return None
        if self.direction == TradeDirection.LONG:
            return (self.exit_price - self.entry_price) * self.shares - self.commission
        else:
            return (self.entry_price - self.exit_price) * self.shares - self.commission

    @property
    def pnl_percent(self) -> Optional[float]:
        """Calculate P&L percentage."""
        if self.exit_price is None or self.entry_price == 0:
            return None
        if self.direction == TradeDirection.LONG:
            return ((self.exit_price / self.entry_price) - 1) * 100
        else:
            return ((self.entry_price / self.exit_price) - 1) * 100

    @property
    def holding_period_days(self) -> Optional[int]:
        """Calculate holding period in days."""
        if self.entry_date is None:
            return None
        end = self.exit_date or datetime.now()
        return (end - self.entry_date).days

    def to_yaml(self) -> str:
        """Convert to YAML string."""
        data = {
            "title": self.title,
            "type": self.note_type.value,
            "symbol": self.symbol,
            "direction": self.direction.value,
            "status": self.status.value,
            "entry_date": self.entry_date.isoformat() if self.entry_date else None,
            "exit_date": self.exit_date.isoformat() if self.exit_date else None,
            "entry_price": self.entry_price,
            "exit_price": self.exit_price,
            "shares": self.shares,
            "commission": self.commission,
            "pnl": self.pnl,
            "pnl_percent": self.pnl_percent,
            "holding_period_days": self.holding_period_days,
            "thesis_link": self.thesis_link,
            "entry_reason": self.entry_reason,
            "exit_reason": self.exit_reason,
            "lessons_learned": self.lessons_learned,
            "emotional_state": self.emotional_state,
            "grade": self.grade,
            "created": self.created.isoformat(),
            "modified": self.modified.isoformat(),
            "tags": self.tags,
            "aliases": self.aliases,
            **self.extra,
        }
        data = {k: v for k, v in data.items() if v is not None}
        return yaml.dump(data, default_flow_style=False, sort_keys=False)

    @classmethod
    def from_yaml(cls, yaml_str: str) -> "TradeFrontmatter":
        """Parse from YAML string."""
        data = yaml.safe_load(yaml_str) or {}

        direction = TradeDirection.LONG
        if "direction" in data:
            try:
                direction = TradeDirection(data.pop("direction"))
            except ValueError:
                pass

        status = TradeStatus.OPEN
        if "status" in data:
            try:
                status = TradeStatus(data.pop("status"))
            except ValueError:
                pass

        entry_date = None
        if "entry_date" in data and data["entry_date"]:
            try:
                entry_date = datetime.fromisoformat(data.pop("entry_date"))
            except (ValueError, TypeError):
                data.pop("entry_date", None)

        exit_date = None
        if "exit_date" in data and data["exit_date"]:
            try:
                exit_date = datetime.fromisoformat(data.pop("exit_date"))
            except (ValueError, TypeError):
                data.pop("exit_date", None)

        created = datetime.now()
        if "created" in data:
            try:
                created = datetime.fromisoformat(data.pop("created"))
            except (ValueError, TypeError):
                pass

        modified = datetime.now()
        if "modified" in data:
            try:
                modified = datetime.fromisoformat(data.pop("modified"))
            except (ValueError, TypeError):
                pass

        # Remove computed fields
        data.pop("pnl", None)
        data.pop("pnl_percent", None)
        data.pop("holding_period_days", None)

        return cls(
            title=data.pop("title", "Untitled"),
            symbol=data.pop("symbol", ""),
            direction=direction,
            status=status,
            entry_date=entry_date,
            exit_date=exit_date,
            entry_price=data.pop("entry_price", 0.0),
            exit_price=data.pop("exit_price", None),
            shares=data.pop("shares", 0.0),
            commission=data.pop("commission", 0.0),
            thesis_link=data.pop("thesis_link", ""),
            entry_reason=data.pop("entry_reason", ""),
            exit_reason=data.pop("exit_reason", ""),
            lessons_learned=data.pop("lessons_learned", ""),
            emotional_state=data.pop("emotional_state", ""),
            grade=data.pop("grade", ""),
            created=created,
            modified=modified,
            tags=data.pop("tags", []),
            aliases=data.pop("aliases", []),
            extra=data,
        )


@dataclass
class EventFrontmatter(NoteFrontmatter):
    """Frontmatter for corporate event notes (conference calls, investor days, etc.)."""

    event_type: EventType = EventType.OTHER
    event_date: Optional[datetime] = None
    company: str = ""  # [[Company]] link
    symbol: str = ""
    participants: List[str] = field(default_factory=list)  # [[Person]] links
    host: str = ""  # Bank/broker hosting the event
    key_takeaways: List[str] = field(default_factory=list)
    management_tone: str = ""  # e.g., "confident", "cautious", "defensive"
    guidance_change: str = ""  # "raised", "lowered", "maintained", "none"
    recording_url: str = ""
    transcript_url: str = ""

    def __post_init__(self):
        self.note_type = NoteType.EVENT

    def to_yaml(self) -> str:
        """Convert to YAML string."""
        data = {
            "title": self.title,
            "type": self.note_type.value,
            "event_type": self.event_type.value,
            "event_date": self.event_date.isoformat() if self.event_date else None,
            "company": self.company,
            "symbol": self.symbol,
            "participants": self.participants,
            "host": self.host,
            "key_takeaways": self.key_takeaways,
            "management_tone": self.management_tone,
            "guidance_change": self.guidance_change,
            "recording_url": self.recording_url,
            "transcript_url": self.transcript_url,
            "created": self.created.isoformat(),
            "modified": self.modified.isoformat(),
            "tags": self.tags,
            "aliases": self.aliases,
            **self.extra,
        }
        data = {k: v for k, v in data.items() if v is not None and v != [] and v != ""}
        return yaml.dump(data, default_flow_style=False, sort_keys=False)

    @classmethod
    def from_yaml(cls, yaml_str: str) -> "EventFrontmatter":
        """Parse from YAML string."""
        data = yaml.safe_load(yaml_str) or {}

        event_type = EventType.OTHER
        if "event_type" in data:
            try:
                event_type = EventType(data.pop("event_type"))
            except ValueError:
                pass

        event_date = None
        if "event_date" in data and data["event_date"]:
            try:
                event_date = datetime.fromisoformat(data.pop("event_date"))
            except (ValueError, TypeError):
                data.pop("event_date", None)

        created = datetime.now()
        if "created" in data:
            try:
                created = datetime.fromisoformat(data.pop("created"))
            except (ValueError, TypeError):
                pass

        modified = datetime.now()
        if "modified" in data:
            try:
                modified = datetime.fromisoformat(data.pop("modified"))
            except (ValueError, TypeError):
                pass

        return cls(
            title=data.pop("title", "Untitled"),
            event_type=event_type,
            event_date=event_date,
            company=data.pop("company", ""),
            symbol=data.pop("symbol", ""),
            participants=data.pop("participants", []),
            host=data.pop("host", ""),
            key_takeaways=data.pop("key_takeaways", []),
            management_tone=data.pop("management_tone", ""),
            guidance_change=data.pop("guidance_change", ""),
            recording_url=data.pop("recording_url", ""),
            transcript_url=data.pop("transcript_url", ""),
            created=created,
            modified=modified,
            tags=data.pop("tags", []),
            aliases=data.pop("aliases", []),
            extra=data,
        )


@dataclass
class PersonFrontmatter(NoteFrontmatter):
    """Frontmatter for person/executive profiles."""

    full_name: str = ""
    current_role: str = ""  # e.g., "CEO", "CFO", "IRO"
    current_company: str = ""  # [[Company]] link
    linkedin_url: str = ""
    email: str = ""
    phone: str = ""
    # Role history for tracking executive transitions
    role_history: List[Dict[str, str]] = field(default_factory=list)
    # Associated people (network mapping)
    associated_people: List[str] = field(default_factory=list)  # [[Person]] links
    # Notes about the person
    reputation: str = ""  # e.g., "strong operator", "financial engineer"
    communication_style: str = ""  # e.g., "transparent", "guarded"
    track_record: str = ""  # Summary of past performance
    red_flags: List[str] = field(default_factory=list)
    green_flags: List[str] = field(default_factory=list)

    def __post_init__(self):
        self.note_type = NoteType.PERSON

    def to_yaml(self) -> str:
        """Convert to YAML string."""
        data = {
            "title": self.title,
            "type": self.note_type.value,
            "full_name": self.full_name,
            "current_role": self.current_role,
            "current_company": self.current_company,
            "linkedin_url": self.linkedin_url,
            "email": self.email,
            "phone": self.phone,
            "role_history": self.role_history,
            "associated_people": self.associated_people,
            "reputation": self.reputation,
            "communication_style": self.communication_style,
            "track_record": self.track_record,
            "red_flags": self.red_flags,
            "green_flags": self.green_flags,
            "created": self.created.isoformat(),
            "modified": self.modified.isoformat(),
            "tags": self.tags,
            "aliases": self.aliases,
            **self.extra,
        }
        data = {k: v for k, v in data.items() if v is not None and v != [] and v != ""}
        return yaml.dump(data, default_flow_style=False, sort_keys=False)

    @classmethod
    def from_yaml(cls, yaml_str: str) -> "PersonFrontmatter":
        """Parse from YAML string."""
        data = yaml.safe_load(yaml_str) or {}

        created = datetime.now()
        if "created" in data:
            try:
                created = datetime.fromisoformat(data.pop("created"))
            except (ValueError, TypeError):
                pass

        modified = datetime.now()
        if "modified" in data:
            try:
                modified = datetime.fromisoformat(data.pop("modified"))
            except (ValueError, TypeError):
                pass

        return cls(
            title=data.pop("title", "Untitled"),
            full_name=data.pop("full_name", ""),
            current_role=data.pop("current_role", ""),
            current_company=data.pop("current_company", ""),
            linkedin_url=data.pop("linkedin_url", ""),
            email=data.pop("email", ""),
            phone=data.pop("phone", ""),
            role_history=data.pop("role_history", []),
            associated_people=data.pop("associated_people", []),
            reputation=data.pop("reputation", ""),
            communication_style=data.pop("communication_style", ""),
            track_record=data.pop("track_record", ""),
            red_flags=data.pop("red_flags", []),
            green_flags=data.pop("green_flags", []),
            created=created,
            modified=modified,
            tags=data.pop("tags", []),
            aliases=data.pop("aliases", []),
            extra=data,
        )


@dataclass
class SectorFrontmatter(NoteFrontmatter):
    """Frontmatter for sector/industry analysis notes."""

    sector_name: str = ""
    sub_sectors: List[str] = field(default_factory=list)
    companies_covered: List[str] = field(default_factory=list)  # [[Company]] links
    # Sector characteristics
    cyclicality: str = ""  # "cyclical", "defensive", "mixed"
    capital_intensity: str = ""  # "high", "medium", "low"
    regulatory_environment: str = ""  # "heavy", "moderate", "light"
    growth_profile: str = ""  # "high_growth", "mature", "declining"
    # Market structure
    market_size: Optional[float] = None
    market_size_currency: str = "USD"
    market_growth_rate: Optional[float] = None  # Annual %
    concentration: str = ""  # "fragmented", "oligopoly", "monopoly"
    # Key dynamics
    key_value_drivers: List[str] = field(default_factory=list)
    key_risks: List[str] = field(default_factory=list)
    # Typical moat sources for the sector
    common_moat_sources: List[MoatSource] = field(default_factory=list)
    # Valuation benchmarks
    typical_pe_range: str = ""  # e.g., "15-25x"
    typical_ev_ebitda_range: str = ""  # e.g., "8-12x"
    # Sector outlook
    outlook: str = ""  # "bullish", "neutral", "bearish"
    outlook_rationale: str = ""

    def __post_init__(self):
        self.note_type = NoteType.SECTOR

    def to_yaml(self) -> str:
        """Convert to YAML string."""
        data = {
            "title": self.title,
            "type": self.note_type.value,
            "sector_name": self.sector_name,
            "sub_sectors": self.sub_sectors,
            "companies_covered": self.companies_covered,
            "cyclicality": self.cyclicality,
            "capital_intensity": self.capital_intensity,
            "regulatory_environment": self.regulatory_environment,
            "growth_profile": self.growth_profile,
            "market_size": self.market_size,
            "market_size_currency": self.market_size_currency,
            "market_growth_rate": self.market_growth_rate,
            "concentration": self.concentration,
            "key_value_drivers": self.key_value_drivers,
            "key_risks": self.key_risks,
            "common_moat_sources": [m.value for m in self.common_moat_sources],
            "typical_pe_range": self.typical_pe_range,
            "typical_ev_ebitda_range": self.typical_ev_ebitda_range,
            "outlook": self.outlook,
            "outlook_rationale": self.outlook_rationale,
            "created": self.created.isoformat(),
            "modified": self.modified.isoformat(),
            "tags": self.tags,
            "aliases": self.aliases,
            **self.extra,
        }
        data = {k: v for k, v in data.items() if v is not None and v != [] and v != ""}
        return yaml.dump(data, default_flow_style=False, sort_keys=False)

    @classmethod
    def from_yaml(cls, yaml_str: str) -> "SectorFrontmatter":
        """Parse from YAML string."""
        data = yaml.safe_load(yaml_str) or {}

        created = datetime.now()
        if "created" in data:
            try:
                created = datetime.fromisoformat(data.pop("created"))
            except (ValueError, TypeError):
                pass

        modified = datetime.now()
        if "modified" in data:
            try:
                modified = datetime.fromisoformat(data.pop("modified"))
            except (ValueError, TypeError):
                pass

        moat_sources = []
        if "common_moat_sources" in data:
            for m in data.pop("common_moat_sources", []):
                try:
                    moat_sources.append(MoatSource(m))
                except ValueError:
                    pass

        return cls(
            title=data.pop("title", "Untitled"),
            sector_name=data.pop("sector_name", ""),
            sub_sectors=data.pop("sub_sectors", []),
            companies_covered=data.pop("companies_covered", []),
            cyclicality=data.pop("cyclicality", ""),
            capital_intensity=data.pop("capital_intensity", ""),
            regulatory_environment=data.pop("regulatory_environment", ""),
            growth_profile=data.pop("growth_profile", ""),
            market_size=data.pop("market_size", None),
            market_size_currency=data.pop("market_size_currency", "USD"),
            market_growth_rate=data.pop("market_growth_rate", None),
            concentration=data.pop("concentration", ""),
            key_value_drivers=data.pop("key_value_drivers", []),
            key_risks=data.pop("key_risks", []),
            common_moat_sources=moat_sources,
            typical_pe_range=data.pop("typical_pe_range", ""),
            typical_ev_ebitda_range=data.pop("typical_ev_ebitda_range", ""),
            outlook=data.pop("outlook", ""),
            outlook_rationale=data.pop("outlook_rationale", ""),
            created=created,
            modified=modified,
            tags=data.pop("tags", []),
            aliases=data.pop("aliases", []),
            extra=data,
        )


@dataclass
class Note:
    """A note in the vault."""

    path: Path
    frontmatter: NoteFrontmatter
    content: str
    _outgoing_links: Set[str] = field(default_factory=set)
    _incoming_links: Set[str] = field(default_factory=set)

    # Regex for wiki-style links: [[Link]] or [[Link|Display Text]]
    LINK_PATTERN = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]")

    @property
    def name(self) -> str:
        """Get note name without extension."""
        return self.path.stem

    @property
    def outgoing_links(self) -> Set[str]:
        """Get all outgoing wiki links from this note."""
        if not self._outgoing_links:
            self._outgoing_links = set(self.LINK_PATTERN.findall(self.content))
        return self._outgoing_links

    @property
    def incoming_links(self) -> Set[str]:
        """Get all incoming links (backlinks) to this note."""
        return self._incoming_links

    def add_backlink(self, source_note: str) -> None:
        """Add a backlink from another note."""
        self._incoming_links.add(source_note)

    def to_markdown(self) -> str:
        """Convert note to markdown with YAML frontmatter."""
        yaml_content = self.frontmatter.to_yaml()
        return f"---\n{yaml_content}---\n\n{self.content}"

    @classmethod
    def from_markdown(cls, path: Path, markdown: str) -> "Note":
        """Parse a note from markdown with YAML frontmatter."""
        frontmatter_match = re.match(r"^---\n(.*?)\n---\n\n?(.*)", markdown, re.DOTALL)

        if frontmatter_match:
            yaml_str = frontmatter_match.group(1)
            content = frontmatter_match.group(2)

            # Determine frontmatter type from YAML
            data = yaml.safe_load(yaml_str) or {}
            note_type = data.get("type", "general")

            if note_type == "thesis":
                frontmatter = ThesisFrontmatter.from_yaml(yaml_str)
            elif note_type == "trade":
                frontmatter = TradeFrontmatter.from_yaml(yaml_str)
            elif note_type == "event":
                frontmatter = EventFrontmatter.from_yaml(yaml_str)
            elif note_type == "person":
                frontmatter = PersonFrontmatter.from_yaml(yaml_str)
            elif note_type == "sector":
                frontmatter = SectorFrontmatter.from_yaml(yaml_str)
            else:
                frontmatter = NoteFrontmatter.from_yaml(yaml_str)
        else:
            frontmatter = NoteFrontmatter(title=path.stem)
            content = markdown

        return cls(path=path, frontmatter=frontmatter, content=content)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "path": str(self.path),
            "name": self.name,
            "title": self.frontmatter.title,
            "type": self.frontmatter.note_type.value,
            "created": self.frontmatter.created.isoformat(),
            "modified": self.frontmatter.modified.isoformat(),
            "tags": self.frontmatter.tags,
            "outgoing_links": list(self.outgoing_links),
            "incoming_links": list(self.incoming_links),
            "content_preview": (
                self.content[:200] + "..." if len(self.content) > 200 else self.content
            ),
        }
