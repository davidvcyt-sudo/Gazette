#!/usr/bin/env node
/**
 * GZAAT Wordle — word database CLI.
 *
 * Everything an editor needs to do to the puzzle database lives here:
 * building it, loading the word lists, filling the calendar, overriding a
 * particular day, and exporting the static files the website reads.
 *
 *   node scripts/wordle-db.mjs help
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  ROOT, DB_PATH, openDatabase, applySchema, getMeta, setMeta, shuffled,
} from './lib/db.mjs';
import { addDays, daysBetween, isISODate, todayISO, weekdayName } from '../public/wordle/js/dates.js';
import { encodeAnswer, decodeAnswer } from '../public/wordle/js/cipher.js';

const SEED_DIR = resolve(ROOT, 'scripts', 'seed');
const EXPORT_DIR = resolve(ROOT, 'public', 'wordle', 'data');
const WORD_LENGTH = 5;

/** Rank 1 is the most common English five-letter word; obscurity grows from there. */
const EASY_UNTIL = 600;
const MEDIUM_UNTIL = 1400;
const DIFFICULTY_ORDER = { easy: 1, medium: 2, hard: 3 };

function difficultyForRank(rank) {
  if (!rank || rank > MEDIUM_UNTIL) return 'hard';
  return rank <= EASY_UNTIL ? 'easy' : 'medium';
}

// ---------------------------------------------------------------------------
// argument handling
// ---------------------------------------------------------------------------

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    from:             { type: 'string' },
    days:             { type: 'string' },
    date:             { type: 'string' },
    word:             { type: 'string' },
    note:             { type: 'string' },
    editor:           { type: 'string' },
    seed:             { type: 'string' },
    'max-difficulty': { type: 'string' },
    out:              { type: 'string' },
    all:              { type: 'boolean', default: false },
    answer:           { type: 'boolean', default: false },
    force:            { type: 'boolean', default: false },
    json:             { type: 'boolean', default: false },
  },
});

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function requireFlag(name) {
  const value = flags[name];
  if (!value) fail(`--${name} is required (run "help" for examples)`);
  return value;
}

function requireDate(name) {
  const value = requireFlag(name);
  if (!isISODate(value)) fail(`--${name} must look like 2026-09-15, got "${value}"`);
  return value;
}

function normalizeWord(input) {
  const word = String(input).trim().toLowerCase();
  if (!/^[a-z]+$/.test(word) || word.length !== WORD_LENGTH) {
    fail(`"${input}" is not a ${WORD_LENGTH}-letter word made of a-z`);
  }
  return word;
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

function cmdInit() {
  if (existsSync(DB_PATH) && !flags.force) {
    fail(`${DB_PATH} already exists. Pass --force to delete it and start over.`);
  }
  if (flags.force) {
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true });
  }
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = openDatabase({ create: true });
  applySchema(db);
  db.close();
  console.log(`created ${DB_PATH}`);
}

function readSeedFile(name) {
  const path = resolve(SEED_DIR, name);
  if (!existsSync(path)) fail(`missing seed file ${path}`);
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line && !line.startsWith('#'));
}

