from edgar import Company
from edgar.entity.enhanced_statement import EnhancedStatementBuilder

# Get Apple facts
aapl = Company("AAPL")
facts = aapl.facts

# Build the income statement
builder = EnhancedStatementBuilder()
stmt = builder.build_multi_period_statement(
    facts=facts._facts,
    statement_type='IncomeStatement',
    periods=6,
    annual=True
)

print(f"Selected periods: {stmt.periods}")
print("\nChecking Revenue item values:")

# Find the revenue item
for item in stmt.items:
    if item.label and 'Revenue' in item.label and 'Total' in item.label:
        print(f"\n{item.label}:")
        for i, (period, value) in enumerate(zip(stmt.periods, item.values)):
            print(f"  {period}: {value}")
        
        # Check what concept this maps to
        if hasattr(item, 'concept'):
            print(f"  Concept: {item.concept}")
            
# Now let's check what facts are in period_facts_by_label
print("\n\nChecking what facts are in the FY 2020 period:")
from collections import defaultdict

# Recreate what the builder does
raw_facts = facts._facts
stmt_facts = [f for f in raw_facts if f.statement_type == 'IncomeStatement']

# Build period_facts with the new key structure
period_facts = defaultdict(list)
for fact in stmt_facts:
    period_key = (fact.fiscal_year, fact.fiscal_period, fact.period_end)
    period_facts[period_key].append(fact)

# Look for FY 2020 periods
for key in period_facts.keys():
    if key[0] == 2020 and key[1] == 'FY':
        if key[2] and key[2].year == 2020:  # Correct match
            print(f"\nKey: {key}")
            # Check revenue facts in this period
            for fact in period_facts[key]:
                if 'RevenueFromContract' in str(fact.concept) and 'Liability' not in str(fact.concept):
                    duration = None
                    if fact.period_start:
                        duration = (fact.period_end - fact.period_start).days
                    print(f"  Revenue: ${fact.value:,.0f} (duration: {duration})")
                    
# The issue might be in how period_facts_by_label is built
print("\n\nChecking period_facts_by_label mapping:")
# This is what happens in the builder after selection
# It remaps from period_key to label, but multiple keys can have the same label!