from edgar import Company
from collections import defaultdict

# Get Apple facts
aapl = Company("AAPL")
facts = aapl.facts
raw_facts = facts._facts

# Check how period_info is built
stmt_facts = [f for f in raw_facts if f.statement_type == 'IncomeStatement']

# Track all unique combinations
all_combos = set()
period_end_by_key = defaultdict(set)

for fact in stmt_facts:
    if fact.fiscal_period == 'FY' and fact.fiscal_year and fact.fiscal_year >= 2019:
        period_key = (fact.fiscal_year, fact.fiscal_period)
        all_combos.add((fact.fiscal_year, fact.fiscal_period, fact.period_end))
        period_end_by_key[period_key].add(fact.period_end)

print("Period keys and their different period_end dates:")
for key in sorted(period_end_by_key.keys(), reverse=True):
    year, period = key
    if year >= 2019 and year <= 2024:
        ends = period_end_by_key[key]
        print(f"\n({year}, '{period}'): {len(ends)} different period_ends")
        for end in sorted(ends):
            match = "✓" if end and end.year == year else "✗"
            print(f"    {end} {match}")

# The problem: period_info dict only keeps ONE per key
print("\n\nProblem: The current code builds period_info as a dict,")
print("so it only keeps ONE fact per (fiscal_year, fiscal_period) key!")
print("We lose all the other period_end variations when we do:")
print("  if period_key not in period_info:")
print("    period_info[period_key] = {...}  # Only first one is kept!")