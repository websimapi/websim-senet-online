import { SceneManager } from './scene.js';
import { SenetLogic, INITIAL_PIECES } from './senet_rules.js';
import { audio } from './audio.js';

class GameManager {
    constructor() {
        this.logic = new SenetLogic();
        this.scene = null;
        this.room = null;
        
        // Local State
        this.mode = null; // 'online' or 'ai'
        this.localPlayerRole = null; // 'p1' or 'p2'
        this.gameState = {
            status: 'lobby', 
            players: { p1: null, p2: null }, 
            turn: 'p1',
            roll: null,
            pieces: { ...INITIAL_PIECES },
            validMoves: []
        };
        
        this.throwing = false;
        this.selectedPiece = null;

        this.initUI();
    }

    initUI() {
        // Screens
        this.screens = {
            title: document.getElementById('screen-title'),
            lobby: document.getElementById('screen-lobby'),
            game: document.getElementById('screen-game'),
            gameover: document.getElementById('screen-gameover')
        };

        // Buttons
        document.getElementById('btn-play-online').onclick = () => this.startOnlineMode();
        document.getElementById('btn-play-ai').onclick = () => this.startAIMode();
        document.getElementById('btn-leave-lobby').onclick = () => this.showScreen('title');
        document.getElementById('btn-join-game').onclick = () => this.joinRoomAsP2();
        document.getElementById('btn-return-title').onclick = () => this.resetToTitle();
    }

    showScreen(name) {
        Object.values(this.screens).forEach(s => s.classList.remove('active'));
        if (this.screens[name]) this.screens[name].classList.add('active');
    }

    updateUI() {
        if (this.gameState.status !== 'playing') return;

        const isMyTurn = this.gameState.turn === this.localPlayerRole;
        const turnDisplay = document.getElementById('turn-display');
        const actionHint = document.getElementById('action-hint');
        const rollResult = document.getElementById('roll-result');

        turnDisplay.innerText = this.gameState.turn === 'p1' ? "P1 Turn" : "P2 Turn";
        turnDisplay.style.color = this.gameState.turn === 'p1' ? "#000" : "#fff";
        turnDisplay.style.textShadow = this.gameState.turn === 'p1' ? "1px 1px 2px #fff" : "1px 1px 2px #000";

        document.getElementById('p1-info').innerText = `P1 (Black) ${this.localPlayerRole==='p1'?'(You)':''}`;
        document.getElementById('p2-info').innerText = `P2 (White) ${this.localPlayerRole==='p2'?'(You)':(this.mode==='ai'?'(CPU)':'')}`;

        if (this.throwing) {
            actionHint.innerText = "Sticks are settling...";
            return;
        }

        if (isMyTurn) {
            if (this.gameState.roll === null) {
                actionHint.innerText = "Tap the sticks to roll!";
                if (this.scene) {
                    this.scene.showRollIndicator(true);
                    if (!this.pannedForRoll) {
                        this.scene.focusOnSticks();
                        this.pannedForRoll = true;
                    }
                }
                rollResult.classList.add('hidden');
                this.scene.clearHighlights();
                this.selectedPiece = null;
            } else {
                if (this.scene) this.scene.showRollIndicator(false);
                this.pannedForRoll = false;
                rollResult.classList.remove('hidden');
                document.getElementById('roll-number').innerText = this.gameState.roll;
                
                if (this.gameState.validMoves.length === 0) {
                    actionHint.innerText = "No valid moves. Turn passes.";
                    this.scene.clearHighlights();
                    setTimeout(() => {
                        if(this.gameState.validMoves.length === 0 && this.gameState.roll !== null && this.gameState.turn === this.localPlayerRole) {
                            this.passTurn();
                        }
                    }, 2000);
                } else {
                    if (!this.selectedPiece) {
                        actionHint.innerText = "Tap one of your pieces to select it.";
                        const movablePieceIds = [...new Set(this.gameState.validMoves.map(m => m.pieceId))];
                        this.scene.showMovablePieces(movablePieceIds, this.gameState.pieces);
                    } else {
                        actionHint.innerText = "Tap a highlighted destination to move.";
                    }
                }
            }
        } else {
            this.pannedForRoll = false;
            if (this.scene) this.scene.showRollIndicator(false);
            actionHint.innerText = "Waiting for opponent...";
            if (this.gameState.roll !== null) {
                rollResult.classList.remove('hidden');
                document.getElementById('roll-number').innerText = this.gameState.roll;
            } else {
                rollResult.classList.add('hidden');
            }
            this.scene.clearHighlights();
            this.selectedPiece = null;
        }
    }

