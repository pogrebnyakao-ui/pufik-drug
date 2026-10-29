#!/usr/bin/env python3
"""Make fonts/PufikEmoji.ttf: Noto Color Emoji cut down to the emoji that game/pufik.html uses.

Why
    In the Android app the game draws its emoji with this font (window.PUFIK_APP is set, K.EMOJI starts
    with "PufikEmoji"), so they look the same on every phone: stock Android before 13 lacks some of the
    game's emoji (empty boxes), and phone makers ship emoji of their own design. The browser version of
    the game keeps the system emoji. scripts/build-web.mjs copies the font to www/fonts/ and prints a
    WARNING when the game uses an emoji the font lacks: then run this script again and commit fonts/.

What it does
    1. Finds every emoji in game/pufik.html, written literally (escapes such as \\u{1F600} are not
       decoded): characters of the source font outside ASCII, with an optional variation selector or
       skin tone and tag characters, keycaps (digit + U+FE0F + U+20E3), flags (two regional indicators)
       and ZWJ sequences of these.
    2. Subsets the source font to their code points plus U+FE0F, U+200D and U+20E3, keeping GSUB (the
       ligatures of ZWJ sequences, keycaps and flags) and every name record (copyright, licence).
    3. Writes fonts/PufikEmoji.ttf and fonts/PufikEmoji.json: the source font's name and version, the
       code points the subset covers and the emoji found. The same inputs give byte-identical files.

Source font
    Noto Color Emoji, the CBDT/CBLC (bitmap) build; SIL Open Font License 1.1, see
    fonts/OFL-NotoColorEmoji.txt. The committed subset is made from version 2.047:
    /usr/share/fonts/truetype/noto/NotoColorEmoji.ttf of the Ubuntu 24.04 package
    fonts-noto-color-emoji 2.047-0ubuntu0.24.04.1 (sha256 93cdc4ee...f48a477, also recorded in the
    .json). Upstream: https://github.com/googlefonts/noto-emoji, release v2.047, fonts/NotoColorEmoji.ttf.
    Use this CBDT/CBLC build (the script checks for it), not Noto-COLRv1.ttf: only CBDT was tested in the app.

Run it from the repository root (Python 3.8+ and fontTools, tested with fontTools 4.68.0; the venv lives
outside the repository):
    python3 -m venv ~/venv-pufik-emoji
    ~/venv-pufik-emoji/bin/pip install fonttools
    ~/venv-pufik-emoji/bin/python scripts/subset-emoji.py [--font path/to/NotoColorEmoji.ttf]
    npm run build:web        # must not print the emoji WARNING any more
    git add fonts/           # PufikEmoji.ttf and PufikEmoji.json
(On Windows: ~/venv-pufik-emoji/Scripts/python.exe.)
"""

import argparse
import hashlib
import json
import os
import sys

try:
    from fontTools import subset, version as fonttools_version
    from fontTools.ttLib import TTFont
except ImportError:
    sys.exit('subset-emoji: fontTools is missing. Install it in a venv: python3 -m venv ~/venv-pufik-emoji && '
             '~/venv-pufik-emoji/bin/pip install fonttools, then run ~/venv-pufik-emoji/bin/python scripts/subset-emoji.py')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_CANDIDATES = [
    '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf',                  # Debian, Ubuntu
    '/usr/share/fonts/google-noto-color-emoji-fonts/NotoColorEmoji.ttf',  # Fedora
    '/usr/share/fonts/noto/NotoColorEmoji.ttf',                           # Arch
]
FAMILY = 'PufikEmoji'

VS15, VS16, ZWJ, KEYCAP = 0xFE0E, 0xFE0F, 0x200D, 0x20E3
ALWAYS = (VS16, ZWJ, KEYCAP)              # kept even when unused: sequences need them
KEYCAP_BASES = set(map(ord, '0123456789#*'))


def is_modifier(c): return 0x1F3FB <= c <= 0x1F3FF
def is_tag(c): return 0xE0020 <= c <= 0xE007F
def is_ri(c): return 0x1F1E6 <= c <= 0x1F1FF
def is_pua(c): return 0xE000 <= c <= 0xF8FF or c >= 0xF0000


def find_emoji(text, cmap):
    """Emoji sequences in text, in order of appearance, plus characters that look like emoji but are not in
    the font. An emoji character is one the source font maps, outside ASCII (Noto Color Emoji maps exactly
    the Unicode Emoji=Yes characters, plus the joiners and tags handled here), the same set as /\\p{Emoji}/u
    in scripts/build-web.mjs."""
    cps = [ord(ch) for ch in text]
    n = len(cps)

    def emoji_char(c):
        return c >= 0x80 and c in cmap and c not in (ZWJ, KEYCAP, VS15, VS16) and not is_tag(c) and not is_pua(c)

    def element(i):                       # end of the emoji element starting at i, or i when there is none
        c = cps[i]
        if c in KEYCAP_BASES:
            j = i + 1
            if j < n and cps[j] == VS16:
                j += 1
            return j + 1 if j < n and cps[j] == KEYCAP else i
        if is_ri(c) and i + 1 < n and is_ri(cps[i + 1]):
            return i + 2
        if not emoji_char(c):
            return i
        j = i + 1
        if j < n and (cps[j] in (VS15, VS16) or is_modifier(cps[j])):
            j += 1
        while j < n and is_tag(cps[j]):
            j += 1
        return j

    found, missing, i = [], [], 0
    while i < n:
        j = element(i)
        if j == i:
            c = cps[i]
            nxt = cps[i + 1] if i + 1 < n else 0
            if c >= 0x80 and c not in cmap and (nxt in (VS16, KEYCAP) or 0x1F000 <= c <= 0x1FAFF):
                missing.append(c)       # an emoji newer than the source font (or a typo)
            i += 1
            continue
        while j + 1 < n and cps[j] == ZWJ and element(j + 1) > j + 1:
            j = element(j + 1)
        found.append(''.join(map(chr, cps[i:j])))
        i = j
    return found, missing


