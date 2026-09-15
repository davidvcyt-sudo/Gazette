/**
 * Everything the newsroom might want to change, in one place.
 */

export const CONFIG = {
  /** Shown in the header and in the text readers share. */
  name: 'The Wordette',
  publication: 'GZAAT Gazette',

  /** Change these and re-export the database if you ever want a 6-letter game. */
  wordLength: 5,
  maxGuesses: 6,

  /**
   * Where the game gets its words.
   *
   *   'static' — read the exported JSON files. No server needed; the whole
   *              schedule is in the page, lightly obfuscated (see cipher.js).
   *   'api'    — ask server/api.mjs for the current puzzle. Slower to set up,
   *              but tomorrow's word genuinely is not in the browser.
   */
  source: {
    mode: 'static',
    puzzlesUrl: 'data/puzzles.json',
    dictionaryUrl: 'data/dictionary.json',
    apiUrl: '/api/wordette',
  },

  /** Appended to the shared result. Set it to the page's public address. */
  shareUrl: 'https://gazette.gzaat.ge/wordette/',

  /** Swap these rows out for a different alphabet or layout. */
  keyboardRows: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'],

  /**
   * localStorage key prefix — bump the version to reset every reader's data.
   * If you change it, change the matching key in the small inline script at the
   * top of index.html too; that one runs before this file is loaded.
   */
  storagePrefix: 'gzaat-wordette:v1',

  /** Animation timings, in milliseconds. */
  flipDuration: 300,
  flipStagger: 240,
  toastDuration: 1400,
};
