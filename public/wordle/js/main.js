/**
 * Starting the game up and keeping the pieces in step: input, storage,
 * dialogs, sharing.
 */

import { CONFIG } from './config.js';
import { formatLongDate, isISODate, msUntilTomorrow } from './dates.js';
import { loadDictionary } from './dictionary.js';
import { loadPuzzle } from './puzzles.js';
import {
  STATUS, createGame, keyboardMarks, restoreGame, submitGuess,
} from './game.js';
import {
  loadProgress, loadSettings, loadStats, recordResult, resetStats,
  saveProgress, saveSettings,
} from './storage.js';
import { shareResult, shareText } from './share.js';
import * as ui from './ui.js';

/** What the paper says when you get it in n guesses. */
const PRAISE = ['Stop the press!', 'Headline news', 'Front page', 'Well read', 'Good copy', 'Just in time'];

const state = {
  game: null,
  dictionary: null,
  settings: loadSettings(),
  stats: loadStats(),
  current: '',        // letters typed but not submitted
  busy: false,        // true while the tiles are turning over
  archive: false,     // an old or previewed puzzle: never counts
  countdownTimer: null,
};

const dialogs = {
  help: document.getElementById('dialog-help'),
  stats: document.getElementById('dialog-stats'),
  settings: document.getElementById('dialog-settings'),
};

// --- start up ---------------------------------------------------------------

async function start() {
  applyTheme();

  const params = new URLSearchParams(window.location.search);
  const requested = {
    date: params.get('date') ?? undefined,
    puzzleNumber: params.has('puzzle') ? Number(params.get('puzzle')) : undefined,
  };

  ui.initUI(CONFIG, { onKeyPress: handleKey });

  let puzzle;
  let dictionary;
  try {
    [puzzle, dictionary] = await Promise.all([
      loadPuzzle(CONFIG, requested),
      loadDictionary(CONFIG.source.dictionaryUrl, CONFIG.wordLength),
    ]);
  } catch (error) {
    console.error(error);
    // Opening index.html straight off the disk is the usual reason this fails
    // during setup, so say so — but only when that is really what happened.
    const hint = window.location.protocol === 'file:'
      ? 'Open the game through a web server — run <code>npm start</code> — rather than opening the file directly.'
      : 'Please try again in a moment.';
    ui.fatal('The puzzle could not be loaded.', error.message, hint);
    return;
  }

  state.dictionary = dictionary;
  state.archive = puzzle.isArchive;

  state.game = createGame({
    answer: puzzle.answer,
    puzzleNumber: puzzle.number,
    puzzleDate: puzzle.date,
    maxGuesses: CONFIG.maxGuesses,
    hardMode: state.settings.hardMode,
  });

  ui.setHeader({ date: formatLongDate(puzzle.date), number: puzzle.number });
  document.title = `${CONFIG.name} #${puzzle.number} — ${CONFIG.publication}`;

  if (state.archive) {
    const label = isISODate(requested.date) || requested.puzzleNumber
      ? `You are playing puzzle <strong>#${puzzle.number}</strong> from ${formatLongDate(puzzle.date)}.`
      : 'You are playing an older puzzle.';
    ui.showBanner(`${label} It will not change your statistics.`);
  } else {
    restoreTodaysBoard();
  }

  ui.paintKeyboard(keyboardMarks(state.game.guesses, state.game.marks));
  wireControls();

  if (!state.settings.seenHelp) {
    dialogs.help.showModal();
    state.settings = { ...state.settings, seenHelp: true };
    saveSettings(state.settings);
  }
}

function restoreTodaysBoard() {
  const saved = loadProgress(state.game.puzzleNumber);
  if (!saved.length) return;

  restoreGame(state.game, saved);
  state.game.guesses.forEach((guess, row) => ui.drawFinishedRow(row, guess, state.game.marks[row]));

  if (state.game.status !== STATUS.PLAYING) {
    showOutcome({ reopened: true });
  }
}

// --- input ------------------------------------------------------------------

function handleKey(key) {
  if (!state.game || state.busy || state.game.status !== STATUS.PLAYING) return;
  if (Object.values(dialogs).some((dialog) => dialog.open)) return;

  if (key === 'Enter') { void submitCurrent(); return; }
  if (key === 'Backspace') {
    state.current = state.current.slice(0, -1);
    ui.drawCurrentRow(state.game.guesses.length, state.current, CONFIG.wordLength);
    return;
  }
  if (/^[a-z]$/.test(key) && state.current.length < CONFIG.wordLength) {
    state.current += key;
    ui.drawCurrentRow(state.game.guesses.length, state.current, CONFIG.wordLength);
  }
}

function handlePhysicalKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  // While a dialog is open its own buttons and menus need these keys — calling
  // preventDefault() here would stop Enter working on the close button.
  if (Object.values(dialogs).some((dialog) => dialog.open)) return;

  const key = event.key === 'Enter' || event.key === 'Backspace'
    ? event.key
    : event.key.toLowerCase();
  if (key === 'Enter' || key === 'Backspace' || /^[a-z]$/.test(key)) {
    event.preventDefault();
    handleKey(key);
  }
}

async function submitCurrent() {
  const row = state.game.guesses.length;
  const guess = state.current;

  if (guess.length < CONFIG.wordLength) {
    reject(row, 'Not enough letters');
    return;
  }
  if (!state.dictionary.has(guess)) {
    reject(row, 'Not in the word list');
    return;
  }

  const result = submitGuess(state.game, guess);
  if (!result.ok) {
    reject(row, result.reason);
    return;
  }

  state.current = '';
  state.busy = true;
  if (!state.archive) saveProgress(state.game.puzzleNumber, state.game.guesses);

  await ui.revealRow(row, guess, result.marks);
  ui.paintKeyboard(keyboardMarks(state.game.guesses, state.game.marks));
  state.busy = false;

  ui.announceGuess(guess, result.marks);
  if (state.game.status !== STATUS.PLAYING) finish(row);
}

function reject(row, message) {
  ui.shakeRow(row);
  ui.toast(message);
  ui.announce(message);
}

// --- finishing --------------------------------------------------------------

function finish(row) {
  const won = state.game.status === STATUS.WON;

  // An archive or previewed puzzle is practice: it changes nothing.
  if (!state.archive) {
    state.stats = recordResult(state.stats, {
      puzzleNumber: state.game.puzzleNumber,
      won,
      guessCount: state.game.guesses.length,
    });
    void reportResult(won);
  }

  if (won) {
    ui.celebrateRow(row);
    const message = PRAISE[state.game.guesses.length - 1] ?? 'Solved';
    ui.toast(message);
    ui.announce(`${message}. The word was ${state.game.answer.toUpperCase()}.`);
  } else {
    ui.toast(state.game.answer.toUpperCase(), 3000);
    ui.announce(`Out of guesses. The word was ${state.game.answer.toUpperCase()}.`);
  }

  showOutcome({ reopened: false });
  window.setTimeout(() => {
    // Not if the reader has opened something else in the meantime — showModal()
    // throws on a dialog that is already open.
    if (Object.values(dialogs).every((dialog) => !dialog.open)) dialogs.stats.showModal();
  }, won ? 1900 : 2200);
}

/**
 * Tell the API how the game went, so `v_puzzle_stats` can say how the school
 * did on a given word. Only in API mode — the static build has nowhere to post
 * to — and only ever a random per-browser key, never anything about the reader.
 * A failure here is not worth bothering anyone about.
 */
