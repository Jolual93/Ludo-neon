const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = { players: {}, started: false };
  }
  return rooms[roomId];
}

io.on('connection', (socket) => {
  console.log('Conectado:', socket.id);

  socket.on('join_room', ({ roomId, playerName, color }) => {
    const room = getOrCreateRoom(roomId);
    const takenColors = Object.values(room.players).map(p => p.color);
    if (takenColors.includes(color)) {
      socket.emit('join_error', `El color ${color} ya está ocupado.`);
      return;
    }
    socket.join(roomId);
    socket.roomId = roomId;
    socket.playerColor = color;
    room.players[socket.id] = { color, name: playerName, ready: false };
    io.to(roomId).emit('room_update', {
      players: Object.values(room.players),
      started: room.started
    });
  });

  socket.on('player_ready', () => {
    const room = rooms[socket.roomId];
    if (!room || !room.players[socket.id]) return;
    room.players[socket.id].ready = true;
    const allReady = Object.values(room.players).every(p => p.ready);
    const playerCount = Object.keys(room.players).length;
    io.to(socket.roomId).emit('room_update', {
      players: Object.values(room.players),
      started: room.started
    });
    if (allReady && playerCount >= 2) {
      room.started = true;
      const colorList = Object.values(room.players).map(p => p.color);
      io.to(socket.roomId).emit('game_start', { colors: colorList });
    }
  });

  socket.on('roll_dice', ({ roomId, result }) => {
    socket.to(roomId).emit('opponent_rolled', { color: socket.playerColor, result });
  });

  socket.on('move_token', ({ roomId, tokenIndex, steps, color }) => {
    socket.to(roomId).emit('opponent_moved', { tokenIndex, steps, color });
  });

  socket.on('use_skill', ({ roomId, color }) => {
    socket.to(roomId).emit('opponent_skill', { color });
  });

  socket.on('sync_state', ({ roomId, gameState }) => {
    if (rooms[roomId]) {
      rooms[roomId].gameState = gameState;
      socket.to(roomId).emit('state_synced', gameState);
    }
  });

  socket.on('chat_msg', ({ roomId, name, text }) => {
    io.to(roomId).emit('chat_msg', { name, text });
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.roomId];
    if (room) {
      const playerName = room.players[socket.id]?.name || 'Alguien';
      delete room.players[socket.id];
      io.to(socket.roomId).emit('player_disconnected', {
        name: playerName,
        players: Object.values(room.players)
      });
      if (Object.keys(room.players).length === 0) {
        delete rooms[socket.roomId];
      }
    }
    console.log('Desconectado:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
