/**
 * Packing the guess dictionary.
 *
 * Nearly fifteen thousand words written out plainly is 73 KB, which is most of
 * the game's weight and a long wait on a slow phone. Two observations shrink it
 * to about 26 KB:
 *
 *   1. A five-letter word is a number written in base 26 — "aahed" is just
 *      0·26⁴ + 0·26³ + 7·26² + 4·26 + 3.
 *   2. Sorted, those numbers sit close together. Storing the gap between each
 *      word and the one before it leaves small numbers, and small numbers fit
 *      in one byte.
 *
 * The bytes are then written as base64 so the result is plain text that can
 * live in a JSON file or be pasted into a web page.
 *
 * Shared file: the export script and the browser both import it, so the two
 * can never disagree about the format.
 */

const A = 'a'.charCodeAt(0);
const ALPHABET = 26;

function wordToNumber(word) {
  let value = 0;
  for (let i = 0; i < word.length; i += 1) {
    value = value * ALPHABET + (word.charCodeAt(i) - A);
  }
  return value;
}

function numberToWord(value, length) {
  let remaining = value;
  let word = '';
  for (let i = 0; i < length; i += 1) {
    word = String.fromCharCode(A + (remaining % ALPHABET)) + word;
    remaining = Math.floor(remaining / ALPHABET);
  }
  return word;
}

/**
 * @param {string[]} words  all the same length, lowercase a-z
 * @returns {string} base64
 */
export function packWords(words) {
  const numbers = words.map(wordToNumber).sort((a, b) => a - b);

  const bytes = [];
  let previous = 0;
  for (const value of numbers) {
    // Seven bits per byte, with the top bit meaning "there is more to come".
    let gap = value - previous;
    previous = value;
    while (gap >= 128) {
      bytes.push((gap & 127) | 128);
      gap >>>= 7;
    }
    bytes.push(gap);
  }

  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * @param {string} packed  base64 from packWords
 * @param {number} wordLength
 * @returns {Set<string>}
 */
export function unpackWords(packed, wordLength) {
  const binary = atob(packed);
  const words = new Set();

  let gap = 0;
  let shift = 0;
  let value = 0;

  for (let i = 0; i < binary.length; i += 1) {
    const byte = binary.charCodeAt(i);
    gap |= (byte & 127) << shift;
    if (byte & 128) {
      shift += 7;
      continue;
    }
    value += gap;
    words.add(numberToWord(value, wordLength));
    gap = 0;
    shift = 0;
  }

  return words;
}
