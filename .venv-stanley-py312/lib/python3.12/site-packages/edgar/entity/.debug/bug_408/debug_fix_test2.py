from edgar import Company
from edgar.entity.enhanced_statement import EnhancedStatementBuilder
from collections import defaultdict

# Get Apple facts
aapl = Company("AAPL")
facts = aapl.facts
raw_facts = facts._facts

# Build statement manually to debug
builder = EnhancedStatementBuilder()
stmt_facts = [f for f in raw_facts if f.statement_type == 'IncomeStatement']

# Build period info
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

# Apply the fix logic
period_list = [(pk, info) for pk, info in period_info.items()]
annual_periods = [(pk, info) for pk, info in period_list if info['is_annual']]

print(f"Total annual periods: {len(annual_periods)}")

# Apply the matching logic
correct_annual_periods = {}
for pk, info in annual_periods:
    fiscal_year = pk[0]
    if info['end_date'] and info['end_date'].year == fiscal_year:
        if fiscal_year not in correct_annual_periods or \
           info['end_date'] > correct_annual_periods[fiscal_year][1]['end_date']:
            correct_annual_periods[fiscal_year] = (pk, info)
            print(f"  Selected FY {fiscal_year}: ends {info['end_date']}")

print(f"\nCorrect annual periods found: {len(correct_annual_periods)}")

# Sort and select
sorted_periods = sorted(correct_annual_periods.items(), key=lambda x: x[0], reverse=True)
selected_period_info = [period_info for year, period_info in sorted_periods[:6]]

print(f"\nSelected {len(selected_period_info)} periods:")
for (year, period), info in selected_period_info:
    print(f"  {info['label']}")
    
# Check what revenue facts we have for these periods
print("\nRevenue facts for selected periods:")
for (year, fp), info in selected_period_info:
    period_label = info['label']
    revenue_found = False
    for fact in period_facts_map[period_label]:
        if 'RevenueFromContract' in str(fact.concept) and 'Liability' not in str(fact.concept):
            print(f"  {period_label}: ${fact.value:,.0f}")
            revenue_found = True
            break
    if not revenue_found:
        print(f"  {period_label}: No revenue found")