from edgar import Company
from collections import defaultdict

# Get Apple facts
aapl = Company("AAPL")
facts = aapl.facts
raw_facts = facts._facts

# Check all FY income statement facts for 2019-2024
print("Checking FY facts and their period_end dates:\n")
print("fiscal_year | fiscal_period | period_end | period_end.year | Match?")
print("-" * 70)

fy_facts = defaultdict(list)
for fact in raw_facts:
    if fact.statement_type == 'IncomeStatement' and fact.fiscal_period == 'FY':
        if fact.fiscal_year and fact.fiscal_year >= 2019:
            fy_facts[fact.fiscal_year].append(fact)

# Show all FY entries grouped by fiscal_year
for year in sorted(fy_facts.keys(), reverse=True):
    facts_for_year = fy_facts[year]
    # Get unique period_end dates for this fiscal year
    unique_ends = set()
    for fact in facts_for_year:
        if fact.period_end:
            unique_ends.add(fact.period_end)
    
    print(f"\nFY {year} has {len(unique_ends)} unique period_end dates:")
    for end_date in sorted(unique_ends):
        if end_date:
            match = "✓" if end_date.year == year else "✗"
            print(f"  {year:4d} | FY | {end_date} | {end_date.year} | {match}")

# Now check if we have the correct matches
print("\n\nChecking if we have correct year matches:")
correct_matches = defaultdict(set)
for fact in raw_facts:
    if fact.statement_type == 'IncomeStatement' and fact.fiscal_period == 'FY':
        if fact.period_end and fact.fiscal_year:
            if fact.period_end.year == fact.fiscal_year:
                correct_matches[fact.fiscal_year].add(fact.period_end)

print("\nFiscal years with matching period_end.year:")
for year in sorted(correct_matches.keys(), reverse=True)[:6]:
    for end_date in correct_matches[year]:
        print(f"  FY {year} -> {end_date} ✓")

# Check revenue values for correct matches
print("\n\nRevenue values for CORRECT year matches:")
for fact in raw_facts:
    if fact.statement_type == 'IncomeStatement' and fact.fiscal_period == 'FY':
        if fact.period_end and fact.fiscal_year:
            if fact.period_end.year == fact.fiscal_year:
                if 'RevenueFromContract' in str(fact.concept) and 'Liability' not in str(fact.concept):
                    if fact.fiscal_year >= 2019 and fact.fiscal_year <= 2024:
                        print(f"  FY {fact.fiscal_year} (ends {fact.period_end}): ${fact.value:,.0f}")