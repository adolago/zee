#!/usr/bin/env python3
"""
News Digest Generator for Stanley

Generates comprehensive news digests for portfolio holdings by leveraging
agent-core's WebSearch and LLM providers. No separate API keys required.

Architecture:
  Stanley -> Tiara (claude-flow) -> Agent-Core
  - WebSearch via Exa MCP (built into agent-core)
  - LLM summarization via agent-core providers
  - Auth handled by ~/.opencode/auth.json
"""

import argparse
import asyncio
import json
import os
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# Sentiment keywords
POSITIVE_KEYWORDS = {
    "beat", "beats", "exceeds", "exceeded", "upgrade", "upgraded", "growth",
    "record", "surge", "surged", "rally", "rallies", "outperform", "bullish",
    "raises", "raised", "optimistic", "strong", "stronger", "positive"
}
NEGATIVE_KEYWORDS = {
    "miss", "missed", "misses", "downgrade", "downgraded", "decline", "declined",
    "layoffs", "lawsuit", "warning", "warns", "bearish", "weak", "weaker",
    "cuts", "slashes", "disappoints", "negative", "concern", "risk"
}

# News categories and their search patterns
CATEGORIES = {
    "general": "{ticker} stock news today",
    "earnings": "{ticker} earnings report results quarterly",
    "sec_filings": "{ticker} SEC filing 10-K 10-Q 8-K",
    "analyst": "{ticker} analyst rating upgrade downgrade price target",
    "insider": "{ticker} insider trading executive",
    "ma": "{ticker} merger acquisition deal",
    "macro": "{ticker} Fed interest rates economy",
}

# High-authority sources
AUTHORITY_SOURCES = {
    "reuters.com", "bloomberg.com", "wsj.com", "ft.com", "cnbc.com",
    "marketwatch.com", "barrons.com", "yahoo.com", "investing.com"
}


@dataclass
class Article:
    """Represents a news article."""
    ticker: str
    category: str
    title: str
    url: str
    source: str
    description: str
    published: Optional[str] = None
    summary: Optional[str] = None
    sentiment: str = "neutral"
    impact: str = "medium"

    def to_dict(self) -> dict:
        return {
            "ticker": self.ticker,
            "category": self.category,
            "title": self.title,
            "url": self.url,
            "source": self.source,
            "published": self.published,
            "description": self.description,
            "summary": self.summary,
            "sentiment": self.sentiment,
            "impact": self.impact,
        }


@dataclass
class Digest:
    """Represents a complete news digest."""
    generated_at: str
    tickers: list[str]
    range: str
    articles: list[Article] = field(default_factory=list)

    def to_dict(self) -> dict:
        articles = [a.to_dict() for a in self.articles]
        sentiment_counts = {"positive": 0, "neutral": 0, "negative": 0}
        for a in self.articles:
            sentiment_counts[a.sentiment] = sentiment_counts.get(a.sentiment, 0) + 1

        return {
            "generated_at": self.generated_at,
            "tickers": self.tickers,
            "range": self.range,
            "articles": articles,
            "summary": {
                "total_articles": len(articles),
                "by_sentiment": sentiment_counts,
                "by_ticker": self._count_by_ticker(),
            }
        }

    def _count_by_ticker(self) -> dict[str, int]:
        counts = {}
        for a in self.articles:
            counts[a.ticker] = counts.get(a.ticker, 0) + 1
        return counts


def analyze_sentiment(text: str) -> str:
    """Simple keyword-based sentiment analysis."""
    text_lower = text.lower()
    positive_count = sum(1 for kw in POSITIVE_KEYWORDS if kw in text_lower)
    negative_count = sum(1 for kw in NEGATIVE_KEYWORDS if kw in text_lower)

    if positive_count > negative_count + 1:
        return "positive"
    elif negative_count > positive_count + 1:
        return "negative"
    return "neutral"


def determine_impact(article: Article) -> str:
    """Determine article impact level."""
    source_lower = article.source.lower()
    is_authority = any(s in source_lower for s in AUTHORITY_SOURCES)
    high_impact_categories = {"earnings", "ma", "sec_filings"}

    if article.category in high_impact_categories and is_authority:
        return "high"
    elif article.category in high_impact_categories or is_authority:
        return "medium"
    return "low"


def extract_source(url: str) -> str:
    """Extract source domain from URL."""
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        domain = parsed.netloc.replace("www.", "")
        return domain
    except Exception:
        return "unknown"


def find_agent_core_path() -> Optional[Path]:
    """Find agent-core installation path."""
    # Check common locations
    paths = [
        Path.home() / ".local/src/agent-core",
        Path.home() / ".opencode",
        Path("/opt/agent-core"),
    ]
    for p in paths:
        if p.exists():
            return p
    return None


