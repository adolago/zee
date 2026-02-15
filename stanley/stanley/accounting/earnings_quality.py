"""
Earnings Quality Module

Comprehensive earnings quality metrics including:
- Beneish M-Score for earnings manipulation detection
- Piotroski F-Score for financial strength
- Altman Z-Score for bankruptcy prediction
- Sloan Accrual Ratio
- Cash conversion quality
"""

import logging
from dataclasses import dataclass
from typing import Dict, List, Optional
from enum import Enum

import numpy as np
import pandas as pd

from .financial_statements import FinancialStatements

logger = logging.getLogger(__name__)


class QualityRating(Enum):
    """Quality rating categories."""

    EXCELLENT = "excellent"
    GOOD = "good"
    FAIR = "fair"
    POOR = "poor"
    CRITICAL = "critical"


@dataclass
class MScoreResult:
    """Beneish M-Score results."""

    m_score: float
    is_likely_manipulator: bool  # M-Score > -1.78
    components: Dict[str, float]  # DSRI, GMI, AQI, SGI, DEPI, SGAI, LVGI, TATA
    risk_level: QualityRating


@dataclass
class FScoreResult:
    """Piotroski F-Score results."""

    f_score: int  # 0-9
    signals: Dict[str, bool]  # 9 binary signals
    category: str  # "Strong", "Neutral", "Weak"


@dataclass
class ZScoreResult:
    """Altman Z-Score results."""

    z_score: float
    zone: str  # "Safe", "Grey", "Distress"
    components: Dict[str, float]


@dataclass
class EarningsQualityResult:
    """Comprehensive earnings quality assessment."""

    overall_rating: QualityRating
    overall_score: float  # 0-100
    m_score: Optional[MScoreResult]
    f_score: Optional[FScoreResult]
    z_score: Optional[ZScoreResult]
    accrual_ratio: Optional[float]
    cash_conversion: Optional[float]
    earnings_persistence: Optional[float]
    red_flags: List[str]


