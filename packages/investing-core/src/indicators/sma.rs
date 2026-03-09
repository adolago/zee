//! Simple Moving Average (SMA) and Exponential Moving Average (EMA) indicators.

/// Calculate Simple Moving Average.
///
/// # Arguments
///
/// * `data` - Price series
/// * `period` - Lookback period
///
/// # Returns
///
/// Vector of SMA values. First `period-1` values are 0.0.
///
/// # Example
///
/// ```rust
/// use investing_core::indicators::sma;
///
/// let prices = vec![10.0, 11.0, 12.0, 11.0, 10.0, 11.0, 12.0, 13.0, 12.0, 11.0];
/// let sma_values = sma(&prices, 3);
///
/// // SMA at index 2 = (10 + 11 + 12) / 3 = 11.0
/// assert!((sma_values[2] - 11.0).abs() < 0.001);
/// ```
pub fn sma(data: &[f64], period: usize) -> Vec<f64> {
    let n = data.len();
    let mut result = vec![0.0; n];

    if period == 0 || period > n {
        return result;
    }

    // Calculate first SMA using simple sum
    let mut sum: f64 = data[..period].iter().sum();
    result[period - 1] = sum / period as f64;

    // Use rolling window for subsequent values
    for i in period..n {
        sum = sum - data[i - period] + data[i];
        result[i] = sum / period as f64;
    }

    result
}

/// Calculate Exponential Moving Average.
///
/// Uses the formula: EMA[i] = alpha * price[i] + (1 - alpha) * EMA[i-1]
/// where alpha = 2 / (period + 1)
///
/// # Arguments
///
/// * `data` - Price series
/// * `period` - Lookback period (used to calculate smoothing factor)
///
/// # Returns
///
/// Vector of EMA values.
///
/// # Example
///
/// ```rust
/// use investing_core::indicators::ema;
///
/// let prices = vec![10.0, 11.0, 12.0, 11.0, 10.0, 11.0, 12.0, 13.0, 12.0, 11.0];
/// let ema_values = ema(&prices, 3);
///
/// // EMA reacts faster to recent prices than SMA
/// assert!(ema_values[9] > 0.0);
/// ```
pub fn ema(data: &[f64], period: usize) -> Vec<f64> {
    let n = data.len();
    let mut result = vec![0.0; n];

    if period == 0 || n == 0 {
        return result;
    }

    let alpha = 2.0 / (period as f64 + 1.0);

    // Initialize with first value
    result[0] = data[0];

    // Calculate EMA
    for i in 1..n {
        result[i] = alpha * data[i] + (1.0 - alpha) * result[i - 1];
    }

    result
}

/// Calculate Double Exponential Moving Average (DEMA).
///
/// DEMA = 2 * EMA(data) - EMA(EMA(data))
///
/// This reduces lag compared to a standard EMA.
///
/// # Arguments
///
/// * `data` - Price series
/// * `period` - Lookback period
///
/// # Returns
///
/// Vector of DEMA values.
pub fn dema(data: &[f64], period: usize) -> Vec<f64> {
    let ema1 = ema(data, period);
    let ema2 = ema(&ema1, period);

    let n = data.len();
    let mut result = vec![0.0; n];

    for i in 0..n {
        result[i] = 2.0 * ema1[i] - ema2[i];
    }

    result
}

/// Calculate Triple Exponential Moving Average (TEMA).
///
/// TEMA = 3 * EMA - 3 * EMA(EMA) + EMA(EMA(EMA))
///
/// This further reduces lag compared to DEMA.
///
/// # Arguments
///
/// * `data` - Price series
/// * `period` - Lookback period
///
/// # Returns
///
/// Vector of TEMA values.
pub fn tema(data: &[f64], period: usize) -> Vec<f64> {
    let ema1 = ema(data, period);
    let ema2 = ema(&ema1, period);
    let ema3 = ema(&ema2, period);

    let n = data.len();
    let mut result = vec![0.0; n];

    for i in 0..n {
        result[i] = 3.0 * ema1[i] - 3.0 * ema2[i] + ema3[i];
    }

    result
}

