/**
 * Everything that touches the page: drawing the board and the keyboard,
 * running the reveal animation, and the little messages that pop up.
 *
 * The rules live in game.js; this file only shows what happened.
 */

import { MARK } from './game.js';

const BACKSPACE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.4 5h11.1A2.5 2.5 0 0 1 22 7.5v9a2.5 2.5 0 0 1-2.5 2.5H8.4a2 2 0 0 1-1.5-.7l-4.6-5.5a1.2 1.2 0 0 1 0-1.6l4.6-5.5a2 2 0 0 1 1.5-.7Zm4 4.6L10.9 11l1.9 1.9-1.9 1.9 1.4 1.4 1.9-1.9 1.9 1.9 1.4-1.4-1.9-1.9 1.9-1.9-1.4-1.4-1.9 1.9-1.9-1.9Z"/></svg>';

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
const MARK_WORDS = {
  [MARK.CORRECT]: 'correct',
  [MARK.PRESENT]: 'in the word, wrong place',
  [MARK.ABSENT]: 'not in the word',
};

const dom = {};
let settings = { flipDuration: 300, flipStagger: 240, toastDuration: 1400 };
let onKeyPress = () => {};

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initUI(config, handlers) {
  Object.assign(dom, {
    board: document.getElementById('board'),
    keyboard: document.getElementById('keyboard'),
    toasts: document.getElementById('toasts'),
    announcer: document.getElementById('announcer'),
    banner: document.getElementById('banner'),
    puzzleDate: document.getElementById('puzzle-date'),
    puzzleNumber: document.getElementById('puzzle-number'),
  });
  settings = {
    flipDuration: config.flipDuration,
    flipStagger: config.flipStagger,
    toastDuration: config.toastDuration,
  };
  onKeyPress = handlers.onKeyPress;

  buildBoard(config.maxGuesses, config.wordLength);
  buildKeyboard(config.keyboardRows);
  document.documentElement.style.setProperty('--flip', `${config.flipDuration}ms`);
}

// --- building ---------------------------------------------------------------

function buildBoard(rows, columns) {
  dom.board.style.setProperty('--rows', rows);
  dom.board.style.setProperty('--columns', columns);
  dom.board.replaceChildren(
    ...Array.from({ length: rows }, (_, row) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'row';
      rowEl.setAttribute('role', 'row');
      rowEl.dataset.row = String(row);
      rowEl.append(
        ...Array.from({ length: columns }, (__, column) => {
          const tile = document.createElement('div');
          tile.className = 'tile';
          tile.setAttribute('role', 'cell');
          tile.dataset.column = String(column);
          return tile;
        }),
      );
      return rowEl;
    }),
  );
}

function buildKeyboard(rows) {
  dom.keyboard.replaceChildren(
    ...rows.map((letters, index) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'keyboard__row';
      const isLast = index === rows.length - 1;

      if (isLast) rowEl.append(specialKey('Enter', 'Enter', 'Enter'));
      for (const letter of letters) rowEl.append(letterKey(letter));
      if (isLast) rowEl.append(specialKey('Backspace', BACKSPACE_ICON, 'Backspace', true));

      return rowEl;
    }),
  );

  dom.keyboard.addEventListener('click', (event) => {
    const key = event.target.closest('.key');
    if (key) onKeyPress(key.dataset.key);
  });
}

function letterKey(letter) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'key';
  button.dataset.key = letter;
  button.textContent = letter;
  button.setAttribute('aria-label', letter.toUpperCase());
  return button;
}

function specialKey(key, label, accessibleName, isHtml = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'key key--wide';
  button.dataset.key = key;
  if (isHtml) button.innerHTML = label;
  else button.textContent = label;
  button.setAttribute('aria-label', accessibleName);
  return button;
}

// --- the board --------------------------------------------------------------

const tilesIn = (row) => dom.board.children[row].children;

export function setHeader({ date, number }) {
  dom.puzzleDate.textContent = date;
  dom.puzzleNumber.textContent = number;
}

export function showBanner(html) {
  dom.banner.innerHTML = html;
  dom.banner.hidden = false;
}

/** Draw the letters the reader is part way through typing. */
export function drawCurrentRow(row, letters, columns) {
  if (row >= dom.board.children.length) return;
  const tiles = tilesIn(row);
  for (let i = 0; i < columns; i += 1) {
    const tile = tiles[i];
    const letter = letters[i] ?? '';
    if (tile.textContent === letter) continue;
    tile.textContent = letter;
    tile.classList.toggle('tile--filled', Boolean(letter));
  }
}

