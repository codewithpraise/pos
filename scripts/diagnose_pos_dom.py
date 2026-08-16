import sys
from html.parser import HTMLParser

class DOMNode:
    def __init__(self, tag, attrs, parent=None, line=0):
        self.tag = tag
        self.attrs = dict(attrs)
        self.parent = parent
        self.children = []
        self.line = line
        self.id = self.attrs.get('id', '')
        self.classes = self.attrs.get('class', '').split()

    def get_parent_chain(self):
        chain = []
        curr = self.parent
        while curr and curr.tag != '[document]':
            cls_str = ('.' + '.'.join(curr.classes)) if curr.classes else ''
            id_str = ('#' + curr.id) if curr.id else ''
            chain.append(f"{curr.tag}{id_str}{cls_str}")
            curr = curr.parent
        return chain

class RobustHTMLTreeBuilder(HTMLParser):
    VOID_TAGS = {
        'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 
        'link', 'meta', 'param', 'source', 'track', 'wbr'
    }

    def __init__(self):
        super().__init__()
        self.root = DOMNode('[document]', {})
        self.current = self.root
        self.all_views = []

    def handle_starttag(self, tag, attrs):
        line, _ = self.getpos()
        node = DOMNode(tag, attrs, parent=self.current, line=line)
        self.current.children.append(node)
        
        if 'content-view' in node.classes:
            self.all_views.append(node)

        if tag.lower() not in self.VOID_TAGS:
            self.current = node

    def handle_endtag(self, tag):
        tag_lower = tag.lower()
        if tag_lower in self.VOID_TAGS:
            return
        
        # Traverse upwards to match closing tag
        curr = self.current
        while curr and curr.tag != '[document]' and curr.tag.lower() != tag_lower:
            curr = curr.parent
            
        if curr and curr.tag.lower() == tag_lower:
            self.current = curr.parent
        else:
            # Unmatched end tag, ignore or log
            pass

def analyze_html(file_path='public/index.html'):
    with open(file_path, 'r', encoding='utf-8') as f:
        html = f.read()

    parser = RobustHTMLTreeBuilder()
    parser.feed(html)

    print('======================================================================')
    print('VALENIXIA POS DOM HIERARCHY & NESTING DIAGNOSTIC (Pure Standard Python)')
    print('======================================================================')
    print(f'Total .content-view sections discovered: {len(parser.all_views)}\n')

    id_counts = {}
    illegal_nested = []

    for v in parser.all_views:
        vid = v.id or '(unnamed)'
        id_counts[vid] = id_counts.get(vid, 0) + 1
        
        parents = v.get_parent_chain()
        is_nested_in_view = any('content-view' in p for p in parents)
        
        direct_parent = parents[0] if parents else 'ROOT'
        if is_nested_in_view:
            illegal_nested.append((vid, v.line, parents))
            print(f'[CRITICAL ERROR] Line {v.line:4d}: #{vid} is NESTED inside another view!')
            print(f'                 Parent Chain: {" -> ".join(parents[:4])}')
        else:
            print(f'[OK] Line {v.line:4d}: #{vid:24} (Parent: {direct_parent})')

    print('\n======================================================================')
    print('DUPLICATE VIEW IDs:')
    duplicates = {k: v for k, v in id_counts.items() if v > 1}
    if duplicates:
        for k, v in duplicates.items():
            print(f'  [DUPLICATE] #{k}: occurs {v} times in DOM')
    else:
        print('  None! All view IDs are strictly unique.')

    print('======================================================================')
    print(f'SUMMARY: Total={len(parser.all_views)}, Illegal Nested={len(illegal_nested)}, Duplicates={len(duplicates)}')
    print('======================================================================')

if __name__ == '__main__':
    analyze_html()
