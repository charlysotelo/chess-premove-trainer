let game = new Chess();
let board = null;
let moveHistory = [];
let whiteTime = 5.0;
let blackTime = 60.0;
let initialWhiteTime = 5.0;
let initialBlackTime = 60.0;
let timerInterval = null;
let premoves = [];
let blackMoveDelay = 1.0;
let blackMoveTimeout = null;
let currentScenario = 'kq';
let customFen = '';
let premoveAutoPending = false;
let premoveAutoTimeout = null;
let dragStartedOnTurn = null;
let dragStartedAtMs = 0;
let lastDragSource = null;

const PMDBG_TAG = 'PMDBG';
let pmdbgLastSuspiciousLogAt = 0;
let pmdbgLastTurn = null;
let pmdbgLastFen = null;

function pmdbgEnabled() {
    try {
        // Enable via DevTools:
        //   localStorage.setItem('debugPremove', '1'); location.reload();
        // or:
        //   window.DEBUG_PREMOVE = true;
        if (typeof window !== 'undefined' && window.DEBUG_PREMOVE === true) return true;
        if (typeof localStorage !== 'undefined' && localStorage.getItem('debugPremove') === '1') return true;
    } catch (e) {
        // ignore
    }
    return false;
}

function pmdbgNowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
    return Date.now();
}

function pmdbgState(extra) {
    let fen = '';
    try { fen = game.fen(); } catch (e) { fen = ''; }

    return {
        t: new Date().toISOString(),
        turn: (() => { try { return game.turn(); } catch (e) { return '?'; } })(),
        inCheck: (() => { try { return game.in_check(); } catch (e) { return null; } })(),
        inMate: (() => { try { return game.in_checkmate(); } catch (e) { return null; } })(),
        gameOver: (() => { try { return game.game_over(); } catch (e) { return null; } })(),
        fen,
        whiteTime,
        blackTime,
        premovesLen: premoves.length,
        premoveAutoPending,
        blackMoveTimeoutActive: !!blackMoveTimeout,
        premoveAutoTimeoutActive: !!premoveAutoTimeout,
        ...(extra || {})
    };
}

function pmdbgLog(event, extra) {
    if (!pmdbgEnabled()) return;
    // Keep logs machine-greppable.
    try {
        console.log(`[${PMDBG_TAG}] ${event}`, pmdbgState(extra));
    } catch (e) {
        // ignore
    }
}

function pmdbgWarn(event, extra) {
    if (!pmdbgEnabled()) return;
    try {
        console.warn(`[${PMDBG_TAG}] ${event}`, pmdbgState(extra));
    } catch (e) {
        // ignore
    }
}

function clearPremoves(reason, options) {
    const opts = options || {};
    const didHavePremoves = premoves.length > 0;
    const preview = didHavePremoves ? premoves.slice(0, 6) : [];

    premoves = [];

    // Clearing the queue should also cancel any pending auto-execution.
    premoveAutoPending = false;
    if (premoveAutoTimeout) {
        clearTimeout(premoveAutoTimeout);
        premoveAutoTimeout = null;
    }

    // Put the reason into the event string so it shows even in collapsed console output.
    if (didHavePremoves) {
        pmdbgLog(`premoves_cleared reason=${reason}`, { reason, preview });
    } else {
        pmdbgLog(`premoves_cleared_empty reason=${reason}`, { reason });
    }

    if (opts.removeHighlights !== false) {
        try { removeHighlights(); } catch (e) { /* ignore */ }
    }

    // Avoid visual desync: if we cleared the queue, ensure board reflects the real game state.
    if (opts.snapBoard !== false && board) {
        try { board.position(game.fen(), false); } catch (e) { /* ignore */ }
    }
}

