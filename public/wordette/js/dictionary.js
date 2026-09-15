/**
 * The list of words the game will accept as a guess.
 *
 * Exported as one long string of five-letter words joined together, which is
 * roughly half the bytes of a JSON array of the same words.
 */

export async function loadDictionary(url, wordLength) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`could not load ${url} (${response.status})`);

  const payload = await response.json();
  const length = payload.wordLength ?? wordLength;
  const words = new Set();

  if (typeof payload.packed === 'string') {
    for (let i = 0; i + length <= payload.packed.length; i += length) {
      words.add(payload.packed.slice(i, i + length));
    }
  } else if (Array.isArray(payload.words)) {
    for (const word of payload.words) words.add(word);
  } else {
    throw new Error(`${url} is not in a format this game understands`);
  }

  return {
    size: words.size,
    has: (word) => words.has(String(word).toLowerCase()),
  };
}
