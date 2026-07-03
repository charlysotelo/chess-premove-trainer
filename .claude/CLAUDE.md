# Chess Premove Trainer

A single-page, static, no-build vanilla JS app for practicing **premoves** in
speed-chess mating drills (e.g. K+Q vs K). White has very little time (default
5s) and must queue premoves so the mate finishes before the clock runs out.
Black moves randomly. Hosted on GitHub Pages directly from `master`.

See `docs/architecture.md` for a deep dive into the premove state machine —
that's the subtle, bug-prone core of this app and worth reading before
touching `js/trainer.engine.js`.

## Stack

- No build step, no package.json, no bundler. Just static HTML/CSS/JS.
- Dependencies loaded from CDNs in `index.html`: jQuery, chess.js 0.10.3,
  chessboard.js 1.0.0.
- `chess.js` owns legal-move/game-state logic (turns, check, mate, FEN).
  `chessboard.js` owns the visual board and drag-and-drop. The app glues the
  two together and layers a premove queue on top.

## Running / testing locally

There's no dev server or test suite. Open `index.html` directly in a browser,
or serve the directory with any static file server (e.g. `python3 -m http.server`)
and visit it — CDN scripts require network access.

To debug premove behavior, enable verbose console logging from DevTools:
```js
localStorage.setItem('debugPremove', '1'); location.reload();
```
This turns on the `[PMDBG]` logs from `js/trainer.pmdbg.js`, which record
every drag/drop/premove/timer event with the full game state attached. This is
the primary tool for diagnosing premove/timing bugs — reach for it before
adding new console.logs.

## File layout

Scripts are loaded in this order from `index.html`, which matters because
later files use globals defined in earlier ones (no modules, no imports):

1. `js/trainer.state.js` — all shared mutable state (`game`, `board`,
   `premoves`, timers, etc.) as bare top-level `let` bindings.
2. `js/trainer.pmdbg.js` — opt-in debug logging helpers.
3. `js/trainer.scenarios.js` — position generation (random K+Q vs K, "reset
   mate" random back-rank setup, custom FEN loading) and FEN⇄position helpers.
4. `js/trainer.ui.js` — DOM/board rendering only (status text, timer display,
   highlight classes, the premove preview board position). No game-state
   mutation happens here.
5. `js/trainer.engine.js` — the actual engine: chessboard.js event handlers
   (`onDragStart`/`onDrop`/`onSnapEnd`), the premove queue, timers, and
   `initTrainer()`, which wires up all the DOM controls and boots the app on
   `DOMContentLoaded`.

`css/trainer.css` holds all styling, including the square highlight classes
(`square-real-highlight`, `square-premove-dest-highlight`) applied by
`renderPremoveHighlights()`.

## Conventions

- No modules/bundler — new code should keep using plain global functions and
  top-level `let` state in the existing files, matching the current style.
- Chess square colors follow chess.js convention: `'w'`/`'b'` prefix on piece
  strings (e.g. `'wQ'`), not `'white'`/`'black'`.
- Every state-changing action in the engine should go through
  `pmdbgLog`/`pmdbgWarn` with enough context to reconstruct what happened —
  this is how the maintainer diagnoses premove race conditions after the
  fact. Keep that pattern when adding new premove/timer logic.
- Timers advance in fixed 100ms ticks (see `startTimer()`), not `Date.now()`
  deltas — keep new timing logic on that same tick model rather than mixing
  in wall-clock timestamps.
