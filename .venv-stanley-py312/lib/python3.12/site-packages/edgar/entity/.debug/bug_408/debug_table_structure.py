#!/usr/bin/env python3
"""
Debug the table structure to understand why we're getting so many empty columns.
"""

import sys
sys.path.insert(0, '/Users/dwight/PycharmProjects/edgartools')

from edgar.documents.parser import HTMLParser
from edgar.documents.config import ParserConfig
from edgar.documents.table_nodes import TableNode

def analyze_table_structure():
    print("🔍 ANALYZING TABLE STRUCTURE")
    print("=" * 50)
    
    try:
        with open('/Users/dwight/PycharmProjects/edgartools/data/html/MSFT.10-K.html', 'r') as f:
            html_content = f.read()
        
        config = ParserConfig(fast_table_rendering=True)
        parser = HTMLParser(config)
        document = parser.parse(html_content)
        
        # Find target table
        target_table = None
        def find_target(node):
            nonlocal target_table
            if isinstance(node, TableNode):
                try:
                    if "Weighted average outstanding shares" in node.text():
                        target_table = node
                        return
                except:
                    pass
            if hasattr(node, 'children'):
                for child in node.children:
                    find_target(child)
        
        find_target(document.root)
        
        if not target_table:
            print("❌ Target table not found")
            return
        
        print("✅ Found target table")
        
        # Analyze the structure
        print(f"\nTable structure:")
        print(f"  Headers: {len(target_table.headers)} rows")
        print(f"  Data rows: {len(target_table.rows)}")
        
        # Analyze header structure
        print(f"\n📋 HEADER ANALYSIS:")
        for i, header_row in enumerate(target_table.headers):
            print(f"  Header row {i+1}: {len(header_row)} cells")
            for j, cell in enumerate(header_row[:10]):  # First 10 cells
                text = cell.text().strip()
                display_text = text[:20] if text else "[EMPTY]"
                print(f"    Cell {j+1}: '{display_text}' (colspan={cell.colspan})")
        
        # Analyze data rows
        print(f"\n📊 DATA ROW ANALYSIS:")
        for i, row in enumerate(target_table.rows[:5]):  # First 5 rows
            print(f"  Row {i+1}: {len(row.cells)} cells")
            for j, cell in enumerate(row.cells[:10]):  # First 10 cells
                text = cell.text().strip()
                display_text = text[:20] if text else "[EMPTY]"
                print(f"    Cell {j+1}: '{display_text}' (colspan={cell.colspan})")
        
        # Count empty vs filled cells
        total_cells = 0
        empty_cells = 0
        
        for header_row in target_table.headers:
            for cell in header_row:
                total_cells += 1
                if not cell.text().strip():
                    empty_cells += 1
        
        for row in target_table.rows:
            for cell in row.cells:
                total_cells += 1
                if not cell.text().strip():
                    empty_cells += 1
        
        print(f"\n📊 CELL STATISTICS:")
        print(f"  Total cells: {total_cells}")
        print(f"  Empty cells: {empty_cells}")
        print(f"  Filled cells: {total_cells - empty_cells}")
        print(f"  Empty percentage: {empty_cells/total_cells*100:.1f}%")
        
        # Check maximum meaningful columns
        max_meaningful_cols = 0
        for row in target_table.rows:
            meaningful_cols = 0
            for cell in row.cells:
                if cell.text().strip():
                    meaningful_cols = len([c for c in row.cells[:len(row.cells)] if c.text().strip()])
                    break
            max_meaningful_cols = max(max_meaningful_cols, meaningful_cols)
        
        print(f"  Maximum meaningful columns in any row: {max_meaningful_cols}")
        
        return target_table
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return None

def test_column_filtering():
    """Test filtering out empty columns."""
    print(f"\n🔧 TESTING COLUMN FILTERING")
    print("=" * 50)
    
    target_table = analyze_table_structure()
    if not target_table:
        return
    
    # Analyze which columns actually have content
    if not target_table.rows:
        print("No data rows to analyze")
        return
    
    max_cols = max(len(row.cells) for row in target_table.rows)
    print(f"Maximum columns: {max_cols}")
    
    # Check each column for meaningful content
    meaningful_columns = []
    for col_idx in range(max_cols):
        has_content = False
        
        # Check headers
        for header_row in target_table.headers:
            if col_idx < len(header_row) and header_row[col_idx].text().strip():
                has_content = True
                break
        
        # Check data rows
        if not has_content:
            for row in target_table.rows:
                if col_idx < len(row.cells) and row.cells[col_idx].text().strip():
                    has_content = True
                    break
        
        if has_content:
            meaningful_columns.append(col_idx)
            
    print(f"Meaningful columns: {meaningful_columns} ({len(meaningful_columns)} total)")
    
    # Test rendering with only meaningful columns
    print(f"\n📊 FILTERED TABLE PREVIEW:")
    
    # Show first data row with only meaningful columns
    if target_table.rows:
        first_row = target_table.rows[0]
        filtered_cells = []
        for col_idx in meaningful_columns:
            if col_idx < len(first_row.cells):
                cell_text = first_row.cells[col_idx].text().strip()
                filtered_cells.append(cell_text if cell_text else "[EMPTY]")
            else:
                filtered_cells.append("[MISSING]")
        
        print("First row filtered:", " | ".join(filtered_cells))
        
    return meaningful_columns

if __name__ == "__main__":
    print("🎯 DEBUGGING TABLE STRUCTURE ISSUE")
    print("Focus: Understanding why we get so many empty columns")
    print()
    
    meaningful_cols = test_column_filtering()
    
    if meaningful_cols:
        print(f"\n🎯 FINDINGS:")
        print(f"The table has many empty spacing columns.")
        print(f"Only {len(meaningful_cols)} out of many columns have actual content.")
        print(f"The FastTableRenderer should filter out empty columns.")
        
        print(f"\n🔧 SOLUTION:")
        print("Update FastTableRenderer to:")
        print("1. Identify columns with meaningful content")
        print("2. Filter out purely empty/spacing columns")
        print("3. Only render the meaningful columns")
    else:
        print("❌ Could not analyze column structure")