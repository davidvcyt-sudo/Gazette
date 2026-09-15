/**
 * Optional puzzle API: `npm run api`.
 *
 * The static build is enough for most newspapers. Run this instead when you
 * want tomorrow's word to be genuinely unavailable until tomorrow — this
 * server reads the same SQLite database and refuses to answer for any date
 * that has not started yet.
 *
 * Point the game at it by setting `source.mode: 'api'` in
 * public/wordle/js/config.js.
 *
 * Endpoints
 *   GET  /api/wordle/puzzle?date=YYYY-MM-DD   today's or an earlier word
 *   GET  /api/wordle/puzzle?number=N          the same, by puzzle number
 *   GET  /api/wordle/stats?number=N           how everyone did on that puzzle
 *   POST /api/wordle/result                   record one finished game
 *
 * Anything under public/ is served alongside, so the whole thing runs on one
 * origin with no CORS to configure.
 */

import { createServer } from 'node:http';

import { openDatabase } from '../scripts/lib/db.mjs';
import { encodeAnswer } from '../public/wordle/js/cipher.js';
import { isISODate, todayISO } from '../public/wordle/js/dates.js';
import { serveStatic } from './serve-static.mjs';

const PORT = Number(process.env.PORT ?? 8080);
const BODY_LIMIT = 4096;

const db = openDatabase();

const selectByDate = db.prepare(
  `SELECT p.puzzle_number AS number, p.puzzle_date AS date, w.word
     FROM puzzles p JOIN words w ON w.id = p.word_id
    WHERE p.puzzle_date = ?`,
);
const selectByNumber = db.prepare(
  `SELECT p.puzzle_number AS number, p.puzzle_date AS date, w.word
     FROM puzzles p JOIN words w ON w.id = p.word_id
    WHERE p.puzzle_number = ?`,
);
const selectPuzzleId = db.prepare('SELECT id FROM puzzles WHERE puzzle_number = ?');
const insertResult = db.prepare(
  `INSERT INTO results (puzzle_id, player_key, solved, guess_count, hard_mode)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT (puzzle_id, player_key) DO NOTHING`,
);
const selectStats = db.prepare(
  `SELECT plays, solved, avg_guesses FROM v_puzzle_stats WHERE puzzle_number = ?`,
);

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

function handlePuzzle(url, response) {
  const today = todayISO();
  const number = url.searchParams.get('number');
  const date = url.searchParams.get('date') ?? today;

  let row;
  if (number !== null) {
    if (!/^\d+$/.test(number)) return json(response, 400, { error: 'number must be a whole number' });
    row = selectByNumber.get(Number(number));
  } else {
    if (!isISODate(date)) return json(response, 400, { error: 'date must look like 2026-09-15' });
    row = selectByDate.get(date);
  }

  if (!row) return json(response, 404, { error: 'no puzzle for that day' });

  // The whole point of this server: a word that has not been published yet
  // never leaves the building.
  if (row.date > today) return json(response, 403, { error: 'that puzzle has not been published yet' });

  return json(response, 200, {
    number: row.number,
    date: row.date,
    encoded: encodeAnswer(row.word, row.number),
  });
}

function handleStats(url, response) {
  const number = Number(url.searchParams.get('number'));
  if (!Number.isInteger(number)) return json(response, 400, { error: 'number must be a whole number' });

  const row = selectStats.get(number);
  if (!row) return json(response, 404, { error: 'no puzzle with that number' });

  return json(response, 200, {
    number,
    plays: row.plays ?? 0,
    solved: row.solved ?? 0,
    averageGuesses: row.avg_guesses,
  });
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new Error('body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function handleResult(request, response) {
  let body;
  try {
    body = await readBody(request);
  } catch (error) {
    return json(response, 400, { error: error.message });
  }

  const { puzzleNumber, playerKey, solved, guessCount, hardMode = false } = body;
  const valid = Number.isInteger(puzzleNumber)
    && typeof playerKey === 'string' && playerKey.length > 0 && playerKey.length <= 64
    && typeof solved === 'boolean'
    && Number.isInteger(guessCount) && guessCount >= 1 && guessCount <= 10;
  if (!valid) return json(response, 400, { error: 'puzzleNumber, playerKey, solved and guessCount are required' });

  const puzzle = selectPuzzleId.get(puzzleNumber);
  if (!puzzle) return json(response, 404, { error: 'no puzzle with that number' });

  insertResult.run(puzzle.id, playerKey, solved ? 1 : 0, guessCount, hardMode ? 1 : 0);
  return json(response, 200, { ok: true });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);

  try {
    if (url.pathname === '/api/wordle/puzzle' && request.method === 'GET') {
      return handlePuzzle(url, response);
    }
    if (url.pathname === '/api/wordle/stats' && request.method === 'GET') {
      return handleStats(url, response);
    }
    if (url.pathname === '/api/wordle/result' && request.method === 'POST') {
      return await handleResult(request, response);
    }
    if (url.pathname.startsWith('/api/')) {
      return json(response, 404, { error: 'unknown endpoint' });
    }

    const served = await serveStatic(request, response);
    if (!served) json(response, 404, { error: 'not found' });
  } catch (error) {
    console.error(error);
    if (!response.headersSent) json(response, 500, { error: 'something went wrong' });
  }
});

server.listen(PORT, () => {
  console.log(`GZAAT Wordle API and site at http://localhost:${PORT}/wordle/`);
  console.log(`today's puzzle: http://localhost:${PORT}/api/wordle/puzzle`);
  console.log(`remember to set source.mode to 'api' in public/wordle/js/config.js`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
