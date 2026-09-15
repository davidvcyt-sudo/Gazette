/**
 * The list of words the game will accept as a guess.
 *
 * Stored in the compact form described in wordlist.js — about a third of the
 * size of the words written out.
 */

import { unpackWords } from './wordlist.js';

/**
 * The single-file build (npm run build:single) bakes the word data into the
 * page and sets this global, so there is nothing to fetch. On the ordinary
 * site the global is absent and the files are fetched as usual.
 */
export function inlineData(key) {
  return globalThis.WORDETTE_DATA?.[key];
}

export async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`could not load ${url} (${response.status})`);
  return response.json();
}

export async function loadDictionary(url, wordLength) {
  const payload = inlineData('dictionary') ?? await fetchJson(url);
  const length = payload.wordLength ?? wordLength;
  let words;

  if (typeof payload.packed === 'string') {
    words = unpackWords(payload.packed, length);
  } else if (Array.isArray(payload.words)) {
    words = new Set(payload.words);
  } else {
    throw new Error(`${url} is not in a format this game understands`);
  }

  return {
    size: words.size,
    has: (word) => words.has(String(word).toLowerCase()),
  };
}
