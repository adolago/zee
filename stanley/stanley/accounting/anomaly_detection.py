"""
Anomaly Detection Module

Statistical and pattern-based anomaly detection:
- Time series anomalies in financial metrics
- Footnote change detection
- Peer comparison outliers
- Benford's Law analysis
- Disclosure quality scoring
"""

import logging
import re
from collections import Counter
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from enum import Enum

import numpy as np
import pandas as pd
from scipy import stats

from .financial_statements import FinancialStatements
from .footnotes import FootnoteAnalyzer, FootnoteType
from .edgar_adapter import EdgarAdapter

logger = logging.getLogger(__name__)


class AnomalyType(Enum):
    """Types of detected anomalies."""

    STATISTICAL_OUTLIER = "statistical_outlier"
    TREND_BREAK = "trend_break"
    PEER_DEVIATION = "peer_deviation"
    BENFORD_VIOLATION = "benford_violation"
    DISCLOSURE_CHANGE = "disclosure_change"
    SEASONAL_ANOMALY = "seasonal_anomaly"


@dataclass
class Anomaly:
    """Individual anomaly detection result."""

    anomaly_type: AnomalyType
    metric: str
    period: str
    expected_value: float
    actual_value: float
    deviation: float  # Number of std deviations or % deviation
    confidence: float  # 0-1
    explanation: str


@dataclass
class AnomalyReport:
    """Comprehensive anomaly report."""

    ticker: str
    anomalies: List[Anomaly]
    anomaly_score: float  # 0-100
    time_series_health: str
    peer_alignment: str
    disclosure_quality: str


