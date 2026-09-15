/**
 * "GZAAT Wordette #12 4/6" — the block of text readers paste into group chats.
 */

import { STATUS, resultGrid } from './game.js';

export function shareText(game, config, { highContrast = false } = {}) {
  const score = game.status === STATUS.WON ? game.guesses.length : 'X';
  const hard = game.hardMode ? '*' : '';
  const lines = [
    `${config.name} #${game.puzzleNumber} ${score}/${game.maxGuesses}${hard}`,
    '',
    resultGrid(game, { highContrast }),
  ];
  if (config.shareUrl) lines.push('', config.shareUrl);
  return lines.join('\n');
}

/**
 * Copy to the clipboard, falling back for browsers and embeds where the
 * clipboard API is unavailable — an iframe without permission, or any page
 * served over plain http.
 *
 * @returns {Promise<boolean>} whether the text made it to the clipboard
 */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the textarea trick
  }

  try {
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', '');
    scratch.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(scratch);
    scratch.select();
    const copied = document.execCommand('copy');
    scratch.remove();
    return copied;
  } catch {
    return false;
  }
}

/** Phones get the native share sheet; everything else gets the clipboard. */
export async function shareResult(text, title) {
  if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }
  return (await copyToClipboard(text)) ? 'copied' : 'failed';
}
