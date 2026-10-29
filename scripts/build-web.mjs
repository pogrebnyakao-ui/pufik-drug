#!/usr/bin/env node
// Builds www/ for the Android app (Capacitor webDir) from game/pufik.html.
//
// www/index.html = APP wrapper prefix + game file, with the Google Fonts <link>
// swapped for the local fonts/nunito.css (contract A in README.md). The prefix sets
// window.PUFIK_APP = {platform, version, appName, developer, email, privacyUrl}
// from package.json ("version" and the "pufik" object); the game shows them in its
// parent menu («О приложении»).
// www/fonts/     = Nunito 700/800/900 woff2 (latin, latin-ext, cyrillic, cyrillic-ext)
//                  from @fontsource/nunito, plus nunito.css and the font licence;
//                  PufikEmoji.ttf (fonts/, Noto Color Emoji cut down to the game's emoji
//                  by scripts/subset-emoji.py) and its licence; nunito.css declares it too.
// www/<file>     = every file of web-extra/ (if any), unchanged. The page that
//                  capacitor.config.json names in server.errorPath must be among them.
//
// No dependencies besides @fontsource/nunito. Any surprise is a hard error:
// a broken build must never reach the store quietly. The one exception is an emoji
// the game uses but fonts/PufikEmoji.ttf lacks: a WARNING (the phone's own emoji
// font draws it; in GitHub Actions also a ::warning annotation on the run page),
// fixed by running scripts/subset-emoji.py again.

import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GAME = join(ROOT, 'game', 'pufik.html');
const PKG = join(ROOT, 'package.json');
const CAP_CONFIG = join(ROOT, 'capacitor.config.json');
const EMOJI_TTF = join(ROOT, 'fonts', 'PufikEmoji.ttf');
const EMOJI_JSON = join(ROOT, 'fonts', 'PufikEmoji.json');
const EMOJI_LICENSE = join(ROOT, 'fonts', 'OFL-NotoColorEmoji.txt');
const EXTRA = join(ROOT, 'web-extra');
const OUT = join(ROOT, 'www');
const FONTS_OUT = join(OUT, 'fonts');

const LOCAL_FONT_LINK = '<link rel="stylesheet" href="fonts/nunito.css">';
const GOOGLE_FONT_LINK = /<link\b[^>]*\bhref\s*=\s*["']https:\/\/fonts\.googleapis\.com\/css2\?family=Nunito[^"']*["'][^>]*>/gi;

const WEIGHTS = [700, 800, 900];
const SUBSETS = ['cyrillic-ext', 'cyrillic', 'latin-ext', 'latin']; // same order as fontsource / Google Fonts

function fail(msg) {
  console.error(`\nbuild-web: ERROR: ${msg}\n`);
  process.exit(1);
}

// --- window.PUFIK_APP from package.json ----------------------------------
let pkg;
try {
  pkg = JSON.parse(readFileSync(PKG, 'utf8'));
} catch (e) {
  fail(`cannot read package.json: ${e.message}`);
}
const PUFIK_FIELDS = ['appName', 'developer', 'email', 'privacyUrl'];
const about = pkg.pufik === undefined ? {} : pkg.pufik;
if (!about || typeof about !== 'object' || Array.isArray(about)) fail('package.json "pufik" must be an object.');
for (const key of Object.keys(about)) {
  if (!PUFIK_FIELDS.includes(key)) console.warn(`build-web: WARNING: package.json "pufik.${key}" is unknown and ignored (known: ${PUFIK_FIELDS.join(', ')}).`);
}
const APP = { platform: 'android' };
if (pkg.version !== undefined) {
  if (typeof pkg.version !== 'string') fail('package.json "version" must be a string.');
  APP.version = pkg.version;
}
for (const key of PUFIK_FIELDS) {
  const value = about[key] === undefined && key === 'appName' ? 'Пуфик' : about[key];
  if (value === undefined) continue;
  if (typeof value !== 'string' || !value.trim()) fail(`package.json "pufik.${key}" must be a non-empty string.`);
  APP[key] = value.trim();
}
// JSON is a JS expression; "<" escaped so no "</script>" or "<!--" can end or break the inline script
const appJson = JSON.stringify(APP).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const PREFIX =
  '<!doctype html><html lang="ru"><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">' +
  `<script>window.PUFIK_APP=${appJson};</script>`;

