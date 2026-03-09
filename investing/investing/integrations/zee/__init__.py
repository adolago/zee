"""
Investing-Zee Integration

Routes Investing alerts through Zee's messaging gateway for Telegram notifications.
"""

from investing.integrations.zee.alert_forwarder import (
    AlertForwarder,
    AlertSeverity,
    InvestingAlert,
)

__all__ = [
    "AlertForwarder",
    "AlertSeverity",
    "InvestingAlert",
]
