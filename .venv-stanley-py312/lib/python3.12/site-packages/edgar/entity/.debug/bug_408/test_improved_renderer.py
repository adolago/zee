#!/usr/bin/env python3
"""
Test the improved FastTableRenderer with column filtering.
"""

import sys
sys.path.insert(0, '/Users/dwight/PycharmProjects/edgartools')

from edgar.documents.parser import HTMLParser
from edgar.documents.config import ParserConfig
from edgar.documents.table_nodes import TableNode

def test_improved_rendering():
    print("🧪 TESTING IMPROVED FAST TABLE RENDERER")
    print("=" * 55)
    
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
            return False
        
        print("✅ Found target table")
        
        # Clear cache to get fresh rendering
        if hasattr(target_table, '_text_cache'):
            target_table._text_cache = None
        
        # Get new table text
        table_text = target_table.text()
        
        print(f"\nImproved table output ({len(table_text)} characters):")
        print("-" * 60)
        print(table_text)
        print("-" * 60)
        
        # Analyze the improvement
        lines = [line for line in table_text.split('\n') if line.strip()]
        pipe_lines = [line for line in lines if '|' in line]
        
        if pipe_lines:
            # Count columns in the first content line
            first_content_line = pipe_lines[0]
            column_count = first_content_line.count('|') - 1  # Subtract 1 for border
            print(f"\nTable structure analysis:")
            print(f"  Total lines: {len(lines)}")
            print(f"  Lines with pipes: {len(pipe_lines)}")
            print(f"  Columns: {column_count}")
            
            # Check if it looks reasonable (should be ~4 columns: Description, 2025, 2024, 2023)
            if 3 <= column_count <= 6:
                print(f"  ✅ Column count looks reasonable ({column_count} columns)")
            else:
                print(f"  ⚠️  Column count still seems high ({column_count} columns)")
        
        # Check for specific improvements
        improvements = []
        issues = []
        
        if "Weighted average outstanding shares" in table_text:
            improvements.append("Contains target text")
        else:
            issues.append("Missing target text")
        
        if "|" in table_text:
            improvements.append("Has pipe separators")
        else:
            issues.append("No pipe separators")
        
        # Count empty columns (sequences of | | | with only spaces between)
        empty_column_pattern = r'\|\s*\|\s*\|'
        import re
        empty_sequences = len(re.findall(empty_column_pattern, table_text))
        if empty_sequences < 5:  # Much fewer than before
            improvements.append("Reduced empty columns")
        else:
            issues.append("Still many empty columns")
        
        if len(table_text) < 2000:  # Should be more compact
            improvements.append("More compact output")
        else:
            issues.append("Still verbose output")
        
        print(f"\nQuality assessment:")
        if improvements:
            print("  ✅ Improvements:")
            for improvement in improvements:
                print(f"    - {improvement}")
        
        if issues:
            print("  ⚠️  Remaining issues:")
            for issue in issues:
                print(f"    - {issue}")
        
        # Show sample of first few lines for readability
        print(f"\nFirst few lines preview:")
        for i, line in enumerate(pipe_lines[:5]):
            print(f"  {i+1}: {line}")
        
        return len(issues) == 0
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

def compare_with_rich():
    """Compare the improved fast renderer with Rich renderer."""
    print(f"\n🔄 COMPARING WITH RICH RENDERER")
    print("=" * 55)
    
    try:
        with open('/Users/dwight/PycharmProjects/edgartools/data/html/MSFT.10-K.html', 'r') as f:
            html_content = f.read()
        
        # Test both renderers
        configs = [
            ("Fast Renderer", ParserConfig(fast_table_rendering=True)),
            ("Rich Renderer", ParserConfig(fast_table_rendering=False)),
        ]
        
        for config_name, config in configs:
            print(f"\n🔧 {config_name}:")
            
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
            
            if target_table:
                table_text = target_table.text()
                lines = table_text.split('\n')
                pipe_lines = [line for line in lines if '|' in line and line.strip()]
                
                print(f"  Length: {len(table_text)} chars")
                print(f"  Lines: {len(lines)}")
                print(f"  Pipe lines: {len(pipe_lines)}")
                print(f"  Contains target: {'✅' if 'Weighted average outstanding shares' in table_text else '❌'}")
                print(f"  First line: {lines[0][:60]}..." if lines else "  No lines")
            else:
                print("  ❌ Table not found")
    
    except Exception as e:
        print(f"❌ Comparison failed: {e}")

if __name__ == "__main__":
    success = test_improved_rendering()
    compare_with_rich()
    
    if success:
        print(f"\n🎉 SUCCESS!")
        print("The improved FastTableRenderer is working well!")
    else:
        print(f"\n🔧 NEEDS MORE WORK")
        print("The renderer still needs improvements.")