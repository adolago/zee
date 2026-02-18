from edgar import Company
from edgar.entity.enhanced_statement import EnhancedStatementBuilder

# Get Apple facts
aapl = Company("AAPL")
facts = aapl.facts
raw_facts = facts._facts

# Build statement manually to debug
builder = EnhancedStatementBuilder()
stmt_facts = [f for f in raw_facts if f.statement_type == 'IncomeStatement']

# Build period info
from collections import defaultdict
period_info = {}
period_facts_map = defaultdict(list)

for fact in stmt_facts:
    period_key = (fact.fiscal_year, fact.fiscal_period)
    period_label = f"{fact.fiscal_period} {fact.fiscal_year}"
    
    period_facts_map[period_label].append(fact)
    
    if period_key not in period_info:
        period_info[period_key] = {
            'label': period_label,
            'end_date': fact.period_end,
            'is_annual': fact.fiscal_period == 'FY',
            'filing_date': fact.filing_date,
            'fiscal_year': fact.fiscal_year,
            'fiscal_period': fact.fiscal_period
        }

# Create list of periods
period_list = [(pk, info) for pk, info in period_info.items()]

# Filter for annual
annual_periods = [(pk, info) for pk, info in period_list if info['is_annual']]
print(f"Total annual periods before sort: {len(annual_periods)}")

# Sort by end_date
annual_periods.sort(key=lambda x: x[1]['end_date'], reverse=True)

print("\nFirst 10 annual periods after sorting by end_date:")
for i, ((year, period), info) in enumerate(annual_periods[:10]):
    print(f"  {i}: FY {year} - ends {info['end_date']}")

# Deduplicate by fiscal year
seen_years = set()
unique_annual_periods = []
for pk, info in annual_periods:
    fiscal_year = pk[0]
    if fiscal_year not in seen_years:
        seen_years.add(fiscal_year)
        unique_annual_periods.append((pk, info))
        print(f"  Keeping: FY {fiscal_year} ending {info['end_date']}")

print(f"\nUnique annual periods: {len(unique_annual_periods)}")
print("\nFirst 6 unique periods:")
for (year, period), info in unique_annual_periods[:6]:
    print(f"  FY {year} - ends {info['end_date']}")

# Check what revenue value we have for those periods
print("\nRevenue values for selected periods:")
for (year, fp), info in unique_annual_periods[:6]:
    period_label = info['label']
    # Find revenue fact for this period
    for fact in period_facts_map[period_label]:
        if 'RevenueFromContract' in str(fact.concept) and 'Liability' not in str(fact.concept):
            print(f"  {period_label}: {fact.concept} = ${fact.value:,}")
            break