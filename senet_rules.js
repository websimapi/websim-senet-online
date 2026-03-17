export const BOARD_SIZE = 30;

export const INITIAL_PIECES = {
    // Player 1 (Black, Cones) starts on evens
    'p1_0': 0, 'p1_1': 2, 'p1_2': 4, 'p1_3': 6, 'p1_4': 8,
    // Player 2 (White, Spools) starts on odds
    'p2_0': 1, 'p2_1': 3, 'p2_2': 5, 'p2_3': 7, 'p2_4': 9
};

// Calculate visual path (snake pattern)
export function getBoardCoordinates(index) {
    if (index < 0 || index >= BOARD_SIZE) return null;
    const row = Math.floor(index / 10);
    let col = index % 10;
    
    // Middle row goes right to left
    if (row === 1) {
        col = 9 - col;
    }
    
    const TILE_SIZE = 2;
    const OFFSET_X = -6 * TILE_SIZE; // Shift board left to make room for table throw area
    const OFFSET_Z = -1 * TILE_SIZE;

    return {
        x: OFFSET_X + col * TILE_SIZE,
        y: 0.1, // Sit nicely on the board
        z: OFFSET_Z + row * TILE_SIZE
    };
}

export class SenetLogic {
    constructor() {
        this.pieces = { ...INITIAL_PIECES };
    }

    setState(pieces) {
        this.pieces = { ...pieces };
    }

    getPieceAt(index) {
        for (const [id, pos] of Object.entries(this.pieces)) {
            if (pos === index) return id;
        }
        return null;
    }

    getValidMoves(player, roll) {
        if (!roll) return [];
        
        const distance = roll === 0 ? 5 : roll;
        const validMoves = [];
        const opponent = player === 'p1' ? 'p2' : 'p1';

        for (let i = 0; i < 5; i++) {
            const pieceId = `${player}_${i}`;
            const currentPos = this.pieces[pieceId];
            
            if (currentPos === -1) continue;

            let targetPos = currentPos + distance;

            // Blockade rule: Cannot pass 3 or more opponent pieces in a row
            let isBlocked = false;
            for (let p = currentPos + 1; p < targetPos; p++) {
                if (p > 29) break;
                if (this.isBlockade(p, opponent)) {
                    isBlocked = true;
                    break;
                }
            }
            if (isBlocked) continue;

            if (targetPos >= BOARD_SIZE) {
                // Exact roll required to exit
                if (targetPos === BOARD_SIZE) {
                    validMoves.push({ pieceId, targetPos: -1, type: 'exit' });
                }
                continue;
            }

            const occupantId = this.getPieceAt(targetPos);

            if (occupantId) {
                const occupantPlayer = occupantId.split('_')[0];
                if (occupantPlayer === player) {
                    continue; // Blocked by own piece
                } else {
                    if (this.isDefended(targetPos, occupantPlayer)) {
                        continue; // Cannot capture defended piece
                    } else {
                        validMoves.push({ pieceId, targetPos, type: 'capture', captureId: occupantId });
                    }
                }
            } else {
                validMoves.push({ pieceId, targetPos, type: 'normal' });
            }
        }
        return validMoves;
    }

    isBlockade(index, player) {
        const check = (i) => {
            if (i < 0 || i >= BOARD_SIZE) return false;
            const id = this.getPieceAt(i);
            return id && id.split('_')[0] === player;
        };
        if (check(index)) {
            if (check(index-1) && check(index-2)) return true;
            if (check(index-1) && check(index+1)) return true;
            if (check(index+1) && check(index+2)) return true;
        }
        return false;
    }

    isDefended(index, player) {
        const prevId = index > 0 ? this.getPieceAt(index - 1) : null;
        const nextId = index < BOARD_SIZE - 1 ? this.getPieceAt(index + 1) : null;

        if (prevId && prevId.split('_')[0] === player) return true;
        if (nextId && nextId.split('_')[0] === player) return true;
        return false;
    }

    applyMove(move) {
        const newPieces = { ...this.pieces };
        
        let finalPos = move.targetPos;
        if (finalPos === 26) { // House of Water
            finalPos = 14;     // Fall back to 15th square
            const occupant = this.getPieceAt(14);
            if (occupant) {
                 newPieces[occupant] = 26; // Swap them into the water
            }
        }

        if (move.type === 'capture' && finalPos === move.targetPos) {
            newPieces[move.captureId] = this.pieces[move.pieceId];
        }

        newPieces[move.pieceId] = finalPos;
        return newPieces;
    }

    checkWin(player) {
        for (let i = 0; i < 5; i++) {
            if (this.pieces[`${player}_${i}`] !== -1) return false;
        }
        return true;
    }

    grantsExtraTurn(roll) {
        return roll === 1 || roll === 4 || roll === 0;
    }
}