from edgar import Company
from collections import defaultdict

# Get Apple facts
aapl = Company("AAPL")
facts = aapl.facts
raw_facts = facts._facts

print("Analyzing period durations for FY facts:\n")

# Group facts by (fiscal_year, fiscal_period, period_end)
fact_groups = defaultdict(list)
for fact in raw_facts:
    if fact.statement_type == 'IncomeStatement' and fact.fiscal_period == 'FY':
        if fact.fiscal_year and fact.fiscal_year >= 2019 and fact.fiscal_year <= 2021:
            if 'RevenueFromContract' in str(fact.concept) and 'Liability' not in str(fact.concept):
                key = (fact.fiscal_year, fact.fiscal_period, fact.period_end)
                fact_groups[key].append(fact)

# Analyze each group
for key in sorted(fact_groups.keys()):
    year, period, end_date = key
    facts_in_group = fact_groups[key]
    
    if len(facts_in_group) > 1:
        print(f"\nFY {year} ending {end_date}: {len(facts_in_group)} facts")
        for fact in facts_in_group:
            duration = None
            if fact.period_start and fact.period_end:
                duration = (fact.period_end - fact.period_start).days
            
            period_type = "Annual" if duration and duration > 300 else "Quarterly" if duration else "Unknown"
            print(f"  ${fact.value:,.0f} - Duration: {duration} days ({period_type})")
            print(f"    Period: {fact.period_start} to {fact.period_end}")
            print(f"    Filed: {fact.filing_date}")
            if hasattr(fact, 'form'):
                print(f"    Form: {fact.form}")
            if hasattr(fact, 'accession'):
                print(f"    Accession: {fact.accession}")

print("\n\nSummary:")
print("The issue: Both annual and quarterly revenue are marked as 'FY'")
print("Solution: Use period duration to distinguish:")
print("  - Annual: period_start to period_end > 300 days")
print("  - Quarterly: period_start to period_end < 100 days")