class BeneishMScore:
    """
    Calculate Beneish M-Score for earnings manipulation detection.

    M-Score > -1.78 suggests likely earnings manipulation.

    Formula:
    M = -4.84 + 0.920*DSRI + 0.528*GMI + 0.404*AQI + 0.892*SGI +
        0.115*DEPI - 0.172*SGAI + 4.679*TATA - 0.327*LVGI

    Components:
    - DSRI: Days Sales in Receivables Index
    - GMI: Gross Margin Index
    - AQI: Asset Quality Index
    - SGI: Sales Growth Index
    - DEPI: Depreciation Index
    - SGAI: Sales, General & Admin Expenses Index
    - LVGI: Leverage Index
    - TATA: Total Accruals to Total Assets
    """

    def __init__(self, financial_statements: Optional[FinancialStatements] = None):
        """
        Initialize BeneishMScore calculator.

        Args:
            financial_statements: FinancialStatements instance
        """
        self.fin_stmt = financial_statements or FinancialStatements()

    def calculate(self, ticker: str, periods: int = 2) -> MScoreResult:
        """
        Calculate Beneish M-Score.

        Args:
            ticker: Stock ticker symbol
            periods: Number of periods for comparison (need at least 2)

        Returns:
            MScoreResult with score and components
        """
        try:
            # Get financial statements
            statements = self.fin_stmt.get_all_statements(ticker, periods=periods)
            bs = statements["balance_sheet"].data
            inc = statements["income_statement"].data
            cf = statements["cash_flow"].data

            # Calculate components
            components = {}

            # DSRI: Days Sales in Receivables Index
            # (AR_t / Revenue_t) / (AR_t-1 / Revenue_t-1)
            dsri = self._calculate_dsri(bs, inc)
            components["dsri"] = dsri

            # GMI: Gross Margin Index
            # GM_t-1 / GM_t
            gmi = self._calculate_gmi(inc)
            components["gmi"] = gmi

            # AQI: Asset Quality Index
            # [1 - (CA_t + PPE_t) / TA_t] / [1 - (CA_t-1 + PPE_t-1) / TA_t-1]
            aqi = self._calculate_aqi(bs)
            components["aqi"] = aqi

            # SGI: Sales Growth Index
            # Revenue_t / Revenue_t-1
            sgi = self._calculate_sgi(inc)
            components["sgi"] = sgi

            # DEPI: Depreciation Index
            # Depreciation_t-1 / (PPE_t-1 + Depreciation_t-1) /
            # Depreciation_t / (PPE_t + Depreciation_t)
            depi = self._calculate_depi(bs, cf)
            components["depi"] = depi

            # SGAI: SG&A Expense Index
            # (SGA_t / Revenue_t) / (SGA_t-1 / Revenue_t-1)
            sgai = self._calculate_sgai(inc)
            components["sgai"] = sgai

            # LVGI: Leverage Index
            # [(LTD_t + CL_t) / TA_t] / [(LTD_t-1 + CL_t-1) / TA_t-1]
            lvgi = self._calculate_lvgi(bs)
            components["lvgi"] = lvgi

            # TATA: Total Accruals to Total Assets
            # (ΔWC - ΔCash - ΔSTP + ΔSTD - Depreciation) / TA
            tata = self._calculate_tata(bs, cf)
            components["tata"] = tata

            # Calculate M-Score
            m_score = (
                -4.84
                + 0.920 * dsri
                + 0.528 * gmi
                + 0.404 * aqi
                + 0.892 * sgi
                + 0.115 * depi
                - 0.172 * sgai
                + 4.679 * tata
                - 0.327 * lvgi
            )

            # Determine risk level
            is_manipulator = m_score > -1.78

            if is_manipulator:
                if m_score > -1.5:
                    risk_level = QualityRating.CRITICAL
                elif m_score > -1.65:
                    risk_level = QualityRating.POOR
                else:
                    risk_level = QualityRating.FAIR
            else:
                if m_score < -2.5:
                    risk_level = QualityRating.EXCELLENT
                elif m_score < -2.0:
                    risk_level = QualityRating.GOOD
                else:
                    risk_level = QualityRating.FAIR

            return MScoreResult(
                m_score=m_score,
                is_likely_manipulator=is_manipulator,
                components=components,
                risk_level=risk_level,
            )

        except Exception as e:
            logger.error(f"Failed to calculate M-Score for {ticker}: {e}")
            return MScoreResult(
                m_score=np.nan,
                is_likely_manipulator=False,
                components={},
                risk_level=QualityRating.FAIR,
            )

    def _calculate_dsri(self, bs: pd.DataFrame, inc: pd.DataFrame) -> float:
        """Days Sales in Receivables Index."""
        try:
            ar = bs.get("accounts_receivable", pd.Series([np.nan] * len(bs)))
            revenue = inc.get("revenue", pd.Series([np.nan] * len(inc)))

            if len(ar) < 2 or len(revenue) < 2:
                return np.nan

            # Current period
            ar_t = ar.iloc[0]
            rev_t = revenue.iloc[0]

            # Prior period
            ar_t1 = ar.iloc[1]
            rev_t1 = revenue.iloc[1]

            if rev_t == 0 or rev_t1 == 0:
                return np.nan

            dsri = (ar_t / rev_t) / (ar_t1 / rev_t1)
            return dsri

        except Exception as e:
            logger.warning(f"Failed to calculate DSRI: {e}")
            return np.nan

    def _calculate_gmi(self, inc: pd.DataFrame) -> float:
        """Gross Margin Index."""
        try:
            revenue = inc.get("revenue", pd.Series([np.nan] * len(inc)))
            cogs = inc.get("cost_of_revenue", pd.Series([np.nan] * len(inc)))

            if len(revenue) < 2 or len(cogs) < 2:
                return np.nan

            # Gross margin = (Revenue - COGS) / Revenue
            gm_t = (
                (revenue.iloc[0] - cogs.iloc[0]) / revenue.iloc[0]
                if revenue.iloc[0] != 0
                else np.nan
            )
            gm_t1 = (
                (revenue.iloc[1] - cogs.iloc[1]) / revenue.iloc[1]
                if revenue.iloc[1] != 0
                else np.nan
            )

            if pd.isna(gm_t) or pd.isna(gm_t1) or gm_t == 0:
                return np.nan

            gmi = gm_t1 / gm_t
            return gmi

        except Exception as e:
            logger.warning(f"Failed to calculate GMI: {e}")
            return np.nan

    def _calculate_aqi(self, bs: pd.DataFrame) -> float:
        """Asset Quality Index."""
        try:
            current_assets = bs.get("current_assets", pd.Series([np.nan] * len(bs)))
            ppe = bs.get("ppe_net", pd.Series([np.nan] * len(bs)))
            total_assets = bs.get("total_assets", pd.Series([np.nan] * len(bs)))

            if len(current_assets) < 2 or len(ppe) < 2 or len(total_assets) < 2:
                return np.nan

            # Non-current non-PPE assets ratio
            nca_t = (
                (1 - (current_assets.iloc[0] + ppe.iloc[0]) / total_assets.iloc[0])
                if total_assets.iloc[0] != 0
                else np.nan
            )
            nca_t1 = (
                (1 - (current_assets.iloc[1] + ppe.iloc[1]) / total_assets.iloc[1])
                if total_assets.iloc[1] != 0
                else np.nan
            )

            if pd.isna(nca_t) or pd.isna(nca_t1) or nca_t1 == 0:
                return np.nan

            aqi = nca_t / nca_t1
            return aqi

        except Exception as e:
            logger.warning(f"Failed to calculate AQI: {e}")
            return np.nan

    def _calculate_sgi(self, inc: pd.DataFrame) -> float:
        """Sales Growth Index."""
        try:
            revenue = inc.get("revenue", pd.Series([np.nan] * len(inc)))

            if len(revenue) < 2:
                return np.nan

            rev_t = revenue.iloc[0]
            rev_t1 = revenue.iloc[1]

            if rev_t1 == 0:
                return np.nan

            sgi = rev_t / rev_t1
            return sgi

        except Exception as e:
            logger.warning(f"Failed to calculate SGI: {e}")
            return np.nan

    def _calculate_depi(self, bs: pd.DataFrame, cf: pd.DataFrame) -> float:
        """Depreciation Index."""
        try:
            ppe = bs.get("ppe_net", pd.Series([np.nan] * len(bs)))
            depreciation = cf.get("depreciation", pd.Series([np.nan] * len(cf)))

            if len(ppe) < 2 or len(depreciation) < 2:
                return np.nan

            # Depreciation rate = Depreciation / (PPE + Depreciation)
            depr_rate_t = (
                depreciation.iloc[0] / (ppe.iloc[0] + depreciation.iloc[0])
                if (ppe.iloc[0] + depreciation.iloc[0]) != 0
                else np.nan
            )
            depr_rate_t1 = (
                depreciation.iloc[1] / (ppe.iloc[1] + depreciation.iloc[1])
                if (ppe.iloc[1] + depreciation.iloc[1]) != 0
                else np.nan
            )

            if pd.isna(depr_rate_t) or pd.isna(depr_rate_t1) or depr_rate_t == 0:
                return np.nan

            depi = depr_rate_t1 / depr_rate_t
            return depi

        except Exception as e:
            logger.warning(f"Failed to calculate DEPI: {e}")
            return np.nan

    def _calculate_sgai(self, inc: pd.DataFrame) -> float:
        """SG&A Expense Index."""
        try:
            sga = inc.get("sga_expense", pd.Series([np.nan] * len(inc)))
            revenue = inc.get("revenue", pd.Series([np.nan] * len(inc)))

            if len(sga) < 2 or len(revenue) < 2:
                return np.nan

            # SGA as % of revenue
            sga_ratio_t = (
                sga.iloc[0] / revenue.iloc[0] if revenue.iloc[0] != 0 else np.nan
            )
            sga_ratio_t1 = (
                sga.iloc[1] / revenue.iloc[1] if revenue.iloc[1] != 0 else np.nan
            )

            if pd.isna(sga_ratio_t) or pd.isna(sga_ratio_t1) or sga_ratio_t1 == 0:
                return np.nan

            sgai = sga_ratio_t / sga_ratio_t1
            return sgai

        except Exception as e:
            logger.warning(f"Failed to calculate SGAI: {e}")
            return np.nan

    def _calculate_lvgi(self, bs: pd.DataFrame) -> float:
        """Leverage Index."""
        try:
            ltd = bs.get("long_term_debt", pd.Series([0] * len(bs)))
            current_liab = bs.get("current_liabilities", pd.Series([np.nan] * len(bs)))
            total_assets = bs.get("total_assets", pd.Series([np.nan] * len(bs)))

            if len(ltd) < 2 or len(current_liab) < 2 or len(total_assets) < 2:
                return np.nan

            # Leverage = (LTD + CL) / TA
            lev_t = (
                (ltd.iloc[0] + current_liab.iloc[0]) / total_assets.iloc[0]
                if total_assets.iloc[0] != 0
                else np.nan
            )
            lev_t1 = (
                (ltd.iloc[1] + current_liab.iloc[1]) / total_assets.iloc[1]
                if total_assets.iloc[1] != 0
                else np.nan
            )

            if pd.isna(lev_t) or pd.isna(lev_t1) or lev_t1 == 0:
                return np.nan

            lvgi = lev_t / lev_t1
            return lvgi

        except Exception as e:
            logger.warning(f"Failed to calculate LVGI: {e}")
            return np.nan

    def _calculate_tata(self, bs: pd.DataFrame, cf: pd.DataFrame) -> float:
        """Total Accruals to Total Assets."""
        try:
            # Working capital = Current Assets - Current Liabilities
            current_assets = bs.get("current_assets", pd.Series([np.nan] * len(bs)))
            current_liab = bs.get("current_liabilities", pd.Series([np.nan] * len(bs)))
            cash = bs.get("cash_and_equivalents", pd.Series([np.nan] * len(bs)))
            short_term_debt = bs.get("short_term_debt", pd.Series([0] * len(bs)))
            total_assets = bs.get("total_assets", pd.Series([np.nan] * len(bs)))
            depreciation = cf.get("depreciation", pd.Series([np.nan] * len(cf)))

            if len(current_assets) < 2 or len(total_assets) < 1:
                return np.nan

            # Change in working capital (excluding cash and STD)
            wc_t = current_assets.iloc[0] - current_liab.iloc[0]
            wc_t1 = current_assets.iloc[1] - current_liab.iloc[1]
            delta_wc = wc_t - wc_t1

            delta_cash = cash.iloc[0] - cash.iloc[1] if len(cash) >= 2 else 0
            delta_std = (
                short_term_debt.iloc[0] - short_term_debt.iloc[1]
                if len(short_term_debt) >= 2
                else 0
            )
            depr = depreciation.iloc[0] if len(depreciation) >= 1 else 0

            # Total accruals
            accruals = delta_wc - delta_cash + delta_std - depr

            tata = (
                accruals / total_assets.iloc[0] if total_assets.iloc[0] != 0 else np.nan
            )
            return tata

        except Exception as e:
            logger.warning(f"Failed to calculate TATA: {e}")
            return np.nan


