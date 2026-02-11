---
name: portfolio
description: Portfolio analytics, risk management, and performance attribution
version: 2.0.0
author: Artur
tags: [finance, portfolio, analytics, risk, stanley]
triggers:
  - portfolio analysis
  - risk metrics
  - portfolio performance
  - allocation analysis
  - VaR
  - risk analysis
  - value at risk
  - portfolio risk
  - stress test
  - drawdown
  - beta
  - volatility
  - sharpe ratio
  - sortino ratio
---

# Portfolio Analytics

Comprehensive portfolio risk and performance analysis.

## Risk Metrics

### Using Stanley Backend
```
from stanley.portfolio import PortfolioAnalyzer

# Example portfolio
positions = [
    {"symbol": "AAPL", "shares": 100, "avg_cost": 150.0},
    {"symbol": "MSFT", "shares": 50, "avg_cost": 280.0},
    {"symbol": "GOOGL", "shares": 25, "avg_cost": 130.0},
]

analyzer = PortfolioAnalyzer(positions)

# Risk metrics
var_95 = analyzer.calculate_var(confidence=0.95, days=1)
cvar = analyzer.calculate_cvar(confidence=0.95)
beta = analyzer.calculate_portfolio_beta(benchmark="SPY")
sharpe = analyzer.calculate_sharpe_ratio()
```

### Via OpenBB
```
# Get correlation matrix
symbols = [p["symbol"] for p in positions]
prices = obb.equity.price.historical(symbol=",".join(symbols))
# Calculate correlation from prices DataFrame
```

## Sector Exposure

```
# Sector breakdown
exposure = analyzer.get_sector_exposure()
# {
#     "Technology": 0.65,
#     "Communication Services": 0.15,
#     "Consumer Discretionary": 0.20
# }
```

## Performance Attribution

```
# Factor attribution
attribution = analyzer.calculate_attribution(
    start_date="2024-01-01",
    end_date="2024-06-30",
    factors=["SPY", "QQQ", "IWM"]
)
```

## Stress Testing

```
# Historical scenarios
scenarios = analyzer.stress_test([
    {"name": "2008 Crisis", "spy_return": -0.38},
    {"name": "COVID Crash", "spy_return": -0.34},
    {"name": "Tech Correction", "qqq_return": -0.25},
])
```

## Output Format

Portfolio Report:
1. Holdings summary with current values
2. Risk metrics (VaR, Sharpe, Beta)
3. Sector/factor exposure
4. Performance vs benchmark
5. Risk-adjusted returns
6. Recommendations for rebalancing

## Memory Integration

Store portfolio state:
```typescript
await memory.store({
  namespace: "stanley/portfolio",
  key: "positions",
  value: {
    holdings: [...],
    lastUpdated: new Date(),
    totalValue: 125000,
    dayChange: 1250,
    dayChangePct: 0.01
  }
});

await memory.store({
  namespace: "stanley/portfolio",
  key: "performance",
  value: {
    ytdReturn: 0.12,
    sharpe: 1.25,
    beta: 1.1,
    maxDrawdown: -0.08,
    benchmarkReturn: 0.10
  }
});
```

---

## Risk Management

### Risk Metrics Reference

| Metric | Description |
|--------|-------------|
| **Historical VaR** | Non-parametric, uses actual return distribution |
| **Parametric VaR** | Assumes normal distribution |
| **CVaR (Expected Shortfall)** | Expected loss given loss exceeds VaR |
| **Beta** | Market sensitivity vs benchmark (SPY default) |
| **Alpha** | Jensen's alpha -- risk-adjusted excess return |
| **Sharpe Ratio** | Return per unit of total risk |
| **Sortino Ratio** | Return per unit of downside risk |
| **Max Drawdown** | Largest peak-to-trough decline |

### Risk Limits (Configurable)

| Parameter | Default | Description |
|-----------|---------|-------------|
| Max Position Size | 10% | Maximum single position |
| Max Sector Exposure | 30% | Maximum sector weight |
| Max VaR 95 | 5% | Maximum daily VaR |
| Max Drawdown | 15% | Stop-loss trigger |
| Min Diversification | 5 | Minimum holdings |

### Risk Dashboard Output

```
## Portfolio Risk Summary

**Value at Risk (1-day)**
- VaR 95%: $2,450 (1.96%)
- VaR 99%: $3,890 (3.11%)
- CVaR 95%: $3,120 (2.50%)

**Market Sensitivity**
- Beta: 1.15
- Alpha: 2.3% (annualized)

**Risk-Adjusted Returns**
- Sharpe: 1.45
- Sortino: 1.92

**Stress Scenarios**
- 2008 Crisis: -$47,500
- COVID Crash: -$42,500
- 10% Correction: -$12,500
```

### Risk Alerts

Trigger alerts when:
- VaR exceeds threshold
- Drawdown exceeds limit
- Sector concentration too high
- Correlation spike detected
- Volatility regime change
