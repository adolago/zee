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

# Build period info with new key structure
period_info = {}
period_facts = defaultdict(list)

for fact in stmt_facts:
    period_key = (fact.fiscal_year, fact.fiscal_period, fact.period_end)
    
    if period_key not in period_info:
        period_info[period_key] = {
            'label': f"{fact.fiscal_period} {fact.fiscal_year}",
            'end_date': fact.period_end,
            'is_annual': fact.fiscal_period == 'FY',
            'filing_date': fact.filing_date,
            'fiscal_year': fact.fiscal_year,
            'fiscal_period': fact.fiscal_period
        }
    
    period_facts[period_key].append(fact)

# Apply the annual filtering logic
period_list = [(pk, info) for pk, info in period_info.items()]

true_annual_periods = []
for pk, info in period_list:
    if not info['is_annual']:
        continue
    
    fiscal_year = pk[0]
    period_end_date = pk[2]
    
    # Check if fiscal_year matches period_end.year
    if not (period_end_date and period_end_date.year == fiscal_year):
        continue
    
    # Check duration
    period_fact_list = period_facts.get(pk, [])
    if period_fact_list:
        sample_fact = period_fact_list[0]
        if sample_fact.period_start and sample_fact.period_end:
            duration = (sample_fact.period_end - sample_fact.period_start).days
            if duration > 300:
                true_annual_periods.append((pk, info))
                # Find revenue for this period
                for fact in period_fact_list:
                    if 'RevenueFromContract' in str(fact.concept) and 'Liability' not in str(fact.concept):
                        print(f"Selected: FY {fiscal_year} ends {period_end_date}: ${fact.value:,.0f} (duration: {duration} days)")
                        break

print(f"\nTotal true annual periods found: {len(true_annual_periods)}")

# Check what's in the final selection
annual_by_year = {}
for pk, info in true_annual_periods:
    fiscal_year = pk[0]
    period_end_date = pk[2]
    if fiscal_year not in annual_by_year or period_end_date > annual_by_year[fiscal_year][0][2]:
        annual_by_year[fiscal_year] = (pk, info)

sorted_periods = sorted(annual_by_year.items(), key=lambda x: x[0], reverse=True)
selected = [period_info for year, period_info in sorted_periods[:6]]

print(f"\nFinal selected periods:")
for (year, period, end), info in selected:
    print(f"  FY {year} ends {end}")
    # Find revenue for this period
    for fact in period_facts[(year, period, end)]:
        if 'RevenueFromContract' in str(fact.concept) and 'Liability' not in str(fact.concept):
            duration = (fact.period_end - fact.period_start).days if fact.period_start else None
            print(f"    Revenue: ${fact.value:,.0f} (duration: {duration} days)")
            break