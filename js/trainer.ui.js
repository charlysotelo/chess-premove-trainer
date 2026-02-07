// DOM + board rendering helpers.

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
