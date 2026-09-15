-- =============================================================================
-- GZAAT Wordette — the same design for PostgreSQL
--
-- The CLI in scripts/ speaks SQLite, which is what makes this project run with
-- no installation at all. If the Gazette's website already has a Postgres
-- database and you would rather keep the words there, this is the same schema
-- in Postgres terms: same tables, same rules, same views.
-- =============================================================================

CREATE TABLE words (
  id             BIGSERIAL PRIMARY KEY,
  word           TEXT        NOT NULL UNIQUE CHECK (word ~ '^[a-z]{5}$'),
  is_answer      BOOLEAN     NOT NULL DEFAULT FALSE,
  is_blocked     BOOLEAN     NOT NULL DEFAULT FALSE,
  frequency_rank INTEGER     CHECK (frequency_rank IS NULL OR frequency_rank > 0),
  difficulty     TEXT        NOT NULL DEFAULT 'medium'
                             CHECK (difficulty IN ('easy', 'medium', 'hard')),
  language       TEXT        NOT NULL DEFAULT 'en',
  source         TEXT        NOT NULL DEFAULT 'seed',
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_words_pool ON words (is_answer, is_blocked, frequency_rank);

CREATE TABLE puzzles (
  id            BIGSERIAL PRIMARY KEY,
  puzzle_date   DATE        NOT NULL UNIQUE,
  puzzle_number INTEGER     NOT NULL UNIQUE CHECK (puzzle_number > 0),
  -- UNIQUE is the rule that stops a word ever being the answer twice.
  word_id       BIGINT      NOT NULL UNIQUE REFERENCES words (id) ON DELETE RESTRICT,
  status        TEXT        NOT NULL DEFAULT 'scheduled'
                            CHECK (status IN ('draft', 'scheduled', 'published')),
  editor        TEXT,
  editor_note   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_puzzles_date ON puzzles (puzzle_date);

CREATE TABLE results (
  id          BIGSERIAL PRIMARY KEY,
  puzzle_id   BIGINT      NOT NULL REFERENCES puzzles (id) ON DELETE CASCADE,
  player_key  TEXT        NOT NULL,
  solved      BOOLEAN     NOT NULL,
  guess_count SMALLINT    NOT NULL CHECK (guess_count BETWEEN 1 AND 10),
  hard_mode   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (puzzle_id, player_key)
);

CREATE INDEX idx_results_puzzle ON results (puzzle_id);

-- --- rules the database enforces on its own --------------------------------

CREATE FUNCTION puzzles_answer_only() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM words
     WHERE id = NEW.word_id AND is_answer AND NOT is_blocked
  ) THEN
    RAISE EXCEPTION 'word is blocked or not marked as an answer';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_puzzles_answer_only
BEFORE INSERT OR UPDATE OF word_id ON puzzles
FOR EACH ROW EXECUTE FUNCTION puzzles_answer_only();

CREATE FUNCTION words_block_scheduled() RETURNS trigger AS $$
BEGIN
  IF NEW.is_blocked AND EXISTS (SELECT 1 FROM puzzles WHERE word_id = NEW.id) THEN
    RAISE EXCEPTION 'word is already scheduled — unschedule that date first';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_words_block_scheduled
BEFORE UPDATE OF is_blocked ON words
FOR EACH ROW EXECUTE FUNCTION words_block_scheduled();

CREATE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_words_touch   BEFORE UPDATE ON words
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER trg_puzzles_touch BEFORE UPDATE ON puzzles
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- --- views -----------------------------------------------------------------

CREATE VIEW v_schedule AS
SELECT p.puzzle_number, p.puzzle_date, w.word, w.difficulty, w.frequency_rank,
       p.status, p.editor, p.editor_note
FROM   puzzles p
JOIN   words   w ON w.id = p.word_id
ORDER  BY p.puzzle_date;

CREATE VIEW v_upcoming AS
SELECT * FROM v_schedule WHERE puzzle_date >= CURRENT_DATE;

CREATE VIEW v_answer_pool AS
SELECT w.id, w.word, w.difficulty, w.frequency_rank
FROM   words w
WHERE  w.is_answer
  AND  NOT w.is_blocked
  AND  NOT EXISTS (SELECT 1 FROM puzzles p WHERE p.word_id = w.id)
ORDER  BY w.frequency_rank;

CREATE VIEW v_puzzle_stats AS
SELECT p.puzzle_number,
       p.puzzle_date,
       w.word,
       COUNT(r.id)                                          AS plays,
       COUNT(r.id) FILTER (WHERE r.solved)                  AS solved,
       ROUND(AVG(r.guess_count) FILTER (WHERE r.solved), 2) AS avg_guesses
FROM   puzzles p
JOIN   words   w ON w.id = p.word_id
LEFT   JOIN results r ON r.puzzle_id = p.id
GROUP  BY p.id, p.puzzle_number, p.puzzle_date, w.word
ORDER  BY p.puzzle_date;