// --- server.errorPath: the page Capacitor shows instead of the game in a too old WebView ---
// It must end up in www/ (checked after the web-extra/ copy): on a 404 Capacitor opens errorPath again, and an old
// WebView would reload it endlessly instead of showing how to update.
let errorPath;
if (existsSync(CAP_CONFIG)) {
  try {
    errorPath = (JSON.parse(readFileSync(CAP_CONFIG, 'utf8')).server || {}).errorPath;
  } catch (e) {
    fail(`cannot read capacitor.config.json: ${e.message}`);
  }
  if (errorPath !== undefined && (typeof errorPath !== 'string' || !errorPath.trim() || /^[\\/]|(^|[\\/])\.\.([\\/]|$)/.test(errorPath))) {
    fail('capacitor.config.json "server.errorPath" must be a file path inside www/ without a leading "/", like "webview-update.html".');
  }
}

// --- game ---------------------------------------------------------------
if (!existsSync(GAME)) fail(`${relative(ROOT, GAME)} not found.`);
let game = readFileSync(GAME, 'utf8');
if (game.charCodeAt(0) === 0xfeff) game = game.slice(1); // a BOM in the middle of the page would break <head>
if (/<!doctype|<html[\s>]/i.test(game.slice(0, 2000))) {
  console.warn('build-web: WARNING: game/pufik.html looks like a full HTML document; the artifact format (starting with <title>) is expected.');
}

const links = game.match(GOOGLE_FONT_LINK) || [];
if (links.length !== 1) {
  fail(
    `expected exactly one Google Fonts Nunito <link> (href="https://fonts.googleapis.com/css2?family=Nunito...") ` +
      `in ${relative(ROOT, GAME)}, found ${links.length}. The app must not load fonts from the internet; ` +
      `update scripts/build-web.mjs if the game changed the way it loads fonts.`
  );
}
const page = PREFIX + game.replace(GOOGLE_FONT_LINK, LOCAL_FONT_LINK);

