#!/usr/bin/env node
/**
 * Build the whole game into one HTML file: `npm run build:single`.
 *
 * The result is dist/the-wordette.html — markup, styles, code and five years
 * of words in a single document with nothing to fetch and nothing to install.
 * It is meant for pasting into a website builder's HTML or embed box (Wix,
 * Squarespace, WordPress and the like), where a folder of files is not an
 * option.
 *
 * It is built from exactly the same sources as the ordinary site, so a change
 * to the words or the design reaches both: edit, then re-run this.
 *
 * How it works: the ES modules are concatenated in dependency order with their
 * import and export keywords stripped, wrapped in one function so nothing
 * leaks into the page around it, and the word data is written in as a global
 * the loaders already know to look for.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ROOT } from './lib/db.mjs';

const SRC = resolve(ROOT, 'public', 'wordette');
const OUT_DIR = resolve(ROOT, 'dist');
const OUT_FILE = resolve(OUT_DIR, 'the-wordette.html');

/** Dependency order: every module comes after the ones it uses. */
const MODULES = [
  'config.js', 'cipher.js', 'dates.js', 'game.js', 'storage.js',
  'wordlist.js', 'dictionary.js', 'puzzles.js', 'share.js', 'ui.js', 'main.js',
];

/** Strip the module wiring, leaving plain script that runs top to bottom. */
function flatten(source) {
  const lines = source.split('\n');
  const kept = [];
  let insideImport = false;

  for (const line of lines) {
    if (insideImport) {
      if (/;\s*$/.test(line)) insideImport = false;
      continue;
    }
    if (/^import\b/.test(line)) {
      if (!/;\s*$/.test(line)) insideImport = true;
      continue;
    }
    kept.push(line.replace(/^export\s+(?=(async\s+)?function|const|let|class)/, ''));
  }
  return kept.join('\n');
}

/** main.js reaches for the ui module as a namespace, so rebuild it by hand. */
function namespaceFor(source, name) {
  const exported = [...source.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)]
    .map((match) => match[1]);
  if (!exported.length) throw new Error(`no exports found for the ${name} namespace`);
  return `const ${name} = { ${exported.join(', ')} };`;
}

const css = readFileSync(resolve(SRC, 'styles.css'), 'utf8');
const html = readFileSync(resolve(SRC, 'index.html'), 'utf8');
const uiSource = readFileSync(resolve(SRC, 'js', 'ui.js'), 'utf8');

const puzzles = JSON.parse(readFileSync(resolve(SRC, 'data', 'puzzles.json'), 'utf8'));
const dictionary = JSON.parse(readFileSync(resolve(SRC, 'data', 'dictionary.json'), 'utf8'));

// Only what the game reads at run time — the build stamps are dropped.
const data = {
  puzzles: {
    startDate: puzzles.startDate,
    startNumber: puzzles.startNumber,
    answers: puzzles.answers,
  },
  dictionary: {
    wordLength: dictionary.wordLength,
    packed: dictionary.packed,
  },
};

const script = MODULES
  .map((name) => {
    const source = readFileSync(resolve(SRC, 'js', name), 'utf8');
    const body = flatten(source);
    // The ui namespace has to exist before main.js runs.
    return name === 'ui.js' ? `${body}\n\n${namespaceFor(uiSource, 'ui')}` : body;
  })
  .join('\n\n');

const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'))
  .replace(/<link rel="stylesheet"[^>]*>/, '')
  .trim();
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace('<script type="module" src="js/main.js"></script>', '')
  .trim();

const page = `<!doctype html>
<html lang="en">
<head>
${head}
<style>
${css}
</style>
</head>
<body>
${body}

<script>
/* The words: five years of puzzles and every guess the game accepts. */
window.WORDETTE_DATA = ${JSON.stringify(data)};
</script>
<script>
(function () {
'use strict';
${script}
}());
</script>
</body>
</html>
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, page);

const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`wrote ${OUT_FILE}`);
console.log(`  ${kb(Buffer.byteLength(page))} in total — ${puzzles.count} puzzles, ${dictionary.count} words`);
console.log(`  ${page.length.toLocaleString('en-US')} characters, if you are pasting it somewhere with a limit`);
