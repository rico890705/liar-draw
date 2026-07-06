// ─────────────────────────────────────────────────────────────
//  라이어 그림 게임 - 실시간 멀티플레이 서버
//  Express + Socket.IO
// ─────────────────────────────────────────────────────────────
const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

// ── 제시어 은행 ────────────────────────────────────────────────
const WORD_BANK = {
  "동물": ["코끼리", "기린", "펭귄", "판다", "사자", "고래", "다람쥐", "부엉이", "악어", "캥거루", "고슴도치", "문어"],
  "음식": ["김치찌개", "피자", "떡볶이", "초밥", "햄버거", "라면", "치킨", "삼겹살", "비빔밥", "아이스크림", "탕수육", "김밥"],
  "영화": ["타이타닉", "어벤져스", "겨울왕국", "기생충", "인터스텔라", "라이온킹", "해리포터", "명량", "알라딘", "인셉션"],
  "직업": ["의사", "소방관", "요리사", "경찰", "가수", "화가", "선생님", "운동선수", "우주비행사", "미용사", "판사", "농부"],
  "장소": ["학교", "병원", "놀이공원", "해수욕장", "도서관", "공항", "동물원", "찜질방", "노래방", "캠핑장", "박물관", "카페"],
  "물건": ["우산", "안경", "자전거", "냉장고", "핸드폰", "칫솔", "시계", "가위", "베개", "선풍기", "지갑", "청소기"],
  "스포츠": ["축구", "농구", "야구", "수영", "태권도", "볼링", "스키", "테니스", "양궁", "골프", "배드민턴", "복싱"],
};
const CATEGORIES = Object.keys(WORD_BANK);

// ── 방 상태 저장소 ─────────────────────────────────────────────
const rooms = {}; // code -> room

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms[code]);
  return code;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 클라이언트에 보낼 안전한 방 요약 (정답/라이어 정보 제외)
function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    category: room.category,
    round: room.round,
    totalRounds: room.totalRounds,
    currentDrawerId: room.turnOrder ? room.turnOrder[room.currentTurnIndex] : null,
    turnNumber: room.currentTurnIndex != null ? room.currentTurnIndex + 1 : null,
    turnTotal: room.turnOrder ? room.turnOrder.length : null,
    confirmedCount: room.confirmedCount,
    voteCount: room.votes ? Object.keys(room.votes).length : 0,
    players: room.players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      ready: p.ready,
      connected: p.connected,
      isHost: p.id === room.hostId,
      confirmed: room.confirmedSet ? room.confirmedSet.has(p.id) : false,
      hasVoted: room.votes ? room.votes[p.id] != null : false,
    })),
  };
}

function activePlayers(room) {
  return room.players.filter((p) => p.connected);
}

function broadcastRoom(room) {
  io.to(room.code).emit("roomUpdate", publicRoom(room));
}

function getPlayer(room, id) {
  return room.players.find((p) => p.id === id);
}

// ── 게임 흐름 제어 ─────────────────────────────────────────────
function startGame(room, category) {
  const players = activePlayers(room);
  if (players.length < 3) return;

  room.category = category && WORD_BANK[category] ? category : CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const words = WORD_BANK[room.category];
  room.word = words[Math.floor(Math.random() * words.length)];

  // 라이어 한 명 랜덤 지정
  const liar = players[Math.floor(Math.random() * players.length)];
  room.liarId = liar.id;

  // 그리기 순서 (섞기), 2바퀴
  room.totalRounds = 2;
  const seatOrder = shuffle(players.map((p) => p.id));
  room.turnOrder = [];
  for (let r = 0; r < room.totalRounds; r++) room.turnOrder.push(...seatOrder);
  room.currentTurnIndex = 0;
  room.round = 1;

  room.canvasHistory = []; // 누적 그림 (한 캔버스 공유)
  room.confirmedSet = new Set();
  room.confirmedCount = 0;
  room.votes = {};
  room.phase = "reveal";

  // 각자에게 역할 개별 전송
  room.players.forEach((p) => {
    if (!p.connected) return;
    if (p.id === room.liarId) {
      io.to(p.socketId).emit("yourRole", { isLiar: true, category: room.category, word: null });
    } else {
      io.to(p.socketId).emit("yourRole", { isLiar: false, category: room.category, word: room.word });
    }
  });

  broadcastRoom(room);
}

function beginDrawing(room) {
  room.phase = "drawing";
  room.currentTurnIndex = 0;
  room.round = 1;
  broadcastRoom(room);
  announceTurn(room);
}

function announceTurn(room) {
  const drawerId = room.turnOrder[room.currentTurnIndex];
  const drawer = getPlayer(room, drawerId);
  const n = activePlayers(room).length || 1;
  room.round = Math.floor(room.currentTurnIndex / n) + 1;
  io.to(room.code).emit("turnUpdate", {
    currentDrawerId: drawerId,
    drawerName: drawer ? drawer.nickname : "?",
    round: room.round,
    totalRounds: room.totalRounds,
    turnNumber: room.currentTurnIndex + 1,
    turnTotal: room.turnOrder.length,
  });
  broadcastRoom(room);
}

