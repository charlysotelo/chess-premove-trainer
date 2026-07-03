# Architecture: the premove state machine

This is the part of the app that's easy to get wrong. It has already caused
at least one race-condition bug fix (see `git log --oneline` — "Add debug
logs and fix race condition"), so this doc explains the moving pieces in
detail.

## The core idea

White has almost no thinking time. To have any chance of mating in time, the
player must be able to drag pieces **during Black's turn**, queueing up moves
that fire the instant it becomes White's turn again — a "premove," same
concept as on lichess/chess.com.

Two coordinate systems have to stay in sync:

- **`game`** (a chess.js instance) — the authoritative, legal position. Only
  ever advanced via `game.move(...)`.
- **`board`** (a chessboardjs instance) — the visual board. Its displayed
  position can legitimately be *ahead* of `game`, showing queued premoves
  applied on top of the real position, via `updatePremovePreview()`.

`premoves` (`js/trainer.state.js`) is the queue: an array of `{from, to}`
pairs, oldest first. It represents a chain of moves the player wants applied
in order as soon as it's legally White's turn.

## Drag/drop handlers (`js/trainer.engine.js`)

### `onDragStart(source, piece)`
Records `dragStartedOnTurn` (whose turn it was in `game` at drag start) and
`lastDragSource`. Refuses to start a drag if the game is over, either clock
has hit 0, or the piece being dragged is Black's. Note it captures the turn
*at drag start*, not at drop — this matters because the turn can flip to
White mid-drag if a delayed Black move resolves while the player is dragging.

### `onDrop(source, target)`
Decides whether the drop is a **real move** or a **premove**:

```
treatAsPremove = (dragStartedOnTurn === 'b') || (currentTurn === 'b')
```

i.e. if it was Black's turn either when the drag started *or* when it ended,
treat it as a premove rather than a real move. This OR is deliberate — it
covers the case where Black's turn started, the player began dragging, and
then White's turn resumed before they dropped (still should count as
premove-style queueing since the drag began under premove conditions), as
well as the reverse ordering.

If it's a premove:
- Push `{from, to}` onto `premoves`.
- Re-render highlights and the preview board position (queued moves shown
  applied on top of the real position — piece appears to already be at the
  destination, but `game` hasn't moved).
- **Special case:** if `currentTurn === 'w'` at drop time (turn already
  flipped back to White while dragging) and the game isn't over, immediately
  `scheduleAutoPremoveExecution(0)` — don't wait for the timer tick, since the
  premove should fire essentially instantly.

If it's a real move: clear any queued premoves (a manual real-time move
supersedes the queue), attempt `game.move(...)`, and on success schedule
Black's reply via `scheduleBlackMove()`.

### `onSnapEnd()`
Normally snaps the board back to `game.fen()` after a drag animation. But if
premoves are queued (regardless of whose turn it is — the turn can flip to
White mid-drag), it re-renders the premove preview instead — snapping back to
the raw game position would visually erase the queue.

### Cancelling premoves
Right-clicking the board clears the whole queue via
`clearPremoves('user_right_click', ...)` — same UX as lichess/chess.com.
A real-time move on White's turn also clears the queue, as before.

Two quirks make the wiring non-obvious (both in `initTrainer()`):
- The `contextmenu` listener is on `document`, not `#board`, because
  chessboard.js appends the actively-dragged piece to `<body>` — a
  right-click landing on it never bubbles through `#board`. The handler
  matches `e.target.closest('#board')` or the dragged-piece class
  (`piece-417db`).
- A capture-phase `mousedown` listener on `#board` swallows non-left-button
  presses before chessboard.js sees them: chessboard.js starts a drag on
  *any* mouse button, so an unsuppressed right-click would start a phantom
  drag alongside the context menu.

### Board rendering vs. drags: `syncBoardDisplay()`
All mid-game repaints of the visual board go through
`syncBoardDisplay(animate)` (never `board.position()` directly): it renders
the premove preview when the queue is non-empty, the real `game.fen()`
otherwise. Crucially, if a drag is in flight (`isDragging`, set in
`onDragStart` only once the drag is accepted, cleared in
`onSnapEnd`/`onSnapbackEnd`), the sync is *deferred* (`boardSyncPending`) and
flushed when the drag settles. Calling `board.position()` while chessboard.js
is mid-drag or mid-snap-animation double-draws the moving piece — the
"ghost/teleporting piece" bug. For the same reason, `onDrop`'s premove branch
only renders highlights; the preview render waits for `onSnapEnd`.

## Timers and move scheduling

- `startTimer()` runs a single `setInterval` at 100ms driving both clocks.
  Only one side's clock ticks down per tick, based on `game.turn()`.