function updateScenarioVideo() {
    const tile = document.getElementById('videoTile');
    const iframe = document.getElementById('scenarioVideo');
    if (!tile || !iframe) return;

    // Hide by default (e.g. Custom FEN)
    let src = '';

    if (currentScenario === 'resetMate') {
        src = 'https://www.youtube.com/embed/prgvSGbjkSU?si=UCiKtz3XptuoXRG4';
    } else if (currentScenario === 'kq') {
        // K+Q vs K
        src = 'https://www.youtube.com/embed/jquaz5axNC4?si=d0dfjIOhLcQIytt2&start=1683';
    }

    if (!src) {
        tile.style.display = 'none';
        // Clear src to stop playback when switching away
        iframe.src = '';
        return;
    }

    tile.style.display = 'block';

    // Only set when changed to avoid resetting playback unnecessarily
    if (iframe.src !== src) {
        iframe.src = src;
    }
}

// Generate a random starting position for king + queen vs king
function generateRandomPosition() {
    game.clear();

    // Place white king
    let wkPos = getRandomSquare();
    game.put({ type: 'k', color: 'w' }, wkPos);

    // Place white queen (not adjacent to white king)
    let wqPos;
    do {
        wqPos = getRandomSquare();
    } while (wqPos === wkPos || areAdjacent(wkPos, wqPos));
    game.put({ type: 'q', color: 'w' }, wqPos);

    // Place black king (not adjacent to any white piece and not in check initially)
    let bkPos;
    let attempts = 0;
    do {
        bkPos = getRandomSquare();
        attempts++;
        if (attempts > 100) {
            // Reset and try again
            return generateRandomPosition();
        }
    } while (
        bkPos === wkPos ||
        bkPos === wqPos ||
        areAdjacent(bkPos, wkPos) ||
        areAdjacent(bkPos, wqPos) ||
        isSquareAttacked(bkPos)
    );
    game.put({ type: 'k', color: 'b' }, bkPos);

    // Set white to move
    game.load(game.fen().replace(' w ', ' w '));
    moveHistory = [];
    premoves = [];
}

function setupResetMatePosition() {
    game.clear();

    // White pieces in original squares (minus pawns)
    game.put({ type: 'k', color: 'w' }, 'e1');
    game.put({ type: 'q', color: 'w' }, 'd1');
    game.put({ type: 'r', color: 'w' }, 'a1');
    game.put({ type: 'r', color: 'w' }, 'h1');
    game.put({ type: 'b', color: 'w' }, 'c1');
    game.put({ type: 'b', color: 'w' }, 'f1');
    game.put({ type: 'n', color: 'w' }, 'b1');
    game.put({ type: 'n', color: 'w' }, 'g1');

    // Place black king on a random legal square (not occupied, not adjacent to white king, not in check)
    const whiteKingSquare = 'e1';
    let bkPos = null;
    let attempts = 0;

    while (attempts < 800) {
        attempts++;
        const candidate = getRandomSquare();

        // must be empty
        if (game.get(candidate)) continue;

        // kings cannot be adjacent
        if (areAdjacent(candidate, whiteKingSquare)) continue;

        // Build a temp position to verify legality and that black is not in check
        const temp = new Chess();
        temp.clear();
        const b = game.board();
        for (let r = 0; r < 8; r++) {
            for (let f = 0; f < 8; f++) {
                const p = b[r][f];
                if (!p) continue;
                const file = 'abcdefgh'[f];
                const rank = String(8 - r);
                temp.put(p, file + rank);
            }
        }
        temp.put({ type: 'k', color: 'b' }, candidate);

        // Switch to black-to-move to check if black is in check
        const fenParts = temp.fen().split(' ');
        fenParts[1] = 'b';
        const fenB = fenParts.join(' ');
        const loaded = temp.load(fenB);
        if (!loaded) continue;
        if (temp.in_check()) continue;

        bkPos = candidate;
        break;
    }

    if (!bkPos) bkPos = 'b7';
    game.put({ type: 'k', color: 'b' }, bkPos);

    // White to move
    game.load(game.fen().replace(' w ', ' w '));
    moveHistory = [];
    premoves = [];
}