class PiotroskiFScore:
    """
    Calculate Piotroski F-Score for financial strength.

    9 binary signals (1 point each):

    Profitability:
    1. ROA > 0
    2. Operating Cash Flow > 0
    3. Change in ROA > 0
    4. Accruals (CFO > Net Income)

    Leverage/Liquidity:
    5. Change in Long-term Debt < 0
    6. Change in Current Ratio > 0
    7. No new equity issuance

    Operating Efficiency:
    8. Change in Gross Margin > 0
    9. Change in Asset Turnover > 0

    Score interpretation:
    - 8-9: Strong
    - 5-7: Neutral
    - 0-4: Weak
    """

    def __init__(self, financial_statements: Optional[FinancialStatements] = None):
        """
        Initialize PiotroskiFScore calculator.

        Args:
            financial_statements: FinancialStatements instance
        """
        self.fin_stmt = financial_statements or FinancialStatements()

    def calculate(self, ticker: str) -> FScoreResult:
        """
        Calculate Piotroski F-Score.

        Args:
            ticker: Stock ticker symbol

        Returns:
            FScoreResult with score and signals
        """
        try:
            # Get financial statements
            statements = self.fin_stmt.get_all_statements(ticker, periods=2)
            bs = statements["balance_sheet"].data
            inc = statements["income_statement"].data
            cf = statements["cash_flow"].data

            signals = {}
            score = 0

            # 1. ROA > 0
            signal = self._roa_positive(bs, inc)
            signals["roa_positive"] = signal
            score += int(signal)

            # 2. Operating Cash Flow > 0
            signal = self._cfo_positive(cf)
            signals["cfo_positive"] = signal
            score += int(signal)

            # 3. Change in ROA > 0
            signal = self._delta_roa_positive(bs, inc)
            signals["delta_roa_positive"] = signal
            score += int(signal)

            # 4. Accruals (CFO > Net Income)
            signal = self._accruals_quality(cf, inc)
            signals["accruals_quality"] = signal
            score += int(signal)

            # 5. Change in Leverage < 0
            signal = self._delta_leverage_negative(bs)
            signals["delta_leverage_negative"] = signal
            score += int(signal)

            # 6. Change in Current Ratio > 0
            signal = self._delta_current_ratio_positive(bs)
            signals["delta_current_ratio_positive"] = signal
            score += int(signal)

            # 7. No new equity issuance
            signal = self._no_equity_issuance(bs)
            signals["no_equity_issuance"] = signal
            score += int(signal)

            # 8. Change in Gross Margin > 0
            signal = self._delta_gross_margin_positive(inc)
            signals["delta_gross_margin_positive"] = signal
            score += int(signal)

            # 9. Change in Asset Turnover > 0
            signal = self._delta_asset_turnover_positive(bs, inc)
            signals["delta_asset_turnover_positive"] = signal
            score += int(signal)

            # Categorize
            if score >= 8:
                category = "Strong"
            elif score >= 5:
                category = "Neutral"
            else:
                category = "Weak"

            return FScoreResult(f_score=score, signals=signals, category=category)

        except Exception as e:
            logger.error(f"Failed to calculate F-Score for {ticker}: {e}")
            return FScoreResult(f_score=0, signals={}, category="Unknown")

    def _roa_positive(self, bs: pd.DataFrame, inc: pd.DataFrame) -> bool:
        """ROA > 0."""
        try:
            net_income = inc.get("net_income", pd.Series([np.nan]))
            total_assets = bs.get("total_assets", pd.Series([np.nan]))

            if len(net_income) < 1 or len(total_assets) < 1:
                return False

            roa = (
                net_income.iloc[0] / total_assets.iloc[0]
                if total_assets.iloc[0] != 0
                else np.nan
            )
            return roa > 0 if not pd.isna(roa) else False

        except Exception:
            return False

    def _cfo_positive(self, cf: pd.DataFrame) -> bool:
        """Operating Cash Flow > 0."""
        try:
            cfo = cf.get("cfo", pd.Series([np.nan]))

            if len(cfo) < 1:
                return False

            return cfo.iloc[0] > 0 if not pd.isna(cfo.iloc[0]) else False

        except Exception:
            return False

    def _delta_roa_positive(self, bs: pd.DataFrame, inc: pd.DataFrame) -> bool:
        """Change in ROA > 0."""
        try:
            net_income = inc.get("net_income", pd.Series([np.nan] * 2))
            total_assets = bs.get("total_assets", pd.Series([np.nan] * 2))

            if len(net_income) < 2 or len(total_assets) < 2:
                return False

            roa_t = (
                net_income.iloc[0] / total_assets.iloc[0]
                if total_assets.iloc[0] != 0
                else np.nan
            )
            roa_t1 = (
                net_income.iloc[1] / total_assets.iloc[1]
                if total_assets.iloc[1] != 0
                else np.nan
            )

            if pd.isna(roa_t) or pd.isna(roa_t1):
                return False

            return roa_t > roa_t1

        except Exception:
            return False

    def _accruals_quality(self, cf: pd.DataFrame, inc: pd.DataFrame) -> bool:
        """CFO > Net Income (quality of earnings)."""
        try:
            cfo = cf.get("cfo", pd.Series([np.nan]))
            net_income = inc.get("net_income", pd.Series([np.nan]))

            if len(cfo) < 1 or len(net_income) < 1:
                return False

            return (
                cfo.iloc[0] > net_income.iloc[0]
                if not pd.isna(cfo.iloc[0]) and not pd.isna(net_income.iloc[0])
                else False
            )

        except Exception:
            return False

    def _delta_leverage_negative(self, bs: pd.DataFrame) -> bool:
        """Change in Long-term Debt < 0."""
        try:
            ltd = bs.get("long_term_debt", pd.Series([0] * 2))

            if len(ltd) < 2:
                return False

            delta_ltd = ltd.iloc[0] - ltd.iloc[1]
            return delta_ltd < 0

        except Exception:
            return False

    def _delta_current_ratio_positive(self, bs: pd.DataFrame) -> bool:
        """Change in Current Ratio > 0."""
        try:
            current_assets = bs.get("current_assets", pd.Series([np.nan] * 2))
            current_liab = bs.get("current_liabilities", pd.Series([np.nan] * 2))

            if len(current_assets) < 2 or len(current_liab) < 2:
                return False

            cr_t = (
                current_assets.iloc[0] / current_liab.iloc[0]
                if current_liab.iloc[0] != 0
                else np.nan
            )
            cr_t1 = (
                current_assets.iloc[1] / current_liab.iloc[1]
                if current_liab.iloc[1] != 0
                else np.nan
            )

            if pd.isna(cr_t) or pd.isna(cr_t1):
                return False

            return cr_t > cr_t1

        except Exception:
            return False

    def _no_equity_issuance(self, bs: pd.DataFrame) -> bool:
        """No new equity issuance."""
        try:
            common_stock = bs.get("common_stock", pd.Series([np.nan] * 2))

            if len(common_stock) < 2:
                return True  # Default to True if data unavailable

            delta_shares = common_stock.iloc[0] - common_stock.iloc[1]
            return delta_shares <= 0

        except Exception:
            return True

    def _delta_gross_margin_positive(self, inc: pd.DataFrame) -> bool:
        """Change in Gross Margin > 0."""
        try:
            revenue = inc.get("revenue", pd.Series([np.nan] * 2))
            cogs = inc.get("cost_of_revenue", pd.Series([np.nan] * 2))

            if len(revenue) < 2 or len(cogs) < 2:
                return False

            gm_t = (
                (revenue.iloc[0] - cogs.iloc[0]) / revenue.iloc[0]
                if revenue.iloc[0] != 0
                else np.nan
            )
            gm_t1 = (
                (revenue.iloc[1] - cogs.iloc[1]) / revenue.iloc[1]
                if revenue.iloc[1] != 0
                else np.nan
            )

            if pd.isna(gm_t) or pd.isna(gm_t1):
                return False

            return gm_t > gm_t1

        except Exception:
            return False

    def _delta_asset_turnover_positive(
        self, bs: pd.DataFrame, inc: pd.DataFrame
    ) -> bool:
        """Change in Asset Turnover > 0."""
        try:
            revenue = inc.get("revenue", pd.Series([np.nan] * 2))
            total_assets = bs.get("total_assets", pd.Series([np.nan] * 2))

            if len(revenue) < 2 or len(total_assets) < 2:
                return False

            turnover_t = (
                revenue.iloc[0] / total_assets.iloc[0]
                if total_assets.iloc[0] != 0
                else np.nan
            )
            turnover_t1 = (
                revenue.iloc[1] / total_assets.iloc[1]
                if total_assets.iloc[1] != 0
                else np.nan
            )

            if pd.isna(turnover_t) or pd.isna(turnover_t1):
                return False

            return turnover_t > turnover_t1

        except Exception:
            return False


