/**
 * Calendar-date helpers.
 *
 * Puzzle dates are plain `YYYY-MM-DD` strings with no time zone attached — the
 * word of the day changes at midnight wherever the reader happens to be. All
 * arithmetic here goes through UTC so a daylight-saving jump can never move a
 * date by a day.
 *
 * Shared file: the browser and the command line scripts both import it, so the
 * schedule can never be read one way on the server and another in the page.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y
      && date.getUTCMonth() === m - 1
      && date.getUTCDate() === d;
}

export function parseISODate(value) {
  if (!isISODate(value)) throw new Error(`not a valid YYYY-MM-DD date: ${value}`);
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(isoDate, days) {
  const date = parseISODate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return toISODate(date);
}

/** Whole days from `from` to `to`; negative if `to` is earlier. */
export function daysBetween(from, to) {
  const ms = parseISODate(to) - parseISODate(from);
  return Math.round(ms / 86400000);
}

/** Today in the machine's own time zone, not UTC. */
export function todayISO(now = new Date()) {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return toISODate(local);
}

export function weekdayName(isoDate) {
  return parseISODate(isoDate).toLocaleDateString('en-US', {
    weekday: 'short', timeZone: 'UTC',
  });
}

/** "Tuesday, 15 September 2026", for the masthead. */
export function formatLongDate(isoDate, locale = 'en-GB') {
  return parseISODate(isoDate).toLocaleDateString(locale, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

/** Milliseconds from now until the next local midnight, for the countdown. */
export function msUntilTomorrow(now = new Date()) {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}