    // --- GAME INITIALIZATION ---

    async startOnlineMode() {
        this.mode = 'online';
        this.showScreen('lobby');
        
        if (!this.room) {
            this.room = new WebsimSocket();
            
            this.room.onmessage = (event) => {
                if (event.data.type === 'throw') {
                    this.handleRemoteThrow(event.data.impulses);
                }
            };

            await this.room.initialize();
            
            this.room.subscribeRoomState((state) => {
                this.syncGameStateFromRoom(state);
            });
            
            this.room.subscribePresence((presence) => {
                this.updateLobbyUI();
            });
        }
        
        this.updateLobbyUI();
    }

    startAIMode() {
        this.mode = 'ai';
        this.localPlayerRole = 'p1';
        this.initScene();
        
        // Setup local state
        this.gameState = {
            status: 'playing',
            players: { p1: 'local', p2: 'AI' },
            turn: 'p1',
            roll: null,
            pieces: { ...INITIAL_PIECES },
            validMoves: []
        };
        
        this.logic.setState(this.gameState.pieces);
        this.scene.updatePiecesPositions(this.gameState.pieces);
        this.showScreen('game');
        this.updateUI();
    }

    initScene() {
        if (!this.scene) {
            const container = document.getElementById('game-container');
            this.scene = new SceneManager(container, this.handleInteract.bind(this));
        }
    }

    // --- MULTIPLAYER LOGIC ---

    updateLobbyUI() {
        if (this.mode !== 'online' || this.gameState.status === 'playing') return;

        const list = document.getElementById('players-list');
        list.innerHTML = '';
        
        const peers = this.room.peers;
        const myId = this.room.clientId;
        
        // Host logic: First person in peers is host (P1)
        const peerIds = Object.keys(peers).sort();
        const hostId = peerIds[0];
        
        if (myId === hostId) {
            this.localPlayerRole = 'p1';
            document.getElementById('lobby-status').innerText = "You are Player 1. Waiting for Player 2...";
            document.getElementById('btn-join-game').style.display = 'none';
            
            // Initialize room state if empty
            if (!this.room.roomState.status) {
                this.room.updateRoomState({
                    status: 'lobby',
                    players: { p1: myId, p2: null },
                    turn: 'p1',
                    roll: null,
                    pieces: { ...INITIAL_PIECES }
                });
            }
        } else {
            this.localPlayerRole = 'spectator';
            const p2Id = this.room.roomState.players?.p2;
            
            if (p2Id === myId) {
                this.localPlayerRole = 'p2';
                document.getElementById('lobby-status').innerText = "You are Player 2. Waiting for host to start...";
                document.getElementById('btn-join-game').style.display = 'none';
            } else if (!p2Id) {
                document.getElementById('lobby-status').innerText = "Room has an open slot.";
                document.getElementById('btn-join-game').style.display = 'block';
            } else {
                document.getElementById('lobby-status').innerText = "Room is full. Spectating.";
                document.getElementById('btn-join-game').style.display = 'none';
            }
        }

        for (const id in peers) {
            const p = peers[id];
            const div = document.createElement('div');
            div.className = 'lobby-player';
            div.innerHTML = `<img src="${p.avatarUrl}"> ${p.username} ${id === myId ? '(You)' : ''}`;
            list.appendChild(div);
        }

        // Auto start if 2 players
        if (myId === hostId && this.room.roomState.players?.p2 && this.room.roomState.status === 'lobby') {
            setTimeout(() => {
                this.room.updateRoomState({ status: 'playing' });
            }, 1000);
        }
    }

