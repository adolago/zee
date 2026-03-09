//! Relative Strength Index (RSI) indicator.

/// Calculate RSI value from average gain and average loss.
/// Handles edge cases: no losses (RSI=100), no gains (RSI=0), no change (RSI=50).
#[inline]
fn calculate_rsi_value(avg_gain: f64, avg_loss: f64) -> f64 {
    if avg_loss <= 0.0 {
        if avg_gain <= 0.0 {
            50.0 // No change
        } else {
            100.0 // All gains, no losses
        }
    } else if avg_gain <= 0.0 {
        0.0 // All losses, no gains
    } else {
        let rs = avg_gain / avg_loss;
        100.0 - (100.0 / (1.0 + rs))
    }
}

/// Calculate Relative Strength Index.
///
/// RSI measures the magnitude of recent price changes to evaluate
/// overbought or oversold conditions.
///
/// Formula:
/// 1. Calculate price changes
/// 2. Separate gains and losses
/// 3. Calculate average gain and average loss (using EMA smoothing)
/// 4. RS = average_gain / average_loss
/// 5. RSI = 100 - (100 / (1 + RS))
///
/// # Arguments
///
/// * `prices` - Price series (typically closing prices)
/// * `period` - Lookback period (typically 14)
///
/// # Returns
///
/// Vector of RSI values (0-100 scale). Values below 30 typically indicate
/// oversold conditions, above 70 indicate overbought.
///
/// # Example
///
/// ```rust
/// use investing_core::indicators::rsi;
///
/// let prices = vec![44.0, 44.25, 44.5, 43.75, 44.5, 44.25, 44.5, 44.0, 43.5, 44.0,
///                   44.25, 44.0, 43.5, 44.0, 44.5, 44.25, 44.0];
/// let rsi_values = rsi(&prices, 14);
///
/// // RSI should be between 0 and 100
/// for &value in &rsi_values {
///     assert!(value >= 0.0 && value <= 100.0);
/// }
/// ```
pub fn rsi(prices: &[f64], period: usize) -> Vec<f64> {
    let n = prices.len();
    let mut result = vec![50.0; n]; // Default to neutral RSI

    if n < 2 || period == 0 {
        return result;
    }

    // Calculate price changes
    let mut gains = vec![0.0; n];
    let mut losses = vec![0.0; n];

    for i in 1..n {
        let change = prices[i] - prices[i - 1];
        if change > 0.0 {
            gains[i] = change;
        } else {
            losses[i] = -change; // Store as positive value
        }
    }

    // Need at least period+1 prices to calculate
    if n <= period {
        return result;
    }

    // Calculate initial average gain and loss (SMA for first period)
    let mut avg_gain: f64 = gains[1..=period].iter().sum::<f64>() / period as f64;
    let mut avg_loss: f64 = losses[1..=period].iter().sum::<f64>() / period as f64;

    // Calculate RSI for the first complete period
    result[period] = calculate_rsi_value(avg_gain, avg_loss);

    // EMA smoothing factor
    let alpha = 1.0 / period as f64;

    // Calculate subsequent RSI values using Wilder's smoothing (EMA)
    for i in (period + 1)..n {
        // Wilder's smoothing: avg = (prev_avg * (period - 1) + current) / period
        // Which is equivalent to: avg = alpha * current + (1 - alpha) * prev_avg
        avg_gain = alpha * gains[i] + (1.0 - alpha) * avg_gain;
        avg_loss = alpha * losses[i] + (1.0 - alpha) * avg_loss;

        result[i] = calculate_rsi_value(avg_gain, avg_loss);
    }

    result
}

/// Calculate Stochastic RSI.
///
/// Stochastic RSI applies the stochastic oscillator formula to RSI values
/// to create a more sensitive indicator.
///
/// Formula: StochRSI = (RSI - RSI_low) / (RSI_high - RSI_low)
///
/// # Arguments
///
/// * `prices` - Price series
/// * `rsi_period` - Period for RSI calculation (typically 14)
/// * `stoch_period` - Period for stochastic calculation (typically 14)
///
/// # Returns
///
/// Vector of Stochastic RSI values (0-100 scale).
pub fn stochastic_rsi(prices: &[f64], rsi_period: usize, stoch_period: usize) -> Vec<f64> {
    let rsi_values = rsi(prices, rsi_period);
    let n = rsi_values.len();
    let mut result = vec![50.0; n];

    if n < stoch_period {
        return result;
    }

    for i in (stoch_period - 1)..n {
        let start_idx = i + 1 - stoch_period; // Avoid overflow: rewritten from (i - stoch_period + 1)
        let window = &rsi_values[start_idx..=i];
        let rsi_low = window.iter().cloned().fold(f64::INFINITY, f64::min);
        let rsi_high = window.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

        let range = rsi_high - rsi_low;
        if range > 0.0 {
            result[i] = ((rsi_values[i] - rsi_low) / range) * 100.0;
        } else {
            result[i] = 50.0;
        }
    }

    result
}

/// Generate RSI-based trading signals.
///
/// # Arguments
///
/// * `rsi_values` - Calculated RSI values
/// * `oversold` - Oversold threshold (typically 30)
/// * `overbought` - Overbought threshold (typically 70)
///
/// # Returns
///
/// Vector of signals: 1.0 = buy (oversold), -1.0 = sell (overbought), 0.0 = hold
pub fn rsi_signals(rsi_values: &[f64], oversold: f64, overbought: f64) -> Vec<f64> {
    rsi_values
        .iter()
        .map(|&rsi| {
            if rsi < oversold {
                1.0 // Buy signal (oversold)
            } else if rsi > overbought {
                -1.0 // Sell signal (overbought)
            } else {
                0.0 // Hold
            }
        })
        .collect()
}