function setupScenarioPosition() {
    if (currentScenario === 'resetMate') {
        setupResetMatePosition();
        return;
    }

    if (currentScenario === 'customFen') {
        if (!customFen) return false;
        try {
            const ok = game.load(customFen);
            if (!ok) return false;
        } catch (e) {
            return false;
        }
        moveHistory = [];
        premoves = [];
        return true;
    }

    // default: KQ vs K randomized
    generateRandomPosition();
    return true;
}

function getRandomSquare() {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['1', '2', '3', '4', '5', '6', '7', '8'];
    return files[Math.floor(Math.random() * 8)] + ranks[Math.floor(Math.random() * 8)];
}

function areAdjacent(sq1, sq2) {
    const file1 = sq1.charCodeAt(0) - 97;
    const rank1 = parseInt(sq1[1]) - 1;
    const file2 = sq2.charCodeAt(0) - 97;
    const rank2 = parseInt(sq2[1]) - 1;

    return Math.abs(file1 - file2) <= 1 && Math.abs(rank1 - rank2) <= 1;
}

function isSquareAttacked(square) {
    // Temporarily switch turn to check if square is attacked
    const originalTurn = game.turn();
    const fen = game.fen();
    const newFen = fen.replace(/ [wb] /, originalTurn === 'w' ? ' b ' : ' w ');
    game.load(newFen);

    const attacked = game.moves({ square: square, verbose: true }).length === 0 &&
        game.in_check();

    game.load(fen);

    // Simple check: see if any white piece attacks this square
    const moves = game.moves({ verbose: true });
    for (let move of moves) {
        if (move.to === square) {
            return true;
        }
    }
    return false;
}

function onDragStart(source, piece) {
    dragStartedOnTurn = null;
    lastDragSource = source;
    dragStartedAtMs = pmdbgNowMs();

    // Only allow dragging white pieces
    if (game.game_over()) return false;
    if (whiteTime <= 0 || blackTime <= 0) return false;
    if (piece.search(/^b/) !== -1) return false;

    dragStartedOnTurn = (() => {
        try { return game.turn(); } catch (e) { return null; }
    })();
    pmdbgLog('drag_start', { source, piece, dragStartedOnTurn });

    // During black's turn, check if we're dragging from a premoved position
    if (game.turn() === 'b') {
        // Allow dragging from premoved squares
        return true;
    }

    // Allow white to pre-move during black's turn
    return true;
}

function onDrop(source, target) {
    const currentTurn = (() => {
        try { return game.turn(); } catch (e) { return '?'; }
    })();

    // Dropped outside the board (or otherwise invalid target)
    if (!target || target === 'offboard') return 'snapback';
    if (source === target) return 'snapback';

    // If you started dragging during Black's turn, keep treating this as a premove,
    // even if Black moved mid-drag and the turn flipped to White before drop.
    const treatAsPremove = (dragStartedOnTurn === 'b') || (currentTurn === 'b');
    pmdbgLog('drop', {
        source,
        target,
        dragStartedOnTurn,
        currentTurn,
        treatAsPremove,
        dragHeldMs: Math.round(pmdbgNowMs() - (dragStartedAtMs || pmdbgNowMs()))
    });

    // If it's (effectively) black's turn, this is a pre-move
    if (treatAsPremove) {
        // Validate against the *visual* board state (includes previously queued premoves)
        const currentPos = board.position();
        const pieceAtSource = currentPos[source]; // e.g. 'wQ', 'wK'
        if (!pieceAtSource || pieceAtSource[0] !== 'w') return 'snapback';

        // Store the pre-move
        premoves.push({ from: source, to: target });

        pmdbgLog('premove_queued', { from: source, to: target, queued: premoves.slice(-5) });

        renderPremoveHighlights();

        // Keep the piece rendered at the last premoved-to square
        updatePremovePreview();

        // If the turn already flipped to white (black moved while we were dragging),
        // execute the premove immediately rather than waiting for a black-move callback.
        if (currentTurn === 'w' && !game.game_over()) {
            pmdbgLog('premove_drop_turn_flipped_to_white_execute_now');
            scheduleAutoPremoveExecution(0);
        }

        // Keep piece at target by not returning 'snapback'
        return;
    }

    // Clear any existing pre-moves and highlights
    clearPremoves('real_move_attempt', { removeHighlights: true, snapBoard: false });

    // Try to make the move
    let move = null;
    try {
        move = game.move({
            from: source,
            to: target,
            promotion: 'q' // always promote to queen
        });
    } catch (e) {
        pmdbgWarn('real_move_threw', { source, target, error: String(e && (e.message || e)) });
        return 'snapback';
    }

    // Illegal move
    if (move === null) {
        pmdbgLog('real_move_illegal', { source, target });
        return 'snapback';
    }

    pmdbgLog('real_move_played', { san: move && move.san, from: move && move.from, to: move && move.to });

    moveHistory.push(move);
    updateStatus();

    // Make black move after delay
    if (!game.game_over()) {
        scheduleBlackMove();
    }
}

