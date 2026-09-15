import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import {
  MARK, STATUS, createGame, hardModeError, keyboardMarks, resultGrid,
  restoreGame, scoreGuess, submitGuess,
} from '../public/wordle/js/game.js';
import { decodeAnswer, encodeAnswer } from '../public/wordle/js/cipher.js';
import { addDays, daysBetween, isISODate, todayISO } from '../public/wordle/js/dates.js';

const { ABSENT: _, PRESENT: P, CORRECT: C } = MARK;

describe('scoreGuess', () => {
  test('marks every letter of an exact match', () => {
    assert.deepEqual(scoreGuess('crane', 'crane'), [C, C, C, C, C]);
  });

  test('marks a miss', () => {
    assert.deepEqual(scoreGuess('chomp', 'wield'), [_, _, _, _, _]);
  });

  test('marks right letter, wrong place', () => {
    // SLATE / LEAST share an A in the middle; the rest are all misplaced.
    assert.deepEqual(scoreGuess('slate', 'least'), [P, P, C, P, P]);
  });

  test('only credits as many copies as the answer actually has', () => {
    // ABIDE has a single E: the first E in SPEED takes it, the second gets grey.
    assert.deepEqual(scoreGuess('speed', 'abide'), [_, _, P, _, P]);
  });

  test('credits both copies when the answer has two', () => {
    // ERASE has two Es, so both of SPEED's Es come back yellow.
    assert.deepEqual(scoreGuess('speed', 'erase'), [P, _, P, P, _]);
  });

  test('greens win over yellows for the same letter', () => {
    // Every E in GEESE that lines up with THESE is green; the spare one is grey.
    assert.deepEqual(scoreGuess('geese', 'these'), [_, _, C, C, C]);
  });

  test('a doubled guess against a doubled answer marks both', () => {
    assert.deepEqual(scoreGuess('belle', 'level'), [_, C, P, P, P]);
  });

  test('refuses a guess of the wrong length', () => {
    assert.throws(() => scoreGuess('four', 'crane'), /different lengths/);
  });
});

describe('keyboardMarks', () => {
  test('keeps the best result each letter has earned', () => {
    const guesses = ['audio', 'adept'];
    const marks = guesses.map((guess) => scoreGuess(guess, 'adept'));
    // AUDIO leaves D yellow; ADEPT then turns it green and rules out U, I, O.
    assert.deepEqual(keyboardMarks(guesses, marks), {
      a: C, u: _, d: C, i: _, o: _, e: C, p: C, t: C,
    });
  });

  test('a later green upgrades an earlier yellow', () => {
    const guesses = ['react', 'crane'];
    const marks = guesses.map((guess) => scoreGuess(guess, 'crane'));
    assert.equal(keyboardMarks(guesses, marks).c, C);
  });
});

describe('hard mode', () => {
  const guesses = ['slate'];
  // SLATE against STALK: S green, L yellow, A green, T yellow, E grey.
  const marks = [scoreGuess('slate', 'stalk')];

  test('allows a guess that reuses every hint', () => {
    assert.equal(hardModeError('stalk', guesses, marks), null);
  });

  test('rejects moving a known-correct letter', () => {
    assert.match(hardModeError('cramp', guesses, marks), /1st letter must be S/);
  });

  test('rejects a guess that keeps the greens but drops a yellow', () => {
    // STARK keeps S and A in place but leaves out the known L.
    assert.equal(hardModeError('stark', guesses, marks), 'Guess must contain L');
  });

  test('reports a misplaced green before anything else', () => {
    assert.equal(hardModeError('stout', guesses, marks), '3rd letter must be A');
  });

  test('asks for both copies once two are known', () => {
    // SHEEP against GEESE proves there are two Es; STEMS only offers one.
    const g = ['sheep'];
    const m = [scoreGuess('sheep', 'geese')];
    assert.equal(hardModeError('stems', g, m), 'Guess must contain 2 Es');
  });
});