class AltmanZScore:
    """
    Calculate Altman Z-Score for bankruptcy prediction.

    Original Z-Score (for manufacturing firms):
    Z = 1.2*A + 1.4*B + 3.3*C + 0.6*D + 1.0*E

    Where:
    A = Working Capital / Total Assets
    B = Retained Earnings / Total Assets
    C = EBIT / Total Assets
    D = Market Value of Equity / Total Liabilities
    E = Sales / Total Assets

    Z-Score' (for service/non-manufacturing):
    Z' = 6.56*A + 3.26*B + 6.72*C + 1.05*D

    Zones:
    - Safe Zone: Z > 2.99
    - Grey Zone: 1.81 < Z < 2.99
    - Distress Zone: Z < 1.81
    """

    def __init__(self, financial_statements: Optional[FinancialStatements] = None):
        """
        Initialize AltmanZScore calculator.

        Args:
            financial_statements: FinancialStatements instance
        """
        self.fin_stmt = financial_statements or FinancialStatements()

    def calculate(self, ticker: str, manufacturing: bool = False) -> ZScoreResult:
        """
        Calculate Altman Z-Score.

        Args:
            ticker: Stock ticker symbol
            manufacturing: If True, use original manufacturing formula

        Returns:
            ZScoreResult with score and zone
        """
        try:
            # Get financial statements
            statements = self.fin_stmt.get_all_statements(ticker, periods=1)
            bs = statements["balance_sheet"].data
            inc = statements["income_statement"].data

            components = {}

            # A: Working Capital / Total Assets
            a = self._calculate_a(bs)
            components["working_capital_to_assets"] = a

            # B: Retained Earnings / Total Assets
            b = self._calculate_b(bs)
            components["retained_earnings_to_assets"] = b

            # C: EBIT / Total Assets
            c = self._calculate_c(bs, inc)
            components["ebit_to_assets"] = c

            # D: Market Value of Equity / Total Liabilities
            # Note: We'll use book value as proxy if market value unavailable
            d = self._calculate_d(bs)
            components["equity_to_liabilities"] = d

            # E: Sales / Total Assets (only for manufacturing)
            if manufacturing:
                e = self._calculate_e(bs, inc)
                components["sales_to_assets"] = e

            # Calculate Z-Score
            if manufacturing:
                z_score = 1.2 * a + 1.4 * b + 3.3 * c + 0.6 * d + 1.0 * e
            else:
                # Service firm formula
                z_score = 6.56 * a + 3.26 * b + 6.72 * c + 1.05 * d

            # Determine zone
            if z_score > 2.99:
                zone = "Safe"
            elif z_score > 1.81:
                zone = "Grey"
            else:
                zone = "Distress"

            return ZScoreResult(z_score=z_score, zone=zone, components=components)

        except Exception as e:
            logger.error(f"Failed to calculate Z-Score for {ticker}: {e}")
            return ZScoreResult(z_score=np.nan, zone="Unknown", components={})

    def _calculate_a(self, bs: pd.DataFrame) -> float:
        """Working Capital / Total Assets."""
        try:
            current_assets = bs.get("current_assets", pd.Series([np.nan]))
            current_liab = bs.get("current_liabilities", pd.Series([np.nan]))
            total_assets = bs.get("total_assets", pd.Series([np.nan]))

            if (
                len(current_assets) < 1
                or len(current_liab) < 1
                or len(total_assets) < 1
            ):
                return np.nan

            wc = current_assets.iloc[0] - current_liab.iloc[0]
            return wc / total_assets.iloc[0] if total_assets.iloc[0] != 0 else np.nan

        except Exception:
            return np.nan

    def _calculate_b(self, bs: pd.DataFrame) -> float:
        """Retained Earnings / Total Assets."""
        try:
            retained_earnings = bs.get("retained_earnings", pd.Series([np.nan]))
            total_assets = bs.get("total_assets", pd.Series([np.nan]))

            if len(retained_earnings) < 1 or len(total_assets) < 1:
                return np.nan

            return (
                retained_earnings.iloc[0] / total_assets.iloc[0]
                if total_assets.iloc[0] != 0
                else np.nan
            )

        except Exception:
            return np.nan

    def _calculate_c(self, bs: pd.DataFrame, inc: pd.DataFrame) -> float:
        """EBIT / Total Assets."""
        try:
            operating_income = inc.get("operating_income", pd.Series([np.nan]))
            total_assets = bs.get("total_assets", pd.Series([np.nan]))

            if len(operating_income) < 1 or len(total_assets) < 1:
                return np.nan

            return (
                operating_income.iloc[0] / total_assets.iloc[0]
                if total_assets.iloc[0] != 0
                else np.nan
            )

        except Exception:
            return np.nan

    def _calculate_d(self, bs: pd.DataFrame) -> float:
        """Market Value of Equity / Total Liabilities."""
        try:
            # Use book value of equity as proxy
            shareholders_equity = bs.get("shareholders_equity", pd.Series([np.nan]))
            total_liabilities = bs.get("total_liabilities", pd.Series([np.nan]))

            if len(shareholders_equity) < 1 or len(total_liabilities) < 1:
                return np.nan

            return (
                shareholders_equity.iloc[0] / total_liabilities.iloc[0]
                if total_liabilities.iloc[0] != 0
                else np.nan
            )

        except Exception:
            return np.nan

    def _calculate_e(self, bs: pd.DataFrame, inc: pd.DataFrame) -> float:
        """Sales / Total Assets."""
        try:
            revenue = inc.get("revenue", pd.Series([np.nan]))
            total_assets = bs.get("total_assets", pd.Series([np.nan]))

            if len(revenue) < 1 or len(total_assets) < 1:
                return np.nan

            return (
                revenue.iloc[0] / total_assets.iloc[0]
                if total_assets.iloc[0] != 0
                else np.nan
            )

        except Exception:
            return np.nan