function onSnapEnd() {
    // Don't reset position during premoves - let visual state persist
    if (game.turn() === 'b' && premoves.length > 0) {
        return;
    }
    board.position(game.fen());
}

function removeHighlights() {
    $('#board .square-55d63').removeClass('square-premove-highlight');
    $('#board .square-55d63').removeClass('square-real-highlight');
    $('#board .square-55d63').removeClass('square-premove-dest-highlight');
}

function renderPremoveHighlights() {
    // New behavior:
    // - highlight current "real" position(s) (chain head squares) in yellow
    // - highlight premoved-to chain squares in red
    removeHighlights();
    if (premoves.length === 0) return;

    const toSquares = new Set(premoves.map(pm => pm.to));
    const headSquares = new Set();
    for (const pm of premoves) {
        if (!toSquares.has(pm.from)) headSquares.add(pm.from);
    }
    if (headSquares.size === 0) headSquares.add(premoves[0].from);

    for (const sq of headSquares) {
        $('#board .square-' + sq).addClass('square-real-highlight');
    }
    for (const pm of premoves) {
        $('#board .square-' + pm.to).addClass('square-premove-dest-highlight');
    }
}

function updatePremovePreview() {
    // Show the position after applying all queued premoves to the current *real* game position.
    // This keeps the piece rendered at the last premoved-to square.
    if (premoves.length === 0) {
        board.position(game.fen());
        return;
    }

    const pos = fenToPosition(game.fen());

    for (const pm of premoves) {
        const movingPiece = pos[pm.from];
        if (!movingPiece || movingPiece[0] !== 'w') {
            // If we can't apply the preview consistently, fall back to the real position.
            board.position(game.fen());
            return;
        }

        delete pos[pm.from];
        pos[pm.to] = movingPiece;
    }

    // Snap instantly for preview updates (no animation while showing queued premoves)
    board.position(pos, false);
}

function scheduleBlackMove() {
    if (blackMoveTimeout) {
        clearTimeout(blackMoveTimeout);
        blackMoveTimeout = null;
    }
    updateTimerDisplay();
    pmdbgLog('black_move_scheduled', { delaySeconds: blackMoveDelay });
    blackMoveTimeout = setTimeout(() => {
        blackMoveTimeout = null;
        pmdbgLog('black_move_timeout_fired');
        makeBlackMove();
    }, blackMoveDelay * 1000);
}

