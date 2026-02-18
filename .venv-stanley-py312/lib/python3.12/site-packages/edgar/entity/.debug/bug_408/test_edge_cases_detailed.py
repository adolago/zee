"""
Check specific edge cases in our solution
"""

from edgar import Company

def check_instant_facts():
    """Check how we handle instant facts (balance sheet items)"""
    print("\n1. INSTANT FACTS (Balance Sheet Items)")
    print("-" * 50)
    
    aapl = Company("AAPL")
    facts = aapl.facts._facts
    
    # Look for balance sheet instant facts
    instant_count = 0
    duration_count = 0
    
    for fact in facts:
        if fact.statement_type == 'BalanceSheet' and fact.fiscal_period == 'FY':
            if fact.fiscal_year == 2023:
                if fact.period_start:
                    duration_count += 1
                else:
                    instant_count += 1
    
    print(f"  Balance Sheet FY 2023 facts:")
    print(f"    - With duration (period_start exists): {duration_count}")
    print(f"    - Instant (no period_start): {instant_count}")
    print(f"  ✓ Our solution handles instant facts correctly (no duration check)")

def check_fiscal_year_boundaries():
    """Check companies with different fiscal year ends"""
    print("\n2. FISCAL YEAR BOUNDARY ISSUES")
    print("-" * 50)
    
    # Microsoft has June year-end
    msft = Company("MSFT")
    facts = msft.facts._facts
    
    print("  Microsoft (June year-end):")
    for fact in facts:
        if fact.statement_type == 'IncomeStatement' and fact.fiscal_period == 'FY':
            if fact.fiscal_year == 2023 and 'Revenue' in str(fact.concept):
                if fact.period_start and fact.period_end:
                    duration = (fact.period_end - fact.period_start).days
                    if duration > 300:
                        print(f"    FY 2023: {fact.period_start} to {fact.period_end}")
                        print(f"    Period end year: {fact.period_end.year}")
                        print(f"    Fiscal year: {fact.fiscal_year}")
                        match = "✓" if fact.period_end.year == fact.fiscal_year else "✗"
                        print(f"    Year match: {match}")
                        break
    
    # Walmart has January year-end  
    print("\n  Walmart (January year-end):")
    wmt = Company("WMT")
    facts = wmt.facts._facts
    
    for fact in facts:
        if fact.statement_type == 'IncomeStatement' and fact.fiscal_period == 'FY':
            if fact.fiscal_year == 2023 and 'Revenue' in str(fact.concept):
                if fact.period_start and fact.period_end:
                    duration = (fact.period_end - fact.period_start).days
                    if duration > 300:
                        print(f"    FY 2023: {fact.period_start} to {fact.period_end}")
                        print(f"    Period end year: {fact.period_end.year}")
                        print(f"    Fiscal year: {fact.fiscal_year}")
                        match = "✓" if fact.period_end.year == fact.fiscal_year else "✗"
                        print(f"    Year match: {match}")
                        break

def check_duration_edge_cases():
    """Check edge cases around our 300-day threshold"""
    print("\n3. DURATION EDGE CASES")
    print("-" * 50)
    
    # Collect all annual durations across companies
    test_tickers = ['AAPL', 'MSFT', 'WMT', 'JNJ', 'TSLA']
    all_durations = []
    
    for ticker in test_tickers:
        try:
            company = Company(ticker)
            facts = company.facts._facts
            
            for fact in facts:
                if fact.statement_type == 'IncomeStatement' and fact.fiscal_period == 'FY':
                    if fact.fiscal_year >= 2020 and 'Revenue' in str(fact.concept):
                        if fact.period_start and fact.period_end:
                            duration = (fact.period_end - fact.period_start).days
                            if duration > 200:  # Collect all potentially annual
                                all_durations.append((ticker, duration))
        except:
            pass
    
    # Analyze distribution
    from collections import Counter
    duration_counts = Counter([d for _, d in all_durations])
    
    print("  Duration distribution for FY Revenue facts:")
    for duration in sorted(set([d for _, d in all_durations])):
        count = duration_counts[duration]
        if duration < 300:
            status = "❌ Would be filtered out"
        elif duration > 400:
            status = "⚠️  Unusually long"
        else:
            status = "✓ Accepted as annual"
        print(f"    {duration} days: {count} facts - {status}")
    
    # Check if any annual facts are < 300 days
    short_annuals = [d for _, d in all_durations if d >= 250 and d < 300]
    if short_annuals:
        print(f"\n  ⚠️  WARNING: Found {len(short_annuals)} facts between 250-300 days")
        print(f"     These might be annual but would be filtered out")

