"""
Verify the fiscal year pattern across companies
"""

from edgar import Company

def check_fiscal_year_pattern(ticker, name):
    """Check the relationship between fiscal_year and period_end.year"""
    print(f"\n{name} ({ticker}):")
    print("-" * 40)
    
    try:
        company = Company(ticker)
        facts = company.facts._facts
        
        # Collect FY facts with revenue
        fy_facts = []
        for fact in facts:
            if fact.statement_type == 'IncomeStatement' and fact.fiscal_period == 'FY':
                if fact.fiscal_year and fact.fiscal_year >= 2019 and fact.fiscal_year <= 2024:
                    if 'Revenue' in str(fact.concept):
                        if fact.period_start and fact.period_end:
                            duration = (fact.period_end - fact.period_start).days
                            if duration > 300 and duration < 400:  # Annual only
                                fy_facts.append({
                                    'fiscal_year': fact.fiscal_year,
                                    'period_end': fact.period_end,
                                    'period_end_year': fact.period_end.year,
                                    'difference': fact.fiscal_year - fact.period_end.year
                                })
        
        # Deduplicate and sort
        unique_facts = {}
        for f in fy_facts:
            key = (f['fiscal_year'], f['period_end'])
            unique_facts[key] = f
        
        # Analyze the pattern
        differences = set()
        for f in unique_facts.values():
            differences.add(f['difference'])
            
        print(f"  Fiscal Year vs Period End Year differences: {sorted(differences)}")
        
        # Show examples
        print("\n  Examples:")
        for f in sorted(unique_facts.values(), key=lambda x: x['fiscal_year'], reverse=True)[:5]:
            print(f"    FY {f['fiscal_year']} → ends {f['period_end']} (diff: {f['difference']} years)")
            
        # What's the consistent pattern?
        if len(differences) == 1:
            diff = list(differences)[0]
            print(f"\n  ✓ Consistent pattern: fiscal_year = period_end.year + {diff}")
        else:
            print(f"\n  ⚠️  Multiple patterns found: {differences}")
            
        return differences
        
    except Exception as e:
        print(f"  Error: {e}")
        return set()

# Test various companies
companies = [
    ('AAPL', 'Apple (Sept year-end)'),
    ('MSFT', 'Microsoft (June year-end)'),
    ('WMT', 'Walmart (Jan year-end)'),
    ('AMZN', 'Amazon (Dec year-end)'),
    ('JNJ', 'J&J (Dec year-end)'),
    ('TSLA', 'Tesla (Dec year-end)'),
]

all_differences = set()
for ticker, name in companies:
    diffs = check_fiscal_year_pattern(ticker, name)
    all_differences.update(diffs)

print("\n" + "="*60)
print("CONCLUSION")
print("="*60)

if len(all_differences) == 1:
    diff = list(all_differences)[0]
    print(f"\n✓ ALL companies show the same pattern:")
    print(f"  fiscal_year = period_end.year + {diff}")
    print("\nThis appears to be how the SEC Facts API structures the data!")
    print("The 'fiscal_year' field indicates when the data was filed/reported,")
    print("not the actual year of the fiscal period.")
else:
    print(f"\n⚠️  Different companies show different patterns: {all_differences}")
    print("The most common pattern seems to be a 2-year difference.")
    
print("\nIMPLICATION FOR OUR FIX:")
print("We should NOT require fiscal_year == period_end.year")
print("Instead, we should:")
print("1. Use duration (>300 days) as the primary filter")
print("2. Match facts where fiscal_year is within 0-3 years of period_end.year")
print("3. Deduplicate by keeping the latest period_end for each actual year")