function fenToPosition(fen) {
    const placement = fen.split(' ')[0];
    const ranks = placement.split('/');
    const position = {};
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

    for (let r = 0; r < 8; r++) {
        const rankStr = ranks[r];
        let fileIndex = 0;
        for (const ch of rankStr) {
            if (ch >= '1' && ch <= '8') {
                fileIndex += parseInt(ch, 10);
                continue;
            }

            const color = ch === ch.toUpperCase() ? 'w' : 'b';
            const pieceLetter = ch.toLowerCase();
            const typeMap = {
                p: 'P',
                n: 'N',
                b: 'B',
                r: 'R',
                q: 'Q',
                k: 'K'
            };
            const type = typeMap[pieceLetter];
            const file = files[fileIndex];
            const rank = 8 - r;
            position[file + rank] = color + type;
            fileIndex += 1;
        }
    }

    return position;
}

function makeBlackMove() {
    // Get all possible moves for black
    const possibleMoves = game.moves();

    // Game over
    if (possibleMoves.length === 0) return;

    // Pick a random move
    const randomIdx = Math.floor(Math.random() * possibleMoves.length);
    pmdbgLog('black_move_about_to_play', { candidateCount: possibleMoves.length, chosenIndex: randomIdx });
    const move = game.move(possibleMoves[randomIdx]);

    pmdbgLog('black_move_played', { san: move && move.san, from: move && move.from, to: move && move.to });

    moveHistory.push(move);

    // If premoves are queued, keep showing the final premoved-to preview.
    if (premoves.length > 0) updatePremovePreview();
    else board.position(game.fen());
    updateTimerDisplay();
    updateStatus();

    // If a premove is queued, execute exactly ONE (white move), then black will respond again.
    if (premoves.length > 0 && !game.game_over()) {
        pmdbgLog('auto_premove_will_schedule', { delayMs: 80, premovesLen: premoves.length });
        scheduleAutoPremoveExecution(80);
    }
}

function scheduleAutoPremoveExecution(delayMs) {
    if (premoveAutoTimeout) {
        clearTimeout(premoveAutoTimeout);
        premoveAutoTimeout = null;
    }
    premoveAutoPending = true;
    pmdbgLog('auto_premove_scheduled', { delayMs });
    premoveAutoTimeout = setTimeout(() => {
        premoveAutoTimeout = null;
        premoveAutoPending = false;
        pmdbgLog('auto_premove_timeout_fired');
        executeNextPremove();
    }, Math.max(0, Number(delayMs) || 0));
}

function executeNextPremove() {
    try {
        // If called directly, ensure pending state is cleared.
        premoveAutoPending = false;
        if (premoveAutoTimeout) {
            clearTimeout(premoveAutoTimeout);
            premoveAutoTimeout = null;
        }

        pmdbgLog('auto_premove_execute_enter');

        if (premoves.length === 0) {
            pmdbgLog('auto_premove_execute_abort_no_premoves');
            return;
        }
        if (game.game_over()) {
            clearPremoves('auto_premove_abort_game_over', { removeHighlights: true, snapBoard: true });
            pmdbgLog('auto_premove_execute_aborted_game_over');
            return;
        }

        // Only execute premoves when it's actually white's turn
        if (game.turn() !== 'w') {
            pmdbgLog('auto_premove_execute_abort_not_white_turn');
            return;
        }

    const pm = premoves.shift();
    pmdbgLog('auto_premove_about_to_play', { from: pm && pm.from, to: pm && pm.to, remainingAfterShift: premoves.length });
    try {
        renderPremoveHighlights();
    } catch (e) {
        pmdbgWarn('auto_premove_render_highlights_failed', { error: String(e && (e.message || e)) });
    }

    const move = game.move({
        from: pm.from,
        to: pm.to,
        promotion: 'q'
    });

    // If illegal after black's move, clear remaining premoves and snap to the legal game state
    if (move === null) {
        clearPremoves('auto_premove_illegal', { removeHighlights: true, snapBoard: true });
        updateTimerDisplay();
        pmdbgWarn('auto_premove_illegal_cleared_queue', { from: pm.from, to: pm.to });
        return;
    }

    pmdbgLog('auto_premove_played', { san: move && move.san, from: move && move.from, to: move && move.to, remainingQueue: premoves.length });

    // Consume 0.1s from white's clock when the premove EXECUTES
    whiteTime = Math.max(0, whiteTime - 0.1);
    moveHistory.push(move);
    // Keep the piece rendered at the last premoved-to square of the REMAINING queue.
    if (premoves.length > 0) updatePremovePreview();
    else board.position(game.fen(), false);
    updateStatus();
    updateTimerDisplay();

    // After a white premove, it's black's turn again
    if (!game.game_over() && whiteTime > 0) {
        scheduleBlackMove();
    }
    } catch (e) {
        pmdbgWarn('auto_premove_execute_threw', { error: String(e && (e.message || e)) });
        // If anything goes wrong mid-execution, clear premoves and snap to real state
        clearPremoves('auto_premove_execute_exception', { removeHighlights: true, snapBoard: true });
        updateTimerDisplay();
        updateStatus();
    }
}

