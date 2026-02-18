from edgar import Company
from collections import defaultdict

# Get Apple facts
aapl = Company("AAPL")
facts = aapl.facts

# Get raw facts data - access internal facts list
raw_facts = facts._facts  # Access internal facts list

# Look for all facts in Income Statement for 2019-2020
income_facts = defaultdict(lambda: defaultdict(list))
for fact in raw_facts:
    if fact.statement_type == 'IncomeStatement':
        if fact.fiscal_year in [2019, 2020]:
            key = f"{fact.fiscal_year}-{fact.fiscal_period}"
            income_facts[fact.concept][key].append({
                'value': fact.value,
                'period_end': fact.period_end,
                'filing_date': fact.filing_date
            })

# Find Revenue/Revenues concept
revenue_concepts = []
for concept in income_facts.keys():
    if 'Revenue' in concept and 'Contract' not in concept:
        revenue_concepts.append(concept)
        
print("Revenue concepts found:", revenue_concepts)
print("\nRevenue values by year-period:")

for concept in revenue_concepts:
    print(f"\n{concept}:")
    for period in sorted(income_facts[concept].keys()):
        facts_list = income_facts[concept][period]
        for f in facts_list:
            print(f"  {period}: ${f['value']:,}")
            
# Check what periods are actually marked as FY
print("\n\nAll FY periods in Income Statement:")
fy_periods = set()
for fact in raw_facts:
    if fact.statement_type == 'IncomeStatement' and fact.fiscal_period == 'FY':
        fy_periods.add((fact.fiscal_year, fact.fiscal_period, fact.period_end))
        
for year, period, end_date in sorted(fy_periods):
    print(f"  {year} {period} (ends {end_date})")
    
# Now check what exact facts are selected for 2019 and 2020
print("\n\nChecking what's selected for income statement:")
from edgar.entity.enhanced_statement import EnhancedStatementBuilder

builder = EnhancedStatementBuilder()
stmt_facts = [f for f in raw_facts if f.statement_type == 'IncomeStatement']

# Build period info like the builder does
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

# Get annual periods
annual_periods = [(pk, info) for pk, info in period_info.items() if info['is_annual']]
annual_periods.sort(key=lambda x: x[0][0] if x[0][0] else 0, reverse=True)

print("\nAnnual periods found (sorted newest first):")
for (year, period), info in annual_periods[:10]:
    print(f"  {info['label']} - ends {info['end_date']}")
    
# Check if there are any revenue facts for FY 2019 and FY 2020
print("\n\nRevenue facts for FY periods:")
for fact in raw_facts:
    if fact.statement_type == 'IncomeStatement' and fact.fiscal_period == 'FY':
        if fact.fiscal_year in [2019, 2020] and 'Revenue' in str(fact.concept):
            print(f"  {fact.fiscal_year} {fact.fiscal_period}: {fact.concept} = ${fact.value:,}")