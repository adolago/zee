"""
Test our duration-based solution across different companies to identify edge cases
"""

from edgar import Company
from collections import defaultdict
import sys

def analyze_company_periods(ticker, company_name):
    """Analyze period durations for a company"""
    print(f"\n{'='*60}")
    print(f"Analyzing {company_name} ({ticker})")
    print('='*60)
    
    try:
        company = Company(ticker)
        facts = company.facts
        raw_facts = facts._facts
        
        # Find FY facts with different durations
        fy_facts_by_duration = defaultdict(list)
        
        for fact in raw_facts:
            if fact.statement_type == 'IncomeStatement' and fact.fiscal_period == 'FY':
                if fact.fiscal_year and fact.fiscal_year >= 2019:
                    # Check for revenue facts
                    if 'Revenue' in str(fact.concept):
                        duration = None
                        if fact.period_start and fact.period_end:
                            duration = (fact.period_end - fact.period_start).days
                            duration_bucket = "No duration"
                            if duration:
                                if duration < 100:
                                    duration_bucket = f"Quarterly (~{duration} days)"
                                elif duration > 300 and duration < 400:
                                    duration_bucket = f"Annual (~{duration} days)"
                                elif duration > 180 and duration < 200:
                                    duration_bucket = f"Semi-annual (~{duration} days)"
                                elif duration > 700:
                                    duration_bucket = f"Multi-year (~{duration} days)"
                                else:
                                    duration_bucket = f"Other ({duration} days)"
                            
                            fy_facts_by_duration[duration_bucket].append({
                                'year': fact.fiscal_year,
                                'value': fact.value,
                                'duration': duration,
                                'period_end': fact.period_end
                            })
        
        # Report findings
        for bucket in sorted(fy_facts_by_duration.keys()):
            facts_list = fy_facts_by_duration[bucket]
            print(f"\n{bucket}: {len(facts_list)} facts")
            # Show a few examples
            for fact in facts_list[:3]:
                print(f"  FY {fact['year']}: ${fact['value']:,.0f}")
                
        return fy_facts_by_duration
        
    except Exception as e:
        print(f"  Error: {e}")
        return None

# Test various types of companies
test_companies = [
    ('AAPL', 'Apple - Tech Giant'),
    ('MSFT', 'Microsoft - Different fiscal year end'),
    ('WMT', 'Walmart - Retail with Jan year end'),
    ('BAC', 'Bank of America - Financial institution'),
    ('JNJ', 'Johnson & Johnson - Healthcare'),
    ('TSLA', 'Tesla - Newer company'),
    ('AMZN', 'Amazon - E-commerce'),
    ('XOM', 'Exxon - Energy sector'),
]

# Analyze each company
results = {}
for ticker, name in test_companies:
    result = analyze_company_periods(ticker, name)
    if result:
        results[ticker] = result

# Summary of potential issues
print("\n" + "="*60)
print("POTENTIAL ISSUES WITH OUR SOLUTION")
print("="*60)

print("\n1. DURATION THRESHOLD (>300 days):")
print("   Our fix assumes annual = >300 days")
print("   Potential issues:")

# Check for edge cases around 300 days
for ticker in results:
    for bucket in results[ticker]:
        if "Other" in bucket or "Semi-annual" in bucket:
            print(f"   - {ticker} has unusual duration: {bucket}")

print("\n2. NO DURATION DATA:")
print("   Some facts might not have period_start")
for ticker in results:
    if "No duration" in results[ticker]:
        count = len(results[ticker]["No duration"])
        print(f"   - {ticker}: {count} facts without duration")

print("\n3. FISCAL YEAR VARIATIONS:")
print("   Companies have different fiscal year ends:")
fiscal_year_ends = {
    'AAPL': 'September',
    'MSFT': 'June', 
    'WMT': 'January',
    'BAC': 'December',
    'JNJ': 'December',
    'TSLA': 'December',
    'AMZN': 'December',
    'XOM': 'December'
}
for ticker, month in fiscal_year_ends.items():
    print(f"   - {ticker}: Fiscal year ends in {month}")

print("\n4. MULTI-YEAR FACTS:")
print("   Some companies might report multi-year aggregates")
for ticker in results:
    if "Multi-year" in results[ticker]:
        count = len(results[ticker]["Multi-year"])
        print(f"   - {ticker}: {count} multi-year facts found")

print("\nRECOMMENDATIONS:")
print("1. The 300-day threshold works for most companies")
print("2. Consider 350-380 days as 'normal' annual range")
print("3. Handle edge cases:")
print("   - No duration: Could check fiscal_period or use other heuristics")
print("   - Multi-year: Filter out (duration > 400)")
print("   - Semi-annual: Rare but should be filtered for annual=True")