function nextTurn(room) {
  room.currentTurnIndex++;
  if (room.currentTurnIndex >= room.turnOrder.length) {
    beginVoting(room);
  } else {
    announceTurn(room);
  }
}

function beginVoting(room) {
  room.phase = "voting";
  room.votes = {};
  io.to(room.code).emit("votingStart");
  broadcastRoom(room);
}

function tallyVotes(room) {
  const counts = {};
  Object.values(room.votes).forEach((target) => {
    counts[target] = (counts[target] || 0) + 1;
  });
  let max = 0;
  let leaders = [];
  Object.entries(counts).forEach(([id, c]) => {
    if (c > max) {
      max = c;
      leaders = [id];
    } else if (c === max) {
      leaders.push(id);
    }
  });

  const breakdown = room.players
    .filter((p) => counts[p.id])
    .map((p) => ({ id: p.id, nickname: p.nickname, votes: counts[p.id] }))
    .sort((a, b) => b.votes - a.votes);

  // 동점이면 시민들이 라이어 특정 실패 → 라이어 승
  if (leaders.length !== 1) {
    finishGame(room, { accusedId: null, tie: true, winner: "liar", breakdown });
    return;
  }

  const accusedId = leaders[0];
  if (accusedId === room.liarId) {
    // 라이어 지목됨 → 정답 맞추기 기회
    room.phase = "liarGuess";
    room.pendingBreakdown = breakdown;
    const liar = getPlayer(room, room.liarId);
    const options = shuffle(WORD_BANK[room.category]).slice(0, 6);
    if (!options.includes(room.word)) {
      options[Math.floor(Math.random() * options.length)] = room.word;
    }
    io.to(room.code).emit("liarCaught", {
      liarId: room.liarId,
      liarName: liar ? liar.nickname : "?",
      breakdown,
    });
    if (liar && liar.connected) {
      io.to(liar.socketId).emit("liarGuessPrompt", { options: shuffle(options) });
    }
    broadcastRoom(room);
  } else {
    // 시민이 지목됨 → 라이어 최종 승리
    finishGame(room, { accusedId, tie: false, winner: "liar", breakdown });
  }
}

function finishGame(room, result) {
  room.phase = "result";
  const liar = getPlayer(room, room.liarId);
  io.to(room.code).emit("gameResult", {
    winner: result.winner, // "liar" | "citizens"
    word: room.word,
    category: room.category,
    liarId: room.liarId,
    liarName: liar ? liar.nickname : "?",
    accusedId: result.accusedId || null,
    tie: !!result.tie,
    liarGuess: result.liarGuess || null,
    breakdown: result.breakdown || room.pendingBreakdown || [],
  });
  broadcastRoom(room);
}

function resetToLobby(room) {
  room.phase = "lobby";
  room.category = null;
  room.word = null;
  room.liarId = null;
  room.turnOrder = null;
  room.currentTurnIndex = null;
  room.round = null;
  room.canvasHistory = [];
  room.confirmedSet = new Set();
  room.confirmedCount = 0;
  room.votes = {};
  room.pendingBreakdown = null;
  room.players.forEach((p) => (p.ready = false));
  io.to(room.code).emit("returnedToLobby");
  broadcastRoom(room);
}

