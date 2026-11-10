const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(express.static('public'));

const CANVAS_W = 380;
const CANVAS_H = 540;

let matchmakingQueue = [];
let activeRooms = {};

io.on('connection', (socket) => {
    console.log(`[CONNECT] Игрок подключился: ${socket.id}`);

    socket.on('find_match', (data) => {
        matchmakingQueue = matchmakingQueue.filter(p => p.id !== socket.id);
        matchmakingQueue.push({
            id: socket.id,
            nickname: data.nickname || "Боец",
            trophies: data.trophies || 0,
            deck: data.deck || [],
            cardLevels: data.cardLevels || {}
        });

        checkMatchmaking();
    });

    socket.on('cancel_match', () => {
        matchmakingQueue = matchmakingQueue.filter(p => p.id !== socket.id);
    });

    socket.on('deploy_card', (data) => {
        const roomName = socket.roomId;
        if (!roomName || !activeRooms[roomName]) return;

        const room = activeRooms[roomName];
        const isP1 = socket.id === room.p1.id;
        const targetSocketId = isP1 ? room.p2.id : room.p1.id;
        
        const mirroredX = CANVAS_W - data.x;
        const mirroredY = CANVAS_H - data.y;

        io.to(targetSocketId).emit('enemy_deploy_card', {
            cardId: data.cardId,
            level: data.level,
            x: mirroredX,
            y: mirroredY
        });
    });

    socket.on('match_result', (data) => {
        const roomName = socket.roomId;
        if (!roomName || !activeRooms[roomName]) return;

        const room = activeRooms[roomName];
        if (room.ended) return;
        room.ended = true;

        const winnerId = data.winnerId === 'me' ? socket.id : (socket.id === room.p1.id ? room.p2.id : room.p1.id);
        const loserId = winnerId === room.p1.id ? room.p2.id : room.p1.id;

        const trophyGain = Math.floor(Math.random() * (33 - 25 + 1)) + 25;
        const trophyLoss = Math.floor(Math.random() * (17 - 4 + 1)) + 4;

        io.to(winnerId).emit('game_over', { 
            win: true, 
            trophyChange: trophyGain,
            coinsReward: 50000,
            gemsReward: 10
        });
        
        io.to(loserId).emit('game_over', { 
            win: false, 
            trophyChange: -trophyLoss,
            coinsReward: 0,
            gemsReward: 0
        });

        delete activeRooms[roomName];
    });

    socket.on('disconnect', () => {
        matchmakingQueue = matchmakingQueue.filter(p => p.id !== socket.id);
        const roomName = socket.roomId;
        if (roomName && activeRooms[roomName]) {
            const room = activeRooms[roomName];
            const opponentId = socket.id === room.p1.id ? room.p2.id : room.p1.id;
            const trophyGain = Math.floor(Math.random() * (33 - 25 + 1)) + 25;

            io.to(opponentId).emit('game_over', { 
                win: true, 
                trophyChange: trophyGain,
                coinsReward: 50000,
                gemsReward: 10
            });
            delete activeRooms[roomName];
        }
    });
});

function checkMatchmaking() {
    if (matchmakingQueue.length >= 2) {
        const p1 = matchmakingQueue.shift();
        const p2 = matchmakingQueue.shift();
        const roomName = `room_${p1.id}_${p2.id}`;

        const s1 = io.sockets.sockets.get(p1.id);
        const s2 = io.sockets.sockets.get(p2.id);

        if (s1 && s2) {
            s1.roomId = roomName;
            s2.roomId = roomName;
            s1.join(roomName);
            s2.join(roomName);

            activeRooms[roomName] = { p1, p2, ended: false };

            s1.emit('match_found', { opponentNickname: p2.nickname, opponentTrophies: p2.trophies });
            s2.emit('match_found', { opponentNickname: p1.nickname, opponentTrophies: p1.trophies });
        }
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));