describe('submitGuess', () => {
  test('records the guess and its marks', () => {
    const game = createGame({ answer: 'crane', puzzleNumber: 1, puzzleDate: '2026-09-15' });
    const result = submitGuess(game, 'slate');
    assert.equal(result.ok, true);
    assert.deepEqual(game.guesses, ['slate']);
    assert.equal(game.marks.length, 1);
    assert.equal(game.status, STATUS.PLAYING);
  });

  test('is case insensitive', () => {
    const game = createGame({ answer: 'crane', puzzleNumber: 1, puzzleDate: '2026-09-15' });
    submitGuess(game, 'CRANE');
    assert.equal(game.status, STATUS.WON);
  });

  test('refuses a short guess without touching the board', () => {
    const game = createGame({ answer: 'crane', puzzleNumber: 1, puzzleDate: '2026-09-15' });
    const result = submitGuess(game, 'cran');
    assert.equal(result.ok, false);
    assert.match(result.reason, /Not enough letters/);
    assert.equal(game.guesses.length, 0);
  });

  test('refuses the same word twice', () => {
    const game = createGame({ answer: 'crane', puzzleNumber: 1, puzzleDate: '2026-09-15' });
    submitGuess(game, 'slate');
    const result = submitGuess(game, 'slate');
    assert.equal(result.ok, false);
    assert.equal(game.guesses.length, 1);
  });

  test('loses after the last guess and stops accepting more', () => {
    const game = createGame({ answer: 'crane', puzzleNumber: 1, puzzleDate: '2026-09-15', maxGuesses: 3 });
    for (const word of ['slate', 'pouty', 'humid']) submitGuess(game, word);
    assert.equal(game.status, STATUS.LOST);
    assert.equal(submitGuess(game, 'crane').ok, false);
  });

  test('enforces hard mode only when it is on', () => {
    const relaxed = createGame({ answer: 'stalk', puzzleNumber: 1, puzzleDate: '2026-09-15' });
    submitGuess(relaxed, 'slate');
    assert.equal(submitGuess(relaxed, 'pouty').ok, true);

    const strict = createGame({ answer: 'stalk', puzzleNumber: 1, puzzleDate: '2026-09-15', hardMode: true });
    submitGuess(strict, 'slate');
    assert.equal(submitGuess(strict, 'pouty').ok, false);
  });
});

describe('restoreGame', () => {
  test('replays saved guesses', () => {
    const game = restoreGame(
      createGame({ answer: 'crane', puzzleNumber: 1, puzzleDate: '2026-09-15' }),
      ['slate', 'crane'],
    );
    assert.equal(game.status, STATUS.WON);
    assert.equal(game.guesses.length, 2);
  });

  test('stops at the first nonsense entry instead of throwing', () => {
    const game = restoreGame(
      createGame({ answer: 'crane', puzzleNumber: 1, puzzleDate: '2026-09-15' }),
      ['slate', 42, 'crane'],
    );
    assert.deepEqual(game.guesses, ['slate']);
  });

  test('survives junk in place of a list', () => {
    const game = restoreGame(
      createGame({ answer: 'crane', puzzleNumber: 1, puzzleDate: '2026-09-15' }),
      null,
    );
    assert.deepEqual(game.guesses, []);
  });
});

describe('resultGrid', () => {
  test('draws one row of squares per guess', () => {
    const game = createGame({ answer: 'crane', puzzleNumber: 1, puzzleDate: '2026-09-15' });
    submitGuess(game, 'slate');
    submitGuess(game, 'crane');
    assert.deepEqual(resultGrid(game).split('\n'), ['⬛⬛🟩⬛🟩', '🟩🟩🟩🟩🟩']);
  });

  test('switches palette for high contrast', () => {
    const game = createGame({ answer: 'crane', puzzleNumber: 1, puzzleDate: '2026-09-15' });
    submitGuess(game, 'crane');
    assert.equal(resultGrid(game, { highContrast: true }), '🟧🟧🟧🟧🟧');
  });
});

describe('answer encoding', () => {
  test('survives a round trip', () => {
    for (const [index, word] of ['crane', 'fuzzy', 'aback', 'lunch'].entries()) {
      assert.equal(decodeAnswer(encodeAnswer(word, index + 1), index + 1), word);
    }
  });

  test('encodes the same word differently on different days', () => {
    assert.notEqual(encodeAnswer('crane', 1), encodeAnswer('crane', 2));
  });

  test('decoding with the wrong day does not give the word back', () => {
    assert.notEqual(decodeAnswer(encodeAnswer('crane', 1), 2), 'crane');
  });
});

describe('dates', () => {
  test('recognises real dates only', () => {
    assert.equal(isISODate('2026-09-15'), true);
    assert.equal(isISODate('2026-02-30'), false);
    assert.equal(isISODate('15/09/2026'), false);
  });

  test('adds days across a month and a year boundary', () => {
    assert.equal(addDays('2026-09-30', 1), '2026-10-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2028-02-28', 1), '2028-02-29'); // leap year
    assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  });

  test('counts days between dates', () => {
    assert.equal(daysBetween('2026-09-15', '2026-09-15'), 0);
    assert.equal(daysBetween('2026-09-15', '2026-10-15'), 30);
    assert.equal(daysBetween('2026-10-15', '2026-09-15'), -30);
  });

  test('todayISO is a valid date', () => {
    assert.equal(isISODate(todayISO()), true);
  });
});
