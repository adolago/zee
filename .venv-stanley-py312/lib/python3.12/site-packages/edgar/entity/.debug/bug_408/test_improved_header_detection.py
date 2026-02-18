#!/usr/bin/env python3
"""
Test the improved header detection logic.
"""

import sys
sys.path.insert(0, '/Users/dwight/PycharmProjects/edgartools')

from edgar.documents.parser import HTMLParser
from edgar.documents.config import ParserConfig
from edgar.documents.table_nodes import TableNode

def test_header_detection_improvement():
    print("🔧 TESTING IMPROVED HEADER DETECTION")
    print("=" * 50)
    
    try:
        with open('/Users/dwight/PycharmProjects/edgartools/data/html/MSFT.10-K.html', 'r') as f:
            html_content = f.read()
        
        # Use default config (Rich rendering)
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
            return False
        
        print("✅ Found target table")
        
        # Check the results
        print(f"\nImproved parsing results:")
        print(f"  Headers detected: {len(target_table.headers)} rows")
        print(f"  Data rows: {len(target_table.rows)}")
        
        if target_table.headers:
            print(f"\n📋 DETECTED HEADERS:")
            for i, header_row in enumerate(target_table.headers):
                header_texts = [cell.text().strip() for cell in header_row if cell.text().strip()]
                print(f"    Header row {i+1}: {header_texts}")
        else:
            print(f"\n❌ Still no headers detected")
            return False
        
        # Test Rich rendering with proper headers
        print(f"\n🎨 TESTING RICH RENDERING:")
        rich_table = target_table.render(width=120)
        from edgar.richtools import rich_to_text
        rich_text = rich_to_text(rich_table)
        
        # Check if Rich now produces structured output
        lines = rich_text.split('\n')
        structured_lines = [line for line in lines if any(c in line for c in '┌┐└┘├┤│─')]
        
        print(f"  Rich output length: {len(rich_text)} chars")
        print(f"  Total lines: {len(lines)}")
        print(f"  Structured lines: {len(structured_lines)}")
        
        if len(structured_lines) > 5:
            print(f"  ✅ Rich output is now properly structured!")
            
            # Show a sample of the structured output
            print(f"\n📊 RICH TABLE SAMPLE:")
            for i, line in enumerate(lines[:10]):
                if line.strip():
                    print(f"    {line}")
            
            return True
        else:
            print(f"  ❌ Rich output still lacks proper structure")
            print(f"  Sample lines:")
            for i, line in enumerate(lines[:5]):
                print(f"    {i+1}: {line[:60]}{'...' if len(line) > 60 else ''}")
            
            return False
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

def compare_before_after():
    """Compare table quality across all tables after the fix."""
    print(f"\n📊 COMPARING TABLE QUALITY ACROSS ALL TABLES")
    print("=" * 50)
    
    try:
        with open('/Users/dwight/PycharmProjects/edgartools/data/html/MSFT.10-K.html', 'r') as f:
            html_content = f.read()
        
        config = ParserConfig()
        parser = HTMLParser(config)
        document = parser.parse(html_content)
        
        # Collect all tables
        all_tables = []
        def collect_tables(node):
            if isinstance(node, TableNode):
                all_tables.append(node)
            if hasattr(node, 'children'):
                for child in node.children:
                    collect_tables(child)
        
        collect_tables(document.root)
        
        print(f"Found {len(all_tables)} total tables")
        
        # Analyze table quality
        good_tables = 0
        tables_with_headers = 0
        
        from edgar.richtools import rich_to_text
        
        for i, table in enumerate(all_tables):
            try:
                # Count tables with headers
                if table.headers:
                    tables_with_headers += 1
                
                # Test Rich rendering quality
                rich_table = table.render(width=120)
                rich_text = rich_to_text(rich_table)
                
                lines = rich_text.split('\n')
                structured_lines = [line for line in lines if any(c in line for c in '┌┐└┘├┤│─')]
                
                if len(structured_lines) > 3:
                    good_tables += 1
                    
            except Exception as e:
                pass  # Skip problematic tables
        
        print(f"\nTable quality summary:")
        print(f"  Tables with headers: {tables_with_headers}/{len(all_tables)} ({tables_with_headers/len(all_tables)*100:.1f}%)")
        print(f"  Well-structured tables: {good_tables}/{len(all_tables)} ({good_tables/len(all_tables)*100:.1f}%)")
        
        if tables_with_headers > 0:
            print(f"  ✅ Header detection is working!")
        else:
            print(f"  ❌ Header detection still needs work")
        
        if good_tables > 0:
            print(f"  ✅ Some tables now render with proper structure!")
        else:
            print(f"  ❌ Rich rendering still needs improvement")
            
        return tables_with_headers > 0 and good_tables > 0
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

if __name__ == "__main__":
    print("🎯 TESTING IMPROVED TABLE PARSING")
    print("Focus: Better header detection for Rich table rendering")
    print()
    
    # Test specific target table
    target_success = test_header_detection_improvement()
    
    # Test overall improvement
    overall_success = compare_before_after()
    
    print(f"\n🏁 FINAL RESULTS:")
    print(f"  Target table fixed: {'✅' if target_success else '❌'}")
    print(f"  Overall improvement: {'✅' if overall_success else '❌'}")
    
    if target_success and overall_success:
        print(f"\n🎉 SUCCESS!")
        print("The table parsing issue has been resolved!")
        print("Tables now render with beautiful Rich formatting!")
    elif target_success:
        print(f"\n🎯 PARTIAL SUCCESS!")
        print("The target table is fixed, but more work needed on other tables.")
    else:
        print(f"\n🔧 MORE WORK NEEDED")
        print("Header detection improvements aren't sufficient yet.")