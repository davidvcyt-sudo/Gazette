/**
 * The rules of the game.
 *
 * Nothing in here touches the DOM, the network or storage, so it can be run
 * straight from `node --test` (see tests/game.test.mjs).
 */

export const MARK = {
  ABSENT: 'absent',
  PRESENT: 'present',
  CORRECT: 'correct',
};

export const STATUS = {
  PLAYING: 'playing',
  WON: 'won',
  LOST: 'lost',
};

/**
 * Colour one guess against the answer.
 *
 * Repeated letters are the fiddly part: a letter is only marked yellow if the
 * answer still has an unmatched copy of it left over. Guessing SPEED against
 * ABIDE marks the first E yellow and the second one grey — ABIDE only has one
 * E to give, and the first guessed E has already claimed it.
 */
export function scoreGuess(guess, answer) {
  if (guess.length !== answer.length) {
    throw new Error(`guess "${guess}" and answer "${answer}" are different lengths`);
  }

  const marks = new Array(guess.length).fill(MARK.ABSENT);
  const unmatched = new Map();

  // First pass: exact positions. Anything not matched goes into the pool.
  for (let i = 0; i < answer.length; i += 1) {
    if (guess[i] === answer[i]) {
      marks[i] = MARK.CORRECT;
    } else {
      unmatched.set(answer[i], (unmatched.get(answer[i]) ?? 0) + 1);
    }
  }

  // Second pass: right letter, wrong place — while copies remain.
  for (let i = 0; i < guess.length; i += 1) {
    if (marks[i] === MARK.CORRECT) continue;
    const left = unmatched.get(guess[i]) ?? 0;
    if (left > 0) {
      marks[i] = MARK.PRESENT;
      unmatched.set(guess[i], left - 1);
    }
  }

  return marks;
}

/** The strongest mark each letter has earned, for colouring the keyboard. */
export function keyboardMarks(guesses, marks) {
  const rank = { [MARK.ABSENT]: 0, [MARK.PRESENT]: 1, [MARK.CORRECT]: 2 };
  const best = {};
  guesses.forEach((guess, row) => {
    [...guess].forEach((letter, column) => {
      const mark = marks[row][column];
      if (!(letter in best) || rank[mark] > rank[best[letter]]) best[letter] = mark;
    });
  });
  return best;
}

/**
 * Hard mode: every hint already revealed has to be reused. Returns a message
 * explaining the first violation, or null when the guess is allowed.
 */
export function hardModeError(guess, guesses, marks) {
  const ordinals = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

  for (let row = 0; row < guesses.length; row += 1) {
    const previous = guesses[row];

    for (let i = 0; i < previous.length; i += 1) {
      if (marks[row][i] === MARK.CORRECT && guess[i] !== previous[i]) {
        return `${ordinals[i]} letter must be ${previous[i].toUpperCase()}`;
      }
    }

    // Count how many of each hinted letter the earlier rows proved are there,
    // then make sure this guess still contains at least that many.
    const required = new Map();
    for (let i = 0; i < previous.length; i += 1) {
      if (marks[row][i] !== MARK.ABSENT) {
        required.set(previous[i], (required.get(previous[i]) ?? 0) + 1);
      }
    }
    for (const [letter, needed] of required) {
      const have = [...guess].filter((character) => character === letter).length;
      if (have < needed) {
        return needed > 1
          ? `Guess must contain ${needed} ${letter.toUpperCase()}s`
          : `Guess must contain ${letter.toUpperCase()}`;
      }
    }
  }

  return null;
}

export function createGame({
  answer,
  puzzleNumber,
  puzzleDate,
  maxGuesses = 6,
  hardMode = false,
}) {
  return {
    answer: answer.toLowerCase(),
    puzzleNumber,
    puzzleDate,
    maxGuesses,
    wordLength: answer.length,
    hardMode,
    guesses: [],
    marks: [],
    status: STATUS.PLAYING,
  };
}

/**
 * Play one guess. The caller has already decided the word is in the
 * dictionary; everything else is checked here.
 *
 * Returns { ok: true, marks } or { ok: false, reason } and only changes the
 * game when it returns ok.
 */
export function submitGuess(game, rawGuess) {
  const guess = String(rawGuess).toLowerCase();

  if (game.status !== STATUS.PLAYING) {
    return { ok: false, reason: 'This puzzle is finished' };
  }
  if (guess.length !== game.wordLength) {
    return { ok: false, reason: 'Not enough letters' };
  }
  if (game.guesses.includes(guess)) {
    return { ok: false, reason: 'You already tried that word' };
  }
  if (game.hardMode) {
    const violation = hardModeError(guess, game.guesses, game.marks);
    if (violation) return { ok: false, reason: violation };
  }

  const marks = scoreGuess(guess, game.answer);
  game.guesses.push(guess);
  game.marks.push(marks);

  if (guess === game.answer) game.status = STATUS.WON;
  else if (game.guesses.length >= game.maxGuesses) game.status = STATUS.LOST;

  return { ok: true, marks };
}

/** Restore a game from what was saved in the browser, discarding anything odd. */
export function restoreGame(game, savedGuesses) {
  if (!Array.isArray(savedGuesses)) return game;
  for (const guess of savedGuesses) {
    if (typeof guess !== 'string') break;
    const result = submitGuess(game, guess);
    if (!result.ok) break;
  }
  return game;
}

/** The emoji grid everyone pastes into a group chat. */
export function resultGrid(game, { highContrast = false } = {}) {
  const palette = highContrast
    ? { [MARK.ABSENT]: '⬛', [MARK.PRESENT]: '🟦', [MARK.CORRECT]: '🟧' }
    : { [MARK.ABSENT]: '⬛', [MARK.PRESENT]: '🟨', [MARK.CORRECT]: '🟩' };
  return game.marks.map((row) => row.map((mark) => palette[mark]).join('')).join('\n');
}
