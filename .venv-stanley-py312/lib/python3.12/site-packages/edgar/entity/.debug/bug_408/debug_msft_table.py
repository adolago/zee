#!/usr/bin/env python3
"""
Debug script to investigate table parsing/rendering issues in MSFT 10-K.
Focus on the "Weighted average outstanding shares of common stock (B)" table.
"""

import sys
sys.path.insert(0, '/Users/dwight/PycharmProjects/edgartools')

from edgar.documents.parser import HTMLParser
from edgar.documents.config import ParserConfig
from edgar.documents.table_nodes import TableNode
from bs4 import BeautifulSoup

def find_table_in_html():
    """Find and examine the table HTML structure around the target text."""
    print("🔍 EXAMINING TABLE HTML STRUCTURE")
    print("=" * 50)
    
    try:
        # Read the MSFT file
        with open('/Users/dwight/PycharmProjects/edgartools/data/html/MSFT.10-K.html', 'r') as f:
            html_content = f.read()
        
        print(f"File size: {len(html_content)} characters")
        
        # Find the table containing our target text
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Search for the specific text
        target_elements = soup.find_all(text=lambda text: text and "Weighted average outstanding shares of common stock" in text)
        
        print(f"\nFound {len(target_elements)} elements with target text")
        
        for i, element in enumerate(target_elements):
            print(f"\n📍 Element {i+1}:")
            print(f"  Text: {element.strip()[:80]}...")
            
            # Find the containing table
            parent = element.parent
            while parent and parent.name != 'table':
                parent = parent.parent
                
            if parent and parent.name == 'table':
                print(f"  Found containing table!")
                
                # Analyze the table structure
                rows = parent.find_all('tr')
                print(f"  Table has {len(rows)} rows")
                
                # Look at first few rows
                for j, row in enumerate(rows[:5]):
                    cells = row.find_all(['td', 'th'])
                    print(f"    Row {j+1}: {len(cells)} cells")
                    for k, cell in enumerate(cells[:3]):  # First 3 cells
                        cell_text = cell.get_text().strip()[:30].replace('\n', ' ')
                        print(f"      Cell {k+1}: '{cell_text}...'")
                
                return parent
            else:
                print(f"  No containing table found")
        
        return None
        
    except Exception as e:
        print(f"❌ Error examining HTML: {e}")
        import traceback
        traceback.print_exc()
        return None

def test_parser_on_msft():
    """Test the document parser on the MSFT file."""
    print("\n🚀 TESTING DOCUMENT PARSER")
    print("=" * 50)
    
    try:
        # Read the MSFT file
        with open('/Users/dwight/PycharmProjects/edgartools/data/html/MSFT.10-K.html', 'r') as f:
            html_content = f.read()
        
        # Parse with different configurations
        configs_to_test = [
            ("Default", ParserConfig()),
            ("Performance", ParserConfig.for_performance()),
            ("Accuracy", ParserConfig.for_accuracy()),
        ]
        
        for config_name, config in configs_to_test:
            print(f"\n🧪 Testing with {config_name} config...")
            
            parser = HTMLParser(config)
            document = parser.parse(html_content)
            
            print(f"  Document parsed successfully")
            print(f"  Root children: {len(document.root.children)}")
            
            # Find tables with our target text
            matching_tables = []
            
            def find_target_tables(node):
                if isinstance(node, TableNode):
                    table_text = node.text()
                    if "Weighted average outstanding shares of common stock" in table_text:
                        matching_tables.append(node)
                for child in node.children:
                    find_target_tables(child)
            
            find_target_tables(document.root)
            
            print(f"  Found {len(matching_tables)} table(s) with target text")
            
            for i, table in enumerate(matching_tables):
                print(f"\n  📋 Table {i+1}:")
                print(f"    Headers: {len(table.headers)} row(s)")
                print(f"    Data rows: {len(table.rows)}")
                print(f"    Table type: {table.table_type}")
                
                # Show table structure
                if table.headers:
                    print(f"    Header structure:")
                    for j, header_row in enumerate(table.headers):
                        print(f"      Row {j+1}: {len(header_row)} cells")
                        for k, cell in enumerate(header_row[:3]):
                            cell_text = cell.text().strip()[:20].replace('\n', ' ')
                            print(f"        Cell {k+1}: '{cell_text}...'")
                
                print(f"    First few data rows:")
                for j, row in enumerate(table.rows[:3]):
                    print(f"      Row {j+1}: {len(row.cells)} cells")
                    for k, cell in enumerate(row.cells[:3]):
                        cell_text = cell.text().strip()[:20].replace('\n', ' ')
                        print(f"        Cell {k+1}: '{cell_text}...'")
                
                # Get the text output
                table_text = table.text()
                print(f"\n    Text output ({len(table_text)} chars):")
                print("    " + "-" * 40)
                
                # Show first few lines
                lines = table_text.split('\n')
                for line_num, line in enumerate(lines[:10]):
                    print(f"    {line_num+1:2d}: {line}")
                
                if len(lines) > 10:
                    print(f"    ... ({len(lines)-10} more lines)")
                    
                print("    " + "-" * 40)
                
                # Check for issues
                issues = []
                if len(table_text.strip()) == 0:
                    issues.append("Empty text output")
                if "Weighted average outstanding shares" not in table_text:
                    issues.append("Missing target text in output")
                if table_text.count('|') < 5:  # Should have multiple columns
                    issues.append("Possibly missing column separators")
                if len(lines) < 3:
                    issues.append("Very few output lines")
                
                if issues:
                    print(f"    ⚠️  Issues detected: {', '.join(issues)}")
                    return table  # Return problematic table for further analysis
                else:
                    print(f"    ✅ Table appears to render correctly")
                    
        return None
        
    except Exception as e:
        print(f"❌ Parser test failed: {e}")
        import traceback
        traceback.print_exc()
        return None

