/**
 * Working out which word belongs to which day.
 *
 * Static mode holds the whole calendar: puzzle N is at offset N from the first
 * scheduled date, so the lookup is arithmetic rather than a search. API mode
 * asks the server, which only answers for days that have already started.
 */

import { decodeAnswer } from './cipher.js';
import { fetchJson, inlineData } from './dictionary.js';
import { addDays, daysBetween, isISODate, todayISO } from './dates.js';

/**
 * @returns {{ answer, number, date, isToday, isArchive, source }}
 */
export async function loadPuzzle(config, { date, puzzleNumber } = {}) {
  const today = todayISO();
  const wanted = isISODate(date) ? date : today;

  const puzzle = config.source.mode === 'api'
    ? await fromApi(config, wanted, puzzleNumber)
    : await fromSchedule(config, wanted, puzzleNumber);

  return { ...puzzle, isToday: puzzle.date === today, isArchive: puzzle.date !== today };
}

async function fromSchedule(config, wantedDate, puzzleNumber) {
  const schedule = inlineData('puzzles') ?? await fetchJson(config.source.puzzlesUrl);
  if (!Array.isArray(schedule.answers) || !schedule.answers.length) {
    throw new Error('the puzzle file has no answers in it');
  }

  let index;
  let date;

  if (Number.isInteger(puzzleNumber)) {
    index = puzzleNumber - schedule.startNumber;
    if (index < 0 || index >= schedule.answers.length) {
      throw new Error(`there is no puzzle #${puzzleNumber}`);
    }
    date = addDays(schedule.startDate, index);
  } else {
    index = daysBetween(schedule.startDate, wantedDate);
    date = wantedDate;

    if (index < 0) {
      // Before the first scheduled day: show day one rather than an error page.
      index = 0;
      date = schedule.startDate;
    } else if (index >= schedule.answers.length) {
      // The calendar ran out. Keep the game playable by cycling through it, and
      // make the reason obvious to whoever looks at the console.
      console.warn(
        `[${config.name}] the schedule ends before ${wantedDate}. ` +
        `Run "npm run db:schedule && npm run db:export" to add more days.`,
      );
      index %= schedule.answers.length;
      date = wantedDate;
    }
  }

  const number = schedule.startNumber + index;
  return {
    answer: decodeAnswer(schedule.answers[index], number),
    number,
    date,
    source: 'static',
  };
}

async function fromApi(config, wantedDate, puzzleNumber) {
  const url = new URL(`${config.source.apiUrl}/puzzle`, window.location.href);
  if (Number.isInteger(puzzleNumber)) url.searchParams.set('number', String(puzzleNumber));
  else url.searchParams.set('date', wantedDate);

  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error ?? `the puzzle server returned ${response.status}`);
  }

  const payload = await response.json();
  return {
    answer: payload.encoded ? decodeAnswer(payload.encoded, payload.number) : payload.answer,
    number: payload.number,
    date: payload.date,
    source: 'api',
  };
}
