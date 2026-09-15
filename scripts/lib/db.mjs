/**
 * Opening the puzzle database.
 *
 * Uses `node:sqlite`, which ships with Node itself — there are no npm
 * dependencies to install anywhere in this project.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// node:sqlite is still flagged experimental in Node 22 and prints a warning on
// every run. Drop that one warning; let everything else through.
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name !== 'ExperimentalWarning' || !/SQLite/i.test(warning.message)) {
    console.warn(warning.stack ?? String(warning));
  }
});

let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  console.error(
    `This project needs Node 22.5 or newer for its built-in SQLite support.\n` +
    `You are running ${process.version}. Install a newer Node and try again.`,
  );
  process.exit(1);
}

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DB_PATH = process.env.GZAAT_WORDLE_DB ?? resolve(ROOT, 'db', 'gzaat-wordle.db');
export const SCHEMA_PATH = resolve(ROOT, 'db', 'schema.sql');

export function openDatabase({ create = false } = {}) {
  if (!create && !existsSync(DB_PATH)) {
    console.error(
      `No database at ${DB_PATH}\n` +
      `Create one with:  npm run db:reset`,
    );
    process.exit(1);
  }
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  return db;
}

export function applySchema(db) {
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
}

export function getMeta(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setMeta(db, key, value) {
  db.prepare(
    `INSERT INTO meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, String(value));
}

/** Seeded PRNG, so a rebuilt database always produces the same schedule. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled(items, seed) {
  const random = mulberry32(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