def analyze_table_structure(table):
    """Deep analysis of a problematic table."""
    print("\n🔬 DEEP TABLE ANALYSIS")
    print("=" * 50)
    
    if not table:
        print("No table to analyze")
        return
    
    print(f"Table type: {table.table_type}")
    print(f"Caption: {table.caption}")
    print(f"Summary: {table.summary}")
    
    # Analyze headers
    print(f"\n📋 HEADERS ({len(table.headers)} rows):")
    for i, header_row in enumerate(table.headers):
        print(f"  Row {i+1} ({len(header_row)} cells):")
        for j, cell in enumerate(header_row):
            print(f"    Cell {j+1}: colspan={cell.colspan}, rowspan={cell.rowspan}")
            print(f"             text='{cell.text()[:40]}...'")
            print(f"             is_header={cell.is_header}")
    
    # Analyze data rows
    print(f"\n📊 DATA ROWS ({len(table.rows)} rows):")
    for i, row in enumerate(table.rows[:5]):  # First 5 rows
        print(f"  Row {i+1} ({len(row.cells)} cells):")
        for j, cell in enumerate(row.cells):
            print(f"    Cell {j+1}: colspan={cell.colspan}, rowspan={cell.rowspan}")
            print(f"             text='{cell.text()[:40]}...'")
            print(f"             is_numeric={cell.is_numeric}")
    
    if len(table.rows) > 5:
        print(f"  ... and {len(table.rows)-5} more rows")
    
    # Test different rendering approaches
    print(f"\n🖼️  TESTING DIFFERENT RENDERERS:")
    
    # Rich renderer
    try:
        rich_table = table.render(width=120)
        from edgar.richtools import rich_to_text
        rich_text = rich_to_text(rich_table)
        print(f"  Rich renderer: {len(rich_text)} chars")
        print(f"    Preview: {rich_text[:100]}...")
    except Exception as e:
        print(f"  Rich renderer failed: {e}")
    
    # Fast renderer
    try:
        fast_text = table._fast_text_rendering()
        print(f"  Fast renderer: {len(fast_text)} chars")
        print(f"    Preview: {fast_text[:100]}...")
    except Exception as e:
        print(f"  Fast renderer failed: {e}")
    
    # Compare outputs
    try:
        current_text = table.text()
        print(f"  Current text() method: {len(current_text)} chars")
        if "Weighted average outstanding shares" in current_text:
            print(f"    ✅ Contains target text")
        else:
            print(f"    ❌ Missing target text")
    except Exception as e:
        print(f"  Current text() method failed: {e}")

if __name__ == "__main__":
    print("🎯 DEBUGGING MSFT TABLE PARSING ISSUE")
    print("Target: 'Weighted average outstanding shares of common stock (B)' table")
    print()
    
    # Step 1: Examine HTML structure
    table_element = find_table_in_html()
    
    # Step 2: Test parser with different configurations
    problematic_table = test_parser_on_msft()
    
    # Step 3: Deep analysis if issues found
    if problematic_table:
        analyze_table_structure(problematic_table)
        
        print(f"\n🎯 CONCLUSION:")
        print("A problematic table was identified. Check the analysis above")
        print("for specific issues with parsing or rendering.")
    else:
        print(f"\n✅ CONCLUSION:")
        print("No obvious parsing issues were detected. The table appears to")
        print("be parsing and rendering correctly with the current parser.")
        print("If there are still issues, they may be subtle formatting problems.")