/// Calculate RSI divergence.
///
/// Bullish divergence: price makes lower low, RSI makes higher low
/// Bearish divergence: price makes higher high, RSI makes lower high
///
/// # Arguments
///
/// * `prices` - Price series
/// * `rsi_values` - Calculated RSI values
/// * `lookback` - Number of periods to look back for divergence
///
/// # Returns
///
/// Vector of divergence signals: 1.0 = bullish, -1.0 = bearish, 0.0 = none
pub fn rsi_divergence(prices: &[f64], rsi_values: &[f64], lookback: usize) -> Vec<f64> {
    let n = prices.len().min(rsi_values.len());
    let mut result = vec![0.0; n];

    if n < lookback + 1 {
        return result;
    }

    for i in lookback..n {
        let price_window = &prices[(i - lookback)..=i];
        let rsi_window = &rsi_values[(i - lookback)..=i];

        // Find local extremes in the window
        let price_min_idx = price_window
            .iter()
            .enumerate()
            .min_by(|a, b| a.1.partial_cmp(b.1).unwrap())
            .map(|(idx, _)| idx)
            .unwrap_or(0);

        let price_max_idx = price_window
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
            .map(|(idx, _)| idx)
            .unwrap_or(0);

        // Check for bullish divergence (price low, RSI higher)
        if price_min_idx == lookback {
            // Current price is the lowest
            let prev_low_rsi = rsi_window[..lookback]
                .iter()
                .cloned()
                .fold(f64::INFINITY, f64::min);
            if rsi_window[lookback] > prev_low_rsi {
                result[i] = 1.0; // Bullish divergence
            }
        }

        // Check for bearish divergence (price high, RSI lower)
        if price_max_idx == lookback {
            // Current price is the highest
            let prev_high_rsi = rsi_window[..lookback]
                .iter()
                .cloned()
                .fold(f64::NEG_INFINITY, f64::max);
            if rsi_window[lookback] < prev_high_rsi {
                result[i] = -1.0; // Bearish divergence
            }
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rsi_basic() {
        // Trending up strongly should give high RSI
        let up_prices: Vec<f64> = (0..20).map(|i| 100.0 + i as f64).collect();
        let rsi_up = rsi(&up_prices, 14);
        assert!(rsi_up[19] > 70.0); // Should be overbought

        // Trending down strongly should give low RSI
        let down_prices: Vec<f64> = (0..20).map(|i| 100.0 - i as f64).collect();
        let rsi_down = rsi(&down_prices, 14);
        assert!(rsi_down[19] < 30.0); // Should be oversold
    }

    #[test]
    fn test_rsi_range() {
        let prices: Vec<f64> = (0..50)
            .map(|i| 100.0 + (i as f64 * 0.5).sin() * 10.0)
            .collect();
        let rsi_values = rsi(&prices, 14);

        // RSI should always be between 0 and 100
        for &value in &rsi_values {
            assert!(value >= 0.0 && value <= 100.0);
        }
    }

    #[test]
    fn test_rsi_neutral() {
        // Alternating up/down should give RSI around 50
        let prices: Vec<f64> = (0..30)
            .map(|i| if i % 2 == 0 { 101.0 } else { 99.0 })
            .collect();
        let rsi_values = rsi(&prices, 14);

        // Should be near neutral (40-60)
        assert!(rsi_values[29] > 40.0 && rsi_values[29] < 60.0);
    }

    #[test]
    fn test_rsi_signals() {
        let rsi_values = vec![25.0, 45.0, 75.0, 30.0, 70.0, 15.0];
        let signals = rsi_signals(&rsi_values, 30.0, 70.0);

        assert_eq!(signals[0], 1.0); // 25 < 30, buy
        assert_eq!(signals[1], 0.0); // 45 in neutral zone
        assert_eq!(signals[2], -1.0); // 75 > 70, sell
        assert_eq!(signals[3], 0.0); // 30 is boundary, neutral
        assert_eq!(signals[4], 0.0); // 70 is boundary, neutral
        assert_eq!(signals[5], 1.0); // 15 < 30, buy
    }

    #[test]
    fn test_stochastic_rsi() {
        let prices: Vec<f64> = (0..50)
            .map(|i| 100.0 + (i as f64 * 0.3).sin() * 10.0)
            .collect();
        let stoch_rsi = stochastic_rsi(&prices, 14, 14);

        // Stochastic RSI should also be between 0 and 100
        for &value in &stoch_rsi {
            assert!(value >= 0.0 && value <= 100.0);
        }
    }

    #[test]
    fn test_rsi_short_data() {
        let prices = vec![100.0, 101.0, 102.0];
        let rsi_values = rsi(&prices, 14);

        // With insufficient data, should return default neutral values
        assert!(rsi_values.iter().all(|&v| v == 50.0));
    }

    #[test]
    fn test_rsi_period_1() {
        let prices = vec![100.0, 105.0, 103.0, 108.0, 106.0];
        let rsi_values = rsi(&prices, 1);

        // With period 1, RSI is either 0, 50, or 100
        for &value in &rsi_values[1..] {
            assert!(value == 0.0 || value == 50.0 || value == 100.0);
        }
    }
}