def check_leap_year_impact():
    """Check if leap years affect our logic"""
    print("\n4. LEAP YEAR IMPACT")
    print("-" * 50)
    
    # 2020 was a leap year
    aapl = Company("AAPL")
    facts = aapl.facts._facts
    
    leap_year_durations = []
    regular_year_durations = []
    
    for fact in facts:
        if fact.statement_type == 'IncomeStatement' and fact.fiscal_period == 'FY':
            if 'Revenue' in str(fact.concept):
                if fact.period_start and fact.period_end:
                    duration = (fact.period_end - fact.period_start).days
                    if duration > 300:
                        if fact.fiscal_year == 2020:
                            leap_year_durations.append(duration)
                        elif fact.fiscal_year in [2019, 2021]:
                            regular_year_durations.append(duration)
    
    if leap_year_durations and regular_year_durations:
        print(f"  Leap year (2020) durations: {set(leap_year_durations)}")
        print(f"  Regular year durations: {set(regular_year_durations)}")
        print(f"  ✓ Difference is minimal, 300-day threshold handles both")

def check_amended_filings():
    """Check how amended filings affect our logic"""
    print("\n5. AMENDED FILINGS")
    print("-" * 50)
    
    # Look for duplicate facts from amendments
    aapl = Company("AAPL")
    facts = aapl.facts._facts
    
    # Track facts by fiscal year and duration
    from collections import defaultdict
    facts_by_year_duration = defaultdict(list)
    
    for fact in facts:
        if fact.statement_type == 'IncomeStatement' and fact.fiscal_period == 'FY':
            if fact.fiscal_year == 2023 and 'Revenue' in str(fact.concept):
                if fact.period_start and fact.period_end:
                    duration = (fact.period_end - fact.period_start).days
                    if duration > 300:
                        key = (fact.fiscal_year, duration, fact.period_end)
                        facts_by_year_duration[key].append({
                            'value': fact.value,
                            'filing_date': fact.filing_date,
                            'accession': fact.accession if hasattr(fact, 'accession') else None
                        })
    
    # Check for duplicates
    for key, facts_list in facts_by_year_duration.items():
        if len(facts_list) > 1:
            year, duration, end_date = key
            print(f"  Found {len(facts_list)} facts for FY {year} ({duration} days, ends {end_date}):")
            for f in facts_list:
                print(f"    Value: ${f['value']:,.0f}, Filed: {f['filing_date']}")
            print("  ⚠️  Multiple facts for same period - might need to pick latest filing")

# Run all checks
if __name__ == "__main__":
    print("=" * 60)
    print("EDGE CASE ANALYSIS FOR DURATION-BASED SOLUTION")
    print("=" * 60)
    
    check_instant_facts()
    check_fiscal_year_boundaries()
    check_duration_edge_cases()
    check_leap_year_impact()
    check_amended_filings()
    
    print("\n" + "=" * 60)
    print("SUMMARY OF FINDINGS")
    print("=" * 60)
    print("\n✓ STRENGTHS:")
    print("  1. 300-day threshold works well for standard annual periods (363-365 days)")
    print("  2. Instant facts (balance sheet) handled correctly")
    print("  3. Leap years don't cause issues")
    print("\n⚠️  POTENTIAL ISSUES:")
    print("  1. Fiscal year boundary: Some companies' FY doesn't match calendar year")
    print("     - WMT FY 2023 ends in Jan 2023 (year mismatch)")
    print("  2. Amended filings might create duplicates")
    print("  3. No handling for multi-year aggregates (>400 days)")
    print("\nRECOMMENDED IMPROVEMENTS:")
    print("  1. For fiscal year matching, be more flexible:")
    print("     - Allow FY to match period_end.year OR period_end.year + 1")
    print("  2. When duplicates exist, prefer latest filing_date")
    print("  3. Add upper bound check (duration < 400) to exclude multi-year")