class AccrualAnalyzer:
    """
    Analyze accrual quality using Sloan Accrual Ratio.

    Sloan Accrual Ratio = (Net Income - Cash Flow from Operations) / Total Assets

    High accruals (>10%) indicate lower earnings quality and potential
    future stock underperformance.
    """

    def __init__(self, financial_statements: Optional[FinancialStatements] = None):
        """
        Initialize AccrualAnalyzer.

        Args:
            financial_statements: FinancialStatements instance
        """
        self.fin_stmt = financial_statements or FinancialStatements()

    def calculate_accrual_ratio(self, ticker: str) -> float:
        """
        Calculate Sloan Accrual Ratio.

        Args:
            ticker: Stock ticker symbol

        Returns:
            Accrual ratio as decimal
        """
        try:
            statements = self.fin_stmt.get_all_statements(ticker, periods=1)
            bs = statements["balance_sheet"].data
            inc = statements["income_statement"].data
            cf = statements["cash_flow"].data

            net_income = inc.get("net_income", pd.Series([np.nan])).iloc[0]
            cfo = cf.get("cfo", pd.Series([np.nan])).iloc[0]
            total_assets = bs.get("total_assets", pd.Series([np.nan])).iloc[0]

            if (
                pd.isna(net_income)
                or pd.isna(cfo)
                or pd.isna(total_assets)
                or total_assets == 0
            ):
                return np.nan

            accruals = net_income - cfo
            ratio = accruals / total_assets

            return ratio

        except Exception as e:
            logger.error(f"Failed to calculate accrual ratio for {ticker}: {e}")
            return np.nan

    def calculate_cash_conversion(self, ticker: str) -> float:
        """
        Calculate cash conversion ratio (CFO / Net Income).

        Args:
            ticker: Stock ticker symbol

        Returns:
            Cash conversion ratio
        """
        try:
            statements = self.fin_stmt.get_all_statements(ticker, periods=1)
            inc = statements["income_statement"].data
            cf = statements["cash_flow"].data

            net_income = inc.get("net_income", pd.Series([np.nan])).iloc[0]
            cfo = cf.get("cfo", pd.Series([np.nan])).iloc[0]

            if pd.isna(net_income) or pd.isna(cfo) or net_income == 0:
                return np.nan

            return cfo / net_income

        except Exception as e:
            logger.error(f"Failed to calculate cash conversion for {ticker}: {e}")
            return np.nan


