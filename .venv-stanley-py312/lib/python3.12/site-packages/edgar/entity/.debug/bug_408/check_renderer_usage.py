#!/usr/bin/env python3
"""
Check which renderer is actually being used in the MSFT table.
"""

import sys
sys.path.insert(0, '/Users/dwight/PycharmProjects/edgartools')

from edgar.documents.parser import HTMLParser
from edgar.documents.config import ParserConfig
from edgar.documents.table_nodes import TableNode

def check_renderer_usage():
    print("🔍 CHECKING WHICH RENDERER IS ACTUALLY BEING USED")
    print("=" * 60)
    
    try:
        # Parse with default config
        with open('/Users/dwight/PycharmProjects/edgartools/data/html/MSFT.10-K.html', 'r') as f:
            html_content = f.read()
        
        # Check what the default config actually has
        config = ParserConfig()
        print(f"Default ParserConfig.fast_table_rendering: {config.fast_table_rendering}")
        
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
        
        print(f"✅ Found target table")
        print(f"Table has _config: {'✅' if hasattr(target_table, '_config') else '❌'}")
        
        if hasattr(target_table, '_config'):
            print(f"Table config fast_table_rendering: {target_table._config.fast_table_rendering}")
        
        # Test the decision logic in TableNode.text()
        print(f"\n🔍 TRACING TableNode.text() DECISION LOGIC:")
        
        # Check if cache exists
        has_cache = hasattr(target_table, '_text_cache') and target_table._text_cache is not None
        print(f"Has cached text: {has_cache}")
        
        if has_cache:
            print(f"❗ Using cached result - clearing cache to test renderer...")
            target_table._text_cache = None
        
        # Check the config decision
        config_obj = getattr(target_table, '_config', None)
        should_use_fast = config_obj and getattr(config_obj, 'fast_table_rendering', False)
        print(f"Config object exists: {'✅' if config_obj else '❌'}")
        print(f"Should use fast rendering: {'✅' if should_use_fast else '❌'}")
        
        # Test both renderers directly
        print(f"\n🧪 TESTING BOTH RENDERERS DIRECTLY:")
        
        # Test Rich renderer
        try:
            print("Rich renderer test:")
            rich_table = target_table.render(width=195)
            from edgar.richtools import rich_to_text
            rich_text = rich_to_text(rich_table)
            rich_has_pipes = '|' in rich_text
            print(f"  Rich output has pipes: {'✅' if rich_has_pipes else '❌'}")
            print(f"  Rich output length: {len(rich_text)} chars")
            print(f"  Rich preview: {rich_text[:80]}...")
        except Exception as e:
            print(f"  Rich renderer error: {e}")
        
        # Test Fast renderer
        try:
            print("Fast renderer test:")
            fast_text = target_table._fast_text_rendering()
            fast_has_pipes = '|' in fast_text
            print(f"  Fast output has pipes: {'✅' if fast_has_pipes else '❌'}")
            print(f"  Fast output length: {len(fast_text)} chars")
            print(f"  Fast preview: {fast_text[:80]}...")
        except Exception as e:
            print(f"  Fast renderer error: {e}")
        
        # Test current text() method
        print("Current text() method:")
        current_text = target_table.text()
        current_has_pipes = '|' in current_text
        print(f"  Current output has pipes: {'✅' if current_has_pipes else '❌'}")
        print(f"  Current output length: {len(current_text)} chars")
        print(f"  Current preview: {current_text[:80]}...")
        
        # Determine which renderer is actually being used
        if current_has_pipes and len(current_text) < 2000:
            print(f"\n🎯 CONCLUSION: Currently using FAST RENDERER ✅")
        elif not current_has_pipes and len(current_text) > 1500:
            print(f"\n🎯 CONCLUSION: Currently using RICH RENDERER ❌")
        else:
            print(f"\n🤔 CONCLUSION: Unclear which renderer is being used")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()

def test_explicit_configurations():
    """Test with explicit fast and rich configurations."""
    print(f"\n🧪 TESTING EXPLICIT CONFIGURATIONS")
    print("=" * 60)
    
    configs = [
        ("Explicit Fast", ParserConfig(fast_table_rendering=True)),
        ("Explicit Rich", ParserConfig(fast_table_rendering=False)),
    ]
    
    try:
        with open('/Users/dwight/PycharmProjects/edgartools/data/html/MSFT.10-K.html', 'r') as f:
            html_content = f.read()
        
        for config_name, config in configs:
            print(f"\n🔧 {config_name} (fast_table_rendering={config.fast_table_rendering}):")
            
            parser = HTMLParser(config)
            document = parser.parse(html_content)
            
            # Find table
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
                has_pipes = '|' in table_text
                print(f"  Output has pipes: {'✅' if has_pipes else '❌'}")
                print(f"  Output length: {len(table_text)} chars")
                print(f"  Preview: {table_text[:60]}...")
            else:
                print(f"  ❌ Table not found")
    
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    check_renderer_usage()
    test_explicit_configurations()