    joinRoomAsP2() {
        this.room.updateRoomState({
            players: { p1: this.room.roomState.players.p1, p2: this.room.clientId }
        });
    }

    syncGameStateFromRoom(roomState) {
        if (!roomState.status) return;

        // Detect transition to playing
        if (this.gameState.status === 'lobby' && roomState.status === 'playing') {
            this.initScene();
            this.showScreen('game');
        }

        // Detect game over
        if (roomState.status === 'gameover') {
            this.showGameOver(roomState.winner);
            return;
        }

        this.gameState = {
            ...this.gameState,
            status: roomState.status,
            turn: roomState.turn,
            roll: roomState.roll,
            pieces: roomState.pieces || this.gameState.pieces
        };

        this.logic.setState(this.gameState.pieces);
        if (this.scene) {
            this.scene.updatePiecesPositions(this.gameState.pieces);
        }

        // Calculate valid moves locally if it's my turn and a roll exists
        if (this.gameState.turn === this.localPlayerRole && this.gameState.roll !== null && !this.throwing) {
            this.gameState.validMoves = this.logic.getValidMoves(this.localPlayerRole, this.gameState.roll);
        }

        this.updateUI();
    }

    updateSharedState(updates) {
        if (this.mode === 'online') {
            this.room.updateRoomState(updates);
        } else {
            // Local AI mode state update
            this.gameState = { ...this.gameState, ...updates };
            this.logic.setState(this.gameState.pieces);
            this.scene.updatePiecesPositions(this.gameState.pieces);
            
            // Recalculate local moves
            if (this.gameState.roll !== null) {
                this.gameState.validMoves = this.logic.getValidMoves(this.gameState.turn, this.gameState.roll);
            }

            this.updateUI();

            // Trigger AI if needed
            if (this.gameState.turn === 'p2' && !this.throwing && updates.turn === 'p2') {
                setTimeout(() => this.doAITurn(), 1000);
            }
        }
    }

    // --- GAMEPLAY ACTIONS ---

    initiateThrow() {
        if (this.gameState.turn !== this.localPlayerRole) return;

        // Generate impulses for realistic toss
        const impulses = [];
        for(let i=0; i<4; i++) {
            impulses.push({
                fx: (Math.random() - 0.5) * 2,     // Slight lateral scatter
                fy: -10 - Math.random() * 10,      // Toss downward firmly
                fz: (Math.random() - 0.5) * 2,     // Slight forward/back scatter
                tx: (Math.random() - 0.5) * 6,     // Gentle spin
                ty: (Math.random() - 0.5) * 6,     
                tz: (Math.random() - 0.5) * 6      
            });
        }

        if (this.mode === 'online') {
            this.room.send({ type: 'throw', impulses });
        }
        
        this.handleRemoteThrow(impulses); // Play locally immediately
    }

    handleRemoteThrow(impulses) {
        if (!this.scene) return;
        
        this.throwing = true;
        this.updateUI();
        this.scene.applyThrowImpulses(impulses);

        // Wait for settling
        const checkInterval = setInterval(() => {
            if (this.scene.checkSticksSettled()) {
                clearInterval(checkInterval);
                this.throwing = false;
                
                if (this.scene) {
                    this.scene.focusOnBoard();
                }

                // Only the active player decides the authoritative result
                if (this.gameState.turn === this.localPlayerRole || (this.mode === 'ai' && this.gameState.turn === 'p2')) {
                    const rollValue = this.scene.calculateRollValue();
                    this.updateSharedState({ roll: rollValue });
                } else {
                    this.updateUI(); // Spectator/Opponent UI update
                }
            }
        }, 200);
    }