function cmdImport() {
  const db = openDatabase();
  const guesses = readSeedFile('guesses.txt');
  const answers = readSeedFile('answers.txt');
  // Blocklist entries that are not five letters can never show up in the game
  // at all, so they are reported and dropped rather than failing the import.
  const blocked = readSeedFile('blocklist.txt').filter((word) => {
    if (/^[a-z]{5}$/.test(word)) return true;
    console.log(`ignoring blocklist entry "${word}" — not a ${WORD_LENGTH}-letter word`);
    return false;
  });

  const malformed = [...guesses, ...answers].filter((w) => !/^[a-z]{5}$/.test(w));
  if (malformed.length) {
    fail(`seed files contain ${malformed.length} malformed entries, e.g. "${malformed[0]}"`);
  }

  const insertGuess = db.prepare(
    `INSERT INTO words (word, is_answer, source) VALUES (?, 0, 'seed')
     ON CONFLICT (word) DO NOTHING`,
  );
  const upgradeAnswer = db.prepare(
    `INSERT INTO words (word, is_answer, frequency_rank, difficulty, source)
     VALUES (?, 1, ?, ?, 'seed')
     ON CONFLICT (word) DO UPDATE
       SET is_answer = 1, frequency_rank = excluded.frequency_rank,
           difficulty = excluded.difficulty`,
  );
  const blockWord = db.prepare('UPDATE words SET is_blocked = 1 WHERE word = ?');
  const insertBlocked = db.prepare(
    `INSERT INTO words (word, is_answer, is_blocked, source) VALUES (?, 0, 1, 'blocklist')
     ON CONFLICT (word) DO NOTHING`,
  );

  db.exec('BEGIN');
  try {
    for (const word of guesses) insertGuess.run(word);
    for (const [index, word] of answers.entries()) {
      const rank = index + 1;
      upgradeAnswer.run(word, rank, difficultyForRank(rank));
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  // Blocking is applied one row at a time: a word that is already on the
  // calendar is refused by the database, and that should be reported rather
  // than roll back the whole import.
  const conflicts = [];
  for (const word of blocked) {
    try {
      insertBlocked.run(word);
      blockWord.run(word);
    } catch (error) {
      conflicts.push(`${word} (${error.message})`);
    }
  }

  const counts = db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(is_answer)  AS answers,
            SUM(is_blocked) AS blocked
     FROM words`,
  ).get();
  db.close();

  console.log(`dictionary: ${counts.total} words`);
  console.log(`answer pool: ${counts.answers} eligible, ${counts.blocked} blocked`);
  if (conflicts.length) {
    console.log(`\ncould not block ${conflicts.length} word(s):`);
    for (const line of conflicts) console.log(`  ${line}`);
    console.log('a word already on the calendar has to be unscheduled before it can be blocked.');
  }
}

/** Two answers in a row that differ by a single letter feel like a trick. */
function tooSimilar(a, b) {
  if (!a || !b) return false;
  let same = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] === b[i]) same += 1;
  return same >= a.length - 1;
}

function cmdSchedule() {
  const db = openDatabase();
  const days = Number(flags.days ?? 365);
  if (!Number.isInteger(days) || days < 1) fail('--days must be a whole number of days');

  const last = db.prepare(
    'SELECT puzzle_date, puzzle_number FROM puzzles ORDER BY puzzle_date DESC LIMIT 1',
  ).get();

  const startDate = flags.from
    ? requireDate('from')
    : (last ? addDays(last.puzzle_date, 1) : todayISO());
  let nextNumber = last ? last.puzzle_number + 1 : 1;

  const ceiling = DIFFICULTY_ORDER[flags['max-difficulty'] ?? 'hard'];
  if (!ceiling) fail('--max-difficulty must be easy, medium or hard');

  const pool = db.prepare(
    `SELECT id, word, difficulty FROM v_answer_pool
      WHERE CASE difficulty WHEN 'easy' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END <= ?`,
  ).all(ceiling);

  if (!pool.length) fail('no unused answer words left — run "import", or add words with "add"');

  const seed = Number(flags.seed ?? getMeta(db, 'shuffle_seed', '20260915'));
  if (!Number.isFinite(seed)) fail('--seed must be a number');
  if (flags.seed) setMeta(db, 'shuffle_seed', seed);
  const queue = shuffled(pool, seed);

  const takenDates = new Set(
    db.prepare('SELECT puzzle_date FROM puzzles').all().map((row) => row.puzzle_date),
  );
  const previousOf = db.prepare(
    `SELECT w.word FROM puzzles p JOIN words w ON w.id = p.word_id
      WHERE p.puzzle_date < ? ORDER BY p.puzzle_date DESC LIMIT 1`,
  );

  const insert = db.prepare(
    `INSERT INTO puzzles (puzzle_date, puzzle_number, word_id, status, editor)
     VALUES (?, ?, ?, 'scheduled', ?)`,
  );

  let cursor = 0;
  let placed = 0;
  let skipped = 0;
  const editor = flags.editor ?? 'schedule';

  db.exec('BEGIN');
  try {
    for (let offset = 0; offset < days; offset += 1) {
      const date = addDays(startDate, offset);
      if (takenDates.has(date)) { skipped += 1; continue; }
      if (cursor >= queue.length) break;

      const previous = previousOf.get(date)?.word ?? null;
      // Look a little way down the queue for a word that does not shadow the
      // day before; if the whole window is similar, take the next one anyway.
      let pick = cursor;
      for (let look = cursor; look < Math.min(cursor + 12, queue.length); look += 1) {
        if (!tooSimilar(previous, queue[look].word)) { pick = look; break; }
      }
      const [chosen] = queue.splice(pick, 1);

      insert.run(date, nextNumber, chosen.id, editor);
      takenDates.add(date);
      nextNumber += 1;
      placed += 1;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const remaining = db.prepare('SELECT COUNT(*) AS n FROM v_answer_pool').get().n;
  const lastDate = db.prepare('SELECT MAX(puzzle_date) AS d FROM puzzles').get().d;
  db.close();

  console.log(`scheduled ${placed} day(s) starting ${startDate}`);
  if (skipped) console.log(`left ${skipped} day(s) alone — they were already scheduled`);
  console.log(`calendar now runs through ${lastDate}`);
  console.log(`${remaining} unused answer word(s) still in the pool`);
  console.log('\nremember to run:  npm run db:export');
}

function cmdSet() {
  const date = requireDate('date');
  const word = normalizeWord(requireFlag('word'));
  const db = openDatabase();

  const row = db.prepare('SELECT id, is_answer, is_blocked FROM words WHERE word = ?').get(word);
  if (!row) fail(`"${word}" is not in the dictionary. Add it with:  add --word ${word} --answer`);
  if (row.is_blocked) fail(`"${word}" is on the blocklist. Unblock it first:  unblock --word ${word}`);
  if (!row.is_answer) {
    fail(`"${word}" is a guess-only word. Promote it with:  add --word ${word} --answer`);
  }

  const existing = db.prepare('SELECT id, puzzle_number, word_id FROM puzzles WHERE puzzle_date = ?').get(date);
  const usedOn = db.prepare(
    `SELECT p.id, p.puzzle_date, p.word_id FROM puzzles p WHERE p.word_id = ? AND p.puzzle_date <> ?`,
  ).get(row.id, date);

  if (usedOn && usedOn.puzzle_date < todayISO()) {
    fail(`"${word}" was already the answer on ${usedOn.puzzle_date} — readers have had it`);
  }

  if (existing) {
    const displaced = db.prepare('SELECT word FROM words WHERE id = ?').get(existing.word_id).word;

    if (usedOn) {
      // The word is spoken for on another future day. Trade the two days rather
      // than leaving a hole in the calendar: both days keep a word, and the
      // "one word, once" rule is never broken.
      //
      // word_id is both NOT NULL and UNIQUE, so there is no intermediate state
      // to update through — the two rows come out and go back in together.
      const rows = db.prepare(
        'SELECT * FROM puzzles WHERE id IN (?, ?) ORDER BY puzzle_date',
      ).all(existing.id, usedOn.id);
      const swap = new Map([[existing.id, row.id], [usedOn.id, existing.word_id]]);

      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM puzzles WHERE id IN (?, ?)').run(existing.id, usedOn.id);
        const reinsert = db.prepare(
          `INSERT INTO puzzles (id, puzzle_date, puzzle_number, word_id, status, editor, editor_note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const old of rows) {
          reinsert.run(
            old.id, old.puzzle_date, old.puzzle_number, swap.get(old.id),
            old.status, old.editor, old.editor_note, old.created_at,
          );
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      console.log(`${date} (#${existing.puzzle_number}) is now "${word}"`);
      console.log(`"${displaced}" moved to ${usedOn.puzzle_date}, which is where "${word}" was`);
    } else {
      db.prepare('UPDATE puzzles SET word_id = ? WHERE id = ?').run(row.id, existing.id);
      console.log(`${date} (#${existing.puzzle_number}) is now "${word}" (was "${displaced}")`);
    }

    db.prepare(
      `UPDATE puzzles SET editor = COALESCE(?, editor), editor_note = COALESCE(?, editor_note)
        WHERE id = ?`,
    ).run(flags.editor ?? null, flags.note ?? null, existing.id);
  } else {
    if (usedOn) fail(`"${word}" is already the answer on ${usedOn.puzzle_date}`);
    const max = db.prepare('SELECT COALESCE(MAX(puzzle_number), 0) AS n FROM puzzles').get().n;
    db.prepare(
      `INSERT INTO puzzles (puzzle_date, puzzle_number, word_id, status, editor, editor_note)
       VALUES (?, ?, ?, 'scheduled', ?, ?)`,
    ).run(date, max + 1, row.id, flags.editor ?? null, flags.note ?? null);
    console.log(`${date} (#${max + 1}) set to "${word}"`);
    console.log('note: this day was outside the existing run of dates — check "doctor" for gaps');
  }
  db.close();
  console.log('remember to run:  npm run db:export');
}

function cmdUnschedule() {
  const date = requireDate('date');
  const db = openDatabase();
  const row = db.prepare(
    `SELECT p.id, p.puzzle_number, w.word FROM puzzles p JOIN words w ON w.id = p.word_id
      WHERE p.puzzle_date = ?`,
  ).get(date);
  if (!row) fail(`nothing scheduled on ${date}`);
  if (date < todayISO() && !flags.force) {
    fail(`${date} is in the past and readers have already played it. Pass --force if you really mean it.`);
  }
  db.prepare('DELETE FROM puzzles WHERE id = ?').run(row.id);
  db.close();
  console.log(`removed #${row.puzzle_number} ("${row.word}") from ${date}`);
  console.log(`"${row.word}" is back in the pool. ${date} now has no word, and export`);
  console.log('will refuse a calendar with a hole in it, so give it one:');
  console.log(`  node scripts/wordle-db.mjs schedule --from ${date} --days 1`);
  console.log(`  node scripts/wordle-db.mjs set --date ${date} --word <your word>`);
}

function cmdList() {
  const db = openDatabase();
  const from = flags.from ?? todayISO();
  const days = Number(flags.days ?? 14);
  const rows = flags.all
    ? db.prepare('SELECT * FROM v_schedule').all()
    : db.prepare(
        'SELECT * FROM v_schedule WHERE puzzle_date >= ? AND puzzle_date <= ?',
      ).all(from, addDays(from, days - 1));

  if (flags.json) {
    console.log(JSON.stringify(rows, null, 2));
    db.close();
    return;
  }

  if (!rows.length) {
    console.log('nothing scheduled in that range');
    db.close();
    return;
  }

  const today = todayISO();
  console.log('  #      date         day   word    difficulty  note');
  console.log('  ' + '-'.repeat(62));
  for (const row of rows) {
    const marker = row.puzzle_date === today ? '>' : ' ';
    console.log(
      `${marker} ${String(row.puzzle_number).padEnd(6)} ${row.puzzle_date}   ` +
      `${weekdayName(row.puzzle_date)}   ${row.word.padEnd(7)} ` +
      `${row.difficulty.padEnd(11)} ${row.editor_note ?? ''}`.trimEnd(),
    );
  }
  db.close();
}

function cmdToday() {
  const db = openDatabase();
  const date = flags.date ?? todayISO();
  const row = db.prepare('SELECT * FROM v_schedule WHERE puzzle_date = ?').get(date);
  db.close();
  if (!row) fail(`nothing scheduled for ${date}`);
  if (flags.json) {
    console.log(JSON.stringify(row, null, 2));
  } else {
    console.log(`GZAAT Wordle #${row.puzzle_number} — ${row.puzzle_date} — ${row.word} (${row.difficulty})`);
  }
}

function cmdAdd() {
  const word = normalizeWord(requireFlag('word'));
  const db = openDatabase();
  db.prepare(
    `INSERT INTO words (word, is_answer, difficulty, source, note)
     VALUES (?, ?, 'medium', 'editor', ?)
     ON CONFLICT (word) DO UPDATE
       SET is_answer = MAX(words.is_answer, excluded.is_answer),
           note      = COALESCE(excluded.note, words.note),
           source    = 'editor'`,
  ).run(word, flags.answer ? 1 : 0, flags.note ?? null);
  db.close();
  console.log(
    flags.answer
      ? `"${word}" added — it can be guessed and can be a word of the day`
      : `"${word}" added as a valid guess (pass --answer to let it be a word of the day)`,
  );
  console.log('remember to run:  npm run db:export');
}

function cmdBlock(shouldBlock) {
  const word = normalizeWord(requireFlag('word'));
  const db = openDatabase();
  const row = db.prepare('SELECT id FROM words WHERE word = ?').get(word);
  if (!row) fail(`"${word}" is not in the dictionary`);
  try {
    db.prepare('UPDATE words SET is_blocked = ? WHERE id = ?').run(shouldBlock ? 1 : 0, row.id);
  } catch (error) {
    fail(error.message);
  }
  db.close();
  console.log(`"${word}" is ${shouldBlock ? 'blocked — it will never be a word of the day' : 'unblocked'}`);
}

function cmdExport() {
  const db = openDatabase();
  const outDir = flags.out ? resolve(flags.out) : EXPORT_DIR;
  mkdirSync(outDir, { recursive: true });

  const schedule = db.prepare('SELECT * FROM v_schedule').all();
  if (!schedule.length) fail('the calendar is empty — run "schedule" first');

  const startDate = schedule[0].puzzle_date;
  const gaps = [];
  for (const [index, row] of schedule.entries()) {
    const expected = addDays(startDate, index);
    if (row.puzzle_date !== expected) { gaps.push(expected); break; }
  }
  if (gaps.length) {
    fail(
      `the calendar has a gap at ${gaps[0]}. Every day between the first and ` +
      `last puzzle needs a word. Run "doctor" to see the details.`,
    );
  }

  const puzzles = {
    generatedAt: new Date().toISOString(),
    wordLength: Number(getMeta(db, 'word_length', WORD_LENGTH)),
    maxGuesses: Number(getMeta(db, 'max_guesses', 6)),
    startDate,
    startNumber: schedule[0].puzzle_number,
    count: schedule.length,
    cipher: 'gzw1',
    answers: schedule.map((row) => encodeAnswer(row.word, row.puzzle_number)),
  };

  const words = db.prepare('SELECT word FROM words ORDER BY word').all().map((row) => row.word);
  const dictionary = {
    generatedAt: puzzles.generatedAt,
    wordLength: puzzles.wordLength,
    count: words.length,
    // One long string instead of an array of strings: same content, roughly
    // half the bytes over the wire, split back apart on load.
    packed: words.join(''),
  };

  writeFileSync(resolve(outDir, 'puzzles.json'), `${JSON.stringify(puzzles)}\n`);
  writeFileSync(resolve(outDir, 'dictionary.json'), `${JSON.stringify(dictionary)}\n`);
  db.close();

  const lastDate = addDays(startDate, schedule.length - 1);
  console.log(`wrote ${resolve(outDir, 'puzzles.json')}`);
  console.log(`  ${schedule.length} puzzles, ${startDate} through ${lastDate}`);
  console.log(`wrote ${resolve(outDir, 'dictionary.json')}`);
  console.log(`  ${words.length} accepted guesses`);
}

function cmdDoctor() {
  const db = openDatabase();
  const problems = [];
  const notes = [];
  const today = todayISO();

  const counts = db.prepare(
    `SELECT COUNT(*) AS words, SUM(is_answer) AS answers, SUM(is_blocked) AS blocked FROM words`,
  ).get();
  notes.push(`dictionary: ${counts.words} words, ${counts.answers} answer-eligible, ${counts.blocked} blocked`);

  const schedule = db.prepare('SELECT * FROM v_schedule').all();
  if (!schedule.length) {
    problems.push('the calendar is empty — run "schedule"');
  } else {
    const startDate = schedule[0].puzzle_date;
    const lastDate = schedule[schedule.length - 1].puzzle_date;
    notes.push(`calendar: ${schedule.length} puzzles, ${startDate} through ${lastDate}`);

    for (const [index, row] of schedule.entries()) {
      const expected = addDays(startDate, index);
      if (row.puzzle_date !== expected) {
        problems.push(`missing a puzzle for ${expected} (next one found is ${row.puzzle_date})`);
        break;
      }
      if (row.puzzle_number !== schedule[0].puzzle_number + index) {
        problems.push(`puzzle numbers are not consecutive around ${row.puzzle_date}`);
        break;
      }
    }

    const blockedOnCalendar = db.prepare(
      `SELECT w.word, p.puzzle_date FROM puzzles p JOIN words w ON w.id = p.word_id
        WHERE w.is_blocked = 1 OR w.is_answer = 0`,
    ).all();
    for (const row of blockedOnCalendar) {
      problems.push(`${row.puzzle_date} uses "${row.word}", which is blocked or guess-only`);
    }

    const runway = daysBetween(today, lastDate);
    if (runway < 0) problems.push(`the calendar ended on ${lastDate} — readers have run out of puzzles`);
    else if (runway < 30) problems.push(`only ${runway} day(s) of puzzles left — schedule more`);
    else if (runway < 90) notes.push(`${runway} days of puzzles left`);
    else notes.push(`${runway} days of puzzles left (through ${lastDate})`);

    if (!db.prepare('SELECT 1 FROM puzzles WHERE puzzle_date = ?').get(today)) {
      problems.push(`nothing is scheduled for today (${today})`);
    }
  }

  const poolLeft = db.prepare('SELECT COUNT(*) AS n FROM v_answer_pool').get().n;
  notes.push(`answer pool: ${poolLeft} unused word(s)`);
  if (poolLeft < 60) problems.push(`the answer pool is nearly empty (${poolLeft} left) — add more words`);

  // Every scheduled answer has to be typeable, i.e. present in the guess list.
  const missing = db.prepare(
    `SELECT w.word FROM puzzles p JOIN words w ON w.id = p.word_id
      WHERE LENGTH(w.word) <> ?`,
  ).all(WORD_LENGTH);
  for (const row of missing) problems.push(`"${row.word}" is not ${WORD_LENGTH} letters long`);

  // Is the exported JSON still in step with the database?
  const puzzlesPath = resolve(EXPORT_DIR, 'puzzles.json');
  if (!existsSync(puzzlesPath)) {
    problems.push('public/wordle/data/puzzles.json has never been exported — run "export"');
  } else if (schedule.length) {
    const exported = JSON.parse(readFileSync(puzzlesPath, 'utf8'));
    const todayRow = schedule.find((row) => row.puzzle_date === today);
    const index = todayRow ? daysBetween(exported.startDate, today) : -1;
    if (exported.count !== schedule.length || exported.startDate !== schedule[0].puzzle_date) {
      problems.push('the exported puzzles.json is out of date — run "export"');
    } else if (todayRow && index >= 0 && index < exported.answers.length) {
      const decoded = decodeAnswer(exported.answers[index], exported.startNumber + index);
      if (decoded !== todayRow.word) {
        problems.push(`the exported file says today's word is "${decoded}" but the database says "${todayRow.word}" — run "export"`);
      } else {
        notes.push(`export is in sync (today serves "${decoded}")`);
      }
    }
  }

  db.close();

  for (const note of notes) console.log(`  ok    ${note}`);
  if (!problems.length) {
    console.log('\neverything checks out.');
    return;
  }
  console.log('');
  for (const problem of problems) console.log(`  FIX   ${problem}`);
  process.exitCode = 1;
}

function cmdHelp() {
  console.log(`GZAAT Wordle — word database CLI

  node scripts/wordle-db.mjs <command> [options]

Setting up
  init [--force]                 Create db/gzaat-wordle.db from db/schema.sql
  import                         Load scripts/seed/*.txt into the dictionary

Running the calendar
  schedule [--from DATE] [--days N] [--max-difficulty easy|medium|hard] [--seed N]
                                 Fill empty days with unused answer words.
                                 Defaults to 365 days from the last scheduled day.
  set --date DATE --word WORD [--note TEXT] [--editor NAME]
                                 Pin one specific word to one specific day
  unschedule --date DATE [--force]
                                 Clear a day and return its word to the pool
  list [--from DATE] [--days N] [--all] [--json]
                                 Show the calendar (next 14 days by default)
  today [--date DATE] [--json]   Print one day's answer

Words
  add --word WORD [--answer] [--note TEXT]
                                 Add a word. Without --answer it is only a
                                 valid guess; with it, it can be a daily word.
  block --word WORD              Never use this word as a daily word
  unblock --word WORD            Undo a block

Publishing
  export [--out DIR]             Write the JSON files the website reads
  doctor                         Check the database and the exported files

Examples
  npm run db:reset                        # init + import + schedule + export
  node scripts/wordle-db.mjs list --days 30
  node scripts/wordle-db.mjs set --date 2026-12-25 --word merry --note "holiday issue"
  node scripts/wordle-db.mjs add --word gzaat --answer --note "school name"
`);
}

// ---------------------------------------------------------------------------

const command = positionals[0] ?? 'help';
const commands = {
  init: cmdInit,
  import: cmdImport,
  schedule: cmdSchedule,
  set: cmdSet,
  unschedule: cmdUnschedule,
  list: cmdList,
  today: cmdToday,
  add: cmdAdd,
  block: () => cmdBlock(true),
  unblock: () => cmdBlock(false),
  export: cmdExport,
  doctor: cmdDoctor,
  help: cmdHelp,
};

if (!commands[command]) {
  console.error(`unknown command "${command}"\n`);
  cmdHelp();
  process.exit(1);
}

try {
  commands[command]();
} catch (error) {
  fail(error.message);
}