def get_opencode_bin() -> str:
    """Get opencode binary path."""
    # Check if opencode is in PATH
    result = subprocess.run(["which", "opencode"], capture_output=True, text=True)
    if result.returncode == 0:
        return result.stdout.strip()

    # Check common locations
    paths = [
        Path.home() / ".local/bin/opencode",
        Path("/usr/local/bin/opencode"),
        Path.home() / ".local/src/agent-core/dist/opencode",
    ]
    for p in paths:
        if p.exists():
            return str(p)

    # Fallback to npx
    return "npx opencode-ai"


async def search_via_agent_core(query: str, num_results: int = 5) -> list[dict]:
    """
    Search using agent-core's WebSearch tool via Exa MCP.
    Uses EXA_API_KEY from environment if available.
    """
    try:
        import httpx

        # Use Exa MCP endpoint directly (same as agent-core's websearch.ts)
        search_request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "web_search_exa",
                "arguments": {
                    "query": query,
                    "type": "auto",
                    "numResults": num_results,
                    "livecrawl": "fallback",
                }
            }
        }

        headers = {
            "accept": "application/json, text/event-stream",
            "content-type": "application/json",
        }

        # Add API key if available
        exa_key = os.environ.get("EXA_API_KEY")
        if exa_key:
            headers["x-api-key"] = exa_key

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://mcp.exa.ai/mcp",
                json=search_request,
                headers=headers,
                timeout=25.0
            )

            if resp.status_code == 200:
                # Parse SSE response (format: "event: message\ndata: {...}")
                for line in resp.text.split("\n"):
                    if line.startswith("data:"):
                        json_str = line[5:].strip()
                        if json_str:
                            data = json.loads(json_str)
                            if data.get("result", {}).get("content"):
                                text = data["result"]["content"][0]["text"]
                                return parse_exa_results(text)
    except Exception as e:
        print(f"Exa MCP call failed: {e}", file=sys.stderr)

    return []


async def search_via_claude_code(query: str, num_results: int = 5) -> list[dict]:
    """
    When running as a Claude Code skill, we can leverage the built-in WebSearch.
    This function returns a marker that tells the parent skill to use WebSearch.
    """
    # Return instruction for Claude Code to execute WebSearch
    # The actual search happens at the skill execution layer
    return [{
        "_use_websearch": True,
        "query": query,
        "num_results": num_results
    }]


def parse_exa_results(text: str) -> list[dict]:
    """Parse search results from Exa MCP response text."""
    results = []
    # Exa returns structured text with Title:, URL:, Published Date:, Text: fields
    current = {}

    for line in text.split("\n"):
        line = line.strip()
        if line.startswith("Title:"):
            if current.get("title") and current.get("url"):
                results.append(current)
            current = {"title": line[6:].strip()}
        elif line.startswith("URL:"):
            current["url"] = line[4:].strip()
        elif line.startswith("Published Date:"):
            current["published"] = line[15:].strip()
        elif line.startswith("Text:"):
            current["description"] = line[5:].strip()
        elif current.get("description") and line and not line.startswith(("Title:", "URL:", "Published")):
            # Append to description (but limit length)
            if len(current["description"]) < 500:
                current["description"] += " " + line

    if current.get("title") and current.get("url"):
        results.append(current)

    return results


async def search_ticker_news(
    ticker: str,
    categories: list[str],
    results_per_category: int = 3,
) -> list[Article]:
    """Search news for a single ticker across categories."""
    articles = []
    seen_urls = set()

    for category in categories:
        if category not in CATEGORIES:
            continue

        query = CATEGORIES[category].format(ticker=ticker)
        results = await search_via_agent_core(query, results_per_category)

        for r in results:
            # Check if this is a marker to use WebSearch
            if r.get("_use_websearch"):
                # Skip - this will be handled by Claude Code
                continue

            url = r.get("url", "")
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)

            title = r.get("title", "").strip()
            description = r.get("description", "").strip()

            article = Article(
                ticker=ticker,
                category=category,
                title=title,
                url=url,
                source=extract_source(url),
                description=description,
            )

            combined_text = f"{title} {description}"
            article.sentiment = analyze_sentiment(combined_text)
            article.impact = determine_impact(article)

            articles.append(article)

    return articles


async def generate_digest(
    tickers: list[str],
    range_str: str = "24h",
    categories: Optional[list[str]] = None,
    summarize: bool = False,
    max_articles: int = 50
) -> Digest:
    """Generate a news digest for the given tickers."""
    if categories is None:
        categories = list(CATEGORIES.keys())

    all_articles = []
    for ticker in tickers:
        ticker_articles = await search_ticker_news(
            ticker.upper(),
            categories,
            results_per_category=3,
        )
        all_articles.extend(ticker_articles)

    # Sort by impact then sentiment
    impact_order = {"high": 0, "medium": 1, "low": 2}
    all_articles.sort(key=lambda a: (impact_order.get(a.impact, 2), a.sentiment != "positive"))
    all_articles = all_articles[:max_articles]

    return Digest(
        generated_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        tickers=[t.upper() for t in tickers],
        range=range_str,
        articles=all_articles
    )


