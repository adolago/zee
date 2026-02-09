---
name: risk-management
description: Portfolio risk analysis using nautilus_trader and Stanley risk metrics
version: 1.0.0
author: Artur
tags: [finance, risk, portfolio, stanley]
triggers:
  - risk analysis
  - VaR
  - value at risk
  - portfolio risk
  - stress test
  - drawdown
  - beta
  - volatility
---

# Risk Management

Comprehensive portfolio risk analysis using Stanley's risk_metrics module and nautilus_trader integration.

## Risk Metrics Available

### Value at Risk (VaR)
- **Historical VaR**: Non-parametric, uses actual return distribution
- **Parametric VaR**: Assumes normal distribution
- **95% and 99% confidence levels**

### Conditional VaR (CVaR / Expected Shortfall)
Expected loss given that loss exceeds VaR - more conservative than VaR alone.

### Beta & Alpha
- **Beta**: Market sensitivity (vs SPY or custom benchmark)
- **Alpha**: Jensen's alpha - risk-adjusted excess return
- **R-squared**: Benchmark correlation

### Volatility Metrics
- Daily and annualized volatility
- Downside volatility (for Sortino)
- Maximum drawdown and duration

### Risk-Adjusted Returns
- **Sharpe Ratio**: Return per unit of total risk
- **Sortino Ratio**: Return per unit of downside risk

## Usage Examples

### Basic Risk Assessment
```python
from stanley.portfolio.risk_metrics import (
    calculate_portfolio_var,
    calculate_beta,
    calculate_sharpe_ratio,
    calculate_volatility_metrics
)

# Calculate VaR
var_result = calculate_portfolio_var(
    returns_matrix=returns_df,
    weights=np.array([0.4, 0.3, 0.3]),
    portfolio_value=100000,
    method="historical",
    lookback_days=252
)
# Returns: VaRResult with var_95, var_99, cvar_95, cvar_99

# Calculate Beta
beta_result = calculate_beta(
    asset_returns=portfolio_returns,
    benchmark_returns=spy_returns,
    risk_free_rate=0.05
)
# Returns: BetaResult with beta, alpha, r_squared
```

### Stress Testing
```python
# Historical scenario analysis
scenarios = [
    {"name": "2008 Crisis", "factor": -0.38},
    {"name": "COVID Crash", "factor": -0.34},
    {"name": "Tech Correction 2022", "factor": -0.25},
]

for scenario in scenarios:
    stressed_value = portfolio_value * (1 + scenario["factor"])
    loss = portfolio_value - stressed_value
    print(f"{scenario['name']}: -${loss:,.0f}")
```

### Nautilus Trader Integration
```python
from stanley.integrations.nautilus import DataClient
from nautilus_trader.risk import RiskEngine

# Real-time risk monitoring with nautilus
risk_engine = RiskEngine()
risk_engine.set_max_position_size(symbol, max_shares)
risk_engine.set_max_notional(symbol, max_dollars)
risk_engine.set_max_daily_loss(max_loss)
```

## Risk Limits (Configurable)

| Parameter | Default | Description |
|-----------|---------|-------------|
| Max Position Size | 10% | Maximum single position |
| Max Sector Exposure | 30% | Maximum sector weight |
| Max VaR 95 | 5% | Maximum daily VaR |
| Max Drawdown | 15% | Stop-loss trigger |
| Min Diversification | 5 | Minimum holdings |

## Memory Integration

Track risk metrics over time:
```typescript
await memory.store({
  namespace: "stanley/risk",
  key: `snapshot/${date}`,
  value: {
    date,
    portfolioValue: 125000,
    var95: 2500,
    var95Pct: 2.0,
    cvar95: 3200,
    beta: 1.15,
    sharpe: 1.45,
    maxDrawdown: -0.08,
    sectorConcentration: {
      Technology: 0.45,
      Healthcare: 0.20
    },
    alerts: ["Technology sector over 40% limit"]
  }
});
```

## Alerts & Monitoring

Trigger alerts when:
- VaR exceeds threshold
- Drawdown exceeds limit
- Sector concentration too high
- Correlation spike detected
- Volatility regime change

## Output Format

### Risk Dashboard
```
## Portfolio Risk Summary

**Value at Risk (1-day)**
- VaR 95%: $2,450 (1.96%)
- VaR 99%: $3,890 (3.11%)
- CVaR 95%: $3,120 (2.50%)

**Market Sensitivity**
- Beta: 1.15
- Alpha: 2.3% (annualized)
- R²: 0.87

**Risk-Adjusted Returns**
- Sharpe: 1.45
- Sortino: 1.92

**Stress Scenarios**
- 2008 Crisis: -$47,500
- COVID Crash: -$42,500
- 10% Correction: -$12,500

**Alerts**
Technology exposure at 45% (limit: 40%)
VaR within limits
Drawdown acceptable
```