// ── 소켓 이벤트 ───────────────────────────────────────────────
io.on("connection", (socket) => {
  let currentRoom = null;
  let playerId = null;

  function err(message) {
    socket.emit("errorMsg", { message });
  }

  socket.on("createRoom", ({ nickname }) => {
    nickname = (nickname || "").trim().slice(0, 12);
    if (!nickname) return err("닉네임을 입력해 주세요.");
    const code = makeRoomCode();
    playerId = socket.id;
    const room = {
      code,
      hostId: playerId,
      phase: "lobby",
      players: [{ id: playerId, socketId: socket.id, nickname, ready: false, connected: true }],
      canvasHistory: [],
    };
    rooms[code] = room;
    currentRoom = room;
    socket.join(code);
    socket.emit("joined", { roomCode: code, playerId });
    broadcastRoom(room);
  });

  socket.on("joinRoom", ({ nickname, roomCode }) => {
    nickname = (nickname || "").trim().slice(0, 12);
    roomCode = (roomCode || "").trim().toUpperCase();
    if (!nickname) return err("닉네임을 입력해 주세요.");
    const room = rooms[roomCode];
    if (!room) return err("그런 방이 없어요. 코드를 확인해 주세요.");
    if (room.phase !== "lobby") return err("이미 게임이 진행 중인 방이에요.");
    if (room.players.filter((p) => p.connected).length >= 10) return err("방이 가득 찼어요 (최대 10명).");
    if (room.players.some((p) => p.connected && p.nickname === nickname))
      return err("같은 닉네임이 이미 있어요.");

    playerId = socket.id;
    room.players.push({ id: playerId, socketId: socket.id, nickname, ready: false, connected: true });
    currentRoom = room;
    socket.join(roomCode);
    socket.emit("joined", { roomCode, playerId });
    broadcastRoom(room);
  });

  socket.on("toggleReady", () => {
    if (!currentRoom || currentRoom.phase !== "lobby") return;
    const p = getPlayer(currentRoom, playerId);
    if (p) p.ready = !p.ready;
    broadcastRoom(currentRoom);
  });

  socket.on("startGame", ({ category }) => {
    if (!currentRoom || currentRoom.phase !== "lobby") return;
    if (playerId !== currentRoom.hostId) return err("방장만 시작할 수 있어요.");
    const players = activePlayers(currentRoom);
    if (players.length < 3) return err("최소 3명이 필요해요.");
    if (!players.every((p) => p.ready || p.id === currentRoom.hostId))
      return err("모두 READY 해야 시작할 수 있어요.");
    startGame(currentRoom, category);
  });

  socket.on("confirmWord", () => {
    if (!currentRoom || currentRoom.phase !== "reveal") return;
    currentRoom.confirmedSet.add(playerId);
    currentRoom.confirmedCount = currentRoom.confirmedSet.size;
    broadcastRoom(currentRoom);
    if (currentRoom.confirmedCount >= activePlayers(currentRoom).length) {
      beginDrawing(currentRoom);
    }
  });

  // 실시간 그림: 현재 차례 플레이어만 그릴 수 있음
  socket.on("draw", (seg) => {
    if (!currentRoom || currentRoom.phase !== "drawing") return;
    if (currentRoom.turnOrder[currentRoom.currentTurnIndex] !== playerId) return;
    currentRoom.canvasHistory.push(seg);
    socket.to(currentRoom.code).emit("draw", seg);
  });

  socket.on("endTurn", () => {
    if (!currentRoom || currentRoom.phase !== "drawing") return;
    if (currentRoom.turnOrder[currentRoom.currentTurnIndex] !== playerId) return;
    nextTurn(currentRoom);
  });

  socket.on("requestCanvas", () => {
    if (!currentRoom) return;
    socket.emit("canvasHistory", currentRoom.canvasHistory || []);
  });

  socket.on("vote", ({ targetId }) => {
    if (!currentRoom || currentRoom.phase !== "voting") return;
    if (!getPlayer(currentRoom, targetId)) return;
    currentRoom.votes[playerId] = targetId;
    broadcastRoom(currentRoom);
    if (Object.keys(currentRoom.votes).length >= activePlayers(currentRoom).length) {
      tallyVotes(currentRoom);
    }
  });

  socket.on("liarGuess", ({ guess }) => {
    if (!currentRoom || currentRoom.phase !== "liarGuess") return;
    if (playerId !== currentRoom.liarId) return;
    const correct = guess === currentRoom.word;
    finishGame(currentRoom, {
      accusedId: currentRoom.liarId,
      winner: correct ? "liar" : "citizens",
      liarGuess: guess,
      breakdown: currentRoom.pendingBreakdown,
    });
  });

  socket.on("playAgain", () => {
    if (!currentRoom) return;
    if (playerId !== currentRoom.hostId) return err("방장만 다시 시작할 수 있어요.");
    resetToLobby(currentRoom);
  });

  socket.on("leaveRoom", () => handleLeave());

  socket.on("disconnect", () => handleLeave());

  function handleLeave() {
    if (!currentRoom) return;
    const room = currentRoom;
    const p = getPlayer(room, playerId);
    if (p) p.connected = false;

    const remaining = activePlayers(room);
    if (remaining.length === 0) {
      delete rooms[room.code];
      currentRoom = null;
      return;
    }

    // 방장이 나가면 다음 사람에게 위임
    if (room.hostId === playerId) {
      room.hostId = remaining[0].id;
    }

    // 게임 도중 이탈 처리
    if (room.phase !== "lobby" && room.phase !== "result") {
      if (remaining.length < 2) {
        io.to(room.code).emit("gameAborted", { reason: "인원이 부족해 게임을 종료했어요." });
        resetToLobby(room);
      } else if (room.phase === "drawing" && room.turnOrder[room.currentTurnIndex] === playerId) {
        // 현재 그리는 사람이 나감 → 다음 차례로
        nextTurn(room);
      } else if (room.phase === "reveal") {
        if (room.confirmedSet.size >= remaining.length) beginDrawing(room);
      } else if (room.phase === "voting") {
        if (Object.keys(room.votes).length >= remaining.length) tallyVotes(room);
      }
    }

    broadcastRoom(room);
    currentRoom = null;
  }
});

server.listen(PORT, () => {
  console.log(`\n🎨  라이어 그림 게임 서버 실행 중`);
  console.log(`    ➜  http://localhost:${PORT}\n`);
});
