// ─────────────────────────────────────────────────────────────
//  라이어 그림 게임 - 실시간 멀티플레이 서버
//  Express + Socket.IO  (안정적 playerKey 식별 + 재연결 지원)
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
const GRACE_MS = 40000; // 재연결 유예 시간
const TURN_SECONDS = 30; // 한 사람당 그리기 제한 시간
const MAX_STROKES = 3;   // 한 턴에 그릴 수 있는 획 수

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
const socketToKey = {}; // socket.id -> { code, key }

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

function getPlayer(room, key) {
  return room.players.find((p) => p.key === key);
}
function activePlayers(room) {
  return room.players.filter((p) => p.connected);
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
    confirmedCount: room.confirmedSet ? room.confirmedSet.size : 0,
    voteCount: room.votes ? Object.keys(room.votes).length : 0,
    players: room.players.map((p) => ({
      id: p.key,
      nickname: p.nickname,
      ready: p.ready,
      connected: p.connected,
      isHost: p.key === room.hostId,
      confirmed: room.confirmedSet ? room.confirmedSet.has(p.key) : false,
      hasVoted: room.votes ? room.votes[p.key] != null : false,
    })),
  };
}

function broadcastRoom(room) {
  io.to(room.code).emit("roomUpdate", publicRoom(room));
}

// 채팅 메시지 저장 + 전송 (대기방/게임 어디서든 동작)
function pushChat(room, msg) {
  if (!room.chat) room.chat = [];
  msg.ts = Date.now();
  room.chat.push(msg);
  if (room.chat.length > 80) room.chat.shift(); // 최근 80개만 보관
  io.to(room.code).emit("chatMessage", msg);
}

// ── 게임 흐름 ─────────────────────────────────────────────────
function startGame(room, category) {
  const players = activePlayers(room);
  if (players.length < 3) return;

  room.category = category && WORD_BANK[category] ? category : CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const words = WORD_BANK[room.category];
  room.word = words[Math.floor(Math.random() * words.length)];

  const liar = players[Math.floor(Math.random() * players.length)];
  room.liarId = liar.key;

  room.totalRounds = 2;
  const seatOrder = shuffle(players.map((p) => p.key));
  room.turnOrder = [];
  for (let r = 0; r < room.totalRounds; r++) room.turnOrder.push(...seatOrder);
  room.currentTurnIndex = 0;
  room.round = 1;

  room.canvasHistory = [];
  room.confirmedSet = new Set();
  room.votes = {};
  room.pendingBreakdown = null;
  room.lastResult = null;
  room.phase = "reveal";

  broadcastRoom(room); // 먼저 화면을 제시어 확인 단계로 전환
  room.players.forEach((p) => sendRole(room, p)); // 그다음 각자 역할 카드 전달
}

function sendRole(room, p) {
  if (!p.connected || !p.socketId) return;
  if (p.key === room.liarId) io.to(p.socketId).emit("yourRole", { isLiar: true, category: room.category, word: null });
  else io.to(p.socketId).emit("yourRole", { isLiar: false, category: room.category, word: room.word });
}

function beginDrawing(room) {
  room.phase = "drawing";
  room.currentTurnIndex = 0;
  room.round = 1;
  broadcastRoom(room);
  announceTurn(room);
}

function clearTurnTimer(room) {
  if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
}

function announceTurn(room) {
  const drawerId = room.turnOrder[room.currentTurnIndex];
  const drawer = getPlayer(room, drawerId);
  const n = activePlayers(room).length || 1;
  room.round = Math.floor(room.currentTurnIndex / n) + 1;

  // 이 턴 상태 초기화
  clearTurnTimer(room);
  room.strokesUsed = 0;
  room.strokeRejected = false;
  room.turnDeadline = Date.now() + TURN_SECONDS * 1000;
  room.turnTimer = setTimeout(() => {
    // 시간 초과 → 자동으로 다음 사람
    if (room.phase === "drawing" && room.turnOrder[room.currentTurnIndex] === drawerId) {
      nextTurn(room);
    }
  }, TURN_SECONDS * 1000);

  io.to(room.code).emit("turnUpdate", {
    currentDrawerId: drawerId,
    drawerName: drawer ? drawer.nickname : "?",
    round: room.round,
    totalRounds: room.totalRounds,
    deadline: room.turnDeadline,
    maxStrokes: MAX_STROKES,
    strokesUsed: 0,
  });
  broadcastRoom(room);
}

function nextTurn(room) {
  clearTurnTimer(room);
  room.currentTurnIndex++;
  if (room.currentTurnIndex >= room.turnOrder.length) beginVoting(room);
  else announceTurn(room);
}

