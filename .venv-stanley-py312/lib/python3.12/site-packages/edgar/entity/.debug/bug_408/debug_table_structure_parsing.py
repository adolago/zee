#!/usr/bin/env python3
"""
Debug why tables are losing their structure during parsing.
"""

import sys
sys.path.insert(0, '/Users/dwight/PycharmProjects/edgartools')

from edgar.documents.parser import HTMLParser
from edgar.documents.config import ParserConfig
from edgar.documents.table_nodes import TableNode
from bs4 import BeautifulSoup

def examine_raw_html_table():
    """Examine the raw HTML structure of the problematic table."""
    print("🔍 EXAMINING RAW HTML TABLE STRUCTURE")
    print("=" * 55)
    
    try:
        with open('/Users/dwight/PycharmProjects/edgartools/data/html/MSFT.10-K.html', 'r') as f:
            html_content = f.read()
        
        # Find the table HTML
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Look for table containing our target text
        target_elements = soup.find_all(string=lambda text: text and "Weighted average outstanding shares" in text)
        
        if not target_elements:
            print("❌ Target text not found in HTML")
            return None
        
        target_element = target_elements[0]
        
        # Find the containing table
        table_element = target_element
        while table_element and table_element.name != 'table':
            table_element = table_element.parent
        
        if not table_element:
            print("❌ No containing table found")
            return None
        
        print("✅ Found containing HTML table")
        
        # Analyze the HTML table structure
        rows = table_element.find_all('tr')
        print(f"HTML table has {len(rows)} rows")
        
        # Look for thead, tbody structure
        thead = table_element.find('thead')
        tbody = table_element.find('tbody')
        print(f"Has <thead>: {'✅' if thead else '❌'}")
        print(f"Has <tbody>: {'✅' if tbody else '❌'}")
        
        # Analyze first few rows
        print(f"\nFirst few rows analysis:")
        for i, row in enumerate(rows[:10]):
            cells = row.find_all(['td', 'th'])
            cell_info = []
            for cell in cells[:5]:  # First 5 cells
                text = cell.get_text().strip()[:20]
                tag = cell.name
                colspan = cell.get('colspan', '1')
                cell_info.append(f"{tag}({colspan}):'{text}'")
            
            print(f"  Row {i+1}: {len(cells)} cells - {', '.join(cell_info)}")
            if len(cells) > 5:
                print(f"         ... and {len(cells)-5} more cells")
        
        # Check if there are any TH (header) cells
        th_cells = table_element.find_all('th')
        print(f"\nTotal <th> header cells: {len(th_cells)}")
        
        # Look for potential header patterns
        header_candidates = []
        for i, row in enumerate(rows[:5]):  # Check first 5 rows for headers
            cells = row.find_all(['td', 'th'])
            row_text = ' '.join(cell.get_text().strip() for cell in cells).strip()
            if any(keyword in row_text.lower() for keyword in ['year', 'ended', '2025', '2024', '2023']):
                header_candidates.append(i)
                print(f"  Potential header row {i+1}: {row_text[:80]}...")
        
        return table_element
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return None

def debug_table_parsing_pipeline():
    """Debug how the table gets processed through the parsing pipeline."""
    print(f"\n🔧 DEBUGGING TABLE PARSING PIPELINE")
    print("=" * 55)
    
    try:
        with open('/Users/dwight/PycharmProjects/edgartools/data/html/MSFT.10-K.html', 'r') as f:
            html_content = f.read()
        
        config = ParserConfig(fast_table_rendering=False)
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
            print("❌ Target table not found in parsed document")
            return
        
        print("✅ Found target table in parsed document")
        
        # Analyze how the table was parsed
        print(f"\nParsed table analysis:")
        print(f"  Table type: {target_table.table_type}")
        print(f"  Has headers: {'✅' if target_table.headers else '❌'}")
        print(f"  Header rows: {len(target_table.headers)}")
        print(f"  Data rows: {len(target_table.rows)}")
        print(f"  Caption: {target_table.caption}")
        
        # Check if headers were detected
        if target_table.headers:
            print(f"\n  Header structure:")
            for i, header_row in enumerate(target_table.headers):
                header_texts = [cell.text().strip()[:20] for cell in header_row]
                print(f"    Header row {i+1}: {header_texts}")
        else:
            print(f"\n  ❌ NO HEADERS DETECTED - This is likely the problem!")
            print(f"  The parser failed to identify header rows in the HTML table.")
            
            # Check if any of the first few data rows look like headers
            print(f"\n  First few data rows (might be misclassified headers):")
            for i, row in enumerate(target_table.rows[:5]):
                row_texts = [cell.text().strip()[:20] for cell in row.cells[:5]]
                print(f"    Data row {i+1}: {row_texts}")
                
                # Check if this row looks like a header
                row_text = ' '.join(cell.text().strip() for cell in row.cells)
                if any(keyword in row_text.lower() for keyword in ['year', 'ended', '2025', '2024', '2023', 'millions']):
                    print(f"      ⚠️  This looks like it should be a header row!")
        
        # Test manual header detection
        print(f"\n🔍 MANUAL HEADER DETECTION TEST:")
        potential_headers = []
        
        for i, row in enumerate(target_table.rows[:5]):
            row_text = ' '.join(cell.text().strip() for cell in row.cells).strip()
            
            # Score this row as a potential header
            header_score = 0
            
            # Check for typical header keywords
            header_keywords = ['millions', 'year ended', 'june 30', '2025', '2024', '2023']
            for keyword in header_keywords:
                if keyword in row_text.lower():
                    header_score += 1
            
            # Check for mostly empty cells (common in header spacing rows)
            empty_cells = sum(1 for cell in row.cells if not cell.text().strip())
            if empty_cells / len(row.cells) > 0.7:  # More than 70% empty
                header_score -= 1
            
            # Check for meaningful content vs pure spacing
            meaningful_cells = sum(1 for cell in row.cells if len(cell.text().strip()) > 2)
            if meaningful_cells >= 2:  # At least 2 cells with meaningful content
                header_score += 1
            
            potential_headers.append((i, row, header_score, row_text))
            print(f"  Row {i+1}: score={header_score}, text='{row_text[:60]}...'")
        
        # Find the best header candidate
        best_header = max(potential_headers, key=lambda x: x[2])
        if best_header[2] > 0:
            print(f"\n  ✅ Best header candidate: Row {best_header[0]+1} (score={best_header[2]})")
            print(f"     Text: {best_header[3]}")
        else:
            print(f"\n  ❌ No good header candidates found")
        
        return target_table
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return None

if __name__ == "__main__":
    print("🎯 DEBUGGING TABLE STRUCTURE PARSING")
    print("Focus: Why tables lose structure during parsing")
    print()
    
    # Step 1: Examine raw HTML
    html_table = examine_raw_html_table()
    
    # Step 2: Debug parsing pipeline
    parsed_table = debug_table_parsing_pipeline()
    
    print(f"\n🎯 DIAGNOSIS:")
    if html_table and parsed_table:
        print("The table exists in HTML and is being parsed into a TableNode.")
        print("The issue is likely in header detection - the parser isn't")
        print("properly identifying which rows should be headers vs data.")
        
        print(f"\n🔧 SOLUTION:")
        print("1. Improve header detection logic in table parsing")
        print("2. Look for rows with year indicators (2025, 2024, 2023) as headers")
        print("3. Handle tables without explicit <th> tags better")
        print("4. Keep Rich rendering as default for beautiful output")
    else:
        print("Basic table parsing is failing - need to investigate further.")