# The word database

Everything about which word appears on which day. If you only ever run
`npm run db:reset` and `npm run db:export`, you can stop after the first
section.

## The shape of it

Three tables. The full definition, with comments, is in
[`db/schema.sql`](../db/schema.sql); the same design for Postgres is in
[`db/schema.postgres.sql`](../db/schema.postgres.sql).

### `words` — the dictionary

Every five-letter word the game knows, about 14,800 of them.

| Column | What it is for |
| --- | --- |
| `word` | The word itself, lowercase. The database refuses anything that is not five letters of a–z. |
| `is_answer` | `1` if the word is common enough to be a word of the day. The other ~12,800 are accepted as guesses only. |
| `is_blocked` | `1` if the word must never be an answer — profanity, slurs, proper nouns, anything the editors veto. |
| `frequency_rank` | `1` is the most common five-letter word in written English. This is what `difficulty` is worked out from. |
| `difficulty` | `easy` (rank 1–600), `medium` (601–1400) or `hard`. Use it to keep the first week of term gentle. |
| `source` | Where the word came from: `seed`, `blocklist`, or `editor` for words you added. |
| `note` | Free text. Handy for "chosen for the science issue". |

Splitting guesses from answers is what makes the game feel fair: readers can
type any real word, but they are never asked to guess one nobody uses.

### `puzzles` — the calendar

One row per date. `puzzle_date` is the day the word goes live, `puzzle_number`
is what readers see in the header and in the text they share.

The three `UNIQUE` constraints are the whole design:

- `puzzle_date` — one word per day, never two.
- `puzzle_number` — numbers never collide.
- `word_id` — **a word can only ever be used once.** The database itself will
  refuse a repeat, so no amount of rescheduling can accidentally run the same
  answer twice.

Two triggers back that up: a blocked or guess-only word cannot be put on the
calendar, and a word that is already on the calendar cannot be blocked without
being unscheduled first. Those rules hold even if someone edits the database by
hand instead of using the CLI.

### `results` — how everyone did (optional)

Only used if you run the API server. It stores a random per-browser key, whether
the puzzle was solved and in how many guesses — no names, no email addresses, no
IP addresses. On a plain static deployment this table stays empty and you can
ignore it.

### Views

`v_schedule`, `v_upcoming`, `v_answer_pool` and `v_puzzle_stats` are what you
actually read. For example, straight from `sqlite3`:

```sql
SELECT * FROM v_upcoming LIMIT 10;                 -- what is going out next
SELECT * FROM v_answer_pool WHERE difficulty = 'easy' LIMIT 20;
SELECT * FROM v_puzzle_stats ORDER BY plays DESC;  -- needs the API server
```

## Filling the calendar

`schedule` takes unused answer words and deals them onto empty days:

```bash
npm run db -- schedule --days 365                      # a year from where the calendar ends
npm run db -- schedule --days 14 --max-difficulty easy # a gentle fortnight
npm run db -- schedule --from 2027-01-01 --days 90
```

It never touches a day that already has a word, so it is safe to run again to
extend the calendar. Two things happen quietly while it works:

- **The order is shuffled, not alphabetical or by frequency** — otherwise the
  words would get steadily harder all year. The shuffle is seeded (the seed is
  in the `meta` table), so rebuilding the database gives the same calendar back.
- **Near-repeats are pushed apart.** A word that differs from the day before by
  a single letter — `CROWN` after `BROWN` — is skipped in favour of the next one
  in the queue. Readers find those maddening.

## Everyday jobs

```bash
# What is going out this fortnight?
npm run db:list

# A word for a particular day — a holiday, an anniversary, the last issue
npm run db -- set --date 2026-12-25 --word merry --note "holiday issue" --editor nino

# Take a word off the calendar; it goes back into the pool
npm run db -- unschedule --date 2026-12-25

# Words of your own. Without --answer it is only accepted as a guess.
npm run db -- add --word gzaat --answer --note "school name"

# Veto a word for good
npm run db -- block --word tacky

# Check everything, then publish
npm run db:doctor
npm run db:export
```

`set` reuses the day's puzzle number, so pinning a word for a particular date
does not renumber anything around it. If the word you ask for is already booked
for another day that has not happened yet, the two days trade words rather than
one of them being left empty — the command tells you where the displaced word
went. A word that has already been published cannot be brought back.

### Words of your own

School-specific words are the nicest touch you can add — a house name, the
school motto, something from the archive. They have to be exactly five letters
and made of a–z, and they need `--answer` to be eligible as a word of the day:

```bash
npm run db -- add --word gzaat --answer --note "the school itself"
npm run db -- set --date 2027-05-25 --word gzaat --note "founders' day"
```

## Publishing

`npm run db:export` writes two files into `public/wordle/data/`:

**`puzzles.json`** — the calendar.

```json
{
  "startDate": "2026-09-15",
  "startNumber": 1,
  "count": 1825,
  "cipher": "gzw1",
  "answers": ["XUa05Zc=", "2OGfelI=", "..."]
}
```

The answers are a dense list: position *n* is the word for *n* days after
`startDate`. The browser subtracts two dates and jumps straight to the right
one. Export refuses to run if the calendar has a gap in it, because a gap would
silently shift every word after it by a day.

**`dictionary.json`** — every accepted guess, joined into one long string and
split back up in the browser. About 73 KB, 35 KB over a gzipped connection.

### About the encoding

Answers are XOR-ed with a keystream derived from the puzzle number and written
in base64 (`public/wordle/js/cipher.js`). This stops a reader spoiling the week
by glancing at the page source. It is not encryption: anyone who opens the
JavaScript can decode the file. That is a deliberate trade — it keeps the game a
set of static files that any web server can host.

If you need real secrecy, use the API.

## The optional API

```bash
npm run api     # serves the site and the API on http://localhost:8080
```

Then set `source.mode` to `'api'` in `public/wordle/js/config.js`. The browser
now asks the server for the current puzzle, and the server refuses to answer for
any date that has not started yet.

| Endpoint | Does |
| --- | --- |
| `GET /api/wordle/puzzle` | Today's puzzle |
| `GET /api/wordle/puzzle?date=2026-09-15` | An earlier day (a future date is refused) |
| `GET /api/wordle/puzzle?number=12` | The same, by puzzle number |
| `GET /api/wordle/stats?number=12` | Plays, solves and average guesses |
| `POST /api/wordle/result` | Record one finished game |

It needs the database file on the web server, which a static host cannot do —
that is the cost of the trade.

## Using a different database

The CLI speaks SQLite because it comes built into Node and needs no
installation. If the Gazette's site already runs on Postgres or MySQL, the
design ports directly:

- **Postgres** — [`db/schema.postgres.sql`](../db/schema.postgres.sql), ready to run.
- **MySQL** — the same tables. Use `VARCHAR(5)` for `word`, `DATE` for
  `puzzle_date`, `TINYINT(1)` for the flags, and `CHECK` constraints work from
  MySQL 8.0.16 onwards.

Whatever holds the words, the website still reads the same exported JSON, so
only the export step has to change.

## Backups

`db/gzaat-wordle.db` is deliberately not committed: it is rebuilt from
`db/schema.sql` and `scripts/seed/*.txt`, both of which are. What is *not*
reproducible is your own editing — words you added, days you pinned, blocks you
made. Either commit those as changes to the seed files, or keep a copy of the
database file:

```bash
sqlite3 db/gzaat-wordle.db ".backup db/backup-$(date +%F).db"
```

If you lose the database entirely, `npm run db:reset` gives you a working game
back in seconds, with the same calendar as long as the shuffle seed has not
changed — but any hand-picked days would need setting again.
