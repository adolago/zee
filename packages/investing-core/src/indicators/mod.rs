//! Technical indicators for trading analysis.
//!
//! This module provides common technical indicators used in quantitative trading:
//!
//! - **SMA**: Simple Moving Average
//! - **RSI**: Relative Strength Index
//! - **Bollinger Bands**: Mean and standard deviation bands
//! - **MACD**: Moving Average Convergence Divergence

mod rsi;
mod sma;

pub use rsi::{rsi, rsi_divergence, rsi_signals, stochastic_rsi};
pub use sma::{dema, ema, sma, tema, wma};

/// Bollinger Bands result.
#[derive(Debug, Clone)]
pub struct BollingerBands {
    /// Middle band (SMA)
    pub middle: Vec<f64>,
    /// Upper band (middle + num_std * std)
    pub upper: Vec<f64>,
    /// Lower band (middle - num_std * std)
    pub lower: Vec<f64>,
}

/// Calculate Bollinger Bands.
///
/// # Arguments
///
/// * `data` - Price series
/// * `period` - Lookback period (typically 20)
/// * `num_std` - Number of standard deviations (typically 2.0)
///
/// # Returns
///
/// BollingerBands with middle, upper, and lower bands.
pub fn bollinger_bands(data: &[f64], period: usize, num_std: f64) -> BollingerBands {
    let n = data.len();
    let mut middle = vec![0.0; n];
    let mut upper = vec![0.0; n];
    let mut lower = vec![0.0; n];

    for i in period..n {
        let window = &data[i - period..i];
        let mean: f64 = window.iter().sum::<f64>() / period as f64;
        let variance: f64 = window.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / period as f64;
        let std = variance.sqrt();

        middle[i] = mean;
        upper[i] = mean + num_std * std;
        lower[i] = mean - num_std * std;
    }

    BollingerBands {
        middle,
        upper,
        lower,
    }
}

/// Calculate momentum (rate of change over n periods).
///
/// # Arguments
///
/// * `data` - Price series
/// * `period` - Lookback period
///
/// # Returns
///
/// Momentum values as percentage change.
pub fn momentum(data: &[f64], period: usize) -> Vec<f64> {
    let n = data.len();
    let mut result = vec![0.0; n];

    for i in period..n {
        if data[i - period] != 0.0 {
            result[i] = (data[i] - data[i - period]) / data[i - period];
        }
    }

    result
}

/// Calculate cumulative momentum over a lookback period.
///
/// # Arguments
///
/// * `data` - Price series
/// * `lookback` - Number of periods to sum returns
///
/// # Returns
///
/// Cumulative momentum values.
pub fn cumulative_momentum(data: &[f64], lookback: usize) -> Vec<f64> {
    let n = data.len();
    if n < 2 {
        return vec![0.0; n];
    }

    // First calculate daily returns
    let mut returns = vec![0.0; n];
    for i in 1..n {
        if data[i - 1] != 0.0 {
            returns[i] = (data[i] - data[i - 1]) / data[i - 1];
        }
    }

    // Then calculate cumulative momentum
    let mut result = vec![0.0; n];
    for i in lookback..n {
        result[i] = returns[i - lookback + 1..=i].iter().sum();
    }

    result
}

/// MACD (Moving Average Convergence Divergence) result.
#[derive(Debug, Clone)]
pub struct Macd {
    /// MACD line (fast EMA - slow EMA)
    pub macd_line: Vec<f64>,
    /// Signal line (EMA of MACD line)
    pub signal_line: Vec<f64>,
    /// Histogram (MACD - Signal)
    pub histogram: Vec<f64>,
}

/// Calculate MACD indicator.
///
/// # Arguments
///
/// * `data` - Price series
/// * `fast_period` - Fast EMA period (typically 12)
/// * `slow_period` - Slow EMA period (typically 26)
/// * `signal_period` - Signal line EMA period (typically 9)
///
/// # Returns
///
/// MACD with macd_line, signal_line, and histogram.
pub fn macd(data: &[f64], fast_period: usize, slow_period: usize, signal_period: usize) -> Macd {
    let fast_ema = ema(data, fast_period);
    let slow_ema = ema(data, slow_period);

    let n = data.len();
    let mut macd_line = vec![0.0; n];

    for i in 0..n {
        macd_line[i] = fast_ema[i] - slow_ema[i];
    }

    let signal_line = ema(&macd_line, signal_period);

    let mut histogram = vec![0.0; n];
    for i in 0..n {
        histogram[i] = macd_line[i] - signal_line[i];
    }

    Macd {
        macd_line,
        signal_line,
        histogram,
    }
}

/// Generate trading signals based on indicator crossovers.
///
/// Returns 1.0 for buy, -1.0 for sell, 0.0 for hold.
pub fn crossover_signals(fast: &[f64], slow: &[f64]) -> Vec<f64> {
    let n = fast.len().min(slow.len());
    let mut signals = vec![0.0; n];

    for i in 1..n {
        let prev_diff = fast[i - 1] - slow[i - 1];
        let curr_diff = fast[i] - slow[i];

        if prev_diff <= 0.0 && curr_diff > 0.0 {
            signals[i] = 1.0; // Golden cross (buy)
        } else if prev_diff >= 0.0 && curr_diff < 0.0 {
            signals[i] = -1.0; // Death cross (sell)
        }
    }

    signals
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bollinger_bands() {
        let data: Vec<f64> = (0..30).map(|i| 100.0 + (i as f64) * 0.5).collect();
        let bb = bollinger_bands(&data, 20, 2.0);

        // After period, should have values
        assert!(bb.middle[25] > 0.0);
        assert!(bb.upper[25] > bb.middle[25]);
        assert!(bb.lower[25] < bb.middle[25]);
    }

    #[test]
    fn test_momentum() {
        let data = vec![100.0, 105.0, 110.0, 108.0, 112.0];
        let mom = momentum(&data, 2);

        // momentum[2] = (110 - 100) / 100 = 0.10
        assert!((mom[2] - 0.10).abs() < 0.001);
    }

    #[test]
    fn test_macd() {
        let data: Vec<f64> = (0..50).map(|i| 100.0 + (i as f64).sin() * 5.0).collect();
        let macd_result = macd(&data, 12, 26, 9);

        assert_eq!(macd_result.macd_line.len(), 50);
        assert_eq!(macd_result.signal_line.len(), 50);
        assert_eq!(macd_result.histogram.len(), 50);
    }

    #[test]
    fn test_crossover_signals() {
        let fast = vec![10.0, 11.0, 12.0, 11.0, 10.0];
        let slow = vec![11.0, 11.0, 11.0, 11.0, 11.0];

        let signals = crossover_signals(&fast, &slow);

        // At index 2: fast crosses above slow (golden cross)
        // fast[1]=11 == slow[1]=11, fast[2]=12 > slow[2]=11
        assert_eq!(signals[2], 1.0);

        // At index 4: fast crosses below slow (death cross)
        // fast[3]=11 == slow[3]=11, fast[4]=10 < slow[4]=11
        assert_eq!(signals[4], -1.0);
    }
}