def name_of(font, name_id):
    return font['name'].getDebugName(name_id) or ''


def rel(path, start=ROOT):
    try:
        return os.path.relpath(os.path.abspath(path), start).replace(os.sep, '/')
    except ValueError:                    # another drive on Windows
        return path


def main():
    ap = argparse.ArgumentParser(description='Subset Noto Color Emoji to the emoji of game/pufik.html (see the header of this file).')
    ap.add_argument('--font', help='source NotoColorEmoji.ttf (CBDT/CBLC build); default: the system copy')
    ap.add_argument('--game', default=os.path.join(ROOT, 'game', 'pufik.html'), help='game file (default: game/pufik.html)')
    ap.add_argument('--out', default=os.path.join(ROOT, 'fonts'), help='output directory (default: fonts/)')
    args = ap.parse_args()

    src = args.font or next((p for p in FONT_CANDIDATES if os.path.isfile(p)), None)
    if not src or not os.path.isfile(src):
        sys.exit('subset-emoji: source font not found. Pass --font path/to/NotoColorEmoji.ttf '
                 '(https://github.com/googlefonts/noto-emoji, fonts/NotoColorEmoji.ttf) or install fonts-noto-color-emoji.')
    with open(src, 'rb') as f:
        src_sha = hashlib.sha256(f.read()).hexdigest()

    font = TTFont(src, lazy=False, recalcTimestamp=False)
    for tag in ('CBDT', 'CBLC', 'GSUB'):
        if tag not in font:
            sys.exit('subset-emoji: %s has no %s table; the CBDT/CBLC build of Noto Color Emoji is needed '
                     '(NotoColorEmoji.ttf, not Noto-COLRv1.ttf).' % (src, tag))
    cmap = dict(font.getBestCmap())
    src_name, src_version = name_of(font, 1), name_of(font, 5)

    with open(args.game, encoding='utf-8-sig') as f:
        game = f.read()
    found, missing = find_emoji(game, cmap)
    emoji = sorted(set(found), key=lambda s: [ord(c) for c in s])
    wanted = sorted({ord(c) for s in emoji for c in s} | set(ALWAYS))

    opts = subset.Options()
    opts.layout_features = ['*']           # GSUB: ZWJ / keycap / flag ligatures
    opts.name_IDs = ['*']                  # keep copyright, licence and version strings
    opts.name_languages = ['*']
    opts.name_legacy = True
    opts.recalc_timestamp = False          # reproducible output
    opts.ignore_missing_unicodes = True    # U+FE0F is not in the cmap of Noto Color Emoji (the shaper handles it)
    sub = subset.Subsetter(options=opts)
    sub.populate(unicodes=wanted)
    sub.subset(font)

    os.makedirs(args.out, exist_ok=True)
    out_font = os.path.join(args.out, FAMILY + '.ttf')
    subset.save_font(font, out_font, opts)

    check = TTFont(out_font)
    covered = sorted(check.getBestCmap())
    lost = [c for c in wanted if c in cmap and c not in covered]
    if lost or any(t not in check for t in ('CBDT', 'CBLC', 'GSUB')):
        sys.exit('subset-emoji: the subset lost glyphs or tables: %s' % ' '.join('U+%04X' % c for c in lost))

    info = {
        'font': FAMILY + '.ttf',
        'family': FAMILY,
        'source': {
            'name': src_name,
            'version': src_version.split(';')[0].replace('Version', '').strip(),
            'versionString': src_version,
            'file': os.path.basename(src),
            'sha256': src_sha,
            'license': 'SIL Open Font License 1.1 (OFL-NotoColorEmoji.txt)',
            'url': 'https://github.com/googlefonts/noto-emoji',
        },
        'game': rel(args.game),
        'tool': 'scripts/subset-emoji.py, fontTools %s' % fonttools_version,
        'glyphs': len(check.getGlyphOrder()),
        'codepoints': ['U+%04X' % c for c in covered],
        'emoji': emoji,
        'missing': ['U+%04X' % c for c in sorted(set(missing))],
    }
    out_json = os.path.join(args.out, FAMILY + '.json')
    with open(out_json, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(info, f, ensure_ascii=False, indent=1)
        f.write('\n')

    print('subset-emoji: %s %s, %d emoji (%d code points) from %s -> %s (%d bytes, %d glyphs), %s'
          % (src_name, info['source']['version'], len(emoji), len(covered), rel(args.game), rel(out_font),
             os.path.getsize(out_font), info['glyphs'], rel(out_json)))
    if missing:
        print('subset-emoji: WARNING: not in the source font (newer emoji?): %s. Use a newer NotoColorEmoji.ttf (--font).'
              % ' '.join('%s U+%04X' % (chr(c), c) for c in sorted(set(missing))), file=sys.stderr)


if __name__ == '__main__':
    main()