const external = page.match(/https?:\/\/fonts\.(googleapis|gstatic)\.com[^"'\s)>]*/gi);
if (external) fail(`Google Fonts references left after the swap: ${external.join(', ')}`);

// --- emoji font: which emoji of the game it lacks ----------------------------
// An emoji = a non-ASCII Emoji character (+ variation selector or skin tone, + tags), a keycap or a flag,
// joined by U+200D; the same rule as find_emoji() in scripts/subset-emoji.py.
for (const f of [EMOJI_TTF, EMOJI_JSON, EMOJI_LICENSE]) {
  if (!existsSync(f)) fail(`${relative(ROOT, f)} not found. Run scripts/subset-emoji.py (see its header) and commit fonts/.`);
}
let emojiInfo;
try {
  emojiInfo = JSON.parse(readFileSync(EMOJI_JSON, 'utf8'));
  if (!Array.isArray(emojiInfo.codepoints) || !emojiInfo.codepoints.every(c => /^U\+[0-9A-F]{4,6}$/.test(c))) throw new Error('no "codepoints" list');
} catch (e) {
  fail(`${relative(ROOT, EMOJI_JSON)} is broken (${e.message}). Run scripts/subset-emoji.py again.`);
}
const covered = new Set(emojiInfo.codepoints.map(c => parseInt(c.slice(2), 16)));
const EL = String.raw`(?:[0-9#*]\uFE0F?\u20E3|\p{Regional_Indicator}{2}|(?![\0-\x7F])\p{Emoji}[\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}]?[\u{E0020}-\u{E007F}]*)`;
const EMOJI = new RegExp(`${EL}(?:\\u200D${EL})*`, 'gu');
const uncovered = [...new Set(game.match(EMOJI) || [])].filter(e => [...e].some(ch => !/[\uFE0E\uFE0F]/.test(ch) && !covered.has(ch.codePointAt(0))));

// --- fonts --------------------------------------------------------------
const require = createRequire(import.meta.url);
let fontPkgDir;
try {
  fontPkgDir = dirname(require.resolve('@fontsource/nunito/package.json'));
} catch {
  fail('@fontsource/nunito is not installed. Run "npm ci" first.');
}
const ranges = JSON.parse(readFileSync(join(fontPkgDir, 'unicode.json'), 'utf8'));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(FONTS_OUT, { recursive: true });

let css = '/* Nunito 700/800/900 from @fontsource/nunito (SIL OFL 1.1, see LICENSE-Nunito-OFL.txt). Generated by scripts/build-web.mjs. */\n';
for (const weight of WEIGHTS) {
  for (const subset of SUBSETS) {
    const range = ranges[subset];
    if (!range) fail(`@fontsource/nunito has no unicode range for subset "${subset}".`);
    const file = `nunito-${subset}-${weight}-normal.woff2`;
    const src = join(fontPkgDir, 'files', file);
    if (!existsSync(src)) fail(`font file missing in @fontsource/nunito: files/${file}`);
    copyFileSync(src, join(FONTS_OUT, file));
    css +=
      `\n/* nunito-${subset}-${weight}-normal */\n@font-face {\n` +
      `  font-family: "Nunito";\n  font-style: normal;\n  font-display: swap;\n  font-weight: ${weight};\n` +
      `  src: url(${file}) format("woff2");\n  unicode-range: ${range};\n}\n`;
  }
}
// unicode-range = what the font has (+ U+FE0F, shaped with the emoji before it): without it the face would "contain" the
// space and could stand in as the primary font (line height, input widths) while a Nunito face is still loading
const cps = [...new Set([...covered, 0xfe0f])].sort((a, b) => a - b), spans = [];
for (const c of cps) { const last = spans[spans.length - 1]; if (last && c === last[1] + 1) last[1] = c; else spans.push([c, c]); }
const hex = c => c.toString(16).toUpperCase();
const emojiRange = spans.map(([a, b]) => (a === b ? `U+${hex(a)}` : `U+${hex(a)}-${hex(b)}`)).join(', ');
const emojiSrc = emojiInfo.source || {};
css +=
  `\n/* PufikEmoji: ${emojiSrc.name || 'Noto Color Emoji'} ${emojiSrc.version || ''} cut down to the game's emoji by scripts/subset-emoji.py\n` +
  `   (SIL OFL 1.1, see LICENSE-NotoColorEmoji-OFL.txt). The game names it in app mode only. */\n` +
  `@font-face {\n  font-family: "PufikEmoji";\n  font-style: normal;\n  font-display: block;\n  font-weight: 100 900;\n` +
  `  src: url(PufikEmoji.ttf) format("truetype");\n  unicode-range: ${emojiRange};\n}\n`;
writeFileSync(join(FONTS_OUT, 'nunito.css'), css);
copyFileSync(join(fontPkgDir, 'LICENSE'), join(FONTS_OUT, 'LICENSE-Nunito-OFL.txt'));
copyFileSync(EMOJI_TTF, join(FONTS_OUT, 'PufikEmoji.ttf'));
copyFileSync(EMOJI_LICENSE, join(FONTS_OUT, 'LICENSE-NotoColorEmoji-OFL.txt'));

writeFileSync(join(OUT, 'index.html'), page);

// --- web-extra/: extra pages and files, copied as they are -------------------
// (dot files such as .gitkeep are skipped; a file may not replace one the build made)
const extra = [];
(function copyDir(from, to) {
  if (!existsSync(from)) return;
  for (const ent of readdirSync(from, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (ent.name.startsWith('.')) continue;
    const s = join(from, ent.name), d = join(to, ent.name);
    if (ent.isDirectory()) { mkdirSync(d, { recursive: true }); copyDir(s, d); continue; }
    if (existsSync(d)) fail(`${relative(ROOT, s)} would replace www/${relative(OUT, d)}, which the build makes. Rename it.`);
    copyFileSync(s, d);
    extra.push(relative(OUT, d).split('\\').join('/'));
  }
})(EXTRA, OUT);

if (errorPath !== undefined && !(existsSync(join(OUT, errorPath)) && statSync(join(OUT, errorPath)).isFile())) {
  fail(
    `www/${errorPath} is missing or not a file (capacitor.config.json "server.errorPath"): an old WebView would reload it endlessly ` +
      `instead of showing how to update. Put the page back into web-extra/ (README.md, section 9).`
  );
}

if (uncovered.length) {
  console.warn(
    `\nbuild-web: WARNING: game/pufik.html uses ${uncovered.length} emoji that fonts/PufikEmoji.ttf lacks: ` +
      uncovered.map(e => `${e} (${[...e].map(ch => 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ')})`).join(', ') +
      `.\nIn the app they are drawn by the phone's own emoji font (an empty box on older Android). ` +
      `Run scripts/subset-emoji.py again (see its header) and commit fonts/.\n`
  );
  // in GitHub Actions also an annotation: shown on the run page, where the log line above is easy to miss
  if (process.env.GITHUB_ACTIONS === 'true') {
    const msg = `В игре есть эмодзи, которых нет во встроенном шрифте fonts/PufikEmoji.ttf: ${uncovered.join(' ')}. ` +
      'В приложении их рисует шрифт телефона, на старых Android это может быть пустой квадратик. ' +
      'Шрифт нужно сделать заново: scripts/subset-emoji.py (README.md, раздел 9, G).';
    console.log(`::warning title=Шрифт эмодзи::${msg.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
  }
}
console.log(
  `build-web: www/index.html (${page.length} chars, app wrapper + local fonts), ` +
    `www/fonts/ (${WEIGHTS.length * SUBSETS.length} woff2 + PufikEmoji.ttf + nunito.css)` +
    (extra.length ? `, web-extra: ${extra.join(', ')}` : '')
);
