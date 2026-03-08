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

function getRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      slots: [],        // [{ socketId, color, disconnectTimer }]
      started: false,
      config: null,
      gameState: null
    };
  }
  return rooms[roomId];
}

io.on('connection', (socket) => {
  console.log('Conectado:', socket.id);

  socket.on('join_room', ({ roomId, rejoinColor }) => {
    const room = getRoom(roomId);
    socket.join(roomId);
    socket.roomId = roomId;

    // Reconexion: cliente pide recuperar su color
    if (room.started && rejoinColor) {
      const slot = room.slots.find(s => s.color === rejoinColor && s.socketId === null);
      if (slot) {
        if (slot.disconnectTimer) { clearTimeout(slot.disconnectTimer); slot.disconnectTimer = null; }
        slot.socketId = socket.id;
        socket.playerColor = rejoinColor;
        socket.emit('game_start', { config: room.config, yourColor: rejoinColor, isRejoin: true });
        if (room.gameState) socket.emit('state_sync', room.gameState);
        io.to(roomId).emit('player_reconnected', { color: rejoinColor });
        console.log('Reconectado:', rejoinColor, 'sala:', roomId);
        return;
      }
    }

    // Partida ya iniciada - buscar slot libre
    if (room.started && room.config) {
      const freeSlot = room.slots.find(s => s.socketId === null && s.color !== null);
      if (freeSlot) {
        if (freeSlot.disconnectTimer) { clearTimeout(freeSlot.disconnectTimer); freeSlot.disconnectTimer = null; }
        freeSlot.socketId = socket.id;
        socket.playerColor = freeSlot.color;
        socket.emit('game_start', { config: room.config, yourColor: freeSlot.color, isRejoin: true });
        if (room.gameState) socket.emit('state_sync', room.gameState);
        io.to(roomId).emit('player_reconnected', { color: freeSlot.color });
      } else {
        socket.emit('game_start', { config: room.config, yourColor: null });
      }
      return;
    }

    // Sala en espera
    const isHost = room.slots.length === 0;
    room.slots.push({ socketId: socket.id, color: null, disconnectTimer: null });
    socket.emit('room_joined', { isHost, playerCount: room.slots.length });
    io.to(roomId).emit('room_update', { playerCount: room.slots.length });
  });

  socket.on('host_start', ({ roomId, config }) => {
    const room = rooms[roomId];
    if (!room || room.slots[0].socketId !== socket.id) return;
    room.started = true;
    room.config = config;
    const humanColors = Object.entries(config).filter(([,v])=>v.status==='human').map(([c])=>c);
    room.slots.forEach((slot, i) => {
      slot.color = humanColors[i] || null;
      if (slot.socketId) {
        io.to(slot.socketId).emit('game_start', { config, yourColor: slot.color, isRejoin: false });
      }
    });
    console.log('Partida iniciada sala:', roomId);
  });

  socket.on('sync_state', ({ roomId, gameState }) => {
    if (rooms[roomId]) rooms[roomId].gameState = gameState;
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

  socket.on('disconnect', () => {
    const room = rooms[socket.roomId];
    if (room) {
      const slot = room.slots.find(s => s.socketId === socket.id);
      if (slot) {
        slot.socketId = null;
        const savedColor = slot.color;
        // Avisar a todos: tiene 30 segundos para volver
        io.to(socket.roomId).emit('player_disconnected', { color: savedColor, seconds: 30 });
        // Timer: si no vuelve en 30s, la IA toma su lugar
        slot.disconnectTimer = setTimeout(() => {
          slot.color = null;
          io.to(socket.roomId).emit('player_abandoned', { color: savedColor });
          console.log('Jugador abandonó sala:', socket.roomId, 'color:', savedColor);
        }, 30000);
      }
      // Limpiar sala si todos se fueron por 2 minutos
      const anyActive = room.slots.some(s => s.socketId !== null);
      if (!anyActive) {
        setTimeout(() => {
          if (rooms[socket.roomId] && room.slots.every(s => s.socketId === null)) {
            delete rooms[socket.roomId];
            console.log('Sala eliminada:', socket.roomId);
          }
        }, 120000);
      }
    }
    console.log('Desconectado:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor Ludo corriendo en puerto ${PORT}`));