async function reportResult(won) {
  if (CONFIG.source.mode !== 'api') return;

  let playerKey = state.settings.playerKey;
  if (!playerKey) {
    playerKey = window.crypto?.randomUUID?.() ?? String(Math.random()).slice(2);
    updateSettings({ playerKey });
  }

  try {
    await fetch(`${CONFIG.source.apiUrl}/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        puzzleNumber: state.game.puzzleNumber,
        playerKey,
        solved: won,
        guessCount: state.game.guesses.length,
        hardMode: state.game.hardMode,
      }),
    });
  } catch (error) {
    console.warn('could not report the result', error);
  }
}

/** Fill in the part of the statistics dialog that only appears once you finish. */
function showOutcome({ reopened }) {
  const won = state.game.status === STATUS.WON;
  const outcome = document.getElementById('outcome');
  const answer = document.getElementById('outcome-answer');

  answer.innerHTML = won
    ? `Today's word was <strong>${state.game.answer}</strong>`
    : `Better luck tomorrow. The word was <strong>${state.game.answer}</strong>`;
  outcome.hidden = false;

  renderStats();
  startCountdown();
  if (reopened) ui.announce(`This puzzle is finished. The word was ${state.game.answer.toUpperCase()}.`);
}

function renderStats() {
  const { played, wins, currentStreak, maxStreak, distribution } = state.stats;
  document.getElementById('stat-played').textContent = played;
  document.getElementById('stat-winrate').textContent = played ? Math.round((wins / played) * 100) : 0;
  document.getElementById('stat-streak').textContent = currentStreak;
  document.getElementById('stat-best').textContent = maxStreak;

  const counts = Array.from({ length: CONFIG.maxGuesses }, (_, i) => distribution[i + 1] ?? 0);
  const highest = Math.max(1, ...counts);
  const finishedNow = state.game?.status === STATUS.WON && !state.archive
    ? state.game.guesses.length
    : 0;

  document.getElementById('distribution').replaceChildren(
    ...counts.map((count, index) => {
      const row = document.createElement('div');
      row.className = 'distribution__row';

      const label = document.createElement('span');
      label.className = 'distribution__label';
      label.textContent = index + 1;

      const bar = document.createElement('span');
      bar.className = 'distribution__bar';
      if (index + 1 === finishedNow) bar.classList.add('distribution__bar--current');
      bar.style.width = `${Math.max(7, (count / highest) * 100)}%`;
      bar.textContent = count;

      row.append(label, bar);
      return row;
    }),
  );
}

function startCountdown() {
  const clock = document.getElementById('countdown');
  window.clearInterval(state.countdownTimer);

  const tick = () => {
    const left = msUntilTomorrow();
    if (left <= 0) {
      window.clearInterval(state.countdownTimer);
      clock.textContent = '00:00:00';
      window.location.reload();
      return;
    }
    const seconds = Math.floor(left / 1000);
    clock.textContent = [
      Math.floor(seconds / 3600),
      Math.floor((seconds % 3600) / 60),
      seconds % 60,
    ].map((part) => String(part).padStart(2, '0')).join(':');
  };

  tick();
  state.countdownTimer = window.setInterval(tick, 1000);
}

// --- controls ---------------------------------------------------------------

function wireControls() {
  document.addEventListener('keydown', handlePhysicalKey);

  document.getElementById('btn-help').addEventListener('click', () => dialogs.help.showModal());
  document.getElementById('btn-settings').addEventListener('click', () => dialogs.settings.showModal());
  document.getElementById('btn-stats').addEventListener('click', () => {
    renderStats();
    if (state.game.status !== STATUS.PLAYING) startCountdown();
    dialogs.stats.showModal();
  });

  dialogs.stats.addEventListener('close', () => window.clearInterval(state.countdownTimer));

  document.getElementById('btn-share').addEventListener('click', async () => {
    const text = shareText(state.game, CONFIG, { highContrast: state.settings.highContrast });
    const outcome = await shareResult(text, CONFIG.name);
    if (outcome === 'copied') ui.toast('Copied to clipboard');
    else if (outcome === 'failed') ui.toast('Could not copy — select the grid and copy it yourself');
  });

  const hardToggle = document.getElementById('set-hard');
  const contrastToggle = document.getElementById('set-contrast');
  const themeSelect = document.getElementById('set-theme');

  hardToggle.checked = state.settings.hardMode;
  contrastToggle.checked = state.settings.highContrast;
  themeSelect.value = state.settings.theme;

  hardToggle.addEventListener('change', () => {
    const midGame = state.game.guesses.length > 0 && state.game.status === STATUS.PLAYING;
    if (midGame) {
      hardToggle.checked = state.settings.hardMode;
      ui.toast('Hard mode can only be changed before you start');
      return;
    }
    updateSettings({ hardMode: hardToggle.checked });
    state.game.hardMode = hardToggle.checked;
  });

  contrastToggle.addEventListener('change', () => {
    updateSettings({ highContrast: contrastToggle.checked });
    applyTheme();
  });

  themeSelect.addEventListener('change', () => {
    updateSettings({ theme: themeSelect.value });
    applyTheme();
  });

  document.getElementById('btn-reset-stats').addEventListener('click', () => {
    const sure = window.confirm('Clear your played count, streaks and distribution on this device?');
    if (!sure) return;
    state.stats = resetStats();
    renderStats();
    ui.toast('Statistics cleared');
  });

  reportHeightToParent();
}

function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  saveSettings(state.settings);
}

function applyTheme() {
  const root = document.documentElement;
  if (state.settings.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = state.settings.theme;

  if (state.settings.highContrast) root.dataset.contrast = 'high';
  else delete root.dataset.contrast;
}

/**
 * When the game is embedded in an article, tell the page around it how tall it
 * needs to be. The host page can listen for this and resize the iframe — see
 * docs/EMBEDDING.md.
 */
function reportHeightToParent() {
  if (window.parent === window) return;
  const post = () => {
    window.parent.postMessage(
      { type: 'gzaat-wordle:height', height: document.documentElement.scrollHeight },
      '*',
    );
  };
  new ResizeObserver(post).observe(document.body);
  post();
}

start();
