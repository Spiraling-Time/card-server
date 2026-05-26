console.log("BOOTING SERVER...");

const http = require("http");
const WebSocket = require("ws");

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;

server.listen(PORT, "0.0.0.0", () => {
    console.log("Server running on port", PORT);
});

// ==================================================
// GAME STATE
// ==================================================

const rooms = {};
const gameState = {};

// ==================================================
// HELPERS
// ==================================================

function createDeck() {
    const cards = [];

    for (let j = 0; j < 4; j++) {
        for (let i = 1; i <= 13; i++) {
            cards.push(`${j}clubs-${i}`);
        }

        for (let i = 1; i <= 13; i++) {
            cards.push(`${j}spades-${i}`);
        }

        for (let i = 1; i <= 13; i++) {
            cards.push(`${j}hearts-${i}`);
        }

        for (let i = 1; i <= 13; i++) {
            cards.push(`${j}diamonds-${i}`);
        }
    }

    return cards;
}

function shuffle(array) {
    const copy = [...array];

    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }

    return copy;
}

function makeCode() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function makeToken() {
    return (
        Math.random().toString(36).substring(2) +
        Math.random().toString(36).substring(2)
    );
}

function getCurrentPlayer(roomCode) {
    const state = gameState[roomCode];

    if (!state) return null;

    return state.playerOrder[state.turnIndex];
}

function nextTurn(roomCode) {
    const state = gameState[roomCode];

    if (!state) return null;

    state.turnIndex++;

    if (state.turnIndex >= state.playerOrder.length) {
        state.turnIndex = 0;
    }

    return getCurrentPlayer(roomCode);
}

function drawCard(state, playerId) {
    if (state.deck.length === 0) {
        return null;
    }

    const card = state.deck.pop();

    state.hands[playerId].push(card);

    return card;
}

function broadcast(roomCode, data) {
    const room = rooms[roomCode];

    if (!room) return;

    for (const ws of room) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }
}

// ==================================================
// CONNECTION
// ==================================================

