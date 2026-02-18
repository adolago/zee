#!/usr/bin/env python3
"""
Test specific header detection logic on the target table rows.
"""

import sys
sys.path.insert(0, '/Users/dwight/PycharmProjects/edgartools')

import re
from edgar.documents.parser import HTMLParser
from edgar.documents.config import ParserConfig
from edgar.documents.table_nodes import TableNode

def test_header_detection_logic():
    print("🔍 TESTING SPECIFIC HEADER DETECTION LOGIC")
    print("=" * 50)
    
    try:
        with open('/Users/dwight/PycharmProjects/edgartools/data/html/MSFT.10-K.html', 'r') as f:
            html_content = f.read()
        
        # Parse document
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
        print(f"Current status: {len(target_table.headers)} headers, {len(target_table.rows)} data rows")
        
        # Test our header detection logic on each of the first few rows
        print(f"\n🔧 TESTING HEADER DETECTION ON FIRST 7 ROWS:")
        
        for i, row in enumerate(target_table.rows[:7]):
            print(f"\n--- ROW {i+1} ---")
            
            # Get the row text
            row_text = ' '.join(cell.text().strip() for cell in row.cells)
            print(f"Row text: '{row_text}'")
            
            # Test each part of our header detection logic
            score = 0
            reasons = []
            
            # 1. Check for year patterns in the combined text
            year_pattern = r'\b(19\d{2}|20\d{2})\b'
            years_found = re.findall(year_pattern, row_text)
            if len(years_found) >= 2:
                if 'total' not in row_text.lower()[:20]:
                    score += 3
                    reasons.append(f"Multiple years found: {years_found}")
            
            # 2. Enhanced year detection - check individual cells
            year_cells = 0
            date_phrases = 0
            cell_contents = []
            for cell in row.cells:
                cell_text = cell.text().strip()
                cell_contents.append(f"'{cell_text}'")
                if cell_text:
                    # Check for individual years
                    if re.match(r'^\s*(19\d{2}|20\d{2})\s*$', cell_text):
                        year_cells += 1
                    # Check for date phrases
                    elif 'june 30' in cell_text.lower() or 'december 31' in cell_text.lower():
                        date_phrases += 1
            
            print(f"Cell contents: {cell_contents[:5]}{'...' if len(cell_contents) > 5 else ''}")
            print(f"Year cells: {year_cells}, Date phrases: {date_phrases}")
            
            if year_cells >= 2 or (year_cells >= 1 and date_phrases >= 1):
                if 'total' not in row_text.lower()[:20]:
                    score += 4
                    reasons.append(f"Enhanced year detection: {year_cells} year cells, {date_phrases} date phrases")
            
            # 3. Check for financial header patterns
            row_text_lower = row_text.lower()
            financial_patterns = [
                r'year\s+ended\s+(june|december|march|september)',
                r'(three|six|nine|twelve)\s+months?\s+ended',
                r'\(in\s+(millions|thousands|billions)\)',
                r'fiscal\s+year\s+ended'
            ]
            
            for pattern in financial_patterns:
                if re.search(pattern, row_text_lower):
                    score += 2
                    reasons.append(f"Financial pattern: {pattern}")
            
            # 4. Check for period indicators
            period_keywords = ['quarter', 'q1', 'q2', 'q3', 'q4', 'month', 
                              'january', 'february', 'march', 'april', 'may', 'june',
                              'july', 'august', 'september', 'october', 'november', 'december',
                              'ended', 'three months', 'six months', 'nine months']
            
            matching_keywords = [kw for kw in period_keywords if kw in row_text_lower]
            if matching_keywords:
                score += 1
                reasons.append(f"Period keywords: {matching_keywords}")
            
            print(f"HEADER SCORE: {score}")
            if reasons:
                print(f"Reasons: {', '.join(reasons)}")
            
            # Determine if this should be considered a header
            should_be_header = score >= 3
            print(f"SHOULD BE HEADER: {'YES' if should_be_header else 'NO'}")
            
            if should_be_header and i == 4:  # Row 5 (index 4) is our expected header
                print("🎯 This matches our expected header row!")
            elif should_be_header:
                print("⚠️  This would be detected as a header but wasn't expected")
            elif i == 4:
                print("❌ This should be the header row but isn't being detected!")
        
        return target_table
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return None

if __name__ == "__main__":
    test_header_detection_logic()