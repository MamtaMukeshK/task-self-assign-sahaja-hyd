"""Builds SETUP_GUIDE.html (one-stop setup guide) from the template plus the real Code.gs and Index.html.

Run from the repo root after changing either code file:  python3 tools/build_guide.py
"""
import html
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
page = (root / 'tools' / 'guide_template.html').read_text(encoding='utf-8')
for token, name in (('{{CODE_GS}}', 'Code.gs'), ('{{INDEX_HTML}}', 'Index.html')):
    assert page.count(token) == 1, token
    page = page.replace(token, html.escape((root / name).read_text(encoding='utf-8'), quote=False))
(root / 'SETUP_GUIDE.html').write_text(page, encoding='utf-8')
print('wrote SETUP_GUIDE.html')
