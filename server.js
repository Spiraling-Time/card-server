
const http = require("http");
const WebSocket = require("ws");

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
    console.log("Server running on", PORT);
});
console.log("Hi!");

// --------------------
// GAME STATE
// --------------------
const rooms = {};
const gameState = {};

// --------------------
// HELPERS
// --------------------
function createDeck() {
    const cards = [];
    for (let j = 0; j < 4; j++) {
        for (let i = 1; i<=13  ; i++) {
            cards.push(`${j}clubs-${i}`);
        }
        for (let i = 1; i<=13  ; i++) {
            cards.push(`${j}spades-${i}`);
        }
        for (let i = 1; i<=13  ; i++) {
            cards.push(`${j}hearts-${i}`);
        }
        for (let i = 1; i<=13  ; i++) {
            cards.push(`${j}diamonds-${i}`);
        }
    }

    return cards;
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function makeCode() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// get current player in turn
function getCurrentPlayer(roomCode) {
    const room = rooms[roomCode];
    const state = gameState[roomCode];

    return room[state.turnIndex];
}

// next turn
function nextTurn(roomCode) {
    const state = gameState[roomCode];
    const room = rooms[roomCode];

    state.turnIndex++;

    if (state.turnIndex >= room.length) {
        state.turnIndex = 0;
    }

    return getCurrentPlayer(roomCode);
}

// draw card
function drawCard(state, playerId) {

    const card = state.deck.pop();

    state.hands[playerId].push(card);

    console.log("DREW:", card);

    return card;
}

// --------------------
// CONNECTION
// --------------------
wss.on("connection", (ws) => {
    console.log("Client connected");

    ws.roomCode = null;
    ws.playerId = null;

    ws.on("message", (raw) => {
        let msg;

        try {
            msg = JSON.parse(raw);
        } catch (e) {
            console.log("Bad message:", raw.toString());
            return;
        }

        // -------------------------
        // TEST
        // -------------------------
        if (msg.type === "test") {
            ws.send(JSON.stringify({
                type: "reply",
                msg: "Server received: " + msg.msg
            }));
        }

        // -------------------------
        // CREATE ROOM
        // -------------------------
        if (msg.type === "create_room") {
            const code = makeCode();

            rooms[code] = [];
            gameState[code] = {
                deck: shuffle(createDeck()),
                hands: {},
                turnIndex: 0,
                discardPile: []
            };

            ws.roomCode = code;
            rooms[code].push(ws);


            const state = gameState[code];

            ws.playerId = "P1";

            // init hand
            state.hands[ws.playerId] = [];


            ws.send(JSON.stringify({
                type: "room_created",
                code: code,
                playerId: ws.playerId,
                hand: state.hands[ws.playerId]
                //currentTurn: room[state.turnIndex].playerId
            }));
            /*
            const drawnCards = [];

            for (let i = 0; i < 3; i++) {
                drawnCards.push(drawCard(state, ws.playerId));
            }

            ws.send(JSON.stringify({
                type: "cards_drawn",
                cards: drawnCards,
                playerId: ws.playerId
            })); */

            console.log("Room created:", code);
        }

        // -------------------------
        // JOIN ROOM
        // -------------------------
        if (msg.type === "join_room") {
            const code = msg.code;

            if (!rooms[code]) {
                ws.send(JSON.stringify({
                    type: "error",
                    message: "Room not found"
                }));
                return;
            }

            const room = rooms[code];
            const state = gameState[code];

            ws.roomCode = code;
            room.push(ws);

            ws.playerId = "P" + room.length;

            // init hand
            state.hands[ws.playerId] = [];


            ws.send(JSON.stringify({
                code: code,
                type: "joined_room",
                playerId: ws.playerId,
                hand: state.hands[ws.playerId],
                currentTurn: room[state.turnIndex].playerId
            }));

            console.log(`Player joined ${code} as ${ws.playerId}`);

                      /*  const drawnCards = [];

            for (let i = 0; i < 3; i++) {
                drawnCards.push(drawCard(state, ws.playerId));
            }

            ws.send(JSON.stringify({
                type: "cards_drawn",
                cards: drawnCards,
                playerId: ws.playerId

            }));*/
        }

        if (msg.type === "draw_card") {
            const code = ws.roomCode;
            const state = gameState[code];

            if (!code || !state) return;

            const card = drawCard(state, ws.playerId);

            for (const client of rooms[code]) {
                client.send(JSON.stringify({
                    type: "cards_drawn",
                    cards: [card],
                    playerId: ws.playerId
                }));
            }
        }
        

        // -------------------------
        // PLAY CARD (broadcast only)
        // -------------------------
        if (msg.type === "play_card") {

            const code = ws.roomCode;

            if (!code || !gameState[code]) return;

            const state = gameState[code];

            const hand = state.hands[ws.playerId];

            if (!hand) return;

            const cardIndex = hand.indexOf(msg.card);

            // card not in hand = reject
            if (cardIndex === -1) {
                console.log("Rejected play:", msg.card);
                return;
            }

            // remove from hand
            hand.splice(cardIndex, 1);

            // add to discard pile
            state.discardPile.push(msg.card);

            console.log(
                ws.playerId,
                "played",
                msg.card,
                "discard size:",
                state.discardPile.length
            );

            // tell everybody
            for (let client of rooms[code]) {
                client.send(JSON.stringify({
                    type: "played_card",
                    card: msg.card,
                    slot: msg.slot,
                    playerId: ws.playerId
                }));
            }
        }

        // -------------------------
        // END TURN
        // -------------------------
        if (msg.type === "end_turn") {
            const code = ws.roomCode;
            const room = rooms[code];
            const state = gameState[code];

            if (!code || !room) return;

            // only allow current player
            const currentPlayer = room[state.turnIndex];
            if (currentPlayer !== ws) return;

            const nextPlayer = nextTurn(code);

            for (let client of room) {
                client.send(JSON.stringify({
                    type: "turn_changed",
                    playerId: nextPlayer.playerId
                }));
            }
        }
    });

    // --------------------
    // DISCONNECT
    // --------------------
    ws.on("close", () => {
        const code = ws.roomCode;
        if (!code || !rooms[code]) return;

        rooms[code] = rooms[code].filter(p => p !== ws);

        if (rooms[code].length === 0) {
            delete rooms[code];
            delete gameState[code];
            console.log("Deleted empty room:", code);
        }
    });
});
