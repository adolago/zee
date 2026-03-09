//! Portfolio risk metrics calculation.
//!
//! Provides VaR, CVaR, Sharpe ratio, Sortino ratio, max drawdown, and volatility calculations.

use crate::types::RiskMetrics;
use crate::{Error, Result};

/// Calculate comprehensive risk metrics for a portfolio.
///
/// # Arguments
///
/// * `returns` - Vector of daily returns (e.g., 0.01 for 1% daily return)
/// * `total_value` - Total portfolio value in dollars
/// * `confidence` - Confidence level for VaR (typically 0.95 for 95%)
/// * `risk_free_rate` - Annual risk-free rate (e.g., 0.04 for 4%)
///
/// # Returns
///
/// Returns `RiskMetrics` with all calculated values, or an error if there's insufficient data.
pub fn calculate_risk_metrics(
    returns: &[f64],
    total_value: f64,
    confidence: f64,
    risk_free_rate: f64,
) -> Result<RiskMetrics> {
    if returns.len() < 10 {
        return Err(Error::InsufficientData(
            "Need at least 10 data points for risk calculation".to_string(),
        ));
    }

    if total_value <= 0.0 {
        return Err(Error::InvalidOperation(
            "Portfolio value must be positive".to_string(),
        ));
    }

    let n = returns.len() as f64;

    // Mean return
    let mean_return = returns.iter().sum::<f64>() / n;

    // Standard deviation
    let variance = returns.iter().map(|r| (r - mean_return).powi(2)).sum::<f64>() / n;
    let std_return = variance.sqrt();

    // VaR (Value at Risk) - parametric method assuming normal distribution
    let z_score = norm_ppf(1.0 - confidence);
    let var = -z_score * std_return * total_value;

    // CVaR (Conditional VaR / Expected Shortfall)
    let _var_return = z_score * std_return;
    let mut sorted_returns: Vec<f64> = returns.to_vec();
    sorted_returns.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let var_idx = ((1.0 - confidence) * n) as usize;
    let cvar = if var_idx > 0 {
        let tail_returns = &sorted_returns[..var_idx];
        let tail_mean = tail_returns.iter().sum::<f64>() / var_idx as f64;
        -tail_mean * total_value
    } else {
        var
    };

    // Daily risk-free rate
    let daily_rf = risk_free_rate / 252.0;

    // Sharpe Ratio (annualized)
    let excess_return = mean_return - daily_rf;
    let sharpe = if std_return > 0.0 {
        excess_return / std_return * (252.0_f64).sqrt()
    } else {
        0.0
    };

    // Sortino Ratio (uses downside deviation)
    let downside_returns: Vec<f64> = returns.iter().filter(|&&r| r < 0.0).copied().collect();

    let downside_std = if !downside_returns.is_empty() {
        let downside_variance = downside_returns.iter().map(|r| r.powi(2)).sum::<f64>()
            / downside_returns.len() as f64;
        downside_variance.sqrt()
    } else {
        std_return
    };

    let sortino = if downside_std > 0.0 {
        excess_return / downside_std * (252.0_f64).sqrt()
    } else {
        0.0
    };

    // Max Drawdown
    let max_drawdown = calculate_max_drawdown(returns);

    // Annualized Volatility
    let volatility = std_return * (252.0_f64).sqrt() * 100.0;

    Ok(RiskMetrics {
        confidence_level: confidence,
        var,
        var_percent: (var / total_value) * 100.0,
        cvar,
        cvar_percent: (cvar / total_value) * 100.0,
        sharpe_ratio: sharpe,
        sortino_ratio: sortino,
        max_drawdown_percent: max_drawdown * 100.0,
        volatility_percent: volatility,
        daily_mean_return_percent: mean_return * 100.0,
        total_portfolio_value: total_value,
    })
}

/// Calculate maximum drawdown from a series of returns.
///
/// Returns the maximum peak-to-trough decline as a decimal (e.g., 0.15 for 15% drawdown).
pub fn calculate_max_drawdown(returns: &[f64]) -> f64 {
    if returns.is_empty() {
        return 0.0;
    }

    // Build cumulative returns
    let mut cumulative = Vec::with_capacity(returns.len());
    let mut cum = 1.0;
    for r in returns {
        cum *= 1.0 + r;
        cumulative.push(cum);
    }

    // Calculate running max and drawdowns
    let mut running_max = cumulative[0];
    let mut max_drawdown = 0.0;

    for &value in &cumulative {
        if value > running_max {
            running_max = value;
        }
        let drawdown = (running_max - value) / running_max;
        if drawdown > max_drawdown {
            max_drawdown = drawdown;
        }
    }

    max_drawdown
}

