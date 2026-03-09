
import pytest
import pandas as pd
import numpy as np
from investing.analytics.whale_tracker import WhaleTracker

class TestWhaleTrackerCorrelation:

    @pytest.fixture
    def tracker(self):
        return WhaleTracker()

    def test_empty_correlation(self, tracker):
        """Test with insufficient data."""
        # Mock empty history
        tracker._get_quarterly_holdings_history = lambda s, quarters=None: {}
        df = tracker.get_cross_holder_correlation("TEST")
        assert df.empty

        # Mock history with < 2 managers
        tracker._get_quarterly_holdings_history = lambda s, quarters=None: {
            "cik1": [{"shares": 100}]
        }
        df = tracker.get_cross_holder_correlation("TEST")
        assert df.empty

    def test_correlated_managers(self, tracker):
        """Test detection of correlated managers."""

        # Create 3 managers: A and B correlated, C uncorrelated
        history = {
            "cik_A": [
                {"manager_name": "Manager A", "shares": 100},
                {"manager_name": "Manager A", "shares": 110}, # +10%
                {"manager_name": "Manager A", "shares": 121}, # +10%
                {"manager_name": "Manager A", "shares": 133}, # +10%
            ],
            "cik_B": [
                {"manager_name": "Manager B", "shares": 200},
                {"manager_name": "Manager B", "shares": 220}, # +10%
                {"manager_name": "Manager B", "shares": 242}, # +10%
                {"manager_name": "Manager B", "shares": 266}, # +10%
            ],
            "cik_C": [
                {"manager_name": "Manager C", "shares": 300},
                {"manager_name": "Manager C", "shares": 270}, # -10%
                {"manager_name": "Manager C", "shares": 243}, # -10%
                {"manager_name": "Manager C", "shares": 218}, # -10%
            ]
        }

        tracker._get_quarterly_holdings_history = lambda s, quarters=None: history

        # High positive correlation expected between A and B
        df = tracker.get_cross_holder_correlation("TEST", min_correlation=0.9)

        assert not df.empty
        # Should find A-B
        assert len(df) >= 1

        row = df[(df['manager_1'] == 'Manager A') & (df['manager_2'] == 'Manager B')]
        if row.empty:
             row = df[(df['manager_1'] == 'Manager B') & (df['manager_2'] == 'Manager A')]

        assert not row.empty
        assert row.iloc[0]['correlation'] > 0.99
        assert row.iloc[0]['movement_type'] == 'coordinated_buying'

    def test_inverse_correlation(self, tracker):
        """Test detection of inverse trading."""

        # A buys, C sells
        # Need variation for correlation to be defined
        history = {
            "cik_A": [
                {"manager_name": "Manager A", "shares": 100},
                {"manager_name": "Manager A", "shares": 110}, # +10%
                {"manager_name": "Manager A", "shares": 132}, # +20%
            ],
            "cik_C": [
                {"manager_name": "Manager C", "shares": 300},
                {"manager_name": "Manager C", "shares": 270}, # -10%
                {"manager_name": "Manager C", "shares": 216}, # -20%
            ]
        }

        tracker._get_quarterly_holdings_history = lambda s, quarters=None: history

        # High negative correlation expected (should be captured if we use absolute value filtering)
        # The method implementation filters by abs() >= min_correlation

        df = tracker.get_cross_holder_correlation("TEST", min_correlation=0.9)

        assert not df.empty
        row = df.iloc[0]
        assert row['correlation'] < -0.99
        assert row['movement_type'] == 'inverse_trading'

    def test_correlation_value_correctness(self, tracker):
        """Verify correlation values match manual calculation."""

        # Data
        # A: [0.1, 0.2, 0.3]
        # B: [0.2, 0.1, 0.4]
        # Corr(A, B) = ?

        # Using numpy to calculate expected
        a_changes = [0.1, 0.2, 0.3]
        b_changes = [0.2, 0.1, 0.4]
        expected_corr = np.corrcoef(a_changes, b_changes)[0, 1]

        # Construct history to produce these changes
        # Shares = prev * (1 + change)

        hist_a = [{"manager_name": "A", "shares": 100}]
        curr = 100
        for ch in a_changes:
            curr = curr * (1 + ch)
            hist_a.append({"manager_name": "A", "shares": curr})

        hist_b = [{"manager_name": "B", "shares": 100}]
        curr = 100
        for ch in b_changes:
            curr = curr * (1 + ch)
            hist_b.append({"manager_name": "B", "shares": curr})

        history = {"cik_A": hist_a, "cik_B": hist_b}
        tracker._get_quarterly_holdings_history = lambda s, quarters=None: history

        df = tracker.get_cross_holder_correlation("TEST", min_correlation=0.0)

        assert len(df) == 1
        calc_corr = df.iloc[0]['correlation']

        assert np.isclose(calc_corr, expected_corr, atol=1e-5)
