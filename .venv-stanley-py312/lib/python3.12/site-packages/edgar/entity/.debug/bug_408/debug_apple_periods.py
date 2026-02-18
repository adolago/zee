from edgar import Company
from collections import defaultdict
import json

# Get Apple facts
aapl = Company("AAPL")
facts = aapl.facts

# Get raw facts data - access internal facts list
raw_facts = facts._facts  # Access internal facts list

# Look for Revenue facts in 2020 and 2019
revenue_facts = []
for fact in raw_facts:
    if fact.concept and 'Revenue' in fact.concept:
        if fact.fiscal_year in [2019, 2020]:
            revenue_facts.append({
                'concept': fact.concept,
                'value': fact.value,
                'fy': fact.fiscal_year,
                'fp': fact.fiscal_period,
                'period_end': str(fact.period_end) if fact.period_end else None,
                'period_duration': getattr(fact, 'period_duration', None),
                'statement': fact.statement_type,
                'filing_date': str(fact.filing_date) if fact.filing_date else None
            })

print("Revenue facts for 2019-2020:")
print(json.dumps(revenue_facts, indent=2, default=str))

# Group by fiscal year and period
by_year_period = defaultdict(list)
for fact in revenue_facts:
    key = f"{fact['fy']}-{fact['fp']}"
    by_year_period[key].append(fact)
    
print("\n\nGrouped by fiscal year and period:")
for key in sorted(by_year_period.keys()):
    print(f"\n{key}:")
    for fact in by_year_period[key]:
        print(f"  {fact['concept']}: ${fact['value']:,} (duration: {fact['period_duration']} days)")
        
# Now check what the income statement method returns
print("\n\nIncome statement for 2019-2020 (annual=True):")
income = facts.income_statement(annual=True, periods=6)
print(income)