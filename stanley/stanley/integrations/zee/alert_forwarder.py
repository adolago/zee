"""
Alert Forwarder - Zee Integration

Forwards Stanley alerts to Zee's messaging gateway for delivery via Telegram.
Stanley has a designated Telegram bot that Zee manages.

Alert types:
- Price alerts (target price reached)
- Flow alerts (unusual options activity)
- Dark pool alerts (large block trades)
- Signal alerts (trading signals generated)
- Risk alerts (portfolio risk warnings)
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)


class AlertSeverity(Enum):
    """Alert severity levels."""

    INFO = "info"  # Informational
    WARNING = "warning"  # Requires attention
    CRITICAL = "critical"  # Immediate action needed


class AlertType(Enum):
    """Types of Stanley alerts."""

    PRICE = "price"
    OPTIONS_FLOW = "options_flow"
    DARK_POOL = "dark_pool"
    SIGNAL = "signal"
    RISK = "risk"
    EARNINGS = "earnings"
    NEWS = "news"
    INSTITUTIONAL = "institutional"


@dataclass
class StanleyAlert:
    """Stanley alert structure."""

    alert_type: AlertType
    severity: AlertSeverity
    symbol: str
    title: str
    message: str
    data: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_telegram_message(self) -> str:
        """Format alert for Telegram."""
        severity_emoji = {
            AlertSeverity.INFO: "ℹ️",
            AlertSeverity.WARNING: "⚠️",
            AlertSeverity.CRITICAL: "🚨",
        }

        type_emoji = {
            AlertType.PRICE: "📈",
            AlertType.OPTIONS_FLOW: "🎯",
            AlertType.DARK_POOL: "🏊",
            AlertType.SIGNAL: "📊",
            AlertType.RISK: "⚡",
            AlertType.EARNINGS: "📋",
            AlertType.NEWS: "📰",
            AlertType.INSTITUTIONAL: "🏛️",
        }

        emoji = severity_emoji.get(self.severity, "📌")
        type_icon = type_emoji.get(self.alert_type, "📌")

        lines = [
            f"{emoji} {type_icon} **Stanley Alert: {self.title}**",
            "",
            f"Symbol: `{self.symbol}`",
            f"Type: {self.alert_type.value}",
            "",
            self.message,
        ]

        # Add data details
        if self.data:
            lines.append("")
            for key, value in self.data.items():
                if isinstance(value, float):
                    lines.append(f"• {key}: {value:,.2f}")
                else:
                    lines.append(f"• {key}: {value}")

        lines.append("")
        lines.append(f"_Time: {self.timestamp.strftime('%Y-%m-%d %H:%M:%S UTC')}_")

        return "\n".join(lines)


class AlertForwarder:
    """
    Forwards Stanley alerts through Zee's messaging gateway.

    Uses the agent-core daemon's messaging API to route alerts
    to Telegram via Zee's gateway.
    """

    def __init__(
        self,
        daemon_url: str = "http://127.0.0.1:3210",
        telegram_chat_id: Optional[str] = None,
        enabled: bool = True,
    ):
        """
        Initialize alert forwarder.

        Args:
            daemon_url: Agent-core daemon URL
            telegram_chat_id: Default Telegram chat ID for alerts
            enabled: Whether forwarding is enabled
        """
        self._daemon_url = daemon_url
        self._telegram_chat_id = telegram_chat_id or os.getenv(
            "STANLEY_TELEGRAM_CHAT_ID"
        )
        self._enabled = enabled
        self._client: Optional[httpx.AsyncClient] = None

        # Alert queue for batching
        self._alert_queue: List[StanleyAlert] = []
        self._batch_interval = 5.0  # seconds

        # Rate limiting
        self._last_alert_time: Dict[str, datetime] = {}
        self._rate_limit_seconds = 60  # 1 alert per symbol per minute for same type

        # Severity filtering
        self._min_severity = AlertSeverity.INFO

        logger.info(
            f"AlertForwarder initialized (enabled={enabled}, "
            f"chat_id={self._telegram_chat_id})"
        )

    async def start(self) -> None:
        """Start the alert forwarder."""
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)

        logger.info("AlertForwarder started")

    async def stop(self) -> None:
        """Stop the alert forwarder."""
        # Flush remaining alerts
        if self._alert_queue:
            await self._flush_alerts()

        if self._client:
            await self._client.aclose()
            self._client = None

        logger.info("AlertForwarder stopped")

    async def send_alert(
        self,
        alert: StanleyAlert,
        chat_id: Optional[str] = None,
        force: bool = False,
    ) -> bool:
        """
        Send an alert via Zee's gateway.

        Args:
            alert: Alert to send
            chat_id: Override chat ID
            force: Bypass rate limiting

        Returns:
            True if sent successfully
        """
        if not self._enabled:
            logger.debug("Alert forwarding disabled")
            return False

        # Check severity
        if alert.severity.value < self._min_severity.value:
            logger.debug(f"Alert below minimum severity: {alert.severity}")
            return False

        # Check rate limit
        if not force and not self._should_send(alert):
            logger.debug(f"Alert rate limited: {alert.symbol} {alert.alert_type}")
            return False

        # Format message
        message = alert.to_telegram_message()
        target_chat = chat_id or self._telegram_chat_id

        if not target_chat:
            logger.warning("No Telegram chat ID configured")
            return False

        return await self._send_telegram_message(message, target_chat)

    async def send_price_alert(
        self,
        symbol: str,
        current_price: float,
        target_price: float,
        direction: str = "above",
    ) -> bool:
        """Send a price alert."""
        alert = StanleyAlert(
            alert_type=AlertType.PRICE,
            severity=AlertSeverity.WARNING,
            symbol=symbol,
            title=f"{symbol} Price Alert",
            message=f"{symbol} has moved {direction} ${target_price:.2f}",
            data={
                "current_price": current_price,
                "target_price": target_price,
                "direction": direction,
            },
        )
        return await self.send_alert(alert)

    async def send_flow_alert(
        self,
        symbol: str,
        flow_data: Dict[str, Any],
    ) -> bool:
        """Send an options flow alert."""
        premium = flow_data.get("premium", 0)
        trade_type = flow_data.get("trade_type", "unknown")
        sentiment = flow_data.get("sentiment", "neutral")

        severity = (
            AlertSeverity.CRITICAL
            if premium >= 500_000
            else AlertSeverity.WARNING if premium >= 100_000 else AlertSeverity.INFO
        )

        alert = StanleyAlert(
            alert_type=AlertType.OPTIONS_FLOW,
            severity=severity,
            symbol=symbol,
            title=f"{symbol} Options Flow",
            message=f"${premium:,.0f} {trade_type} detected ({sentiment})",
            data=flow_data,
        )
        return await self.send_alert(alert)

    async def send_dark_pool_alert(
        self,
        symbol: str,
        size: int,
        price: float,
        notional: float,
        venue: Optional[str] = None,
    ) -> bool:
        """Send a dark pool alert."""
        severity = (
            AlertSeverity.CRITICAL
            if notional >= 5_000_000
            else AlertSeverity.WARNING if notional >= 1_000_000 else AlertSeverity.INFO
        )

        alert = StanleyAlert(
            alert_type=AlertType.DARK_POOL,
            severity=severity,
            symbol=symbol,
            title=f"{symbol} Dark Pool Activity",
            message=f"{size:,} shares @ ${price:.2f} (${notional/1_000_000:.1f}M)",
            data={
                "size": size,
                "price": price,
                "notional": notional,
                "venue": venue or "N/A",
            },
        )
        return await self.send_alert(alert)

    async def send_signal_alert(
        self,
        symbol: str,
        signal_type: str,
        conviction: float,
        source: str,
        details: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Send a trading signal alert."""
        severity = (
            AlertSeverity.CRITICAL
            if conviction >= 0.8
            else AlertSeverity.WARNING if conviction >= 0.6 else AlertSeverity.INFO
        )

        alert = StanleyAlert(
            alert_type=AlertType.SIGNAL,
            severity=severity,
            symbol=symbol,
            title=f"{symbol} Signal: {signal_type.title()}",
            message=f"{signal_type.title()} signal ({conviction*100:.0f}% conviction) from {source}",
            data={
                "signal_type": signal_type,
                "conviction": conviction,
                "source": source,
                **(details or {}),
            },
        )
        return await self.send_alert(alert)

    async def send_risk_alert(
        self,
        symbol: str,
        risk_type: str,
        message: str,
        risk_metrics: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Send a risk alert."""
        alert = StanleyAlert(
            alert_type=AlertType.RISK,
            severity=AlertSeverity.CRITICAL,
            symbol=symbol,
            title=f"{symbol} Risk Alert: {risk_type}",
            message=message,
            data=risk_metrics or {},
        )
        return await self.send_alert(alert, force=True)  # Risk alerts bypass rate limit

    def _should_send(self, alert: StanleyAlert) -> bool:
        """Check if alert should be sent (rate limiting)."""
        key = f"{alert.symbol}:{alert.alert_type.value}"
        now = datetime.now(timezone.utc)

        if key in self._last_alert_time:
            elapsed = (now - self._last_alert_time[key]).total_seconds()
            if elapsed < self._rate_limit_seconds:
                return False

        self._last_alert_time[key] = now
        return True

    async def _send_telegram_message(
        self,
        message: str,
        chat_id: str,
    ) -> bool:
        """
        Send message via Zee's gateway.

        Uses the agent-core daemon which has Zee's messaging capabilities.
        """
        if self._client is None:
            await self.start()

        try:
            # Send via agent-core daemon's session API
            # The daemon routes @stanley messages to Stanley
            response = await self._client.post(
                f"{self._daemon_url}/session/stanley/message",
                json={
                    "message": message,
                    "metadata": {
                        "source": "stanley_alert",
                        "telegram_chat_id": chat_id,
                        "format": "markdown",
                    },
                },
                headers={"Content-Type": "application/json"},
            )

            if response.status_code == 200:
                logger.info(f"Alert sent to Telegram: {chat_id}")
                return True
            else:
                logger.warning(f"Failed to send alert: {response.status_code}")
                return False

        except httpx.ConnectError:
            logger.warning("Agent-core daemon not available, trying direct Zee API")
            return await self._send_via_zee_direct(message, chat_id)

        except Exception as e:
            logger.error(f"Error sending alert: {e}")
            return False

    async def _send_via_zee_direct(
        self,
        message: str,
        chat_id: str,
    ) -> bool:
        """
        Fallback: Send directly via Zee's Telegram API.

        Used when agent-core daemon is not available.
        """
        zee_api_url = os.getenv(
            "ZEE_API_URL",
            "http://127.0.0.1:3456",
        )

        try:
            response = await self._client.post(
                f"{zee_api_url}/api/telegram/send",
                json={
                    "chat_id": chat_id,
                    "text": message,
                    "parse_mode": "Markdown",
                },
            )

            return response.status_code == 200

        except Exception as e:
            logger.error(f"Direct Zee API failed: {e}")
            return False

    async def _flush_alerts(self) -> None:
        """Flush queued alerts."""
        if not self._alert_queue:
            return

        # Group alerts by symbol
        by_symbol: Dict[str, List[StanleyAlert]] = {}
        for alert in self._alert_queue:
            if alert.symbol not in by_symbol:
                by_symbol[alert.symbol] = []
            by_symbol[alert.symbol].append(alert)

        # Send batched alerts
        for symbol, alerts in by_symbol.items():
            if len(alerts) == 1:
                await self.send_alert(alerts[0], force=True)
            else:
                # Create summary message
                lines = [f"📊 **{symbol} Alert Summary** ({len(alerts)} alerts)"]
                for alert in alerts[-5:]:  # Last 5 alerts
                    lines.append(f"• {alert.title}: {alert.message[:50]}...")
                summary = "\n".join(lines)

                if self._telegram_chat_id:
                    await self._send_telegram_message(summary, self._telegram_chat_id)

        self._alert_queue.clear()

    def set_min_severity(self, severity: AlertSeverity) -> None:
        """Set minimum severity for alerts."""
        self._min_severity = severity

    def set_enabled(self, enabled: bool) -> None:
        """Enable or disable alert forwarding."""
        self._enabled = enabled


# Global forwarder instance
_forwarder: Optional[AlertForwarder] = None


def get_alert_forwarder() -> AlertForwarder:
    """Get or create the global alert forwarder."""
    global _forwarder
    if _forwarder is None:
        _forwarder = AlertForwarder()
    return _forwarder


async def send_stanley_alert(
    alert_type: AlertType,
    symbol: str,
    title: str,
    message: str,
    severity: AlertSeverity = AlertSeverity.INFO,
    data: Optional[Dict[str, Any]] = None,
) -> bool:
    """
    Convenience function to send a Stanley alert.

    Args:
        alert_type: Type of alert
        symbol: Symbol involved
        title: Alert title
        message: Alert message
        severity: Alert severity
        data: Additional data

    Returns:
        True if sent successfully
    """
    forwarder = get_alert_forwarder()
    await forwarder.start()

    alert = StanleyAlert(
        alert_type=alert_type,
        severity=severity,
        symbol=symbol,
        title=title,
        message=message,
        data=data or {},
    )

    return await forwarder.send_alert(alert)