class TimeSeriesAnomalyDetector:
    """Detect anomalies in time series financial data."""

    def __init__(self, edgar_adapter: EdgarAdapter):
        self.edgar_adapter = edgar_adapter

    def detect(
        self, ticker: str, metrics: List[str], periods: int = 8
    ) -> List[Anomaly]:
        """
        Detect time series anomalies using multiple statistical methods.

        Args:
            ticker: Company ticker
            metrics: List of metric names to analyze
            periods: Number of periods to analyze

        Returns:
            List of detected anomalies
        """
        anomalies = []

        try:
            # Get financial statements
            statements = FinancialStatements(ticker, self.edgar_adapter)

            for metric in metrics:
                # Get time series data
                data = self._extract_metric_series(statements, metric, periods)

                if data is None or len(data) < 4:
                    logger.warning(f"Insufficient data for {ticker} {metric}")
                    continue

                # Run multiple detection methods
                anomalies.extend(self._z_score_detection(ticker, metric, data))
                anomalies.extend(self._modified_z_score_detection(ticker, metric, data))
                anomalies.extend(self._iqr_detection(ticker, metric, data))
                anomalies.extend(self._trend_break_detection(ticker, metric, data))

        except Exception as e:
            logger.error(f"Error detecting anomalies for {ticker}: {e}")

        return anomalies

    def _extract_metric_series(
        self, statements: FinancialStatements, metric: str, periods: int
    ) -> Optional[pd.Series]:
        """Extract time series for a specific metric."""
        try:
            # Map metric to statement data
            metric_map = {
                "revenue": ("income_statement", "Revenues"),
                "net_income": ("income_statement", "NetIncomeLoss"),
                "total_assets": ("balance_sheet", "Assets"),
                "total_liabilities": ("balance_sheet", "Liabilities"),
                "operating_cash_flow": (
                    "cash_flow",
                    "NetCashProvidedByUsedInOperatingActivities",
                ),
                "gross_profit": ("income_statement", "GrossProfit"),
            }

            if metric not in metric_map:
                return None

            statement_type, field_name = metric_map[metric]

            # Get statement data
            if statement_type == "income_statement":
                df = statements.income_statement
            elif statement_type == "balance_sheet":
                df = statements.balance_sheet
            elif statement_type == "cash_flow":
                df = statements.cash_flow_statement
            else:
                return None

            if df is None or df.empty:
                return None

            # Extract the specific metric
            if field_name in df.columns:
                series = df[field_name].dropna()
                return series.tail(periods)

            return None

        except Exception as e:
            logger.error(f"Error extracting metric {metric}: {e}")
            return None

    def _z_score_detection(
        self, ticker: str, metric: str, data: pd.Series
    ) -> List[Anomaly]:
        """Detect anomalies using Z-score (>2.5 std = anomaly)."""
        anomalies = []

        try:
            mean = data.mean()
            std = data.std()

            if std == 0:
                return anomalies

            z_scores = np.abs((data - mean) / std)

            for idx, z_score in z_scores.items():
                if z_score > 2.5:
                    anomalies.append(
                        Anomaly(
                            anomaly_type=AnomalyType.STATISTICAL_OUTLIER,
                            metric=metric,
                            period=str(idx),
                            expected_value=float(mean),
                            actual_value=float(data[idx]),
                            deviation=float(z_score),
                            confidence=min(0.99, 0.5 + (z_score - 2.5) * 0.1),
                            explanation=f"{metric} is {z_score:.2f} std deviations from mean",
                        )
                    )

        except Exception as e:
            logger.error(f"Error in Z-score detection: {e}")

        return anomalies

    def _modified_z_score_detection(
        self, ticker: str, metric: str, data: pd.Series
    ) -> List[Anomaly]:
        """Detect anomalies using modified Z-score (robust to outliers)."""
        anomalies = []

        try:
            median = data.median()
            mad = np.median(np.abs(data - median))

            if mad == 0:
                return anomalies

            # Modified Z-score
            modified_z_scores = 0.6745 * (data - median) / mad

            for idx, m_z_score in modified_z_scores.items():
                if np.abs(m_z_score) > 3.5:
                    anomalies.append(
                        Anomaly(
                            anomaly_type=AnomalyType.STATISTICAL_OUTLIER,
                            metric=metric,
                            period=str(idx),
                            expected_value=float(median),
                            actual_value=float(data[idx]),
                            deviation=float(np.abs(m_z_score)),
                            confidence=min(
                                0.95, 0.5 + (np.abs(m_z_score) - 3.5) * 0.08
                            ),
                            explanation=f"{metric} has modified Z-score of {m_z_score:.2f}",
                        )
                    )

        except Exception as e:
            logger.error(f"Error in modified Z-score detection: {e}")

        return anomalies

    def _iqr_detection(
        self, ticker: str, metric: str, data: pd.Series
    ) -> List[Anomaly]:
        """Detect anomalies using IQR method."""
        anomalies = []

        try:
            q1 = data.quantile(0.25)
            q3 = data.quantile(0.75)
            iqr = q3 - q1

            lower_bound = q1 - 1.5 * iqr
            upper_bound = q3 + 1.5 * iqr

            for idx, value in data.items():
                if value < lower_bound or value > upper_bound:
                    expected = (q1 + q3) / 2
                    deviation = abs(value - expected) / iqr if iqr > 0 else 0

                    anomalies.append(
                        Anomaly(
                            anomaly_type=AnomalyType.STATISTICAL_OUTLIER,
                            metric=metric,
                            period=str(idx),
                            expected_value=float(expected),
                            actual_value=float(value),
                            deviation=float(deviation),
                            confidence=min(0.90, 0.5 + deviation * 0.05),
                            explanation=f"{metric} outside IQR bounds [{lower_bound:.2f}, {upper_bound:.2f}]",
                        )
                    )

        except Exception as e:
            logger.error(f"Error in IQR detection: {e}")

        return anomalies

    def _trend_break_detection(
        self, ticker: str, metric: str, data: pd.Series
    ) -> List[Anomaly]:
        """Detect structural breaks in trends."""
        anomalies = []

        try:
            if len(data) < 5:
                return anomalies

            # Calculate rolling mean and check for breaks
            window = min(4, len(data) // 2)
            rolling_mean = data.rolling(window=window).mean()
            rolling_std = data.rolling(window=window).std()

            for i in range(window, len(data)):
                idx = data.index[i]
                current_value = data[idx]
                expected = rolling_mean.iloc[i - 1]
                std = rolling_std.iloc[i - 1]

                if pd.isna(expected) or pd.isna(std) or std == 0:
                    continue

                # Check for significant deviation from trend
                deviation = abs(current_value - expected) / std

                if deviation > 2.0:
                    anomalies.append(
                        Anomaly(
                            anomaly_type=AnomalyType.TREND_BREAK,
                            metric=metric,
                            period=str(idx),
                            expected_value=float(expected),
                            actual_value=float(current_value),
                            deviation=float(deviation),
                            confidence=min(0.85, 0.4 + deviation * 0.1),
                            explanation=f"{metric} breaks trend: {deviation:.2f} std from rolling mean",
                        )
                    )

        except Exception as e:
            logger.error(f"Error in trend break detection: {e}")

        return anomalies


class BenfordAnalyzer:
    """Analyze financial data against Benford's Law."""

    # Benford's Law expected first-digit distribution
    BENFORD_DISTRIBUTION = {
        1: 0.301,
        2: 0.176,
        3: 0.125,
        4: 0.097,
        5: 0.079,
        6: 0.067,
        7: 0.058,
        8: 0.051,
        9: 0.046,
    }

    def __init__(self, edgar_adapter: EdgarAdapter):
        self.edgar_adapter = edgar_adapter

    def analyze(self, ticker: str) -> Dict[str, Any]:
        """
        Analyze financial data against Benford's Law.

        Returns:
            Dictionary with chi-square test results and deviations
        """
        try:
            statements = FinancialStatements(ticker, self.edgar_adapter)

            # Collect all financial numbers
            all_numbers = []

            if statements.income_statement is not None:
                all_numbers.extend(self._extract_numbers(statements.income_statement))
            if statements.balance_sheet is not None:
                all_numbers.extend(self._extract_numbers(statements.balance_sheet))
            if statements.cash_flow_statement is not None:
                all_numbers.extend(
                    self._extract_numbers(statements.cash_flow_statement)
                )

            if not all_numbers:
                return {"conformity": "insufficient_data", "chi_square_p": None}

            # Get first digit distribution
            first_digits = [self._get_first_digit(n) for n in all_numbers]
            first_digits = [d for d in first_digits if d is not None]

            if len(first_digits) < 30:
                return {"conformity": "insufficient_data", "chi_square_p": None}

            # Calculate observed distribution
            observed_counts = Counter(first_digits)
            total = len(first_digits)

            observed_dist = {
                digit: observed_counts.get(digit, 0) / total for digit in range(1, 10)
            }

            # Chi-square test
            observed = [observed_counts.get(d, 0) for d in range(1, 10)]
            expected = [self.BENFORD_DISTRIBUTION[d] * total for d in range(1, 10)]

            chi_square, p_value = stats.chisquare(observed, expected)

            # Determine conformity
            if p_value > 0.05:
                conformity = "conforms"
            elif p_value > 0.01:
                conformity = "borderline"
            else:
                conformity = "violates"

            return {
                "conformity": conformity,
                "chi_square": float(chi_square),
                "chi_square_p": float(p_value),
                "observed_distribution": observed_dist,
                "expected_distribution": self.BENFORD_DISTRIBUTION,
                "sample_size": total,
                "max_deviation": max(
                    abs(observed_dist[d] - self.BENFORD_DISTRIBUTION[d])
                    for d in range(1, 10)
                ),
            }

        except Exception as e:
            logger.error(f"Error in Benford analysis for {ticker}: {e}")
            return {"conformity": "error", "chi_square_p": None, "error": str(e)}

    def _extract_numbers(self, df: pd.DataFrame) -> List[float]:
        """Extract all non-zero numbers from a dataframe."""
        numbers = []

        for col in df.select_dtypes(include=[np.number]).columns:
            values = df[col].dropna()
            numbers.extend([abs(v) for v in values if v != 0])

        return numbers

    def _get_first_digit(self, number: float) -> Optional[int]:
        """Get the first digit of a number."""
        try:
            # Convert to string and extract first non-zero digit
            num_str = f"{abs(number):.10e}"
            match = re.search(r"[1-9]", num_str)

            if match:
                return int(match.group())

            return None

        except Exception:
            return None


class PeerComparisonAnalyzer:
    """Compare metrics against peer group to detect outliers."""

    def __init__(self, edgar_adapter: EdgarAdapter):
        self.edgar_adapter = edgar_adapter

    def analyze(self, ticker: str, peers: List[str]) -> List[Anomaly]:
        """
        Compare key ratios against peer median.

        Args:
            ticker: Company ticker
            peers: List of peer company tickers

        Returns:
            List of peer deviation anomalies
        """
        anomalies = []

        try:
            # Calculate ratios for target and peers
            target_ratios = self._calculate_ratios(ticker)
            peer_ratios = [self._calculate_ratios(p) for p in peers]
            peer_ratios = [r for r in peer_ratios if r is not None]

            if not peer_ratios or target_ratios is None:
                return anomalies

            # Compare each metric
            for metric in target_ratios.keys():
                peer_values = [
                    r[metric]
                    for r in peer_ratios
                    if metric in r and r[metric] is not None
                ]

                if len(peer_values) < 2:
                    continue

                peer_median = np.median(peer_values)
                peer_std = np.std(peer_values)

                if peer_std == 0:
                    continue

                target_value = target_ratios[metric]

                if target_value is None:
                    continue

                deviation = abs(target_value - peer_median) / peer_std

                if deviation > 2.0:
                    percentile = stats.percentileofscore(peer_values, target_value)

                    anomalies.append(
                        Anomaly(
                            anomaly_type=AnomalyType.PEER_DEVIATION,
                            metric=metric,
                            period="latest",
                            expected_value=float(peer_median),
                            actual_value=float(target_value),
                            deviation=float(deviation),
                            confidence=min(0.90, 0.5 + deviation * 0.08),
                            explanation=f"{metric} is {deviation:.2f} std from peer median ({percentile:.1f}th percentile)",
                        )
                    )

        except Exception as e:
            logger.error(f"Error in peer comparison for {ticker}: {e}")

        return anomalies

    def _calculate_ratios(self, ticker: str) -> Optional[Dict[str, Optional[float]]]:
        """Calculate key financial ratios."""
        try:
            statements = FinancialStatements(ticker, self.edgar_adapter)

            if statements.income_statement is None or statements.balance_sheet is None:
                return None

            # Get latest values
            income = (
                statements.income_statement.iloc[-1]
                if not statements.income_statement.empty
                else None
            )
            balance = (
                statements.balance_sheet.iloc[-1]
                if not statements.balance_sheet.empty
                else None
            )

            if income is None or balance is None:
                return None

            ratios = {}

            # Profitability ratios
            revenue = income.get("Revenues", 0)
            net_income = income.get("NetIncomeLoss", 0)
            gross_profit = income.get("GrossProfit", 0)

            if revenue and revenue != 0:
                ratios["net_margin"] = (net_income / revenue) * 100
                ratios["gross_margin"] = (
                    (gross_profit / revenue) * 100 if gross_profit else None
                )

            # Balance sheet ratios
            assets = balance.get("Assets", 0)
            liabilities = balance.get("Liabilities", 0)
            equity = assets - liabilities if assets and liabilities else None

            if equity and equity != 0:
                ratios["roe"] = (net_income / equity) * 100
                ratios["debt_to_equity"] = (
                    (liabilities / equity) if liabilities else None
                )

            if assets and assets != 0:
                ratios["roa"] = (net_income / assets) * 100
                ratios["asset_turnover"] = (revenue / assets) if revenue else None

            return ratios

        except Exception as e:
            logger.error(f"Error calculating ratios for {ticker}: {e}")
            return None


class FootnoteAnomalyDetector:
    """Detect changes and anomalies in footnote disclosures."""

    def __init__(self, edgar_adapter: EdgarAdapter):
        self.edgar_adapter = edgar_adapter
        self.footnote_analyzer = FootnoteAnalyzer(edgar_adapter)

    def detect(self, ticker: str, num_periods: int = 3) -> List[Anomaly]:
        """
        Track footnote changes across filings.

        Args:
            ticker: Company ticker
            num_periods: Number of periods to compare

        Returns:
            List of disclosure change anomalies
        """
        anomalies = []

        try:
            # This would require analyzing multiple filings
            # For now, we'll analyze the latest filing and look for red flags

            footnotes = self.footnote_analyzer.extract_all_footnotes(ticker)

            if not footnotes:
                return anomalies

            # Check for red flag keywords
            red_flags = self._check_red_flag_keywords(footnotes)
            anomalies.extend(red_flags)

            # Check for unusual disclosure patterns
            disclosure_anomalies = self._check_disclosure_patterns(ticker, footnotes)
            anomalies.extend(disclosure_anomalies)

        except Exception as e:
            logger.error(f"Error detecting footnote anomalies for {ticker}: {e}")

        return anomalies

    def _check_red_flag_keywords(
        self, footnotes: Dict[FootnoteType, str]
    ) -> List[Anomaly]:
        """Check for red flag keywords in footnotes."""
        anomalies = []

        red_flag_keywords = {
            "going_concern": [
                "going concern",
                "substantial doubt",
                "ability to continue",
            ],
            "restatement": [
                "restatement",
                "restate",
                "restated",
                "prior period adjustment",
            ],
            "litigation": [
                "material litigation",
                "adverse judgment",
                "contingent liability",
            ],
            "related_party": ["related party transaction", "affiliated entity"],
            "change_accounting": [
                "change in accounting",
                "accounting policy change",
                "adoption of new standard",
            ],
        }

        for footnote_type, text in footnotes.items():
            if not text:
                continue

            text_lower = text.lower()

            for flag_type, keywords in red_flag_keywords.items():
                for keyword in keywords:
                    if keyword in text_lower:
                        # Count occurrences
                        count = text_lower.count(keyword)

                        anomalies.append(
                            Anomaly(
                                anomaly_type=AnomalyType.DISCLOSURE_CHANGE,
                                metric=f"{footnote_type.value}_{flag_type}",
                                period="latest",
                                expected_value=0.0,
                                actual_value=float(count),
                                deviation=float(count),
                                confidence=0.75,
                                explanation=f"Found '{keyword}' {count} time(s) in {footnote_type.value}",
                            )
                        )

        return anomalies

    def _check_disclosure_patterns(
        self, ticker: str, footnotes: Dict[FootnoteType, str]
    ) -> List[Anomaly]:
        """Check for unusual disclosure patterns."""
        anomalies = []

        try:
            # Check for very short footnotes (lack of detail)
            for footnote_type, text in footnotes.items():
                if not text:
                    continue

                word_count = len(text.split())

                # Flag unusually short footnotes for important topics
                important_types = [
                    FootnoteType.SIGNIFICANT_ACCOUNTING_POLICIES,
                    FootnoteType.REVENUE_RECOGNITION,
                    FootnoteType.INCOME_TAXES,
                ]

                if footnote_type in important_types and word_count < 100:
                    anomalies.append(
                        Anomaly(
                            anomaly_type=AnomalyType.DISCLOSURE_CHANGE,
                            metric=f"{footnote_type.value}_length",
                            period="latest",
                            expected_value=500.0,
                            actual_value=float(word_count),
                            deviation=abs(500.0 - word_count) / 100,
                            confidence=0.60,
                            explanation=f"{footnote_type.value} is unusually brief ({word_count} words)",
                        )
                    )

        except Exception as e:
            logger.error(f"Error checking disclosure patterns: {e}")

        return anomalies


class DisclosureQualityScorer:
    """Score the quality of financial disclosures."""

    def __init__(self, edgar_adapter: EdgarAdapter):
        self.edgar_adapter = edgar_adapter
        self.footnote_analyzer = FootnoteAnalyzer(edgar_adapter)

    def score(self, ticker: str) -> Dict[str, Any]:
        """
        Measure disclosure quality across multiple dimensions.

        Returns:
            Dictionary with quality scores and analysis
        """
        try:
            footnotes = self.footnote_analyzer.extract_all_footnotes(ticker)

            if not footnotes:
                return {"overall_score": 0, "error": "No footnotes available"}

            scores = {}

            # 1. Completeness score (0-100)
            scores["completeness"] = self._score_completeness(footnotes)

            # 2. Detail score (0-100)
            scores["detail"] = self._score_detail(footnotes)

            # 3. Specificity score (0-100)
            scores["specificity"] = self._score_specificity(footnotes)

            # 4. Clarity score (0-100)
            scores["clarity"] = self._score_clarity(footnotes)

            # Overall score (weighted average)
            overall = (
                scores["completeness"] * 0.3
                + scores["detail"] * 0.3
                + scores["specificity"] * 0.2
                + scores["clarity"] * 0.2
            )

            return {
                "overall_score": round(overall, 1),
                "completeness": round(scores["completeness"], 1),
                "detail": round(scores["detail"], 1),
                "specificity": round(scores["specificity"], 1),
                "clarity": round(scores["clarity"], 1),
                "grade": self._get_grade(overall),
            }

        except Exception as e:
            logger.error(f"Error scoring disclosure quality for {ticker}: {e}")
            return {"overall_score": 0, "error": str(e)}

    def _score_completeness(self, footnotes: Dict[FootnoteType, str]) -> float:
        """Score based on presence of required footnotes."""
        required_types = [
            FootnoteType.SIGNIFICANT_ACCOUNTING_POLICIES,
            FootnoteType.REVENUE_RECOGNITION,
            FootnoteType.INCOME_TAXES,
            FootnoteType.DEBT,
        ]

        present = sum(1 for ft in required_types if ft in footnotes and footnotes[ft])
        return (present / len(required_types)) * 100

    def _score_detail(self, footnotes: Dict[FootnoteType, str]) -> float:
        """Score based on footnote length and detail."""
        total_words = sum(len(text.split()) for text in footnotes.values() if text)

        # Benchmark: 3000+ words = good disclosure
        score = min(100, (total_words / 3000) * 100)
        return score

    def _score_specificity(self, footnotes: Dict[FootnoteType, str]) -> float:
        """Score based on use of specific language vs. hedging."""
        hedging_words = [
            "may",
            "could",
            "might",
            "approximately",
            "estimate",
            "believe",
        ]
        specific_indicators = ["$", "%", "basis points", "million", "billion"]

        total_text = " ".join(footnotes.values())
        words = total_text.lower().split()

        if not words:
            return 0

        hedging_count = sum(1 for w in words if w in hedging_words)
        specific_count = sum(
            1 for indicator in specific_indicators if indicator in total_text.lower()
        )

        # More specific = higher score, excessive hedging = lower score
        hedging_ratio = hedging_count / len(words)
        specific_score = min(100, specific_count * 2)

        # Penalize excessive hedging
        hedging_penalty = min(50, hedging_ratio * 5000)

        return max(0, specific_score - hedging_penalty)

    def _score_clarity(self, footnotes: Dict[FootnoteType, str]) -> float:
        """Score based on readability (inverse of complexity)."""
        total_text = " ".join(footnotes.values())

        if not total_text:
            return 0

        sentences = total_text.split(".")
        words = total_text.split()

        if not sentences or not words:
            return 50

        # Average sentence length (shorter = clearer)
        avg_sentence_length = len(words) / len(sentences)

        # Ideal range: 15-25 words per sentence
        if 15 <= avg_sentence_length <= 25:
            clarity_score = 100
        elif avg_sentence_length < 15:
            clarity_score = 100 - (15 - avg_sentence_length) * 2
        else:
            clarity_score = 100 - (avg_sentence_length - 25) * 1.5

        return max(0, min(100, clarity_score))

    def _get_grade(self, score: float) -> str:
        """Convert score to letter grade."""
        if score >= 90:
            return "A"
        elif score >= 80:
            return "B"
        elif score >= 70:
            return "C"
        elif score >= 60:
            return "D"
        else:
            return "F"


class SeasonalAnomalyDetector:
    """Detect unusual seasonal patterns (e.g., Q4 earnings management)."""

    def __init__(self, edgar_adapter: EdgarAdapter):
        self.edgar_adapter = edgar_adapter

    def detect(self, ticker: str) -> List[Anomaly]:
        """
        Flag unusual Q4 patterns and seasonal anomalies.

        Returns:
            List of seasonal anomalies
        """
        anomalies = []

        try:
            statements = FinancialStatements(ticker, self.edgar_adapter)

            if statements.income_statement is None or statements.income_statement.empty:
                return anomalies

            # Analyze revenue patterns
            revenue_anomalies = self._detect_revenue_hockey_stick(ticker, statements)
            anomalies.extend(revenue_anomalies)

            # Analyze expense timing
            expense_anomalies = self._detect_expense_timing(ticker, statements)
            anomalies.extend(expense_anomalies)

        except Exception as e:
            logger.error(f"Error detecting seasonal anomalies for {ticker}: {e}")

        return anomalies

    def _detect_revenue_hockey_stick(
        self, ticker: str, statements: FinancialStatements
    ) -> List[Anomaly]:
        """Detect Q4 revenue hockey stick pattern."""
        anomalies = []

        try:
            df = statements.income_statement

            if "Revenues" not in df.columns or len(df) < 4:
                return anomalies

            revenues = df["Revenues"].tail(4)

            # Check if Q4 revenue is significantly higher than Q1-Q3 average
            if len(revenues) == 4:
                q4_revenue = revenues.iloc[-1]
                q1_q3_avg = revenues.iloc[:3].mean()

                if q1_q3_avg > 0:
                    q4_ratio = q4_revenue / q1_q3_avg

                    # Flag if Q4 is >30% higher than Q1-Q3 average
                    if q4_ratio > 1.3:
                        anomalies.append(
                            Anomaly(
                                anomaly_type=AnomalyType.SEASONAL_ANOMALY,
                                metric="revenue_hockey_stick",
                                period="Q4",
                                expected_value=float(q1_q3_avg),
                                actual_value=float(q4_revenue),
                                deviation=float((q4_ratio - 1) * 100),
                                confidence=min(0.85, 0.5 + (q4_ratio - 1.3) * 0.5),
                                explanation=f"Q4 revenue {q4_ratio:.1%} of Q1-Q3 average (possible hockey stick)",
                            )
                        )

        except Exception as e:
            logger.error(f"Error detecting revenue hockey stick: {e}")

        return anomalies

    def _detect_expense_timing(
        self, ticker: str, statements: FinancialStatements
    ) -> List[Anomaly]:
        """Detect unusual expense timing (e.g., Q4 expense dumps)."""
        anomalies = []

        try:
            df = statements.income_statement

            if "CostsAndExpenses" not in df.columns or len(df) < 4:
                return anomalies

            expenses = df["CostsAndExpenses"].tail(4)

            if len(expenses) == 4:
                q4_expense = expenses.iloc[-1]
                q1_q3_avg = expenses.iloc[:3].mean()

                if q1_q3_avg > 0:
                    q4_ratio = q4_expense / q1_q3_avg

                    # Flag unusual Q4 expense patterns (>40% higher or lower)
                    if q4_ratio > 1.4 or q4_ratio < 0.6:
                        direction = "higher" if q4_ratio > 1.4 else "lower"

                        anomalies.append(
                            Anomaly(
                                anomaly_type=AnomalyType.SEASONAL_ANOMALY,
                                metric="expense_timing",
                                period="Q4",
                                expected_value=float(q1_q3_avg),
                                actual_value=float(q4_expense),
                                deviation=float(abs(q4_ratio - 1) * 100),
                                confidence=min(0.80, 0.5 + abs(q4_ratio - 1) * 0.3),
                                explanation=f"Q4 expenses {direction} than expected ({q4_ratio:.1%} of Q1-Q3 avg)",
                            )
                        )

        except Exception as e:
            logger.error(f"Error detecting expense timing anomalies: {e}")

        return anomalies


class AnomalyAggregator:
    """Aggregate anomaly detection results into comprehensive report."""

    def __init__(self, edgar_adapter: EdgarAdapter):
        self.edgar_adapter = edgar_adapter
        self.time_series_detector = TimeSeriesAnomalyDetector(edgar_adapter)
        self.benford_analyzer = BenfordAnalyzer(edgar_adapter)
        self.peer_analyzer = PeerComparisonAnalyzer(edgar_adapter)
        self.footnote_detector = FootnoteAnomalyDetector(edgar_adapter)
        self.disclosure_scorer = DisclosureQualityScorer(edgar_adapter)
        self.seasonal_detector = SeasonalAnomalyDetector(edgar_adapter)

    def aggregate(
        self, ticker: str, peers: Optional[List[str]] = None
    ) -> AnomalyReport:
        """
        Combine all anomaly detectors into comprehensive report.

        Args:
            ticker: Company ticker
            peers: Optional list of peer tickers for comparison

        Returns:
            Comprehensive anomaly report
        """
        all_anomalies = []

        try:
            # 1. Time series anomalies
            logger.info(f"Detecting time series anomalies for {ticker}")
            metrics = ["revenue", "net_income", "total_assets", "operating_cash_flow"]
            ts_anomalies = self.time_series_detector.detect(ticker, metrics)
            all_anomalies.extend(ts_anomalies)

            # 2. Benford's Law analysis
            logger.info(f"Running Benford analysis for {ticker}")
            benford_result = self.benford_analyzer.analyze(ticker)

            if benford_result.get("conformity") == "violates":
                all_anomalies.append(
                    Anomaly(
                        anomaly_type=AnomalyType.BENFORD_VIOLATION,
                        metric="first_digit_distribution",
                        period="all",
                        expected_value=0.05,
                        actual_value=float(benford_result.get("chi_square_p", 0)),
                        deviation=float(benford_result.get("max_deviation", 0)),
                        confidence=0.80,
                        explanation=f"Financial data violates Benford's Law (p={benford_result.get('chi_square_p', 0):.4f})",
                    )
                )

            # 3. Peer comparison
            if peers:
                logger.info(f"Comparing {ticker} against peers")
                peer_anomalies = self.peer_analyzer.analyze(ticker, peers)
                all_anomalies.extend(peer_anomalies)

            # 4. Footnote anomalies
            logger.info(f"Detecting footnote anomalies for {ticker}")
            footnote_anomalies = self.footnote_detector.detect(ticker)
            all_anomalies.extend(footnote_anomalies)

            # 5. Seasonal anomalies
            logger.info(f"Detecting seasonal anomalies for {ticker}")
            seasonal_anomalies = self.seasonal_detector.detect(ticker)
            all_anomalies.extend(seasonal_anomalies)

            # 6. Disclosure quality
            logger.info(f"Scoring disclosure quality for {ticker}")
            disclosure_quality = self.disclosure_scorer.score(ticker)

            # Calculate overall anomaly score
            anomaly_score = self._calculate_anomaly_score(
                all_anomalies, disclosure_quality
            )

            # Assess time series health
            ts_health = self._assess_time_series_health(ts_anomalies)

            # Assess peer alignment
            peer_alignment = self._assess_peer_alignment(
                [
                    a
                    for a in all_anomalies
                    if a.anomaly_type == AnomalyType.PEER_DEVIATION
                ]
            )

            return AnomalyReport(
                ticker=ticker,
                anomalies=sorted(
                    all_anomalies, key=lambda x: x.confidence, reverse=True
                ),
                anomaly_score=anomaly_score,
                time_series_health=ts_health,
                peer_alignment=peer_alignment,
                disclosure_quality=disclosure_quality.get("grade", "N/A"),
            )

        except Exception as e:
            logger.error(f"Error aggregating anomalies for {ticker}: {e}")
            return AnomalyReport(
                ticker=ticker,
                anomalies=[],
                anomaly_score=0,
                time_series_health="error",
                peer_alignment="error",
                disclosure_quality="N/A",
            )

    def _calculate_anomaly_score(
        self, anomalies: List[Anomaly], disclosure_quality: Dict[str, Any]
    ) -> float:
        """Calculate overall anomaly score (0-100, higher = more anomalies)."""
        if not anomalies:
            base_score = 0
        else:
            # Weight by confidence and severity
            weighted_sum = sum(a.confidence * min(5, a.deviation) for a in anomalies)
            base_score = min(100, weighted_sum * 2)

        # Adjust for disclosure quality (poor disclosure = higher anomaly score)
        disclosure_score = disclosure_quality.get("overall_score", 70)
        disclosure_penalty = max(0, (70 - disclosure_score) / 2)

        final_score = min(100, base_score + disclosure_penalty)
        return round(final_score, 1)

    def _assess_time_series_health(self, ts_anomalies: List[Anomaly]) -> str:
        """Assess time series health based on anomalies."""
        if not ts_anomalies:
            return "healthy"

        high_confidence = [a for a in ts_anomalies if a.confidence > 0.8]

        if len(high_confidence) >= 3:
            return "poor"
        elif len(high_confidence) >= 1:
            return "concerning"
        else:
            return "fair"

    def _assess_peer_alignment(self, peer_anomalies: List[Anomaly]) -> str:
        """Assess alignment with peer group."""
        if not peer_anomalies:
            return "well_aligned"

        significant = [a for a in peer_anomalies if a.deviation > 3.0]

        if len(significant) >= 3:
            return "outlier"
        elif len(significant) >= 1:
            return "divergent"
        else:
            return "mostly_aligned"