function updateStatus() {
    let status = '';

    if (game.in_checkmate()) {
        status = '<span class="success">Checkmate! You won! 🎉</span>';
    } else if (game.in_stalemate()) {
        status = 'Stalemate - Draw';
    } else if (game.in_draw()) {
        status = 'Draw';
    } else {
        if (game.in_check()) {
            const sideInCheck = game.turn() === 'w' ? 'White' : 'Black';
            status = `<span class="check">${sideInCheck} king is in check!</span>`;
        } else {
            status = 'Continue moving to checkmate black!';
        }
    }

    document.getElementById('status').innerHTML = status;
}

function updateTimerDisplay() {
    const whiteTimerEl = document.getElementById('whiteTimer');
    const blackTimerEl = document.getElementById('blackTimer');

    whiteTimerEl.textContent = `White: ${whiteTime.toFixed(1)}s`;
    blackTimerEl.textContent = `Black: ${blackTime.toFixed(1)}s`;

    whiteTimerEl.classList.remove('active', 'timeout');
    blackTimerEl.classList.remove('active', 'timeout');

    if (whiteTime <= 0) {
        whiteTimerEl.classList.add('timeout');
    } else if (blackTime <= 0) {
        blackTimerEl.classList.add('timeout');
    } else if (premoveAutoPending && game.turn() === 'w') {
        // A premove is about to auto-execute; don't visually imply the user is "thinking".
    } else if (game.turn() === 'w') {
        whiteTimerEl.classList.add('active');
    } else {
        blackTimerEl.classList.add('active');
    }
}