/// Calculate Weighted Moving Average (WMA).
///
/// More recent prices have higher weights.
/// Weight for position i from end = (period - i + 1)
///
/// # Arguments
///
/// * `data` - Price series
/// * `period` - Lookback period
///
/// # Returns
///
/// Vector of WMA values.
pub fn wma(data: &[f64], period: usize) -> Vec<f64> {
    let n = data.len();
    let mut result = vec![0.0; n];

    if period == 0 || period > n {
        return result;
    }

    // Weight sum = 1 + 2 + ... + period = period * (period + 1) / 2
    let weight_sum = (period * (period + 1)) as f64 / 2.0;

    for i in (period - 1)..n {
        let mut weighted_sum = 0.0;
        for j in 0..period {
            let weight = (j + 1) as f64;
            let idx = i + j + 1 - period; // Avoid overflow: rewritten from (i - period + 1 + j)
            weighted_sum += data[idx] * weight;
        }
        result[i] = weighted_sum / weight_sum;
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sma_basic() {
        let data = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let result = sma(&data, 3);

        // SMA[2] = (1 + 2 + 3) / 3 = 2.0
        assert!((result[2] - 2.0).abs() < 0.001);

        // SMA[3] = (2 + 3 + 4) / 3 = 3.0
        assert!((result[3] - 3.0).abs() < 0.001);

        // SMA[4] = (3 + 4 + 5) / 3 = 4.0
        assert!((result[4] - 4.0).abs() < 0.001);
    }

    #[test]
    fn test_sma_period_1() {
        let data = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let result = sma(&data, 1);

        // Period 1 SMA should equal the data
        for i in 0..data.len() {
            assert!((result[i] - data[i]).abs() < 0.001);
        }
    }

    #[test]
    fn test_sma_period_larger_than_data() {
        let data = vec![1.0, 2.0, 3.0];
        let result = sma(&data, 10);

        // Should return zeros
        assert!(result.iter().all(|&x| x == 0.0));
    }

    #[test]
    fn test_ema_basic() {
        let data = vec![10.0, 11.0, 12.0, 11.0, 10.0];
        let result = ema(&data, 3);

        // EMA should start from first value
        assert!((result[0] - 10.0).abs() < 0.001);

        // EMA should be between min and max
        for i in 0..data.len() {
            assert!(result[i] >= 9.0 && result[i] <= 13.0);
        }
    }

    #[test]
    fn test_ema_responsiveness() {
        // EMA should react faster to price changes than SMA
        // When price jumps from 100 to 150, EMA should move faster initially
        let data: Vec<f64> = (0..20)
            .map(|i| if i < 10 { 100.0 } else { 150.0 })
            .collect();

        let sma_result = sma(&data, 5);
        let ema_result = ema(&data, 5);

        // Right after the jump (index 10-11), EMA responds faster
        // At index 11: SMA still includes 100s in its window, EMA weights recent more
        // EMA[11] should be > SMA[11] because EMA weights the recent 150s more heavily
        assert!(ema_result[11] > sma_result[11]);
    }

    #[test]
    fn test_wma() {
        let data = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let result = wma(&data, 3);

        // WMA[2] = (1*1 + 2*2 + 3*3) / 6 = (1 + 4 + 9) / 6 = 14/6 ≈ 2.333
        assert!((result[2] - 14.0 / 6.0).abs() < 0.001);
    }

    #[test]
    fn test_dema() {
        let data: Vec<f64> = (0..20).map(|i| 100.0 + i as f64).collect();
        let result = dema(&data, 5);

        // DEMA should follow trend closely
        assert!(result[19] > result[10]);
    }

    #[test]
    fn test_tema() {
        let data: Vec<f64> = (0..20).map(|i| 100.0 + i as f64).collect();
        let result = tema(&data, 5);

        // TEMA should follow trend closely
        assert!(result[19] > result[10]);
    }

    #[test]
    fn test_empty_data() {
        let data: Vec<f64> = vec![];
        assert!(sma(&data, 3).is_empty());
        assert!(ema(&data, 3).is_empty());
        assert!(wma(&data, 3).is_empty());
    }
}
