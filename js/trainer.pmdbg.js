// Debug logging helpers.
// Enable via DevTools:
//   localStorage.setItem('debugPremove', '1'); location.reload();
// or:
//   window.DEBUG_PREMOVE = true;

const PMDBG_TAG = 'PMDBG';
let pmdbgLastSuspiciousLogAt = 0;
let pmdbgLastTurn = null;
let pmdbgLastFen = null;

function pmdbgEnabled() {
    try {
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