/// Calculate Sharpe ratio from returns.
///
/// # Arguments
///
/// * `returns` - Daily returns
/// * `risk_free_rate` - Annual risk-free rate
///
/// # Returns
///
/// Annualized Sharpe ratio.
pub fn sharpe_ratio(returns: &[f64], risk_free_rate: f64) -> f64 {
    if returns.is_empty() {
        return 0.0;
    }

    let n = returns.len() as f64;
    let mean = returns.iter().sum::<f64>() / n;
    let variance = returns.iter().map(|r| (r - mean).powi(2)).sum::<f64>() / n;
    let std = variance.sqrt();

    if std <= 0.0 {
        return 0.0;
    }

    let daily_rf = risk_free_rate / 252.0;
    (mean - daily_rf) / std * (252.0_f64).sqrt()
}

/// Calculate Sortino ratio from returns.
///
/// # Arguments
///
/// * `returns` - Daily returns
/// * `risk_free_rate` - Annual risk-free rate
///
/// # Returns
///
/// Annualized Sortino ratio.
pub fn sortino_ratio(returns: &[f64], risk_free_rate: f64) -> f64 {
    if returns.is_empty() {
        return 0.0;
    }

    let n = returns.len() as f64;
    let mean = returns.iter().sum::<f64>() / n;

    // Downside deviation
    let downside: Vec<f64> = returns.iter().filter(|&&r| r < 0.0).copied().collect();

    let downside_std = if !downside.is_empty() {
        let variance = downside.iter().map(|r| r.powi(2)).sum::<f64>() / downside.len() as f64;
        variance.sqrt()
    } else {
        return f64::INFINITY; // No downside = infinite Sortino
    };

    if downside_std <= 0.0 {
        return f64::INFINITY;
    }

    let daily_rf = risk_free_rate / 252.0;
    (mean - daily_rf) / downside_std * (252.0_f64).sqrt()
}

/// Calculate Value at Risk (VaR) using parametric method.
///
/// # Arguments
///
/// * `returns` - Daily returns
/// * `portfolio_value` - Current portfolio value
/// * `confidence` - Confidence level (e.g., 0.95 for 95%)
///
/// # Returns
///
/// VaR in dollars (positive number representing potential loss).
pub fn value_at_risk(returns: &[f64], portfolio_value: f64, confidence: f64) -> f64 {
    if returns.is_empty() || portfolio_value <= 0.0 {
        return 0.0;
    }

    let n = returns.len() as f64;
    let mean = returns.iter().sum::<f64>() / n;
    let variance = returns.iter().map(|r| (r - mean).powi(2)).sum::<f64>() / n;
    let std = variance.sqrt();

    let z = norm_ppf(1.0 - confidence);
    -z * std * portfolio_value
}