/** Fill in a finished row with no animation — used when restoring a game. */
export function drawFinishedRow(row, guess, marks) {
  const tiles = tilesIn(row);
  [...guess].forEach((letter, column) => {
    const tile = tiles[column];
    tile.textContent = letter;
    tile.className = `tile tile--${marks[column]}`;
    tile.setAttribute('aria-label', `${ORDINALS[column]} letter ${letter.toUpperCase()}, ${MARK_WORDS[marks[column]]}`);
  });
}

/** Turn the tiles over one at a time. Resolves once the last one has landed. */
export function revealRow(row, guess, marks) {
  const tiles = tilesIn(row);

  if (prefersReducedMotion()) {
    drawFinishedRow(row, guess, marks);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    [...guess].forEach((letter, column) => {
      const tile = tiles[column];
      const delay = column * settings.flipStagger;

      tile.style.animationDelay = `${delay}ms`;
      tile.classList.add('is-flipping');

      // Swap the colour in while the tile is edge-on to the reader.
      window.setTimeout(() => {
        tile.classList.add(`tile--${marks[column]}`);
        tile.classList.remove('tile--filled');
        tile.setAttribute('aria-label', `${ORDINALS[column]} letter ${letter.toUpperCase()}, ${MARK_WORDS[marks[column]]}`);
      }, delay + settings.flipDuration / 2);

      // Tidy the animation away once it has finished, so the tile is left in
      // a plain state and a later redraw can animate again.
      window.setTimeout(() => {
        tile.classList.remove('is-flipping');
        tile.style.animationDelay = '';
        if (column === guess.length - 1) resolve();
      }, delay + settings.flipDuration);
    });
  });
}

export function shakeRow(row) {
  const rowEl = dom.board.children[row];
  if (!rowEl) return;
  rowEl.classList.remove('is-invalid');
  void rowEl.offsetWidth; // restart the animation if it is already running
  rowEl.classList.add('is-invalid');
  window.setTimeout(() => rowEl.classList.remove('is-invalid'), 450);
}

export function celebrateRow(row) {
  if (prefersReducedMotion()) return;
  dom.board.children[row]?.classList.add('is-winner');
}

// --- the keyboard -----------------------------------------------------------

export function paintKeyboard(letterMarks) {
  for (const key of dom.keyboard.querySelectorAll('.key')) {
    const letter = key.dataset.key;
    const mark = letterMarks[letter];
    key.classList.remove('key--absent', 'key--present', 'key--correct');
    if (mark) {
      key.classList.add(`key--${mark}`);
      key.setAttribute('aria-label', `${letter.toUpperCase()}, ${MARK_WORDS[mark]}`);
    } else if (letter?.length === 1) {
      key.setAttribute('aria-label', letter.toUpperCase());
    }
  }
}

// --- messages ---------------------------------------------------------------

export function toast(message, duration = settings.toastDuration) {
  const element = document.createElement('div');
  element.className = 'toast';
  element.textContent = message;
  dom.toasts.append(element);

  window.setTimeout(() => {
    element.classList.add('is-leaving');
    element.addEventListener('animationend', () => element.remove(), { once: true });
  }, duration);
}

/** Read a finished row out in the same words the tiles use. */
export function announceGuess(guess, marks) {
  const detail = [...guess]
    .map((letter, index) => `${letter.toUpperCase()}, ${MARK_WORDS[marks[index]]}`)
    .join('; ');
  announce(`${guess.toUpperCase()}. ${detail}.`);
}

/** Spoken by a screen reader without showing anything on the page. */
export function announce(message) {
  dom.announcer.textContent = '';
  window.setTimeout(() => { dom.announcer.textContent = message; }, 60);
}

/**
 * Replace the board with an explanation. `detail` is treated as text — it can
 * carry a message from a server — while `hint` is our own markup.
 */
export function fatal(message, detail = '', hint = '') {
  const panel = document.createElement('div');
  panel.className = 'fatal';

  const headline = document.createElement('p');
  headline.append(Object.assign(document.createElement('strong'), { textContent: message }));
  panel.append(headline);

  if (detail) {
    const line = document.createElement('p');
    line.textContent = detail;
    panel.append(line);
  }
  if (hint) {
    const line = document.createElement('p');
    line.innerHTML = hint;
    panel.append(line);
  }

  document.querySelector('.game').replaceChildren(panel);
}