function beginVoting(room) {
  clearTurnTimer(room);
  room.phase = "voting";
  room.votes = {};
  io.to(room.code).emit("votingStart");
  broadcastRoom(room);
}

function tallyVotes(room) {
  const counts = {};
  Object.values(room.votes).forEach((t) => (counts[t] = (counts[t] || 0) + 1));
  let max = 0;
  let leaders = [];
  Object.entries(counts).forEach(([id, c]) => {
    if (c > max) { max = c; leaders = [id]; }
    else if (c === max) leaders.push(id);
  });

  const breakdown = room.players
    .filter((p) => counts[p.key])
    .map((p) => ({ id: p.key, nickname: p.nickname, votes: counts[p.key] }))
    .sort((a, b) => b.votes - a.votes);

  if (leaders.length !== 1) {
    finishGame(room, { accusedId: null, tie: true, winner: "liar", breakdown });
    return;
  }
  const accusedId = leaders[0];
  if (accusedId === room.liarId) {
    room.phase = "liarGuess";
    room.pendingBreakdown = breakdown;
    const liar = getPlayer(room, room.liarId);
    let options = shuffle(WORD_BANK[room.category]).slice(0, 6);
    if (!options.includes(room.word)) options[Math.floor(Math.random() * options.length)] = room.word;
    room.liarOptions = shuffle(options);
    io.to(room.code).emit("liarCaught", { liarId: room.liarId, liarName: liar ? liar.nickname : "?", breakdown });
    if (liar && liar.connected && liar.socketId) io.to(liar.socketId).emit("liarGuessPrompt", { options: room.liarOptions });
    broadcastRoom(room);
  } else {
    finishGame(room, { accusedId, tie: false, winner: "liar", breakdown });
  }
}

function finishGame(room, result) {
  clearTurnTimer(room);
  room.phase = "result";
  const liar = getPlayer(room, room.liarId);
  const payload = {
    winner: result.winner,
    word: room.word,
    category: room.category,
    liarId: room.liarId,
    liarName: liar ? liar.nickname : "?",
    accusedId: result.accusedId || null,
    tie: !!result.tie,
    liarGuess: result.liarGuess || null,
    breakdown: result.breakdown || room.pendingBreakdown || [],
  };
  room.lastResult = payload;
  io.to(room.code).emit("gameResult", payload);
  broadcastRoom(room);
}

function resetToLobby(room) {
  clearTurnTimer(room);
  room.phase = "lobby";
  room.category = null; room.word = null; room.liarId = null;
  room.turnOrder = null; room.currentTurnIndex = null; room.round = null;
  room.canvasHistory = []; room.confirmedSet = new Set(); room.votes = {};
  room.pendingBreakdown = null; room.lastResult = null; room.liarOptions = null;
  room.players.forEach((p) => (p.ready = false));
  io.to(room.code).emit("returnedToLobby");
  broadcastRoom(room);
}

// 재연결한 소켓에게 현재 상태 다시 보내주기
function resync(room, p) {
  const s = p.socketId;
  if (!s) return;
  io.to(s).emit("roomUpdate", publicRoom(room));
  if (room.phase === "reveal") {
    sendRole(room, p);
  } else if (room.phase === "drawing") {
    sendRole(room, p);
    const drawer = getPlayer(room, room.turnOrder[room.currentTurnIndex]);
    io.to(s).emit("turnUpdate", {
      currentDrawerId: room.turnOrder[room.currentTurnIndex],
      drawerName: drawer ? drawer.nickname : "?",
      round: room.round, totalRounds: room.totalRounds,
      deadline: room.turnDeadline,
      maxStrokes: MAX_STROKES,
      strokesUsed: room.strokesUsed || 0,
    });
    io.to(s).emit("canvasHistory", room.canvasHistory || []);
  } else if (room.phase === "voting") {
    io.to(s).emit("votingStart");
  } else if (room.phase === "liarGuess") {
    const liar = getPlayer(room, room.liarId);
    io.to(s).emit("liarCaught", { liarId: room.liarId, liarName: liar ? liar.nickname : "?", breakdown: room.pendingBreakdown || [] });
    if (p.key === room.liarId && room.liarOptions) io.to(s).emit("liarGuessPrompt", { options: room.liarOptions });
  } else if (room.phase === "result" && room.lastResult) {
    io.to(s).emit("gameResult", room.lastResult);
  }
}

