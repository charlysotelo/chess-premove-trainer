// Scenario setup + position helpers.

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