function startTimer() {
    if (timerInterval) clearInterval(timerInterval);

    timerInterval = setInterval(() => {
        // Debug: log turn / FEN transitions without spamming every tick.
        if (pmdbgEnabled()) {
            let currentTurn = null;
            let currentFen = null;
            try { currentTurn = game.turn(); } catch (e) { currentTurn = '?'; }
            try { currentFen = game.fen(); } catch (e) { currentFen = ''; }
            if (pmdbgLastTurn !== currentTurn) {
                pmdbgLog('timer_tick_turn_changed', { fromTurn: pmdbgLastTurn, toTurn: currentTurn });
                pmdbgLastTurn = currentTurn;
            }
            if (pmdbgLastFen !== currentFen && currentFen) {
                // Only log FEN changes when they occur (moves/loads)
                pmdbgLog('timer_tick_fen_changed');
                pmdbgLastFen = currentFen;
            }
        }

        if (game.game_over()) {
            clearInterval(timerInterval);
            return;
        }

        if (game.turn() === 'w') {
            // If premoves exist and it is White to move, treat them as an auto-move:
            // never drain White's clock while the queue is pending execution.
            // Also "self-heal": if for any reason the scheduled timeout path fails,
            // try to execute a premove right from the timer tick.
            if (premoves.length > 0) {
                pmdbgLog('timer_tick_skip_white_due_to_premoves_queued', {
                    premoveAutoPending,
                    queuedPreview: premoves.slice(0, 5)
                });

                // If we're not currently waiting on the scheduled auto-execution, try to execute now.
                if (!premoveAutoPending) {
                    const now = pmdbgNowMs();
                    if (now - pmdbgLastSuspiciousLogAt > 600) {
                        pmdbgLastSuspiciousLogAt = now;
                        pmdbgWarn('timer_tick_white_has_premoves_but_not_pending', {
                            queuedPreview: premoves.slice(0, 5)
                        });
                    }
                    try {
                        executeNextPremove();
                    } catch (e) {
                        pmdbgWarn('timer_tick_executeNextPremove_threw', { error: String(e && (e.message || e)) });
                    }
                }

                updateTimerDisplay();
                return;
            }

            whiteTime -= 0.1;
            if (whiteTime <= 0) {
                whiteTime = 0;
                clearInterval(timerInterval);
                document.getElementById('status').innerHTML = '<span style="color: orange; font-weight: bold;">Time out! Draw - Black has insufficient material.</span>';
            }
        } else {
            blackTime -= 0.1;
            if (blackTime <= 0) {
                blackTime = 0;
                clearInterval(timerInterval);
                document.getElementById('status').innerHTML = '<span class="success">Black ran out of time! White wins!</span>';
            }
        }

        updateTimerDisplay();
    }, 100);
}

function resetBoard() {
    if (timerInterval) clearInterval(timerInterval);
    if (blackMoveTimeout) {
        clearTimeout(blackMoveTimeout);
        blackMoveTimeout = null;
    }
    clearPremoves('resetBoard', { removeHighlights: true, snapBoard: false });
    moveHistory = [];

    // Apply configured starting times
    whiteTime = Math.max(0, Number(initialWhiteTime) || 0);
    blackTime = Math.max(0, Number(initialBlackTime) || 0);

    const ok = setupScenarioPosition();
    if (ok === false) {
        board.position(game.fen());
        updateTimerDisplay();
        document.getElementById('status').innerHTML = 'Custom Scenario: paste a FEN and click Load.';
        return;
    }
    board.position(game.fen());
    updateTimerDisplay();
    updateStatus();
    startTimer();

    // If the scenario starts with black to move, kick off black's move loop.
    if (!game.game_over() && game.turn() === 'b' && blackTime > 0) {
        scheduleBlackMove();
    }
}

function applyTimeSetting(side, seconds) {
    const value = Math.max(0, Math.min(120, Number(seconds) || 0));
    if (side === 'w') {
        initialWhiteTime = value;
        whiteTime = value;
    } else {
        initialBlackTime = value;
        blackTime = value;
    }

    // If time is set to 0 while running, stop the clock and show the existing messages.
    if (timerInterval && (whiteTime <= 0 || blackTime <= 0)) {
        clearInterval(timerInterval);
        timerInterval = null;
        if (whiteTime <= 0) {
            document.getElementById('status').innerHTML = '<span style="color: orange; font-weight: bold;">Time out! Draw - Black has insufficient material.</span>';
        } else if (blackTime <= 0) {
            document.getElementById('status').innerHTML = '<span class="success">Black ran out of time! White wins!</span>';
        }
    }

    updateTimerDisplay();
}

function setScenario(value) {
    currentScenario = value === 'resetMate' ? 'resetMate' : (value === 'customFen' ? 'customFen' : 'kq');
    updateScenarioVideo();

    const customControls = document.getElementById('customScenarioControls');
    const customError = document.getElementById('customFenError');
    if (customError) {
        customError.style.display = 'none';
        customError.textContent = '';
    }
    if (customControls) {
        customControls.style.display = currentScenario === 'customFen' ? 'flex' : 'none';
    }

    if (currentScenario === 'customFen') {
        document.getElementById('status').innerHTML = 'Custom Scenario: paste a FEN and click Load.';
        return;
    }

    resetBoard();
}