// ── 소켓 이벤트 ───────────────────────────────────────────────
io.on("connection", (socket) => {
  function err(message) { socket.emit("errorMsg", { message }); }

  function bind(room, key) {
    socketToKey[socket.id] = { code: room.code, key };
    socket.join(room.code);
  }

  // 방 만들기 / 참가 / 재연결을 하나로 처리
  function enter({ nickname, roomCode, playerKey, mode }) {
    nickname = (nickname || "").trim().slice(0, 12);
    playerKey = (playerKey || "").trim();
    if (!playerKey) return err("연결에 문제가 있어요. 새로고침해 주세요.");

    if (mode === "create") {
      if (!nickname) return err("닉네임을 입력해 주세요.");
      const code = makeRoomCode();
      const room = { code, hostId: playerKey, phase: "lobby", players: [], canvasHistory: [], chat: [] };
      rooms[code] = room;
      room.players.push({ key: playerKey, socketId: socket.id, nickname, ready: false, connected: true });
      bind(room, playerKey);
      socket.emit("joined", { roomCode: code, playerId: playerKey });
      socket.emit("chatHistory", room.chat);
      broadcastRoom(room);
      pushChat(room, { type: "system", text: `${nickname} 님이 방을 만들었어요` });
      return;
    }

    // join 또는 rejoin
    roomCode = (roomCode || "").trim().toUpperCase();
    const room = rooms[roomCode];
    if (!room) return socket.emit("rejoinFailed", { message: "그런 방이 없어요. 코드를 확인해 주세요." });

    const existing = getPlayer(room, playerKey);
    if (existing) {
      // 재연결: 기존 자리 복구
      if (existing.disconnectTimer) { clearTimeout(existing.disconnectTimer); existing.disconnectTimer = null; }
      existing.socketId = socket.id;
      existing.connected = true;
      if (nickname) existing.nickname = nickname;
      bind(room, playerKey);
      socket.emit("joined", { roomCode: room.code, playerId: playerKey });
      socket.emit("chatHistory", room.chat || []);
      resync(room, existing);
      broadcastRoom(room);
      return;
    }

    // 새 참가는 대기실에서만
    if (room.phase !== "lobby") return socket.emit("rejoinFailed", { message: "이미 게임이 진행 중인 방이에요." });
    if (activePlayers(room).length >= 10) return err("방이 가득 찼어요 (최대 10명).");
    if (!nickname) return err("닉네임을 입력해 주세요.");
    if (room.players.some((p) => p.connected && p.nickname === nickname)) return err("같은 닉네임이 이미 있어요.");

    room.players.push({ key: playerKey, socketId: socket.id, nickname, ready: false, connected: true });
    bind(room, playerKey);
    socket.emit("joined", { roomCode: room.code, playerId: playerKey });
    socket.emit("chatHistory", room.chat || []);
    broadcastRoom(room);
    pushChat(room, { type: "system", text: `${nickname} 님이 입장했어요` });
  }

  function ctx() {
    const info = socketToKey[socket.id];
    if (!info) return null;
    const room = rooms[info.code];
    if (!room) return null;
    return { room, key: info.key };
  }

  socket.on("createRoom", (d) => enter({ ...d, mode: "create" }));
  socket.on("joinRoom", (d) => enter({ ...d, mode: "join" }));
  socket.on("rejoinRoom", (d) => enter({ ...d, mode: "join" }));

  socket.on("toggleReady", () => {
    const c = ctx(); if (!c || c.room.phase !== "lobby") return;
    const p = getPlayer(c.room, c.key);
    if (p) p.ready = !p.ready;
    broadcastRoom(c.room);
  });

  socket.on("startGame", ({ category } = {}) => {
    const c = ctx(); if (!c || c.room.phase !== "lobby") return;
    if (c.key !== c.room.hostId) return err("방장만 시작할 수 있어요.");
    const players = activePlayers(c.room);
    if (players.length < 3) return err("최소 3명이 필요해요.");
    if (!players.every((p) => p.ready || p.key === c.room.hostId)) return err("모두 READY 해야 시작할 수 있어요.");
    startGame(c.room, category);
  });

  socket.on("confirmWord", () => {
    const c = ctx(); if (!c || c.room.phase !== "reveal") return;
    c.room.confirmedSet.add(c.key);
    broadcastRoom(c.room);
    if (c.room.confirmedSet.size >= activePlayers(c.room).length) beginDrawing(c.room);
  });

  socket.on("draw", (seg) => {
    const c = ctx(); if (!c || c.room.phase !== "drawing") return;
    if (c.room.turnOrder[c.room.currentTurnIndex] !== c.key) return;
    const room = c.room;
    // 새 획 시작이면 획 수를 세고, 한도를 넘으면 이 획은 무시
    if (seg && seg.newStroke) {
      if ((room.strokesUsed || 0) >= MAX_STROKES) { room.strokeRejected = true; return; }
      room.strokesUsed = (room.strokesUsed || 0) + 1;
      room.strokeRejected = false;
      io.to(room.code).emit("strokeCount", { strokesUsed: room.strokesUsed, maxStrokes: MAX_STROKES });
    } else if (room.strokeRejected) {
      return; // 한도 초과 획의 이어지는 선들도 무시
    }
    room.canvasHistory.push(seg);
    socket.to(room.code).emit("draw", seg);
  });

  socket.on("endTurn", () => {
    const c = ctx(); if (!c || c.room.phase !== "drawing") return;
    if (c.room.turnOrder[c.room.currentTurnIndex] !== c.key) return;
    nextTurn(c.room);
  });

  socket.on("requestCanvas", () => {
    const c = ctx(); if (!c) return;
    socket.emit("canvasHistory", c.room.canvasHistory || []);
  });

  socket.on("vote", ({ targetId } = {}) => {
    const c = ctx(); if (!c || c.room.phase !== "voting") return;
    if (!getPlayer(c.room, targetId)) return;
    c.room.votes[c.key] = targetId;
    broadcastRoom(c.room);
    if (Object.keys(c.room.votes).length >= activePlayers(c.room).length) tallyVotes(c.room);
  });

  socket.on("liarGuess", ({ guess } = {}) => {
    const c = ctx(); if (!c || c.room.phase !== "liarGuess") return;
    if (c.key !== c.room.liarId) return;
    const correct = guess === c.room.word;
    finishGame(c.room, { accusedId: c.room.liarId, winner: correct ? "liar" : "citizens", liarGuess: guess, breakdown: c.room.pendingBreakdown });
  });

  socket.on("playAgain", () => {
    const c = ctx(); if (!c) return;
    if (c.key !== c.room.hostId) return err("방장만 다시 시작할 수 있어요.");
    resetToLobby(c.room);
  });

  socket.on("chat", ({ text } = {}) => {
    const c = ctx(); if (!c) return;
    text = (text || "").toString().replace(/\s+/g, " ").trim().slice(0, 200);
    if (!text) return;
    const p = getPlayer(c.room, c.key);
    if (!p) return;
    pushChat(c.room, { type: "user", key: c.key, nickname: p.nickname, text });
  });

  socket.on("leaveRoom", () => {
    const c = ctx(); if (!c) return;
    removeNow(c.room, c.key);
    delete socketToKey[socket.id];
  });

  socket.on("disconnect", () => {
    const info = socketToKey[socket.id];
    if (!info) return;
    delete socketToKey[socket.id];
    const room = rooms[info.code];
    if (!room) return;
    const p = getPlayer(room, info.key);
    if (!p || p.socketId !== socket.id) return; // 이미 다른 소켓으로 재연결됨
    p.connected = false;
    p.socketId = null;

    // 게임 진행 중이라면 즉시 흐름 보정 (유예와 별개)
    handleInGameDrop(room, info.key);
    broadcastRoom(room);

    // 유예 시간 후에도 안 돌아오면 제거
    p.disconnectTimer = setTimeout(() => {
      const still = getPlayer(room, info.key);
      if (!still || still.connected) return;
      removeNow(room, info.key);
    }, GRACE_MS);
  });

  function handleInGameDrop(room, key) {
    if (room.phase === "lobby" || room.phase === "result") return;
    const remaining = activePlayers(room);
    if (remaining.length < 2) {
      io.to(room.code).emit("gameAborted", { reason: "인원이 부족해 게임을 종료했어요." });
      resetToLobby(room);
    } else if (room.phase === "drawing" && room.turnOrder[room.currentTurnIndex] === key) {
      nextTurn(room);
    } else if (room.phase === "reveal") {
      if (room.confirmedSet.size >= remaining.length) beginDrawing(room);
    } else if (room.phase === "voting") {
      if (Object.keys(room.votes).length >= remaining.length) tallyVotes(room);
    }
  }
});

function removeNow(room, key) {
  const p = getPlayer(room, key);
  if (p && p.disconnectTimer) clearTimeout(p.disconnectTimer);
  const leftName = p ? p.nickname : null;
  room.players = room.players.filter((x) => x.key !== key);

  if (room.players.length === 0) { delete rooms[room.code]; return; }
  const remaining = activePlayers(room);
  if (remaining.length === 0) { delete rooms[room.code]; return; }
  if (room.hostId === key) room.hostId = remaining[0].key;
  if (leftName) pushChat(room, { type: "system", text: `${leftName} 님이 나갔어요` });

  if (room.phase !== "lobby" && room.phase !== "result" && remaining.length < 2) {
    io.to(room.code).emit("gameAborted", { reason: "인원이 부족해 게임을 종료했어요." });
    resetToLobby(room);
    return;
  }
  broadcastRoom(room);
}

server.listen(PORT, () => {
  console.log(`\n🎨  라이어 그림 게임 서버 실행 중`);
  console.log(`    ➜  http://localhost:${PORT}\n`);
});