class EarningsQualityAnalyzer:
    """
    Comprehensive earnings quality analysis.

    Aggregates M-Score, F-Score, Z-Score, and accrual metrics
    into a single quality assessment with scoring and red flags.
    """

    def __init__(self, financial_statements: Optional[FinancialStatements] = None):
        """
        Initialize EarningsQualityAnalyzer.

        Args:
            financial_statements: FinancialStatements instance
        """
        self.fin_stmt = financial_statements or FinancialStatements()
        self.m_score_calc = BeneishMScore(self.fin_stmt)
        self.f_score_calc = PiotroskiFScore(self.fin_stmt)
        self.z_score_calc = AltmanZScore(self.fin_stmt)
        self.accrual_calc = AccrualAnalyzer(self.fin_stmt)

    def analyze(
        self, ticker: str, manufacturing: bool = False
    ) -> EarningsQualityResult:
        """
        Perform comprehensive earnings quality analysis.

        Args:
            ticker: Stock ticker symbol
            manufacturing: If True, use manufacturing Z-Score formula

        Returns:
            EarningsQualityResult with overall assessment
        """
        try:
            # Calculate all metrics
            m_score = self.m_score_calc.calculate(ticker)
            f_score = self.f_score_calc.calculate(ticker)
            z_score = self.z_score_calc.calculate(ticker, manufacturing)
            accrual_ratio = self.accrual_calc.calculate_accrual_ratio(ticker)
            cash_conversion = self.accrual_calc.calculate_cash_conversion(ticker)

            # Calculate earnings persistence (standard deviation of ROA)
            earnings_persistence = self._calculate_earnings_persistence(ticker)

            # Identify red flags
            red_flags = self._identify_red_flags(
                m_score, f_score, z_score, accrual_ratio, cash_conversion
            )

            # Calculate overall score (0-100)
            overall_score = self._calculate_overall_score(
                m_score, f_score, z_score, accrual_ratio, cash_conversion
            )

            # Determine overall rating
            overall_rating = self._determine_overall_rating(overall_score, red_flags)

            return EarningsQualityResult(
                overall_rating=overall_rating,
                overall_score=overall_score,
                m_score=m_score,
                f_score=f_score,
                z_score=z_score,
                accrual_ratio=accrual_ratio,
                cash_conversion=cash_conversion,
                earnings_persistence=earnings_persistence,
                red_flags=red_flags,
            )

        except Exception as e:
            logger.error(f"Failed to analyze earnings quality for {ticker}: {e}")
            return EarningsQualityResult(
                overall_rating=QualityRating.FAIR,
                overall_score=50.0,
                m_score=None,
                f_score=None,
                z_score=None,
                accrual_ratio=None,
                cash_conversion=None,
                earnings_persistence=None,
                red_flags=["Analysis failed"],
            )

    def _calculate_earnings_persistence(self, ticker: str) -> float:
        """Calculate earnings persistence (inverse of ROA volatility)."""
        try:
            statements = self.fin_stmt.get_all_statements(ticker, periods=4)
            bs = statements["balance_sheet"].data
            inc = statements["income_statement"].data

            net_income = inc.get("net_income", pd.Series([np.nan] * 4))
            total_assets = bs.get("total_assets", pd.Series([np.nan] * 4))

            if len(net_income) < 4 or len(total_assets) < 4:
                return np.nan

            # Calculate ROA for each period
            roa = net_income / total_assets.replace(0, np.nan)

            # Lower std = higher persistence
            std = roa.std()
            if pd.isna(std) or std == 0:
                return np.nan

            # Normalize to 0-1 (lower std = higher score)
            persistence = 1 / (1 + std)
            return persistence

        except Exception as e:
            logger.warning(f"Failed to calculate earnings persistence: {e}")
            return np.nan

    def _identify_red_flags(
        self,
        m_score: MScoreResult,
        f_score: FScoreResult,
        z_score: ZScoreResult,
        accrual_ratio: Optional[float],
        cash_conversion: Optional[float],
    ) -> List[str]:
        """Identify red flags based on metrics."""
        red_flags = []

        # M-Score red flags
        if m_score.is_likely_manipulator:
            red_flags.append(
                f"M-Score indicates potential manipulation ({m_score.m_score:.2f})"
            )

        # F-Score red flags
        if f_score.f_score < 4:
            red_flags.append(f"Weak Piotroski F-Score ({f_score.f_score}/9)")

        # Z-Score red flags
        if z_score.zone == "Distress":
            red_flags.append(f"Z-Score in distress zone ({z_score.z_score:.2f})")

        # Accrual red flags
        if accrual_ratio and not pd.isna(accrual_ratio):
            if abs(accrual_ratio) > 0.10:
                red_flags.append(f"High accruals ({accrual_ratio:.1%})")

        # Cash conversion red flags
        if cash_conversion and not pd.isna(cash_conversion):
            if cash_conversion < 0.8:
                red_flags.append(f"Low cash conversion ({cash_conversion:.1%})")

        return red_flags

    def _calculate_overall_score(
        self,
        m_score: MScoreResult,
        f_score: FScoreResult,
        z_score: ZScoreResult,
        accrual_ratio: Optional[float],
        cash_conversion: Optional[float],
    ) -> float:
        """
        Calculate overall quality score (0-100).

        Weights:
        - M-Score: 25%
        - F-Score: 20%
        - Z-Score: 15%
        - Accruals: 20%
        - Cash Conversion: 20%
        """
        total_score = 0.0
        total_weight = 0.0

        # M-Score (25%)
        # Convert to 0-100 scale (lower is better)
        if not pd.isna(m_score.m_score):
            # -3.0 = 100, -1.78 = 50, 0 = 0
            m_normalized = max(0, min(100, ((-3.0 - m_score.m_score) / 1.22) * 50 + 50))
            total_score += m_normalized * 0.25
            total_weight += 0.25

        # F-Score (20%)
        # 9 = 100, 0 = 0
        f_normalized = (f_score.f_score / 9.0) * 100
        total_score += f_normalized * 0.20
        total_weight += 0.20

        # Z-Score (15%)
        # 3.0+ = 100, 1.81-3.0 = 50, <1.81 = 0
        if not pd.isna(z_score.z_score):
            if z_score.z_score > 2.99:
                z_normalized = 100
            elif z_score.z_score > 1.81:
                z_normalized = 50
            else:
                z_normalized = max(0, (z_score.z_score / 1.81) * 50)
            total_score += z_normalized * 0.15
            total_weight += 0.15

        # Accruals (20%)
        if accrual_ratio and not pd.isna(accrual_ratio):
            # Lower absolute accruals = better
            # 0% = 100, 10%+ = 0
            accrual_normalized = max(0, min(100, (1 - abs(accrual_ratio) / 0.10) * 100))
            total_score += accrual_normalized * 0.20
            total_weight += 0.20

        # Cash Conversion (20%)
        if cash_conversion and not pd.isna(cash_conversion):
            # 1.0+ = 100, 0.8 = 50, <0 = 0
            if cash_conversion >= 1.0:
                conv_normalized = 100
            elif cash_conversion >= 0.8:
                conv_normalized = 50 + (cash_conversion - 0.8) * 250
            else:
                conv_normalized = max(0, (cash_conversion / 0.8) * 50)
            total_score += conv_normalized * 0.20
            total_weight += 0.20

        if total_weight == 0:
            return 50.0  # Default to neutral

        return total_score / total_weight

    def _determine_overall_rating(
        self, overall_score: float, red_flags: List[str]
    ) -> QualityRating:
        """Determine overall quality rating."""
        # Downgrade if critical red flags
        if len(red_flags) >= 4:
            return QualityRating.CRITICAL

        if overall_score >= 80:
            return (
                QualityRating.EXCELLENT if len(red_flags) == 0 else QualityRating.GOOD
            )
        elif overall_score >= 60:
            return QualityRating.GOOD if len(red_flags) <= 1 else QualityRating.FAIR
        elif overall_score >= 40:
            return QualityRating.FAIR
        elif overall_score >= 20:
            return QualityRating.POOR
        else:
            return QualityRating.CRITICAL
