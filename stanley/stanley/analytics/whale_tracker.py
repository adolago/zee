"""
Whale Tracker Module

Detect and track large institutional holder movements, accumulation/distribution
patterns, and whale consensus signals. Focuses on identifying significant position
changes from major institutional investors.
"""

import logging
from datetime import datetime
from typing import Dict, List, TypedDict

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class WhaleMovement(TypedDict):
    """Type definition for whale movement data."""

    manager_name: str
    manager_cik: str
    previous_shares: int
    current_shares: int
    shares_change: int
    change_percentage: float
    previous_value: float
    current_value: float
    value_change: float
    movement_type: str  # 'accumulation', 'distribution', 'new_position', 'exit'


class WhaleAlert(TypedDict):
    """Type definition for whale alert."""

    symbol: str
    alert_type: str
    manager_name: str
    description: str
    magnitude: float
    timestamp: datetime


class WhaleTracker:
    """
    Track large institutional holder movements and detect accumulation/distribution
    patterns across multiple quarters.
    """

    def __init__(self, data_manager=None):
        """
        Initialize whale tracker.

        Args:
            data_manager: Data manager instance for data access
        """
        self.data_manager = data_manager
        logger.info("WhaleTracker initialized")

    def track_whale_movements(
        self,
        symbol: str,
        threshold_pct: float = 1.0,
        lookback_quarters: int = 4,
    ) -> pd.DataFrame:
        """
        Detect position changes above threshold percentage.

        Args:
            symbol: Stock symbol to track
            threshold_pct: Minimum percentage change to report (default 1.0%)
            lookback_quarters: Number of quarters to analyze (default 4)

        Returns:
            DataFrame with whale movement data including:
            - manager_name: Institution name
            - manager_cik: SEC CIK identifier
            - previous_shares: Shares held in prior period
            - current_shares: Current shares held
            - shares_change: Absolute change in shares
            - change_percentage: Percentage change in position
            - movement_type: Classification of movement
        """
        logger.info(
            f"Tracking whale movements for {symbol} with {threshold_pct}% threshold"
        )

        # Get current and previous holdings
        current_holdings = self._get_holdings(symbol, period="current")
        previous_holdings = self._get_holdings(symbol, period="previous")

        if current_holdings.empty and previous_holdings.empty:
            logger.warning(f"No holdings data available for {symbol}")
            return pd.DataFrame()

        # Merge holdings to detect changes
        movements = self._calculate_movements(current_holdings, previous_holdings)

        # Filter by threshold
        significant_movements = movements[
            abs(movements["change_percentage"]) >= threshold_pct / 100
        ].copy()

        # Sort by absolute change magnitude
        significant_movements = significant_movements.sort_values(
            "change_percentage", key=abs, ascending=False
        )

        logger.info(
            f"Found {len(significant_movements)} significant whale movements for {symbol}"
        )
        return significant_movements

    def get_top_whales(
        self,
        symbol: str,
        limit: int = 20,
    ) -> pd.DataFrame:
        """
        Get largest institutional holders for a symbol.

        Args:
            symbol: Stock symbol
            limit: Maximum number of holders to return (default 20)

        Returns:
            DataFrame with top institutional holders including:
            - manager_name: Institution name
            - manager_cik: SEC CIK identifier
            - shares_held: Number of shares held
            - value_held: Market value of position
            - ownership_percentage: Percentage of outstanding shares
            - rank: Position rank by value
        """
        logger.info(f"Getting top {limit} whales for {symbol}")

        holdings = self._get_holdings(symbol, period="current")

        if holdings.empty:
            logger.warning(f"No holdings data available for {symbol}")
            return pd.DataFrame()

        # Sort by value and take top N
        top_holders = holdings.nlargest(limit, "value_held").copy()
        top_holders["rank"] = range(1, len(top_holders) + 1)

        return top_holders

    def detect_accumulation_patterns(
        self,
        symbol: str,
        min_quarters: int = 2,
        min_increase_pct: float = 5.0,
    ) -> Dict:
        """
        Identify multi-quarter accumulation patterns where institutions
        consistently increase positions.

        Args:
            symbol: Stock symbol
            min_quarters: Minimum consecutive quarters of accumulation (default 2)
            min_increase_pct: Minimum total increase percentage (default 5.0%)

        Returns:
            Dictionary with:
            - accumulating_whales: List of institutions accumulating
            - total_accumulation: Net shares accumulated
            - accumulation_score: Strength of accumulation signal (0-1)
            - details: DataFrame with per-whale accumulation data
        """
        logger.info(f"Detecting accumulation patterns for {symbol}")

        # Get quarterly holdings history
        quarters_data = self._get_quarterly_holdings_history(symbol, quarters=4)

        if not quarters_data:
            return {
                "accumulating_whales": [],
                "total_accumulation": 0,
                "accumulation_score": 0.0,
                "details": pd.DataFrame(),
            }

        # Analyze each institution's pattern
        accumulating = []
        details_list = []

        for manager_cik, manager_history in quarters_data.items():
            if len(manager_history) < min_quarters:
                continue

            # Check for consistent increases
            consecutive_increases = 0
            total_change = 0
            first_shares = manager_history[0]["shares"]
            last_shares = manager_history[-1]["shares"]

            for i in range(1, len(manager_history)):
                if manager_history[i]["shares"] > manager_history[i - 1]["shares"]:
                    consecutive_increases += 1
                    total_change += (
                        manager_history[i]["shares"] - manager_history[i - 1]["shares"]
                    )

            # Calculate percentage increase
            pct_increase = (
                ((last_shares - first_shares) / first_shares * 100)
                if first_shares > 0
                else 0
            )

            if (
                consecutive_increases >= min_quarters
                and pct_increase >= min_increase_pct
            ):
                accumulating.append(
                    {
                        "manager_cik": manager_cik,
                        "manager_name": manager_history[0].get(
                            "manager_name", "Unknown"
                        ),
                        "consecutive_quarters": consecutive_increases,
                        "total_shares_added": total_change,
                        "percentage_increase": pct_increase,
                    }
                )
                details_list.append(
                    {
                        "manager_name": manager_history[0].get(
                            "manager_name", "Unknown"
                        ),
                        "manager_cik": manager_cik,
                        "start_shares": first_shares,
                        "end_shares": last_shares,
                        "shares_added": total_change,
                        "pct_increase": pct_increase,
                        "consecutive_increases": consecutive_increases,
                    }
                )

        details_df = pd.DataFrame(details_list) if details_list else pd.DataFrame()

        # Calculate accumulation score
        total_accumulation = sum(w["total_shares_added"] for w in accumulating)
        accumulation_score = min(1.0, len(accumulating) / 10) * min(
            1.0, total_accumulation / 10000000
        )

        return {
            "accumulating_whales": accumulating,
            "total_accumulation": total_accumulation,
            "accumulation_score": accumulation_score,
            "details": details_df,
        }

    def detect_distribution_patterns(
        self,
        symbol: str,
        min_quarters: int = 2,
        min_decrease_pct: float = 5.0,
    ) -> Dict:
        """
        Identify multi-quarter distribution patterns where institutions
        consistently decrease positions.

        Args:
            symbol: Stock symbol
            min_quarters: Minimum consecutive quarters of distribution (default 2)
            min_decrease_pct: Minimum total decrease percentage (default 5.0%)

        Returns:
            Dictionary with:
            - distributing_whales: List of institutions distributing
            - total_distribution: Net shares distributed
            - distribution_score: Strength of distribution signal (0-1)
            - details: DataFrame with per-whale distribution data
        """
        logger.info(f"Detecting distribution patterns for {symbol}")

        # Get quarterly holdings history
        quarters_data = self._get_quarterly_holdings_history(symbol, quarters=4)

        if not quarters_data:
            return {
                "distributing_whales": [],
                "total_distribution": 0,
                "distribution_score": 0.0,
                "details": pd.DataFrame(),
            }

        # Analyze each institution's pattern
        distributing = []
        details_list = []

        for manager_cik, manager_history in quarters_data.items():
            if len(manager_history) < min_quarters:
                continue

            # Check for consistent decreases
            consecutive_decreases = 0
            total_change = 0
            first_shares = manager_history[0]["shares"]
            last_shares = manager_history[-1]["shares"]

            for i in range(1, len(manager_history)):
                if manager_history[i]["shares"] < manager_history[i - 1]["shares"]:
                    consecutive_decreases += 1
                    total_change += (
                        manager_history[i - 1]["shares"] - manager_history[i]["shares"]
                    )

            # Calculate percentage decrease
            pct_decrease = (
                ((first_shares - last_shares) / first_shares * 100)
                if first_shares > 0
                else 0
            )

            if (
                consecutive_decreases >= min_quarters
                and pct_decrease >= min_decrease_pct
            ):
                distributing.append(
                    {
                        "manager_cik": manager_cik,
                        "manager_name": manager_history[0].get(
                            "manager_name", "Unknown"
                        ),
                        "consecutive_quarters": consecutive_decreases,
                        "total_shares_sold": total_change,
                        "percentage_decrease": pct_decrease,
                    }
                )
                details_list.append(
                    {
                        "manager_name": manager_history[0].get(
                            "manager_name", "Unknown"
                        ),
                        "manager_cik": manager_cik,
                        "start_shares": first_shares,
                        "end_shares": last_shares,
                        "shares_sold": total_change,
                        "pct_decrease": pct_decrease,
                        "consecutive_decreases": consecutive_decreases,
                    }
                )

        details_df = pd.DataFrame(details_list) if details_list else pd.DataFrame()

        # Calculate distribution score
        total_distribution = sum(w["total_shares_sold"] for w in distributing)
        distribution_score = min(1.0, len(distributing) / 10) * min(
            1.0, total_distribution / 10000000
        )

        return {
            "distributing_whales": distributing,
            "total_distribution": total_distribution,
            "distribution_score": distribution_score,
            "details": details_df,
        }

    def get_whale_consensus(self, symbol: str) -> Dict:
        """
        Aggregate whale sentiment into a consensus score.

        Analyzes recent institutional activity to determine overall
        sentiment from large holders.

        Args:
            symbol: Stock symbol

        Returns:
            Dictionary with:
            - consensus_score: Score from -1 (bearish) to 1 (bullish)
            - sentiment: Classification ('bullish', 'bearish', 'neutral')
            - buyers_count: Number of institutions increasing positions
            - sellers_count: Number of institutions decreasing positions
            - new_positions: Number of new institutional positions
            - exits: Number of positions closed
            - concentration_index: HHI concentration measure
            - confidence: Confidence level of the signal
        """
        logger.info(f"Calculating whale consensus for {symbol}")

        # Get movement data
        movements = self.track_whale_movements(symbol, threshold_pct=0.1)

        if movements.empty:
            return {
                "consensus_score": 0.0,
                "sentiment": "neutral",
                "buyers_count": 0,
                "sellers_count": 0,
                "new_positions": 0,
                "exits": 0,
                "concentration_index": 0.0,
                "confidence": 0.0,
            }

        # Count buyers and sellers
        buyers = movements[movements["change_percentage"] > 0]
        sellers = movements[movements["change_percentage"] < 0]
        new_positions = movements[movements["movement_type"] == "new_position"]
        exits = movements[movements["movement_type"] == "exit"]

        buyers_count = len(buyers)
        sellers_count = len(sellers)
        new_positions_count = len(new_positions)
        exits_count = len(exits)

        # Calculate weighted consensus (by position value)
        if "value_change" in movements.columns:
            total_buying = buyers["value_change"].sum() if len(buyers) > 0 else 0
            total_selling = (
                abs(sellers["value_change"].sum()) if len(sellers) > 0 else 0
            )
            total_activity = total_buying + total_selling

            if total_activity > 0:
                consensus_score = (total_buying - total_selling) / total_activity
            else:
                consensus_score = 0.0
        else:
            # Fallback to count-based consensus
            total_count = buyers_count + sellers_count
            if total_count > 0:
                consensus_score = (buyers_count - sellers_count) / total_count
            else:
                consensus_score = 0.0

        # Adjust for new positions and exits
        consensus_score += 0.1 * (new_positions_count - exits_count)
        consensus_score = max(-1.0, min(1.0, consensus_score))

        # Calculate concentration (HHI)
        concentration_index = self._calculate_concentration(symbol)

        # Determine sentiment classification
        if consensus_score > 0.2:
            sentiment = "bullish"
        elif consensus_score < -0.2:
            sentiment = "bearish"
        else:
            sentiment = "neutral"

        # Confidence based on number of active institutions
        total_movers = buyers_count + sellers_count + new_positions_count + exits_count
        confidence = min(1.0, total_movers / 50)

        return {
            "consensus_score": round(consensus_score, 4),
            "sentiment": sentiment,
            "buyers_count": buyers_count,
            "sellers_count": sellers_count,
            "new_positions": new_positions_count,
            "exits": exits_count,
            "concentration_index": round(concentration_index, 4),
            "confidence": round(confidence, 4),
        }

    def get_whale_alerts(
        self,
        symbols: List[str],
        threshold_pct: float = 5.0,
    ) -> List[WhaleAlert]:
        """
        Generate real-time alerts for significant whale activity.

        Args:
            symbols: List of stock symbols to monitor
            threshold_pct: Minimum change percentage to trigger alert (default 5.0%)

        Returns:
            List of WhaleAlert dictionaries with:
            - symbol: Stock symbol
            - alert_type: Type of alert
            - manager_name: Institution name
            - description: Alert description
            - magnitude: Size of the movement
            - timestamp: When alert was generated
        """
        logger.info(f"Generating whale alerts for {len(symbols)} symbols")

        alerts: List[WhaleAlert] = []
        timestamp = datetime.now()

        for symbol in symbols:
            try:
                # Check for large movements
                movements = self.track_whale_movements(
                    symbol, threshold_pct=threshold_pct
                )

                for _, movement in movements.iterrows():
                    change_pct = movement["change_percentage"] * 100

                    # Determine alert type
                    if movement["movement_type"] == "new_position":
                        alert_type = "NEW_WHALE_POSITION"
                        description = (
                            f"{movement['manager_name']} initiated new position "
                            f"of {movement['current_shares']:,} shares"
                        )
                    elif movement["movement_type"] == "exit":
                        alert_type = "WHALE_EXIT"
                        description = (
                            f"{movement['manager_name']} exited position "
                            f"(sold {movement['previous_shares']:,} shares)"
                        )
                    elif change_pct > 0:
                        alert_type = "WHALE_ACCUMULATION"
                        description = (
                            f"{movement['manager_name']} increased position "
                            f"by {change_pct:.1f}% ({movement['shares_change']:,} shares)"
                        )
                    else:
                        alert_type = "WHALE_DISTRIBUTION"
                        description = (
                            f"{movement['manager_name']} decreased position "
                            f"by {abs(change_pct):.1f}% ({abs(movement['shares_change']):,} shares)"
                        )

                    alerts.append(
                        WhaleAlert(
                            symbol=symbol,
                            alert_type=alert_type,
                            manager_name=movement["manager_name"],
                            description=description,
                            magnitude=abs(change_pct),
                            timestamp=timestamp,
                        )
                    )

                # Check for unusual concentration changes
                consensus = self.get_whale_consensus(symbol)
                if abs(consensus["consensus_score"]) > 0.5:
                    alert_type = (
                        "STRONG_WHALE_BUYING"
                        if consensus["consensus_score"] > 0
                        else "STRONG_WHALE_SELLING"
                    )
                    alerts.append(
                        WhaleAlert(
                            symbol=symbol,
                            alert_type=alert_type,
                            manager_name="Multiple Institutions",
                            description=(
                                f"Strong institutional {consensus['sentiment']} signal "
                                f"(consensus: {consensus['consensus_score']:.2f})"
                            ),
                            magnitude=abs(consensus["consensus_score"]) * 100,
                            timestamp=timestamp,
                        )
                    )

            except Exception as e:
                logger.error(f"Error generating alerts for {symbol}: {e}")
                continue

        # Sort by magnitude
        alerts.sort(key=lambda x: x["magnitude"], reverse=True)

        logger.info(f"Generated {len(alerts)} whale alerts")
        return alerts

    def get_cross_holder_correlation(
        self,
        symbol: str,
        min_correlation: float = 0.5,
    ) -> pd.DataFrame:
        """
        Identify when multiple whales move together (coordinated activity).

        Args:
            symbol: Stock symbol
            min_correlation: Minimum correlation to report (default 0.5)

        Returns:
            DataFrame with correlation analysis between whale movements
        """
        logger.info(f"Analyzing cross-holder correlation for {symbol}")

        # Get quarterly holdings history
        quarters_data = self._get_quarterly_holdings_history(symbol, quarters=8)

        if not quarters_data or len(quarters_data) < 2:
            return pd.DataFrame()

        # Build movement matrix (institutions x quarters)
        managers = list(quarters_data.keys())
        n_quarters = max(len(h) for h in quarters_data.values())

        movement_matrix = []
        manager_names = []

        for manager_cik in managers:
            history = quarters_data[manager_cik]
            if len(history) < 2:
                continue

            # Calculate quarter-over-quarter changes
            changes = []
            for i in range(1, len(history)):
                prev_shares = history[i - 1]["shares"]
                curr_shares = history[i]["shares"]
                if prev_shares > 0:
                    change = (curr_shares - prev_shares) / prev_shares
                else:
                    change = 1.0 if curr_shares > 0 else 0.0
                changes.append(change)

            # Pad to common length
            while len(changes) < n_quarters - 1:
                changes.append(0.0)

            movement_matrix.append(changes[: n_quarters - 1])
            manager_names.append(history[0].get("manager_name", manager_cik))

        if len(movement_matrix) < 2:
            return pd.DataFrame()

        # Optimized correlation calculation using NumPy
        movement_array = np.array(movement_matrix)  # Shape (M, Q)

        # Calculate correlation matrix
        # np.corrcoef expects variables as rows, which matches our (M, Q) shape
        correlation_matrix = np.corrcoef(movement_array)

        # Create mask for significant correlations in upper triangle
        # Avoid creating full boolean mask if possible, but for simplicity/readability:
        triu_mask = np.triu(np.ones_like(correlation_matrix, dtype=bool), k=1)
        sig_mask = (np.abs(correlation_matrix) >= min_correlation) & triu_mask

        # Extract indices of significant pairs
        rows, cols = np.where(sig_mask)

        if len(rows) == 0:
            return pd.DataFrame()

        # Extract values and names
        sig_corrs = correlation_matrix[rows, cols]
        manager_names_arr = np.array(manager_names)
        manager_1 = manager_names_arr[rows]
        manager_2 = manager_names_arr[cols]

        # Create result DataFrame
        result_df = pd.DataFrame({
            "manager_1": manager_1,
            "manager_2": manager_2,
            "correlation": sig_corrs
        })

        # Add movement type
        result_df["movement_type"] = np.where(
            result_df["correlation"] > 0, "coordinated_buying", "inverse_trading"
        )

        # Sort by correlation magnitude
        return result_df.sort_values(
            "correlation", key=abs, ascending=False
        ).reset_index(drop=True)

    # ========================================================================
    # Private Helper Methods
    # ========================================================================

    def _get_holdings(self, symbol: str, period: str = "current") -> pd.DataFrame:
        """
        Get institutional holdings for a symbol and period.

        Args:
            symbol: Stock symbol
            period: 'current' or 'previous'

        Returns:
            DataFrame with holdings data
        """
        if self.data_manager:
            # Use async data manager if available
            # Note: In production, this would be properly async
            try:
                import asyncio

                loop = asyncio.get_event_loop()
                if loop.is_running():
                    # If already in async context, create task
                    import concurrent.futures

                    with concurrent.futures.ThreadPoolExecutor() as executor:
                        future = executor.submit(
                            asyncio.run,
                            self.data_manager.get_institutional_holdings(symbol),
                        )
                        return future.result()
                else:
                    return asyncio.run(
                        self.data_manager.get_institutional_holdings(symbol)
                    )
            except Exception as e:
                logger.warning(f"Failed to get holdings from data manager: {e}")

        # Fallback to mock data
        return self._get_holdings_mock(symbol, period)

    def _get_holdings_mock(self, symbol: str, period: str) -> pd.DataFrame:
        """Generate mock institutional holdings data."""
        np.random.seed(hash(f"{symbol}_{period}") % 2**32)

        managers = [
            ("Vanguard Group", "0000102909"),
            ("BlackRock Inc", "0001390777"),
            ("State Street Corp", "0000093751"),
            ("Fidelity Management", "0000315066"),
            ("T. Rowe Price", "0000080227"),
            ("Capital Research", "0000066740"),
            ("Wellington Management", "0000106040"),
            ("Geode Capital", "0001214717"),
            ("Northern Trust", "0000073124"),
            ("Bank of America", "0000070858"),
            ("Morgan Stanley", "0000895421"),
            ("JPMorgan Chase", "0000019617"),
            ("Goldman Sachs", "0000886982"),
            ("Citadel Advisors", "0001423053"),
            ("Renaissance Tech", "0001037389"),
        ]

        base_shares = [
            100000000,
            80000000,
            60000000,
            50000000,
            40000000,
            35000000,
            30000000,
            25000000,
            20000000,
            18000000,
            15000000,
            12000000,
            10000000,
            8000000,
            5000000,
        ]

        # Add variation for different periods
        variation = 0.9 if period == "previous" else 1.0
        shares = [
            int(s * variation * (1 + np.random.uniform(-0.1, 0.15)))
            for s in base_shares
        ]

        price_per_share = 150.0 + np.random.uniform(-20, 20)
        values = [s * price_per_share for s in shares]
        total_shares = sum(shares) * 5  # Assume 5x for total outstanding

        return pd.DataFrame(
            {
                "manager_name": [m[0] for m in managers],
                "manager_cik": [m[1] for m in managers],
                "shares_held": shares,
                "value_held": values,
                "ownership_percentage": [s / total_shares for s in shares],
            }
        )

    def _calculate_movements(
        self,
        current_holdings: pd.DataFrame,
        previous_holdings: pd.DataFrame,
    ) -> pd.DataFrame:
        """
        Calculate position movements between two periods.

        Args:
            current_holdings: Current period holdings
            previous_holdings: Previous period holdings

        Returns:
            DataFrame with movement calculations
        """
        if current_holdings.empty and previous_holdings.empty:
            return pd.DataFrame()

        # Merge on manager_cik
        merged = current_holdings.merge(
            previous_holdings,
            on="manager_cik",
            how="outer",
            suffixes=("_current", "_previous"),
        ).fillna(0)

        # Handle manager_name
        # Optimized: Replace slow apply(axis=1) with vectorized np.where
        merged["manager_name"] = np.where(
            merged["manager_name_current"] != 0,
            merged["manager_name_current"],
            merged["manager_name_previous"],
        )

        # Calculate changes
        merged["previous_shares"] = merged.get(
            "shares_held_previous", merged.get("shares_held", 0)
        ).astype(int)
        merged["current_shares"] = merged.get(
            "shares_held_current", merged.get("shares_held", 0)
        ).astype(int)
        merged["shares_change"] = merged["current_shares"] - merged["previous_shares"]

        # Calculate percentage change safely
        merged["change_percentage"] = np.where(
            merged["previous_shares"] > 0,
            merged["shares_change"] / merged["previous_shares"],
            np.where(merged["current_shares"] > 0, 1.0, 0.0),
        )

        # Calculate value changes
        merged["previous_value"] = merged.get("value_held_previous", 0)
        merged["current_value"] = merged.get("value_held_current", 0)
        merged["value_change"] = merged["current_value"] - merged["previous_value"]

        # Classify movement type
        merged["movement_type"] = np.where(
            merged["previous_shares"] == 0,
            "new_position",
            np.where(
                merged["current_shares"] == 0,
                "exit",
                np.where(
                    merged["shares_change"] > 0,
                    "accumulation",
                    "distribution",
                ),
            ),
        )

        # Select and order columns
        result_columns = [
            "manager_name",
            "manager_cik",
            "previous_shares",
            "current_shares",
            "shares_change",
            "change_percentage",
            "previous_value",
            "current_value",
            "value_change",
            "movement_type",
        ]

        return merged[[c for c in result_columns if c in merged.columns]]

    def _get_quarterly_holdings_history(
        self,
        symbol: str,
        quarters: int = 4,
    ) -> Dict[str, List[Dict]]:
        """
        Get quarterly holdings history for tracking patterns.

        Args:
            symbol: Stock symbol
            quarters: Number of quarters to retrieve

        Returns:
            Dictionary mapping manager_cik to list of quarterly holdings
        """
        # In production, this would fetch from SEC EDGAR or data provider
        # For now, generate mock data
        return self._get_quarterly_history_mock(symbol, quarters)

    def _get_quarterly_history_mock(
        self,
        symbol: str,
        quarters: int,
    ) -> Dict[str, List[Dict]]:
        """Generate mock quarterly holdings history."""
        np.random.seed(hash(symbol) % 2**32)

        managers = [
            ("Vanguard Group", "0000102909", 100000000),
            ("BlackRock Inc", "0001390777", 80000000),
            ("State Street Corp", "0000093751", 60000000),
            ("Fidelity Management", "0000315066", 50000000),
            ("T. Rowe Price", "0000080227", 40000000),
            ("Capital Research", "0000066740", 35000000),
            ("Wellington Management", "0000106040", 30000000),
        ]

        history: Dict[str, List[Dict]] = {}

        for name, cik, base_shares in managers:
            quarters_list = []
            current_shares = base_shares

            for q in range(quarters):
                # Random quarterly change (-15% to +20%)
                change_pct = np.random.uniform(-0.15, 0.20)
                current_shares = int(current_shares * (1 + change_pct))

                quarters_list.append(
                    {
                        "manager_name": name,
                        "manager_cik": cik,
                        "quarter": f"Q{quarters - q}",
                        "shares": current_shares,
                        "value": current_shares * 150.0,
                    }
                )

            # Reverse to chronological order
            history[cik] = list(reversed(quarters_list))

        return history

    def _calculate_concentration(self, symbol: str) -> float:
        """
        Calculate Herfindahl-Hirschman Index (HHI) for institutional concentration.

        Args:
            symbol: Stock symbol

        Returns:
            Normalized HHI value (0 to 1)
        """
        holdings = self._get_holdings(symbol, period="current")

        if holdings.empty or "ownership_percentage" not in holdings.columns:
            return 0.0

        ownership = holdings["ownership_percentage"]
        n_holders = len(ownership)

        if n_holders == 0:
            return 0.0

        if n_holders == 1:
            return 1.0

        # Normalize shares to sum to 1 for HHI calculation
        total = ownership.sum()
        if total == 0:
            return 0.0

        normalized = ownership / total
        hhi = (normalized**2).sum()

        # Normalize HHI to [0, 1] range
        min_hhi = 1.0 / n_holders
        if (1.0 - min_hhi) > 0:
            normalized_hhi = (hhi - min_hhi) / (1.0 - min_hhi)
        else:
            normalized_hhi = 0.0

        return max(0.0, min(1.0, normalized_hhi))

    def health_check(self) -> bool:
        """
        Check if whale tracker is operational.

        Returns:
            True if healthy, False otherwise
        """
        try:
            # Test basic functionality
            _ = self._get_holdings_mock("TEST", "current")
            return True
        except Exception as e:
            logger.error(f"WhaleTracker health check failed: {e}")
            return False
