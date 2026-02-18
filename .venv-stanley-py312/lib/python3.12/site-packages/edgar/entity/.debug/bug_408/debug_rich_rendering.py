#!/usr/bin/env python3
"""
Debug why Rich table rendering is still producing poor structure even with headers detected.
"""

import sys
sys.path.insert(0, '/Users/dwight/PycharmProjects/edgartools')

from edgar.documents.parser import HTMLParser
from edgar.documents.config import ParserConfig
from edgar.documents.table_nodes import TableNode

def debug_rich_rendering_issue():
    print("🔍 DEBUGGING RICH RENDERING WITH DETECTED HEADERS")
    print("=" * 60)
    
    try:
        with open('/Users/dwight/PycharmProjects/edgartools/data/html/MSFT.10-K.html', 'r') as f:
            html_content = f.read()
        
        config = ParserConfig()
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
        print(f"Headers: {len(target_table.headers)}")
        print(f"Data rows: {len(target_table.rows)}")
        
        # Examine the table structure in detail
        print(f"\n🔍 DETAILED TABLE STRUCTURE ANALYSIS:")
        
        # Check headers
        if target_table.headers:
            for i, header_row in enumerate(target_table.headers):
                print(f"\nHeader row {i+1}: {len(header_row)} cells")
                for j, cell in enumerate(header_row[:8]):  # First 8 cells
                    print(f"  Cell {j+1}: '{cell.text()}' (colspan={cell.colspan}, rowspan={cell.rowspan})")
        
        # Check data row structure
        print(f"\n📊 DATA ROW ANALYSIS:")
        for i, row in enumerate(target_table.rows[:5]):  # First 5 data rows
            content_cells = [j for j, cell in enumerate(row.cells) if cell.text().strip()]
            print(f"Row {i+1}: {len(row.cells)} total cells, content in positions {content_cells}")
            
            # Show first few cells with content
            for j in content_cells[:3]:
                if j < len(row.cells):
                    cell = row.cells[j]
                    print(f"  Cell {j+1}: '{cell.text()[:30]}...' (align={cell.align})")
        
        # Check table dimensions
        max_cols = max(len(row.cells) for row in target_table.rows) if target_table.rows else 0
        header_cols = len(target_table.headers[0]) if target_table.headers else 0
        print(f"\n📏 TABLE DIMENSIONS:")
        print(f"  Header columns: {header_cols}")
        print(f"  Max data columns: {max_cols}")
        print(f"  Dimension mismatch: {'YES' if header_cols != max_cols else 'NO'}")
        
        # Count empty vs content cells
        total_cells = sum(len(row.cells) for row in target_table.rows)
        empty_cells = sum(1 for row in target_table.rows for cell in row.cells if not cell.text().strip())
        print(f"  Total data cells: {total_cells}")
        print(f"  Empty data cells: {empty_cells} ({empty_cells/total_cells*100:.1f}%)")
        
        # Test Rich table creation manually
        print(f"\n🎨 TESTING RICH TABLE CREATION:")
        try:
            rich_table = target_table.render(width=120)
            print(f"✅ Rich table created successfully")
            print(f"Rich table type: {type(rich_table)}")
            
            # Check Rich table properties
            if hasattr(rich_table, 'columns'):
                print(f"Rich columns: {len(rich_table.columns)}")
            if hasattr(rich_table, 'rows'):
                print(f"Rich rows: {len(rich_table.rows)}")
            
        except Exception as e:
            print(f"❌ Rich table creation failed: {e}")
            import traceback
            traceback.print_exc()
            return
        
        # Test text conversion
        print(f"\n📝 TESTING TEXT CONVERSION:")
        try:
            from edgar.richtools import rich_to_text
            rich_text = rich_to_text(rich_table)
            
            lines = rich_text.split('\n')
            print(f"Text output: {len(lines)} lines, {len(rich_text)} chars")
            
            # Analyze line types
            empty_lines = sum(1 for line in lines if not line.strip())
            border_lines = sum(1 for line in lines if any(c in line for c in '┌┐└┘├┤│─'))
            content_lines = sum(1 for line in lines if line.strip() and not all(c in '┌┐└┘├┤│─ ' for c in line))
            
            print(f"  Empty lines: {empty_lines}")
            print(f"  Border lines: {border_lines}")
            print(f"  Content lines: {content_lines}")
            
            # Show actual structure
            print(f"\nFirst 10 lines of output:")
            for i, line in enumerate(lines[:10]):
                line_type = "EMPTY" if not line.strip() else "BORDER" if any(c in line for c in '┌┐└┘├┤│─') else "CONTENT"
                print(f"  {i+1:2d} [{line_type:7}]: {line[:60]}{'...' if len(line) > 60 else ''}")
            
            # The problem might be that Rich is creating a table but with poor formatting
            # Let's see if we can identify the issue
            if border_lines < 3:
                print(f"\n❌ DIAGNOSIS: Very few border lines - Rich table structure is poor")
                print("This suggests the table has structural issues that prevent proper rendering.")
                print("Possible causes:")
                print("1. Column count mismatch between headers and data")
                print("2. Too many empty cells causing poor layout")
                print("3. Cell spanning issues")
                print("4. Table too wide for rendering width")
            else:
                print(f"\n✅ Rich table structure appears normal")
                
        except Exception as e:
            print(f"❌ Text conversion failed: {e}")
            return
        
        return target_table
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return None

if __name__ == "__main__":
    debug_rich_rendering_issue()
    
    print(f"\n🎯 NEXT STEPS:")
    print("Based on the analysis above, we can identify specific issues preventing")
    print("proper Rich table rendering and address them systematically.")