wss.on("connection", (ws) => {
    console.log("Client connected");

    ws.roomCode = null;
    ws.playerId = null;
    ws.token = null;

    ws.on("message", (raw) => {
        let msg;

        try {
            msg = JSON.parse(raw);
        } catch {
            console.log("Bad JSON");
            return;
        }

        // =============================================
        // TEST
        // =============================================

        if (msg.type === "test") {
            ws.send(
                JSON.stringify({
                    type: "reply",
                    msg: "Server received: " + msg.msg
                })
            );
        }

        // =============================================
        // CREATE ROOM
        // =============================================

        if (msg.type === "create_room") {
            const code = makeCode();

            rooms[code] = [];

            gameState[code] = {
                deck: shuffle(createDeck()),
                hands: {},
                discardPile: [],
                turnIndex: 0,

                playerOrder: [],

                players: {}
            };

            const state = gameState[code];

            ws.roomCode = code;
            ws.playerId = "P1";
            ws.token = makeToken();

            rooms[code].push(ws);

            state.playerOrder.push("P1");

            state.hands["P1"] = [];

            state.players["P1"] = {
                token: ws.token,
                connected: true
            };

            ws.send(
                JSON.stringify({
                    type: "room_created",
                    code: code,
                    playerId: ws.playerId,
                    token: ws.token,
                    hand: state.hands["P1"],
                    currentTurn: "P1"
                })
            );

            console.log(`Room created: ${code}`);
        }

        // =============================================
        // JOIN ROOM
        // =============================================

        if (msg.type === "join_room") {
            const code = msg.code;

            if (!rooms[code] || !gameState[code]) {
                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: "Room not found"
                    })
                );
                return;
            }

            const state = gameState[code];

            const playerId =
                "P" + (state.playerOrder.length + 1);

            ws.roomCode = code;
            ws.playerId = playerId;
            ws.token = makeToken();

            rooms[code].push(ws);

            state.playerOrder.push(playerId);

            state.hands[playerId] = [];

            state.players[playerId] = {
                token: ws.token,
                connected: true
            };

            ws.send(
                JSON.stringify({
                    type: "joined_room",
                    code: code,
                    playerId: playerId,
                    token: ws.token,
                    hand: state.hands[playerId],
                    currentTurn: getCurrentPlayer(code)
                })
            );

            console.log(`${playerId} joined ${code}`);
        }

        // =============================================
        // RECONNECT
        // =============================================

        if (msg.type === "reconnect") {
            const code = msg.code;
            const token = msg.token;

            if (!gameState[code]) {
                return;
            }

            const state = gameState[code];

            let foundPlayerId = null;

            for (const playerId in state.players) {
                if (state.players[playerId].token === token) {
                    foundPlayerId = playerId;
                    break;
                }
            }

            if (!foundPlayerId) {
                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: "Invalid reconnect token"
                    })
                );
                return;
            }

            ws.roomCode = code;
            ws.playerId = foundPlayerId;
            ws.token = token;

            rooms[code].push(ws);

            state.players[foundPlayerId].connected = true;

            ws.send(
                JSON.stringify({
                    type: "reconnected",
                    code: code,
                    playerId: foundPlayerId,
                    hand: state.hands[foundPlayerId],
                    currentTurn: getCurrentPlayer(code),
                    discardPile: state.discardPile
                })
            );

            console.log(`${foundPlayerId} reconnected`);
        }

        // =============================================
        // DRAW CARD
        // =============================================

        if (msg.type === "draw_card") {
            const code = ws.roomCode;

            if (!code || !gameState[code]) {
                return;
            }

            const state = gameState[code];

            const currentPlayer = getCurrentPlayer(code);

            if (currentPlayer !== ws.playerId) {
                return;
            }

            const card = drawCard(state, ws.playerId);

            if (!card) {
                return;
            }

            broadcast(code, {
                type: "cards_drawn",
                playerId: ws.playerId,
                cards: [card]
            });
        }

        // =============================================
        // PLAY CARD
        // =============================================

        if (msg.type === "play_card") {
            const code = ws.roomCode;

            if (!code || !gameState[code]) {
                return;
            }

            const state = gameState[code];

            const currentPlayer = getCurrentPlayer(code);

            if (currentPlayer !== ws.playerId) {
                return;
            }

            const hand = state.hands[ws.playerId];

            if (!hand) {
                return;
            }

            const index = hand.indexOf(msg.card);

            if (index === -1) {
                console.log(
                    "Rejected play:",
                    ws.playerId,
                    msg.card
                );
                return;
            }

            hand.splice(index, 1);

            state.discardPile.push(msg.card);

            broadcast(code, {
                type: "played_card",
                playerId: ws.playerId,
                card: msg.card,
                slot: msg.slot
            });
        }

        // =============================================
        // END TURN
        // =============================================

        if (msg.type === "end_turn") {
            const code = ws.roomCode;

            if (!code || !gameState[code]) {
                return;
            }

            const currentPlayer = getCurrentPlayer(code);

            if (currentPlayer !== ws.playerId) {
                return;
            }

            const nextPlayer = nextTurn(code);

            broadcast(code, {
                type: "turn_changed",
                playerId: nextPlayer
            });
        }
    });

    // =============================================
    // DISCONNECT
    // =============================================

    ws.on("close", () => {
        const code = ws.roomCode;

        if (!code || !rooms[code] || !gameState[code]) {
            return;
        }

        const state = gameState[code];

        rooms[code] = rooms[code].filter(
            (client) => client !== ws
        );

        if (
            ws.playerId &&
            state.players[ws.playerId]
        ) {
            state.players[ws.playerId].connected = false;

            console.log(
                `${ws.playerId} disconnected from ${code}`
            );
        }

        const anyoneConnected =
            Object.values(state.players).some(
                (player) => player.connected
            );

        if (!anyoneConnected) {
            console.log(
                `Deleting inactive room ${code}`
            );

            delete rooms[code];
            delete gameState[code];
        }
    });
});
