from edgar import Company

# Get Apple facts and display income statement
aapl = Company("AAPL")
facts = aapl.facts

print("Testing with annual=True, periods=6:")
income = facts.income_statement(annual=True, periods=6)

# Get the internal data
items = income.items

# Find the Total Revenue item
for item in items:
    if "Revenue" in item.label and "Total" in item.label:
        print(f"\n{item.label}:")
        print(f"  Values: {item.values}")
        print(f"  Periods: {income.periods}")
        
        # Show what values we have
        for i, (period, value) in enumerate(zip(income.periods, item.values)):
            if value:
                print(f"    {period}: {value}")

# Let's also check what raw facts we have
print("\n\nChecking raw facts for FY 2019 and FY 2020:")
raw_facts = facts._facts
for fact in raw_facts:
    if fact.statement_type == 'IncomeStatement' and fact.fiscal_period == 'FY':
        if fact.fiscal_year in [2019, 2020]:
            if 'RevenueFromContract' in str(fact.concept) and 'Liability' not in str(fact.concept):
                match = "✓" if fact.period_end and fact.period_end.year == fact.fiscal_year else "✗"
                print(f"  FY {fact.fiscal_year} ends {fact.period_end}: ${fact.value:,.0f} {match}")