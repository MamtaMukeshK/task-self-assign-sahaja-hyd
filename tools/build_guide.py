"""Builds SETUP_GUIDE.html and followup/SETUP_GUIDE.html (one-stop setup guides) from their templates plus the real code files.

Run from the repo root after changing either code file:  python3 tools/build_guide.py
"""
import html
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
# Tour page guide, and the Follow-up Program guide (its own sheet and page; files in followup/).
for template, out, folder in (('guide_template.html', 'SETUP_GUIDE.html', ''),
                              ('followup_guide_template.html', 'followup/SETUP_GUIDE.html', 'followup/')):
    page = (root / 'tools' / template).read_text(encoding='utf-8')
    for token, name in (('{{CODE_GS}}', 'Code.gs'), ('{{INDEX_HTML}}', 'Index.html')):
        assert page.count(token) == 1, token
        page = page.replace(token, html.escape((root / (folder + name)).read_text(encoding='utf-8'), quote=False))
    (root / out).write_text(page, encoding='utf-8')
    print('wrote ' + out)