/// Inverse cumulative distribution function for standard normal distribution.
///
/// Uses Acklam's algorithm for high accuracy across the full range.
/// Source: https://web.archive.org/web/20151110174102/http://home.online.no/~pjacklam/notes/invnorm/
pub fn norm_ppf(p: f64) -> f64 {
    // Coefficients in rational approximations
    const A: [f64; 6] = [
        -3.969683028665376e+01,
        2.209460984245205e+02,
        -2.759285104469687e+02,
        1.383577518672690e+02,
        -3.066479806614716e+01,
        2.506628277459239e+00,
    ];

    const B: [f64; 5] = [
        -5.447609879822406e+01,
        1.615858368580409e+02,
        -1.556989798598866e+02,
        6.680131188771972e+01,
        -1.328068155288572e+01,
    ];

    const C: [f64; 6] = [
        -7.784894002430293e-03,
        -3.223964580411365e-01,
        -2.400758277161838e+00,
        -2.549732539343734e+00,
        4.374664141464968e+00,
        2.938163982698783e+00,
    ];

    const D: [f64; 4] = [
        7.784695709041462e-03,
        3.224671290700398e-01,
        2.445134137142996e+00,
        3.754408661907416e+00,
    ];

    // Define break-points
    const P_LOW: f64 = 0.02425;
    const P_HIGH: f64 = 1.0 - P_LOW;

    // Handle edge cases
    if p <= 0.0 {
        return f64::NEG_INFINITY;
    }
    if p >= 1.0 {
        return f64::INFINITY;
    }

    let q: f64;
    let r: f64;

    if p < P_LOW {
        // Rational approximation for lower region
        q = (-2.0 * p.ln()).sqrt();
        (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
            / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    } else if p <= P_HIGH {
        // Rational approximation for central region
        q = p - 0.5;
        r = q * q;
        (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q
            / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1.0)
    } else {
        // Rational approximation for upper region
        q = (-2.0 * (1.0 - p).ln()).sqrt();
        -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
            / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    }
}

/// Calculate annualized volatility from returns.
pub fn volatility(returns: &[f64]) -> f64 {
    if returns.is_empty() {
        return 0.0;
    }

    let n = returns.len() as f64;
    let mean = returns.iter().sum::<f64>() / n;
    let variance = returns.iter().map(|r| (r - mean).powi(2)).sum::<f64>() / n;

    variance.sqrt() * (252.0_f64).sqrt() * 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    // Helper to generate test returns
    fn generate_returns(mean: f64, std: f64, n: usize) -> Vec<f64> {
        // Simple deterministic pseudo-returns for testing
        (0..n)
            .map(|i| mean + std * ((i as f64 / n as f64 - 0.5) * 2.0))
            .collect()
    }

    #[test]
    fn test_norm_ppf() {
        // Test known values
        // norm_ppf(0.5) should be 0
        assert!((norm_ppf(0.5)).abs() < 0.001);

        // norm_ppf(0.95) ≈ 1.645
        assert!((norm_ppf(0.95) - 1.645).abs() < 0.01);

        // norm_ppf(0.975) ≈ 1.96
        assert!((norm_ppf(0.975) - 1.96).abs() < 0.01);

        // norm_ppf(0.99) ≈ 2.326
        assert!((norm_ppf(0.99) - 2.326).abs() < 0.01);

        // Symmetry: norm_ppf(0.05) ≈ -1.645
        assert!((norm_ppf(0.05) + 1.645).abs() < 0.01);
    }

    #[test]
    fn test_calculate_risk_metrics() {
        // Generate some sample returns
        let returns: Vec<f64> = vec![
            0.01, -0.005, 0.008, -0.003, 0.012, -0.007, 0.005, 0.002, -0.004, 0.006, 0.003, -0.002,
            0.007, -0.001, 0.004,
        ];

        let result = calculate_risk_metrics(&returns, 100000.0, 0.95, 0.04).unwrap();

        // Verify basic sanity
        assert!(result.var > 0.0);
        assert!(result.cvar >= result.var); // CVaR should be >= VaR
        assert!(result.volatility_percent > 0.0);
        assert!(result.total_portfolio_value == 100000.0);
        assert!(result.confidence_level == 0.95);
    }

    #[test]
    fn test_calculate_risk_metrics_insufficient_data() {
        let returns = vec![0.01, 0.02, 0.01]; // Only 3 data points

        let result = calculate_risk_metrics(&returns, 100000.0, 0.95, 0.04);
        assert!(matches!(result, Err(Error::InsufficientData(_))));
    }

    #[test]
    fn test_max_drawdown() {
        // Series that goes up, then down significantly
        let returns = vec![0.10, 0.05, -0.15, -0.10, 0.05];

        let mdd = calculate_max_drawdown(&returns);

        // After gains: 1.0 * 1.10 * 1.05 = 1.155
        // After losses: 1.155 * 0.85 * 0.90 = 0.883
        // Drawdown from peak: (1.155 - 0.883) / 1.155 ≈ 23.5%
        assert!(mdd > 0.20);
        assert!(mdd < 0.30);
    }

    #[test]
    fn test_max_drawdown_no_loss() {
        let returns = vec![0.01, 0.02, 0.03, 0.01, 0.02];

        let mdd = calculate_max_drawdown(&returns);
        assert_eq!(mdd, 0.0);
    }

    #[test]
    fn test_sharpe_ratio() {
        // Positive returns with low volatility = high Sharpe
        let good_returns: Vec<f64> = (0..100).map(|_| 0.001).collect();
        let sharpe_good = sharpe_ratio(&good_returns, 0.04);
        assert!(sharpe_good > 0.0);

        // Negative returns = negative Sharpe
        let bad_returns: Vec<f64> = (0..100).map(|_| -0.001).collect();
        let sharpe_bad = sharpe_ratio(&bad_returns, 0.04);
        assert!(sharpe_bad < 0.0);
    }

    #[test]
    fn test_sortino_ratio() {
        // Returns with no negative days = very high Sortino
        let all_positive: Vec<f64> = (0..100).map(|_| 0.001).collect();
        let sortino = sortino_ratio(&all_positive, 0.04);
        assert!(sortino > 0.0 || sortino.is_infinite());
    }

    #[test]
    fn test_value_at_risk() {
        let returns: Vec<f64> = vec![0.01, -0.01, 0.02, -0.02, 0.01, -0.01, 0.015, -0.015, 0.005, -0.005];

        let var = value_at_risk(&returns, 100000.0, 0.95);

        // VaR should be positive and reasonable
        assert!(var > 0.0);
        assert!(var < 100000.0); // Should be less than total portfolio
    }

    #[test]
    fn test_volatility() {
        let returns: Vec<f64> = vec![0.01, -0.01, 0.02, -0.02, 0.01, -0.01, 0.015, -0.015, 0.005, -0.005];

        let vol = volatility(&returns);

        // Volatility should be positive
        assert!(vol > 0.0);
        // For these returns, annualized vol should be roughly 15-25%
        assert!(vol > 10.0);
        assert!(vol < 50.0);
    }
}
