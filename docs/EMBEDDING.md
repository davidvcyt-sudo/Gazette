# Putting the game on the website

The game is a folder of static files. Anywhere that can serve HTML can serve it.

## The simple way: its own page

Copy `public/wordette/` onto the web server and link to it:

```
https://gazette.example.ge/wordette/
```

That is the whole deployment. Then set two things in
`public/wordette/js/config.js`:

```js
publication: 'GZAAT Gazette',                    // your paper's name
shareUrl: 'https://gazette.example.ge/wordette/' // where readers who see a shared result should land
```

`shareUrl` is worth getting right — it is the line that travels when a reader
pastes their grid into a group chat.

### Caching

The game's files can be cached hard; the data files must not be, or readers will
be stuck on yesterday's word:

```nginx
location /wordette/data/ {
  add_header Cache-Control "no-cache";   # revalidate every load
}
location /wordette/ {
  add_header Cache-Control "public, max-age=86400";
}
```

## Inside an article

Use an iframe. Give it a sensible starting height; the game will tell the page
what it actually needs.

```html
<iframe
  src="https://gazette.example.ge/wordette/"
  title="The Wordette"
  id="gzaat-wordette"
  style="width: 100%; height: 720px; border: 0; display: block; margin: 2rem auto; max-width: 560px;"
  loading="lazy"
></iframe>

<script>
  // The game posts its height whenever the layout changes.
  window.addEventListener('message', function (event) {
    if (event.source !== document.getElementById('gzaat-wordette').contentWindow) return;
    if (event.data && event.data.type === 'gzaat-wordette:height') {
      document.getElementById('gzaat-wordette').style.height = event.data.height + 'px';
    }
  });
</script>
```

Two things to know about iframes:

- **Statistics are per-origin.** A reader who plays in the embed and again on
  the standalone page has two separate sets of statistics, because the browser
  keeps storage separate. Pick one home for the game and link to it from
  everywhere else.
- **Sharing may need permission.** Copying to the clipboard from inside an
  iframe can be blocked. Add `allow="clipboard-write"` to the iframe if the
  Share button reports that it could not copy.

## Fitting the paper's design

Everything visual is in `public/wordette/styles.css`, and the colours are custom
properties at the top of it:

```css
:root {
  --paper:   #faf7f0;   /* page background */
  --ink:     #16130f;   /* text */
  --accent:  #a3261d;   /* rules and focus outlines */
  --correct: #1f7a4d;   /* right letter, right place */
  --present: #c8a227;   /* right letter, wrong place */
}
```

Change those five and the game looks like it belongs to your paper. The dark
palette is defined just below, and the high-contrast pair (`--correct` and
`--present` only) below that — if you change the greens and yellows, look at the
dark and high-contrast blocks too.

The masthead text lives in `index.html`: `GZAAT Gazette` above the title, and the
line at the foot of the page.

## Archive links

Any past day can be linked directly:

```
/wordette/?date=2026-09-20     a particular date
/wordette/?puzzle=6            the same puzzle, by number
```

Those play normally but are marked as archive puzzles and left out of the
reader's statistics. The same links let editors preview a word before it is
published — handy when you have pinned something for a special issue.

## Checklist before it goes live

- [ ] `npm run db:doctor` reports no problems
- [ ] `public/wordette/data/` on the server matches what the database exported
- [ ] `publication` and `shareUrl` set in `config.js`
- [ ] The data files are served with `Cache-Control: no-cache`
- [ ] The page has been opened on a phone — the board should fit without scrolling
