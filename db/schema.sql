-- =============================================================================
-- GZAAT Wordle — word & puzzle database (SQLite)
--
-- This file is the source of truth for the schema. Rebuild an empty database
-- with:  npm run db:init
--
-- Design in one paragraph: `words` is the dictionary (every word the game will
-- accept as a guess, with a flag for the ones good enough to be a word of the
-- day). `puzzles` is the calendar — exactly one row per date, each pointing at
-- one word, and a word can only ever be used once. `results` is optional and
-- only fills up if you run the API server. Everything the browser needs is
-- exported out of here into static JSON, so the website itself never talks to
-- the database.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- meta: small key/value table for things that describe the whole database
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO meta (key, value) VALUES
  ('schema_version', '1'),
  ('word_length',    '5'),
  ('max_guesses',    '6'),
  -- Changing the shuffle seed reshuffles every *unscheduled* word. Already
  -- scheduled days are never touched, so published puzzles stay published.
  ('shuffle_seed',   '20260915');

-- -----------------------------------------------------------------------------
-- words: the dictionary
--
--   is_answer  1 = may be picked as a word of the day (curated, common words)
--              0 = accepted as a guess only (the long tail of the dictionary)
--   is_blocked 1 = never schedule this, whatever is_answer says. Used for the
--              blocklist (profanity, slurs, proper nouns) so an editor can veto
--              a word without deleting it from the guess dictionary.
--   frequency_rank  1 = most common English 5-letter word. NULL = unranked.
--                   This is what `difficulty` is derived from.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS words (
  id             INTEGER PRIMARY KEY,
  word           TEXT    NOT NULL UNIQUE
                         CHECK (word GLOB '[a-z][a-z][a-z][a-z][a-z]'),
  is_answer      INTEGER NOT NULL DEFAULT 0 CHECK (is_answer  IN (0, 1)),
  is_blocked     INTEGER NOT NULL DEFAULT 0 CHECK (is_blocked IN (0, 1)),
  frequency_rank INTEGER CHECK (frequency_rank IS NULL OR frequency_rank > 0),
  difficulty     TEXT    NOT NULL DEFAULT 'medium'
                         CHECK (difficulty IN ('easy', 'medium', 'hard')),
  language       TEXT    NOT NULL DEFAULT 'en',
  source         TEXT    NOT NULL DEFAULT 'seed',
  note           TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_words_pool
  ON words (is_answer, is_blocked, frequency_rank);

-- -----------------------------------------------------------------------------
-- puzzles: the calendar
--
-- One row per calendar day. puzzle_date is the local date the word goes live
-- (the browser also rolls over at local midnight, so they agree). Both the date
-- and the number are unique, and so is word_id — that UNIQUE constraint is what
-- guarantees the same word is never the answer twice.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS puzzles (
  id            INTEGER PRIMARY KEY,
  puzzle_date   TEXT    NOT NULL UNIQUE
                        CHECK (puzzle_date IS date(puzzle_date)),
  puzzle_number INTEGER NOT NULL UNIQUE CHECK (puzzle_number > 0),
  word_id       INTEGER NOT NULL UNIQUE REFERENCES words (id) ON DELETE RESTRICT,
  status        TEXT    NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('draft', 'scheduled', 'published')),
  editor        TEXT,
  editor_note   TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_puzzles_date ON puzzles (puzzle_date);

-- -----------------------------------------------------------------------------
-- results: optional play data
--
-- Only written by the API server (server/api.mjs). The static site never posts
-- anything, so on a plain static deployment this table simply stays empty.
-- player_key is a random id the browser generates — not a login, not an email.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS results (
  id          INTEGER PRIMARY KEY,
  puzzle_id   INTEGER NOT NULL REFERENCES puzzles (id) ON DELETE CASCADE,
  player_key  TEXT    NOT NULL,
  solved      INTEGER NOT NULL CHECK (solved IN (0, 1)),
  guess_count INTEGER NOT NULL CHECK (guess_count BETWEEN 1 AND 10),
  hard_mode   INTEGER NOT NULL DEFAULT 0 CHECK (hard_mode IN (0, 1)),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (puzzle_id, player_key)
);

CREATE INDEX IF NOT EXISTS idx_results_puzzle ON results (puzzle_id);

-- -----------------------------------------------------------------------------
-- Rules the database enforces on its own
-- -----------------------------------------------------------------------------

-- A blocked word, or a word not marked as an answer, can never reach the
-- calendar — not through the CLI, not through a hand-written INSERT.
CREATE TRIGGER IF NOT EXISTS trg_puzzles_answer_only_insert
BEFORE INSERT ON puzzles
FOR EACH ROW
WHEN (SELECT is_answer = 0 OR is_blocked = 1 FROM words WHERE id = NEW.word_id)
BEGIN
  SELECT RAISE(ABORT, 'word is blocked or not marked as an answer');
END;

CREATE TRIGGER IF NOT EXISTS trg_puzzles_answer_only_update
BEFORE UPDATE OF word_id ON puzzles
FOR EACH ROW
WHEN (SELECT is_answer = 0 OR is_blocked = 1 FROM words WHERE id = NEW.word_id)
BEGIN
  SELECT RAISE(ABORT, 'word is blocked or not marked as an answer');
END;

-- Blocking a word that is already on the calendar should fail loudly rather
-- than silently leave it scheduled.
CREATE TRIGGER IF NOT EXISTS trg_words_block_scheduled
BEFORE UPDATE OF is_blocked ON words
FOR EACH ROW
WHEN NEW.is_blocked = 1
 AND EXISTS (SELECT 1 FROM puzzles WHERE word_id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'word is already scheduled — unschedule that date first');
END;

CREATE TRIGGER IF NOT EXISTS trg_words_touch
AFTER UPDATE ON words
FOR EACH ROW
BEGIN
  UPDATE words SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_puzzles_touch
AFTER UPDATE ON puzzles
FOR EACH ROW
BEGIN
  UPDATE puzzles SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- -----------------------------------------------------------------------------
-- Views — what an editor actually reads
-- -----------------------------------------------------------------------------

-- The whole calendar, oldest first.
CREATE VIEW IF NOT EXISTS v_schedule AS
SELECT p.puzzle_number,
       p.puzzle_date,
       w.word,
       w.difficulty,
       w.frequency_rank,
       p.status,
       p.editor,
       p.editor_note
FROM   puzzles p
JOIN   words   w ON w.id = p.word_id
ORDER  BY p.puzzle_date;

-- Everything from today on — the queue to review before it goes out.
CREATE VIEW IF NOT EXISTS v_upcoming AS
SELECT * FROM v_schedule WHERE puzzle_date >= date('now');

-- Words still available to schedule, most common first.
CREATE VIEW IF NOT EXISTS v_answer_pool AS
SELECT w.id, w.word, w.difficulty, w.frequency_rank
FROM   words w
WHERE  w.is_answer = 1
  AND  w.is_blocked = 0
  AND  NOT EXISTS (SELECT 1 FROM puzzles p WHERE p.word_id = w.id)
ORDER  BY w.frequency_rank;

-- How each published puzzle actually played, for the ones with API data.
CREATE VIEW IF NOT EXISTS v_puzzle_stats AS
SELECT p.puzzle_number,
       p.puzzle_date,
       w.word,
       COUNT(r.id)                                              AS plays,
       SUM(r.solved)                                            AS solved,
       ROUND(AVG(CASE WHEN r.solved = 1 THEN r.guess_count END), 2)
                                                                AS avg_guesses
FROM   puzzles p
JOIN   words   w ON w.id = p.word_id
LEFT   JOIN results r ON r.puzzle_id = p.id
GROUP  BY p.id
ORDER  BY p.puzzle_date;