function setCustomFenError(message) {
    const el = document.getElementById('customFenError');
    if (!el) return;
    if (!message) {
        el.style.display = 'none';
        el.textContent = '';
        return;
    }
    el.style.display = 'block';
    el.textContent = message;
}

function loadCustomFenFromInput() {
    const input = document.getElementById('customFen');
    if (!input) return;

    const fen = String(input.value || '').trim();
    if (!fen) {
        setCustomFenError('Please paste a FEN first.');
        return;
    }

    // Validate without destroying the current game state
    const test = new Chess();
    let ok = false;
    try {
        ok = test.load(fen);
    } catch (e) {
        ok = false;
    }

    if (!ok) {
        setCustomFenError('Invalid FEN. Please check the format and try again.');
        return;
    }

    setCustomFenError('');
    customFen = fen;
    currentScenario = 'customFen';
    resetBoard();
}

function initTrainer() {
    // Initialize
    const config = {
        draggable: true,
        position: 'start',
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd,
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png'
    };

    board = Chessboard('board', config);

    // Set up delay slider
    const slider = document.getElementById('blackDelay');
    const valueDisplay = document.getElementById('blackDelayValue');

    slider.addEventListener('input', function () {
        blackMoveDelay = parseFloat(this.value);
        valueDisplay.textContent = blackMoveDelay.toFixed(1) + 's';
    });

    // Buttons
    const newPositionBtn = document.getElementById('newPositionBtn');

    if (newPositionBtn) newPositionBtn.addEventListener('click', resetBoard);

    // Scenario select
    const scenarioSelect = document.getElementById('scenarioSelect');
    if (scenarioSelect) {
        currentScenario = scenarioSelect.value === 'resetMate' ? 'resetMate' : (scenarioSelect.value === 'customFen' ? 'customFen' : 'kq');
        updateScenarioVideo();
        scenarioSelect.addEventListener('change', function () {
            setScenario(this.value);
        });
    }

    // Custom FEN controls
    const loadFenBtn = document.getElementById('loadFenBtn');
    const customFenInput = document.getElementById('customFen');
    const customControls = document.getElementById('customScenarioControls');
    if (customControls) {
        customControls.style.display = currentScenario === 'customFen' ? 'flex' : 'none';
    }
    if (loadFenBtn) {
        loadFenBtn.addEventListener('click', loadCustomFenFromInput);
    }
    if (customFenInput) {
        customFenInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                loadCustomFenFromInput();
            }
        });
    }

    // Time sliders
    const whiteTimeSlider = document.getElementById('whiteTime');
    const whiteTimeValue = document.getElementById('whiteTimeValue');
    const blackTimeSlider = document.getElementById('blackTime');
    const blackTimeValue = document.getElementById('blackTimeValue');

    if (whiteTimeSlider && whiteTimeValue) {
        initialWhiteTime = parseFloat(whiteTimeSlider.value);
        whiteTimeValue.textContent = initialWhiteTime.toFixed(1) + 's';
        whiteTimeSlider.addEventListener('input', function () {
            const v = parseFloat(this.value);
            whiteTimeValue.textContent = v.toFixed(1) + 's';
            applyTimeSetting('w', v);
        });
    }

    if (blackTimeSlider && blackTimeValue) {
        initialBlackTime = parseFloat(blackTimeSlider.value);
        blackTimeValue.textContent = initialBlackTime.toFixed(1) + 's';
        blackTimeSlider.addEventListener('input', function () {
            const v = parseFloat(this.value);
            blackTimeValue.textContent = v.toFixed(1) + 's';
            applyTimeSetting('b', v);
        });
    }

    // Set up initial position
    updateTimerDisplay();
    resetBoard();
}

// Ensure functions remain callable if something still references them
window.resetBoard = resetBoard;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTrainer);
} else {
    initTrainer();
}

