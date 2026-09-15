# GZAAT Wordette

The Gazette's daily five-letter word game: six guesses, one new word every day,
the same word for every reader. It is plain HTML, CSS and JavaScript — no build
step, no framework, no npm packages — plus a small database that decides which
word belongs to which day.

```
public/wordette/     the game itself — copy this folder onto the website
db/                the schema for the word database
scripts/           the command line tool the newsroom uses, and the word lists
server/            a local web server, and an optional puzzle API
docs/              how the database works, and how to embed the game
tests/             tests for the scoring rules
```

## Quick start

Needs Node 22.5 or newer, and nothing else.

```bash
npm run db:reset    # build the database and export the game's data files
npm start           # serve the site at http://localhost:8080/wordette/
```

`db:reset` creates `db/gzaat-wordette.db`, loads about 14,800 words into it,
schedules five years of daily puzzles, and writes the two JSON files the game
reads. It is safe to run again whenever you like — but it does rebuild the
calendar from scratch, so only do it before you publish.

## How the daily word works

1. **The database is the source of truth.** `words` holds the dictionary,
   `puzzles` is the calendar: one row per date, each pointing at one word.
2. **Exporting** turns the calendar into `public/wordette/data/puzzles.json`, a
   dated list of answers, and the dictionary into `dictionary.json`.
3. **The browser** works out how many days have passed since the first puzzle
   and takes that day's word. The change happens at local midnight, so everyone
   gets the new word when their own day starts.

No word is ever used twice — the database refuses it — and answers are
obfuscated in the exported file so a curious reader cannot spoil tomorrow by
opening the page source. That is a spoiler guard, not a secret: if you want
tomorrow's word to be genuinely unavailable, run the API server described in
[docs/DATABASE.md](docs/DATABASE.md).

## Running the calendar

Everything goes through one command. `npm run db -- <command>` or
`node scripts/wordette-db.mjs <command>`:

| What you want | Command |
| --- | --- |
| See what is coming up | `npm run db:list` |
| See the next month | `npm run db -- list --days 30` |
| Today's answer | `npm run db -- today` |
| Pick the word for a particular day | `npm run db -- set --date 2026-12-25 --word merry` |
| Add a word of your own | `npm run db -- add --word gzaat --answer` |
| Never use a word again | `npm run db -- block --word tacky` |
| Add another year of puzzles | `npm run db -- schedule --days 365` |
| Check everything is in order | `npm run db:doctor` |
| Publish your changes | `npm run db:export` |

Any change to the database only reaches readers once you run
`npm run db:export` and put the updated `public/wordette/data/` files on the
website. `npm run db:doctor` will tell you if you have forgotten.

A sensible routine: run `npm run db:doctor` at the start of each term. It warns
when the calendar is running short, when a day has no word, and when the
exported files no longer match the database.

## Putting it on the site

Copy `public/wordette/` to the web server and link to it, or embed it in an
article with an iframe. Both are covered in
[docs/EMBEDDING.md](docs/EMBEDDING.md), including how to make the iframe resize
itself.

Change the newspaper's name, the share link and the colours in
`public/wordette/js/config.js` and `public/wordette/styles.css` — those two files
are where anything worth customising lives.

## Notes

- **Readers' data stays with readers.** Guesses, statistics and settings live in
  the browser's own storage. Nothing is sent to the Gazette unless you choose to
  run the optional API, which records only an anonymous key and a guess count.
- **Accessibility.** The board and keyboard are reachable by keyboard and
  announced to screen readers, there is a high-contrast palette for
  red-green colour blindness, and animations stop for readers who have asked
  their device to reduce motion.
- **Browsers.** Anything from 2022 onwards. The game uses ES modules and
  `<dialog>`; there is no build step and no polyfills.
- **Tests.** `npm test` covers the scoring rules — including the fiddly
  repeated-letter cases — hard mode, the statistics, and the date arithmetic.

## Word lists

The starting dictionary is about 14,800 five-letter English words, of which the
2,000 most common are marked as possible answers, ordered by how often they
appear in written English. `scripts/seed/blocklist.txt` keeps profanity, slurs
and proper nouns out of the answers; it is an ordinary text file and you should
edit it to suit the paper. The first fortnight of the calendar is deliberately
stocked with easy words.
