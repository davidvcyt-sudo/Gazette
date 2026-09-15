/**
 * Answer obfuscation.
 *
 * The static build ships the whole schedule to the browser, so anyone
 * determined enough can read tomorrow's word out of the JSON. Encoding it
 * stops the casual "view source" spoiler, which is all it is meant to do —
 * it is not encryption and nothing here is a secret.
 *
 * If you need answers to be genuinely unavailable until their date, run the
 * API server (server/api.mjs); it only ever serves the current day's word.
 *
 * This module runs unchanged in Node and in the browser: the export script
 * imports this exact file so the two can never drift apart.
 */

const SALT = 'gzaat-wordle-v1';

/** Deterministic keystream for one puzzle: FNV-1a seed, xorshift32 output. */
function keystream(puzzleNumber, length) {
  let h = 0x811c9dc5;
  const seed = `${SALT}:${puzzleNumber}`;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    h ^= (h << 13) >>> 0; h >>>= 0;
    h ^= h >>> 17;
    h ^= (h << 5) >>> 0;  h >>>= 0;
    bytes[i] = h & 0xff;
  }
  return bytes;
}

/** word -> base64 blob, different every day even for the same word. */
export function encodeAnswer(word, puzzleNumber) {
  const key = keystream(puzzleNumber, word.length);
  let binary = '';
  for (let i = 0; i < word.length; i += 1) {
    binary += String.fromCharCode(word.charCodeAt(i) ^ key[i]);
  }
  return btoa(binary);
}

/** base64 blob -> word. Throws if the blob is not valid base64. */
export function decodeAnswer(encoded, puzzleNumber) {
  const binary = atob(encoded);
  const key = keystream(puzzleNumber, binary.length);
  let word = '';
  for (let i = 0; i < binary.length; i += 1) {
    word += String.fromCharCode(binary.charCodeAt(i) ^ key[i]);
  }
  return word;
}