- **Critical guard:** while it's White's turn and `premoves.length > 0`,
  the tick does *not* decrement White's clock — instead it treats this as a
  sign that a premove should be executing, and if `premoveAutoPending` is
  falsy (meaning nothing is already scheduled to execute it), it calls
  `executeNextPremove()` directly as a self-healing fallback. This guards
  against the race condition where a scheduled auto-execution was somehow
  dropped, leaving stuck premoves and a frozen clock. A `pmdbgWarn` fires
  when this fallback path triggers, since it means the normal scheduling path
  didn't work as expected.
- `scheduleBlackMove()` sets a `setTimeout` for `blackMoveDelay` seconds, then
  calls `makeBlackMove()`, which plays a uniformly random legal move for
  Black. If premoves are queued when Black's move lands, it schedules
  `executeNextPremove()` after a fixed 80ms via `scheduleAutoPremoveExecution`.
- `scheduleAutoPremoveExecution(delayMs)` sets `premoveAutoPending = true` and
  a `setTimeout` calling `executeNextPremove()`. `premoveAutoPending` exists
  specifically so other code (the timer tick guard above, `updateTimerDisplay`)
  can distinguish "a premove is about to fire" from "White is just sitting
  idle with moves queued."
- `executeNextPremove()` is defensive by necessity: it re-checks the queue
  isn't empty, the game isn't over, and it's actually White's turn before
  shifting the first queued move off and playing it via `game.move(...)`. If
  the move turns out illegal (position changed unexpectedly), it clears the
  whole queue rather than getting stuck. Each queued premove that fires costs
  a flat 0.1s off White's clock (`whiteTime -= 0.1`), modeling execution
  latency. The whole function is wrapped in try/catch that clears premoves
  and re-renders on any unexpected exception, since a stuck/throwing state
  machine here would freeze the game.
- `endGameByTimeout(side, options)` is the single choke point for a clock
  hitting zero: it stops the tick interval, cancels any pending
  `blackMoveTimeout` (without this, a scheduled Black move could fire *after*
  time ran out and keep the game going), wipes the premove queue, sets the
  status verdict, and records the result. The verdict for a White flag is
  material-aware via `blackHasMatingMaterial()` — a lone Black king (or king
  + single minor) makes it a draw; otherwise White loses on time. This
  matters for Custom FEN scenarios where Black has real material.
  `executeNextPremove()` also routes through it when the 0.1s-per-premove
  execution cost drains White's clock mid-queue, which previously froze the
  game silently. `applyTimeSetting` passes `{ record: false }` so ending a
  game by dragging a time slider to 0 doesn't pollute the stats.
- Results are recorded once per game (`resultRecorded`, reset in
  `resetBoard()`): `maybeRecordGameEnd()` runs after every real move, Black
  move, and premove execution; `recordGameEnd(kind)` updates the win/loss/draw
  counters plus best-mate-time, persists them to
  `localStorage['premoveTrainerStats']`, and re-renders the `#statsLine`
  display via `renderStats()` in `trainer.ui.js`.
- `clearPremoves(reason, options)` is the single choke point for wiping the
  queue — it also cancels any pending auto-execution timeout so a stale
  `setTimeout` can never fire against an empty/changed queue. `reason` is
  passed straight into the debug log; when adding a new place that clears
  premoves, add a descriptive reason string rather than reusing an existing
  one, since `reason` is how `[PMDBG]` traces get read after the fact.

## Why so much debug logging

`js/trainer.pmdbg.js` + `pmdbgLog`/`pmdbgWarn` calls throughout
`trainer.engine.js` exist because premove bugs are timing-dependent and hard
to reproduce from a bug report alone. Every transition (drag start, drop,
premove queued, premove executed/aborted, timer tick anomalies) logs a full
state snapshot (`pmdbgState()`: turn, check/mate flags, FEN, both clocks,
queue length, pending-timeout flags). Enable via
`localStorage.setItem('debugPremove', '1')` and reload; the resulting console
trace is the fastest way to diagnose "premove got stuck" or "clock didn't
advance" style reports.

## Scenarios (`js/trainer.scenarios.js`)

Three modes, selected via the `#scenarioSelect` dropdown and dispatched by
`setupScenarioPosition()`:

- **`kq`** (default): `generateRandomPosition()` places a White king, White
  queen (not adjacent to the king), and Black king randomly, ensuring Black
  isn't already in check/adjacent/overlapping. Retries via recursion on
  excessive placement failures.
- **`resetMate`**: `setupResetMatePosition()` puts the full White back rank
  (minus pawns) on its starting squares and places the Black king randomly
  on a square that's empty, not adjacent to the White king, and not already
  in check — verified by cloning the position into a temporary `Chess()`
  instance with the side-to-move flipped.
- **`customFen`**: the player pastes an arbitrary FEN (`loadCustomFenFromInput`
  in `trainer.engine.js` validates it against a scratch `Chess()` instance
  before committing); no auto-generation involved.

`fenToPosition(fen)` converts a FEN placement field into the
`{square: pieceCode}` object shape chessboardjs's `board.position()` expects
— used by `updatePremovePreview()` to render the queue on top of the real
position without mutating `game`.
