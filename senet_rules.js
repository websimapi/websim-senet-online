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
    
    // Scale for 3D world (assuming tile size is ~2 units)
    const TILE_SIZE = 2;
    const OFFSET_X = -4.5 * TILE_SIZE; // Center grid
    const OFFSET_Z = -1 * TILE_SIZE;

    return {
        x: OFFSET_X + col * TILE_SIZE,
        y: 0.5, // Slightly above board
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

    // Standard simplified Senet rules
    // 1=1, 2=2, 3=3, 4=4, 0=5
    // 1, 4, 5 grant an extra turn
    getValidMoves(player, roll) {
        if (!roll) return [];
        
        const distance = roll === 0 ? 5 : roll;
        const validMoves = [];

        for (let i = 0; i < 5; i++) {
            const pieceId = `${player}_${i}`;
            const currentPos = this.pieces[pieceId];
            
            // If already finished
            if (currentPos === -1) continue;

            let targetPos = currentPos + distance;

            // Exit board rule
            if (targetPos >= BOARD_SIZE) {
                // Must land exactly on 30 to exit, or allow overshooting for simplicity
                // Let's allow exiting if >= 30 to make games faster
                validMoves.push({ pieceId, targetPos: -1, type: 'exit' });
                continue;
            }

            const occupantId = this.getPieceAt(targetPos);

            if (occupantId) {
                const occupantPlayer = occupantId.split('_')[0];
                if (occupantPlayer === player) {
                    // Blocked by own piece
                    continue;
                } else {
                    // Check defense rule: Two opponent pieces adjacent?
                    const isDefended = this.isDefended(targetPos, occupantPlayer);
                    if (isDefended) {
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

    isDefended(index, player) {
        // Check adjacent tiles on the path (index-1 and index+1)
        const prevId = index > 0 ? this.getPieceAt(index - 1) : null;
        const nextId = index < BOARD_SIZE - 1 ? this.getPieceAt(index + 1) : null;

        let adjacentCount = 0;
        if (prevId && prevId.split('_')[0] === player) adjacentCount++;
        if (nextId && nextId.split('_')[0] === player) adjacentCount++;

        return adjacentCount > 0;
    }

    applyMove(move) {
        const newPieces = { ...this.pieces };
        
        // Special Tiles
        let finalPos = move.targetPos;
        if (finalPos === 26) { // House of Water
            finalPos = 14;     // Fall back to 15th square (index 14)
            // If 14 is occupied, find nearest empty backwards? 
            // Simplified: just swap with whoever is there or fail. Let's force move to 14.
            const occupant = this.getPieceAt(14);
            if (occupant) {
                 newPieces[occupant] = 26; // Swap them into the water!
            }
        }

        if (move.type === 'capture' && finalPos === move.targetPos) {
            // Swap positions
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