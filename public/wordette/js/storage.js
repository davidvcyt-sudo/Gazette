/**
 * Saved progress, statistics and settings.
 *
 * All of it lives in the reader's own browser — nothing is sent anywhere. Every
 * access is wrapped, because localStorage throws rather than returning null in
 * private windows and when a reader has blocked site data. When that happens
 * the game still plays perfectly; it just forgets everything on reload.
 */

import { CONFIG } from './config.js';

const KEYS = {
  progress: `${CONFIG.storagePrefix}:progress`,
  stats: `${CONFIG.storagePrefix}:stats`,
  settings: `${CONFIG.storagePrefix}:settings`,
};

function read(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// --- settings ---------------------------------------------------------------

const DEFAULT_SETTINGS = {
  theme: 'auto',        // 'auto' | 'light' | 'dark'
  hardMode: false,
  highContrast: false,
};

export function loadSettings() {
  const saved = read(KEYS.settings, {});
  return { ...DEFAULT_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) };
}

export function saveSettings(settings) {
  write(KEYS.settings, settings);
}

// --- statistics -------------------------------------------------------------

const DEFAULT_STATS = {
  played: 0,
  wins: 0,
  currentStreak: 0,
  maxStreak: 0,
  distribution: {},      // guess count -> how many wins took that many
  lastPuzzleNumber: null,
};

export function loadStats() {
  const saved = read(KEYS.stats, {});
  const stats = { ...DEFAULT_STATS, ...(saved && typeof saved === 'object' ? saved : {}) };
  if (!stats.distribution || typeof stats.distribution !== 'object') stats.distribution = {};
  return stats;
}

/**
 * Fold one finished game into the statistics.
 *
 * The streak only survives if this puzzle follows the last one recorded, so
 * skipping a day breaks it — same as the original. Returns the new stats.
 */
export function recordResult(stats, { puzzleNumber, won, guessCount }) {
  if (stats.lastPuzzleNumber === puzzleNumber) return stats; // already counted

  const updated = {
    ...stats,
    distribution: { ...stats.distribution },
    played: stats.played + 1,
    lastPuzzleNumber: puzzleNumber,
  };

  if (won) {
    const continues = stats.lastPuzzleNumber === puzzleNumber - 1;
    updated.wins += 1;
    updated.currentStreak = continues ? stats.currentStreak + 1 : 1;
    updated.maxStreak = Math.max(stats.maxStreak, updated.currentStreak);
    updated.distribution[guessCount] = (updated.distribution[guessCount] ?? 0) + 1;
  } else {
    updated.currentStreak = 0;
  }

  write(KEYS.stats, updated);
  return updated;
}

export function resetStats() {
  write(KEYS.stats, DEFAULT_STATS);
  return { ...DEFAULT_STATS, distribution: {} };
}

// --- today's board ----------------------------------------------------------

/** Returns the saved guesses for this puzzle, or [] for a fresh board. */
export function loadProgress(puzzleNumber) {
  const saved = read(KEYS.progress, null);
  if (!saved || saved.puzzleNumber !== puzzleNumber || !Array.isArray(saved.guesses)) return [];
  return saved.guesses.filter((guess) => typeof guess === 'string');
}

export function saveProgress(puzzleNumber, guesses) {
  write(KEYS.progress, { puzzleNumber, guesses });
}
