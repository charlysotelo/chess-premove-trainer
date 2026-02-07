// Core engine: events, timers, move scheduling.

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

    if (didHavePremoves) {
        pmdbgLog(`premoves_cleared reason=${reason}`, { reason, preview });
    } else {
        pmdbgLog(`premoves_cleared_empty reason=${reason}`, { reason });
    }

    if (opts.removeHighlights !== false) {
        try { removeHighlights(); } catch (e) { /* ignore */ }
    }

    if (opts.snapBoard !== false && board) {
        try { board.position(game.fen(), false); } catch (e) { /* ignore */ }
    }
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
        return true;
    }

    return true;
}

function onDrop(source, target) {
    const currentTurn = (() => {
        try { return game.turn(); } catch (e) { return '?'; }
    })();

    if (!target || target === 'offboard') return 'snapback';
    if (source === target) return 'snapback';

    const treatAsPremove = (dragStartedOnTurn === 'b') || (currentTurn === 'b');
    pmdbgLog('drop', {
        source,
        target,
        dragStartedOnTurn,
        currentTurn,
        treatAsPremove,
        dragHeldMs: Math.round(pmdbgNowMs() - (dragStartedAtMs || pmdbgNowMs()))
    });

    if (treatAsPremove) {
        const currentPos = board.position();
        const pieceAtSource = currentPos[source];
        if (!pieceAtSource || pieceAtSource[0] !== 'w') return 'snapback';

        premoves.push({ from: source, to: target });
        pmdbgLog('premove_queued', { from: source, to: target, queued: premoves.slice(-5) });

        renderPremoveHighlights();
        updatePremovePreview();

        if (currentTurn === 'w' && !game.game_over()) {
            pmdbgLog('premove_drop_turn_flipped_to_white_execute_now');
            scheduleAutoPremoveExecution(0);
        }

        return;
    }

    clearPremoves('real_move_attempt', { removeHighlights: true, snapBoard: false });

    let move = null;
    try {
        move = game.move({
            from: source,
            to: target,
            promotion: 'q'
        });
    } catch (e) {
        pmdbgWarn('real_move_threw', { source, target, error: String(e && (e.message || e)) });
        return 'snapback';
    }

    if (move === null) {
        pmdbgLog('real_move_illegal', { source, target });
        return 'snapback';
    }

    pmdbgLog('real_move_played', { san: move && move.san, from: move && move.from, to: move && move.to });

    moveHistory.push(move);
    updateStatus();

    if (!game.game_over()) {
        scheduleBlackMove();
    }
}

function onSnapEnd() {
    if (game.turn() === 'b' && premoves.length > 0) {
        return;
    }
    board.position(game.fen());
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

function makeBlackMove() {
    const possibleMoves = game.moves();
    if (possibleMoves.length === 0) return;

    const randomIdx = Math.floor(Math.random() * possibleMoves.length);
    pmdbgLog('black_move_about_to_play', { candidateCount: possibleMoves.length, chosenIndex: randomIdx });
    const move = game.move(possibleMoves[randomIdx]);

    pmdbgLog('black_move_played', { san: move && move.san, from: move && move.from, to: move && move.to });

    moveHistory.push(move);

    if (premoves.length > 0) updatePremovePreview();
    else board.position(game.fen());

    updateTimerDisplay();
    updateStatus();

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

        if (move === null) {
            clearPremoves('auto_premove_illegal', { removeHighlights: true, snapBoard: true });
            updateTimerDisplay();
            pmdbgWarn('auto_premove_illegal_cleared_queue', { from: pm.from, to: pm.to });
            return;
        }

        pmdbgLog('auto_premove_played', { san: move && move.san, from: move && move.from, to: move && move.to, remainingQueue: premoves.length });

        whiteTime = Math.max(0, whiteTime - 0.1);
        moveHistory.push(move);

        if (premoves.length > 0) updatePremovePreview();
        else board.position(game.fen(), false);

        updateStatus();
        updateTimerDisplay();

        if (!game.game_over() && whiteTime > 0) {
            scheduleBlackMove();
        }
    } catch (e) {
        pmdbgWarn('auto_premove_execute_threw', { error: String(e && (e.message || e)) });
        clearPremoves('auto_premove_execute_exception', { removeHighlights: true, snapBoard: true });
        updateTimerDisplay();
        updateStatus();
    }
}

function startTimer() {
    if (timerInterval) clearInterval(timerInterval);

    timerInterval = setInterval(() => {
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
                pmdbgLog('timer_tick_fen_changed');
                pmdbgLastFen = currentFen;
            }
        }

        if (game.game_over()) {
            clearInterval(timerInterval);
            return;
        }

        if (game.turn() === 'w') {
            if (premoves.length > 0) {
                pmdbgLog('timer_tick_skip_white_due_to_premoves_queued', {
                    premoveAutoPending,
                    queuedPreview: premoves.slice(0, 5)
                });

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

function loadCustomFenFromInput() {
    const input = document.getElementById('customFen');
    if (!input) return;

    const fen = String(input.value || '').trim();
    if (!fen) {
        setCustomFenError('Please paste a FEN first.');
        return;
    }

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
    const config = {
        draggable: true,
        position: 'start',
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd,
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png'
    };

    board = Chessboard('board', config);

    const slider = document.getElementById('blackDelay');
    const valueDisplay = document.getElementById('blackDelayValue');

    slider.addEventListener('input', function () {
        blackMoveDelay = parseFloat(this.value);
        valueDisplay.textContent = blackMoveDelay.toFixed(1) + 's';
    });

    const newPositionBtn = document.getElementById('newPositionBtn');
    if (newPositionBtn) newPositionBtn.addEventListener('click', resetBoard);

    const scenarioSelect = document.getElementById('scenarioSelect');
    if (scenarioSelect) {
        currentScenario = scenarioSelect.value === 'resetMate' ? 'resetMate' : (scenarioSelect.value === 'customFen' ? 'customFen' : 'kq');
        updateScenarioVideo();
        scenarioSelect.addEventListener('change', function () {
            setScenario(this.value);
        });
    }

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

    updateTimerDisplay();
    resetBoard();
}

window.resetBoard = resetBoard;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTrainer);
} else {
    initTrainer();
}
