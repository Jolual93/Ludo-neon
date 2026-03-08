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

// ──────────────────────────────────────────
//  SALAS
// ──────────────────────────────────────────
const rooms = {};

function getRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      sockets: [],   // lista de socket.id en orden de llegada
      started: false,
      config: null
    };
  }
  return rooms[roomId];
}

io.on('connection', (socket) => {
  console.log('Conectado:', socket.id);

  // ── Unirse a sala ──
  socket.on('join_room', ({ roomId }) => {
    const room = getRoom(roomId);
    socket.join(roomId);
    socket.roomId = roomId;

    if (!room.sockets.includes(socket.id)) {
      room.sockets.push(socket.id);
    }

    const isHost = room.sockets[0] === socket.id;
    socket.isHost = isHost;

    // Si el juego ya empezó y alguien se reconecta, enviarle la config
    if (room.started && room.config) {
      const position = room.sockets.indexOf(socket.id);
      const yourColor = assignColor(room.config, position);
      socket.emit('game_start', { config: room.config, yourColor });
    } else {
      socket.emit('room_joined', {
        isHost,
        playerCount: room.sockets.length
      });
      // Notificar a todos el nuevo conteo
      io.to(roomId).emit('room_update', {
        playerCount: room.sockets.length
      });
    }

    console.log(`Socket ${socket.id} unido a sala ${roomId} (host: ${isHost})`);
  });

  // ── Anfitrión inicia la partida ──
  socket.on('host_start', ({ roomId, config }) => {
    const room = rooms[roomId];
    if (!room || room.sockets[0] !== socket.id) return; // solo el host

    room.started = true;
    room.config = config;

    // Enviar a cada jugador su color asignado
    room.sockets.forEach((sid, index) => {
      const yourColor = assignColor(config, index);
      io.to(sid).emit('game_start', { config, yourColor });
    });

    console.log(`Partida iniciada en sala ${roomId}`);
  });

  // ── Dado ──
  socket.on('roll_dice', ({ roomId, result }) => {
    socket.to(roomId).emit('opponent_rolled', {
      color: getPlayerColor(roomId, socket.id),
      result
    });
  });

  // ── Movimiento ──
  socket.on('move_token', ({ roomId, tokenIndex, steps, color }) => {
    socket.to(roomId).emit('opponent_moved', { tokenIndex, steps, color });
  });

  // ── Habilidad ──
  socket.on('use_skill', ({ roomId, color }) => {
    socket.to(roomId).emit('opponent_skill', { color });
  });

  // ── Desconexión ──
  socket.on('disconnect', () => {
    const room = rooms[socket.roomId];
    if (room) {
      room.sockets = room.sockets.filter(id => id !== socket.id);
      io.to(socket.roomId).emit('player_disconnected', { name: 'Un jugador' });
      io.to(socket.roomId).emit('room_update', { playerCount: room.sockets.length });
      if (room.sockets.length === 0) {
        delete rooms[socket.roomId];
        console.log(`Sala ${socket.roomId} eliminada`);
      }
    }
    console.log('Desconectado:', socket.id);
  });
});

// ──────────────────────────────────────────
//  HELPERS
// ──────────────────────────────────────────

// Asigna un color humano según el orden de llegada del jugador
function assignColor(config, playerIndex) {
  const humanColors = Object.entries(config)
    .filter(([, v]) => v.status === 'human')
    .map(([col]) => col);
  return humanColors[playerIndex] || null;
}

function getPlayerColor(roomId, socketId) {
  const room = rooms[roomId];
  if (!room || !room.config) return null;
  const index = room.sockets.indexOf(socketId);
  return assignColor(room.config, index);
}

// ──────────────────────────────────────────
//  ARRANCAR
// ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor Ludo corriendo en puerto ${PORT}`);
});