    handleInteract(type, data) {
        if (this.gameState.turn !== this.localPlayerRole) return;
        if (this.throwing) return;

        if (type === 'sticks') {
            if (this.gameState.roll === null) {
                this.initiateThrow();
            }
            return;
        }

        if (this.gameState.roll === null) return;

        if (type === 'piece') {
            const pieceId = data;
            if (!pieceId.startsWith(this.localPlayerRole)) {
                if (this.selectedPiece) {
                    const captureMove = this.gameState.validMoves.find(
                        m => m.pieceId === this.selectedPiece && m.type === 'capture' && m.captureId === pieceId
                    );
                    if (captureMove) {
                        this.executeMove(captureMove);
                        this.selectedPiece = null;
                        return;
                    }
                }
                this.selectedPiece = null;
                this.updateUI();
                return;
            }

            const moves = this.gameState.validMoves.filter(m => m.pieceId === pieceId);
            if (moves.length > 0) {
                this.selectedPiece = pieceId;
                this.scene.showValidMoves(moves, pieceId);
                document.getElementById('action-hint').innerText = "Tap a highlighted destination to move.";
            } else {
                this.selectedPiece = null;
                this.updateUI();
            }
        } else if (type === 'move') {
            if (this.selectedPiece) {
                this.executeMove(data);
                this.selectedPiece = null;
            }
        } else if (type === 'none') {
            this.selectedPiece = null;
            this.updateUI();
        }
    }

    executeMove(move) {
        audio.playThud();
        const newPieces = this.logic.applyMove(move);
        this.logic.setState(newPieces);
        
        // Check win
        if (this.logic.checkWin(this.gameState.turn)) {
            this.updateSharedState({ status: 'gameover', winner: this.gameState.turn, pieces: newPieces });
            if (this.mode === 'ai') this.showGameOver(this.gameState.turn);
            return;
        }

        // Determine next turn
        let nextTurn = this.gameState.turn;
        if (!this.logic.grantsExtraTurn(this.gameState.roll)) {
            nextTurn = this.gameState.turn === 'p1' ? 'p2' : 'p1';
        }

        this.updateSharedState({
            pieces: newPieces,
            turn: nextTurn,
            roll: null
        });
    }

    passTurn() {
        const nextTurn = this.gameState.turn === 'p1' ? 'p2' : 'p1';
        this.updateSharedState({
            turn: nextTurn,
            roll: null
        });
    }

    // --- AI LOGIC ---

    doAITurn() {
        if (this.gameState.status !== 'playing') return;

        if (this.gameState.roll === null) {
            this.initiateThrow(); // AI throws
        } else {
            // AI picks a move
            const moves = this.gameState.validMoves;
            if (moves.length > 0) {
                // Simple AI: Prefer captures, then exits, then furthest advancement
                moves.sort((a, b) => {
                    if (a.type === 'capture' && b.type !== 'capture') return -1;
                    if (b.type === 'capture' && a.type !== 'capture') return 1;
                    if (a.type === 'exit') return -1;
                    if (b.type === 'exit') return 1;
                    return b.targetPos - a.targetPos;
                });
                
                setTimeout(() => this.executeMove(moves[0]), 1500);
            } else {
                setTimeout(() => this.passTurn(), 1500);
            }
        }
    }

    // --- ENDGAME ---

    showGameOver(winnerRole) {
        this.showScreen('gameover');
        let text = "You Lost!";
        if (winnerRole === this.localPlayerRole) {
            text = "You Won!";
        } else if (this.localPlayerRole === 'spectator') {
            text = `${winnerRole.toUpperCase()} Wins!`;
        }
        document.getElementById('winner-text').innerText = text;
    }

    resetToTitle() {
        if (this.mode === 'online' && this.room) {
            // Basic reset logic - real implementation might keep room alive
            window.location.reload(); 
        } else {
            this.showScreen('title');
            if (this.scene) {
                document.getElementById('game-container').innerHTML = '';
                this.scene = null;
            }
        }
    }
}

// Start Game
window.onload = () => {
    new GameManager();
};