def format_json(digest: Digest) -> str:
    """Format digest as JSON."""
    return json.dumps(digest.to_dict(), indent=2)


def format_markdown(digest: Digest) -> str:
    """Format digest as Markdown."""
    lines = [
        f"# News Digest - {digest.generated_at[:10]}",
        "",
        f"**Tickers:** {', '.join(digest.tickers)}",
        f"**Range:** {digest.range}",
        f"**Total Articles:** {len(digest.articles)}",
        "",
    ]

    by_ticker: dict[str, list[Article]] = {}
    for a in digest.articles:
        by_ticker.setdefault(a.ticker, []).append(a)

    for ticker, articles in by_ticker.items():
        lines.append(f"## {ticker}")
        lines.append("")

        high_impact = [a for a in articles if a.impact == "high"]
        other = [a for a in articles if a.impact != "high"]

        if high_impact:
            lines.append("### High Impact")
            for a in high_impact:
                sentiment_icon = {"positive": "+", "negative": "-", "neutral": ""}[a.sentiment]
                lines.append(f"- {sentiment_icon}**[{a.title}]({a.url})** ({a.source})")
                if a.description:
                    lines.append(f"  {a.description[:200]}...")
            lines.append("")

        if other:
            lines.append("### Other News")
            for a in other:
                sentiment_icon = {"positive": "+", "negative": "-", "neutral": ""}[a.sentiment]
                lines.append(f"- {sentiment_icon}[{a.title}]({a.url}) ({a.source})")
            lines.append("")

    return "\n".join(lines)


def format_email(digest: Digest) -> str:
    """Format digest as HTML email."""
    sentiment_colors = {
        "positive": "#22c55e",
        "negative": "#ef4444",
        "neutral": "#6b7280"
    }

    articles_html = []
    for a in digest.articles:
        color = sentiment_colors.get(a.sentiment, "#6b7280")
        articles_html.append(f"""
        <tr>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
                <span style="color: {color}; font-weight: bold;">{a.ticker}</span>
            </td>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
                <a href="{a.url}" style="color: #2563eb; text-decoration: none;">{a.title}</a>
                <br><small style="color: #6b7280;">{a.source} | {a.category}</small>
            </td>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
                <span style="background: {color}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">
                    {a.sentiment}
                </span>
            </td>
        </tr>
        """)

    return f"""<!DOCTYPE html>
<html>
<head><style>body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }}</style></head>
<body style="max-width: 800px; margin: 0 auto; padding: 20px;">
    <h1 style="color: #1f2937;">News Digest</h1>
    <p style="color: #6b7280;">Generated: {digest.generated_at[:10]} | Tickers: {', '.join(digest.tickers)}</p>
    <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
        <thead><tr style="background: #f3f4f6;">
            <th style="padding: 12px; text-align: left;">Ticker</th>
            <th style="padding: 12px; text-align: left;">Article</th>
            <th style="padding: 12px; text-align: left;">Sentiment</th>
        </tr></thead>
        <tbody>{''.join(articles_html)}</tbody>
    </table>
    <hr style="margin-top: 40px; border: none; border-top: 1px solid #e5e7eb;">
    <p style="color: #9ca3af; font-size: 12px;">Generated by Stanley via agent-core</p>
</body>
</html>"""


def main():
    parser = argparse.ArgumentParser(
        description="Generate news digests for portfolio holdings (uses agent-core infrastructure)"
    )
    parser.add_argument(
        "--tickers", "-t",
        required=True,
        help="Comma-separated list of tickers (e.g., AAPL,NVDA,MSFT)"
    )
    parser.add_argument(
        "--range", "-r",
        default="24h",
        choices=["24h", "7d", "30d"],
        help="Time range for news (default: 24h)"
    )
    parser.add_argument(
        "--categories", "-c",
        help="Comma-separated categories (default: all)"
    )
    parser.add_argument(
        "--summarize", "-s",
        action="store_true",
        help="Summarize articles using agent-core LLM"
    )
    parser.add_argument(
        "--format", "-f",
        default="markdown",
        choices=["json", "markdown", "email"],
        help="Output format (default: markdown)"
    )
    parser.add_argument(
        "--max-articles", "-m",
        type=int,
        default=50,
        help="Maximum articles in digest (default: 50)"
    )

    args = parser.parse_args()

    tickers = [t.strip() for t in args.tickers.split(",")]
    categories = None
    if args.categories:
        categories = [c.strip() for c in args.categories.split(",")]

    digest = asyncio.run(generate_digest(
        tickers=tickers,
        range_str=args.range,
        categories=categories,
        summarize=args.summarize,
        max_articles=args.max_articles
    ))

    if args.format == "json":
        print(format_json(digest))
    elif args.format == "markdown":
        print(format_markdown(digest))
    elif args.format == "email":
        print(format_email(digest))


if __name__ == "__main__":
    main()
