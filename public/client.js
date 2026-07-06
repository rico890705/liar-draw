/* 라이어 그림 게임 - 클라이언트 */
const socket = io({ reconnection: true, reconnectionDelay: 600 });

// ── 안정적 식별자 (탭마다 고유, 새로고침/재연결에도 유지) ──
function getKey() {
  let k = sessionStorage.getItem("liarKey");
  if (!k) {
    k = (crypto.randomUUID && crypto.randomUUID()) || (Date.now() + "-" + Math.random().toString(36).slice(2));
    sessionStorage.setItem("liarKey", k);
  }
  return k;
}
const PLAYER_KEY = getKey();

// ── 상태 ──
let myId = null;
let roomCode = sessionStorage.getItem("liarRoom") || null;
let myNick = sessionStorage.getItem("liarNick") || "";
let joinedRoom = !!roomCode; // 새로고침 후에도 방으로 자동 복귀
let state = null;
let myRole = null;
let connected = false;
let joinTimer = null;
const AVATAR_COLORS = ["#ff5c5c", "#4c7dff", "#ffc93c", "#23c9a0", "#a66bff", "#ff8c42", "#e05fa0", "#5bc0eb"];

const $ = (id) => document.getElementById(id);
const screens = ["login", "lobby", "reveal", "draw", "vote", "guess", "result"];
function show(name) { screens.forEach((s) => $("screen-" + s).classList.toggle("active", s === name)); }
let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}
function avatarColor(id) { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length; return AVATAR_COLORS[h]; }
function initial(name) { return (name || "?").trim().charAt(0).toUpperCase(); }
function escapeHtml(s) { return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function isHost() { return state && state.hostId === myId; }

// ── 연결 상태에 따라 로그인 버튼 잠금 ──
function setLoginEnabled(on) {
  $("btn-create").disabled = !on;
  $("btn-join").disabled = !on;
  $("btn-create").textContent = on ? "방 만들기" : "서버 연결 중…";
}
setLoginEnabled(false);

socket.on("connect", () => {
  connected = true;
  setLoginEnabled(true);
  // 이미 방에 있었다면 자동 복귀
  if (joinedRoom && roomCode) {
    socket.emit("rejoinRoom", { nickname: myNick, roomCode, playerKey: PLAYER_KEY });
  }
});
socket.on("disconnect", () => {
  connected = false;
  if (!joinedRoom) setLoginEnabled(false);
  else toast("연결이 끊겼어요. 다시 연결 중…");
});
socket.io.on("reconnect", () => { if (joinedRoom) toast("다시 연결됐어요!"); });

// ── 로그인 ──
$("nickname").value = myNick;
$("btn-create").onclick = () => {
  if (!connected) return toast("서버에 연결 중이에요. 잠시만요.");
  const nickname = $("nickname").value.trim();
  if (!nickname) return toast("닉네임을 적어주세요!");
  myNick = nickname; sessionStorage.setItem("liarNick", nickname);
  lockJoin("방 만드는 중…");
  socket.emit("createRoom", { nickname, playerKey: PLAYER_KEY });
};
$("btn-join").onclick = () => {
  if (!connected) return toast("서버에 연결 중이에요. 잠시만요.");
  const nickname = $("nickname").value.trim();
  const code = $("roomCode").value.trim().toUpperCase();
  if (!nickname) return toast("닉네임을 적어주세요!");
  if (code.length !== 4) return toast("방 코드 4자리를 입력하세요.");
  myNick = nickname; sessionStorage.setItem("liarNick", nickname);
  lockJoin("참가하는 중…");
  socket.emit("joinRoom", { nickname, roomCode: code, playerKey: PLAYER_KEY });
};
$("roomCode").addEventListener("input", (e) => (e.target.value = e.target.value.toUpperCase()));

function lockJoin(text) {
  $("btn-create").disabled = true; $("btn-join").disabled = true;
  $("btn-create").textContent = text;
  clearTimeout(joinTimer);
  joinTimer = setTimeout(() => { setLoginEnabled(true); toast("응답이 없어요. 다시 시도해 주세요."); }, 6000);
}

const urlRoom = new URLSearchParams(location.search).get("room");
if (urlRoom && !roomCode) $("roomCode").value = urlRoom.toUpperCase().slice(0, 4);

socket.on("joined", ({ roomCode: code, playerId }) => {
  clearTimeout(joinTimer);
  roomCode = code; myId = playerId; joinedRoom = true;
  sessionStorage.setItem("liarRoom", code);
  $("lobby-code").textContent = code;
  setLoginEnabled(true);
  $("chat-dock").classList.remove("hidden"); // 대기방부터 채팅 표시
});

socket.on("errorMsg", ({ message }) => { clearTimeout(joinTimer); setLoginEnabled(true); toast(message); });
socket.on("rejoinFailed", ({ message }) => {
  clearTimeout(joinTimer);
  joinedRoom = false; roomCode = null;
  sessionStorage.removeItem("liarRoom");
  setLoginEnabled(true);
  show("login");
  if (message) toast(message);
});

// ── 대기실 ──
$("btn-copy").onclick = () => {
  const link = `${location.origin}?room=${roomCode}`;
  navigator.clipboard?.writeText(link).then(() => toast("초대 링크를 복사했어요!"), () => toast("복사 실패 — 코드: " + roomCode));
};
$("btn-ready").onclick = () => socket.emit("toggleReady");
$("btn-start").onclick = () => socket.emit("startGame", { category: selectedCategory });
$("btn-leave-lobby").onclick = () => leaveToHome();

function leaveToHome() {
  socket.emit("leaveRoom");
  joinedRoom = false; roomCode = null;
  sessionStorage.removeItem("liarRoom");
  location.reload();
}

let selectedCategory = null;
const CATEGORIES = ["동물", "음식", "영화", "직업", "장소", "물건", "스포츠"];
function renderCategoryPicker() {
  const box = $("category-picker");
  if (box.dataset.built) return;
  box.dataset.built = "1";
  CATEGORIES.forEach((c) => {
    const chip = document.createElement("button");
    chip.className = "chip"; chip.textContent = c;
    chip.onclick = () => { selectedCategory = c; [...box.children].forEach((el) => el.classList.toggle("selected", el === chip)); };
    box.appendChild(chip);
  });
}

function renderLobby() {
  const list = $("player-list");
  list.innerHTML = "";
  state.players.forEach((p) => {
    const li = document.createElement("li");
    li.className = "player-item" + (p.id === myId ? " me" : "") + (p.connected ? "" : " offline");
    li.innerHTML = `
      <span class="avatar" style="background:${avatarColor(p.id)}">${initial(p.nickname)}</span>
      <span class="pname">${escapeHtml(p.nickname)}${p.id === myId ? " (나)" : ""}</span>
      ${p.isHost ? '<span class="crown">👑</span>' : ""}
      <span class="badge-ready ${p.ready || p.isHost ? "on" : "off"}">${p.isHost ? "방장" : p.ready ? "READY" : "대기"}</span>`;
    list.appendChild(li);
  });

  const iamHost = isHost();
  renderCategoryPicker();
  if (!selectedCategory) {
    selectedCategory = CATEGORIES[0];
    const first = $("category-picker").firstChild;
    if (first) first.classList.add("selected");
  }
  $("host-controls").classList.toggle("hidden", !iamHost);

  const me = state.players.find((p) => p.id === myId);
  $("btn-ready").textContent = me && me.ready ? "READY 취소" : "READY";
  $("btn-ready").classList.toggle("hidden", iamHost);

  const active = state.players.filter((p) => p.connected);
  const allReady = active.every((p) => p.ready || p.isHost);
  const canStart = iamHost && active.length >= 3 && allReady;
  const startBtn = $("btn-start");
  startBtn.classList.toggle("hidden", !iamHost);
  startBtn.disabled = !canStart;
  startBtn.textContent = active.length < 3 ? "3명 필요" : allReady ? "START" : "모두 READY 대기";
}

socket.on("roomUpdate", (room) => {
  state = room;
  if (room.phase === "lobby") { show("lobby"); renderLobby(); }
  else if (room.phase === "reveal") { show("reveal"); $("confirm-progress").textContent = room.confirmedCount || 0; }
  else if (room.phase === "voting") { $("vote-progress").textContent = room.voteCount || 0; renderVoteList(); }
  else if (room.phase === "drawing") { updateDrawUI(); }
});

// ── 제시어 확인 ──
socket.on("yourRole", (role) => {
  myRole = role;
  const back = $("role-back"), card = $("role-card");
  card.classList.remove("flipped");
  back.classList.toggle("liar", role.isLiar);
  if (role.isLiar) {
    back.innerHTML = `<div class="role-label">주제: ${escapeHtml(role.category)}</div>
      <div class="role-word">라이어!</div>
      <div class="role-label">제시어를 모릅니다.<br/>티 내지 말고 그리세요 🤫</div>`;
  } else {
    back.innerHTML = `<div class="role-label">주제: ${escapeHtml(role.category)}</div>
      <div class="role-word">${escapeHtml(role.word)}</div>
      <div class="role-label">이 제시어를 그림으로<br/>설명하세요 ✏️</div>`;
  }
  if (state && state.phase === "reveal") show("reveal");
  $("btn-confirm-word").disabled = false;
  $("btn-confirm-word").textContent = "확인했어요";
});
$("role-card").onclick = () => $("role-card").classList.toggle("flipped");
$("btn-confirm-word").onclick = () => {
  socket.emit("confirmWord");
  $("btn-confirm-word").disabled = true;
  $("btn-confirm-word").textContent = "다른 사람 기다리는 중…";
};

// ── 그리기 ──
const canvas = $("board");
const ctx = canvas.getContext("2d");
let drawing = false, last = null, curColor = "#2b2a33", curSize = 10, eraser = false, isMyTurn = false;
let strokeCount = 0, maxStrokes = 3, pendingNewStroke = false;
let turnDeadline = 0, countdownTimer = null;

function updateStrokeInfo() {
  const left = Math.max(0, maxStrokes - strokeCount);
  const box = $("stroke-info");
  box.innerHTML = `남은 획 <b>${left}</b>`;
  box.classList.toggle("empty", left <= 0);
}
function stopCountdown() { if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; } }
function startCountdown() {
  stopCountdown();
  const pill = $("timer-pill");
  const tick = () => {
    const remain = Math.max(0, Math.ceil((turnDeadline - Date.now()) / 1000));
    pill.textContent = "⏱ " + remain;
    pill.classList.toggle("warn", remain <= 5);
    if (remain <= 0) stopCountdown();
  };
  tick();
  countdownTimer = setInterval(tick, 250);
}
const PALETTE = ["#2b2a33", "#ff5c5c", "#4c7dff", "#ffc93c", "#23c9a0", "#a66bff", "#ff8c42", "#ffffff"];
function buildPalette() {
  const box = $("palette"); box.innerHTML = "";
  PALETTE.forEach((c, i) => {
    const s = document.createElement("div");
    s.className = "swatch" + (i === 0 ? " active" : ""); s.style.background = c;
    s.onclick = () => { curColor = c; eraser = false; $("btn-eraser").classList.remove("active");
      [...box.children].forEach((el) => el.classList.remove("active")); s.classList.add("active"); };
    box.appendChild(s);
  });
}
buildPalette();
document.querySelectorAll(".tool-btn[data-size]").forEach((b) => {
  b.onclick = () => { curSize = +b.dataset.size;
    document.querySelectorAll(".tool-btn[data-size]").forEach((x) => x.classList.remove("active")); b.classList.add("active"); };
});
$("btn-eraser").onclick = () => { eraser = !eraser; $("btn-eraser").classList.toggle("active", eraser); };
$("btn-done").onclick = () => { if (isMyTurn) socket.emit("endTurn"); };

function pos(e) {
  const r = canvas.getBoundingClientRect();
  const src = e.touches ? e.touches[0] : e;
  return { x: (src.clientX - r.left) / r.width, y: (src.clientY - r.top) / r.height };
}
function drawSeg(seg) {
  ctx.strokeStyle = seg.erase ? "#ffffff" : seg.color;
  ctx.lineWidth = seg.size * (canvas.width / 1000);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(seg.x0 * canvas.width, seg.y0 * canvas.height);
  ctx.lineTo(seg.x1 * canvas.width, seg.y1 * canvas.height);
  ctx.stroke();
}
function startDraw(e) {
  if (!isMyTurn) return;
  if (strokeCount >= maxStrokes) { toast(`한 턴에 ${maxStrokes}획까지만 그릴 수 있어요!`); return; }
  drawing = true; pendingNewStroke = true; last = pos(e); e.preventDefault();
}
function moveDraw(e) {
  if (!drawing || !isMyTurn) return;
  const p = pos(e);
  const seg = { x0: last.x, y0: last.y, x1: p.x, y1: p.y, color: curColor, size: curSize, erase: eraser };
  if (pendingNewStroke) {
    seg.newStroke = true; pendingNewStroke = false;
    strokeCount++; updateStrokeInfo();
  }
  drawSeg(seg); socket.emit("draw", seg); last = p; e.preventDefault();
}
function endDraw() { drawing = false; pendingNewStroke = false; }
canvas.addEventListener("mousedown", startDraw);
canvas.addEventListener("mousemove", moveDraw);
window.addEventListener("mouseup", endDraw);
canvas.addEventListener("touchstart", startDraw, { passive: false });
canvas.addEventListener("touchmove", moveDraw, { passive: false });
canvas.addEventListener("touchend", endDraw);

socket.on("draw", (seg) => drawSeg(seg));
socket.on("canvasHistory", (history) => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  history.forEach(drawSeg);
});

socket.on("turnUpdate", (t) => {
  show("draw");
  $("round-num").textContent = t.round;
  $("round-total").textContent = t.totalRounds;
  isMyTurn = t.currentDrawerId === myId;
  maxStrokes = t.maxStrokes || 3;
  strokeCount = t.strokesUsed || 0;
  pendingNewStroke = false; drawing = false;
  updateStrokeInfo();
  turnDeadline = t.deadline || (Date.now() + 30000);
  startCountdown();
  socket.emit("requestCanvas");
  updateDrawUI(t);
});

// 서버가 세는 획 수와 동기화 (내 화면 표시용)
socket.on("strokeCount", ({ strokesUsed, maxStrokes: mx }) => {
  if (typeof mx === "number") maxStrokes = mx;
  if (typeof strokesUsed === "number" && strokesUsed > strokeCount) strokeCount = strokesUsed;
  updateStrokeInfo();
});
function updateDrawUI(t) {
  const drawerId = t ? t.currentDrawerId : state && state.currentDrawerId;
  isMyTurn = drawerId === myId;
  const drawerName = t ? t.drawerName : (state && (state.players.find((p) => p.id === drawerId) || {}).nickname) || "?";
  const wordBox = $("my-word");
  if (myRole) {
    if (myRole.isLiar) { wordBox.textContent = "🤫 나는 라이어"; wordBox.classList.add("liar"); }
    else { wordBox.textContent = "내 제시어: " + myRole.word; wordBox.classList.remove("liar"); }
  }
  $("tools").classList.toggle("hidden", !isMyTurn);
  $("watch-overlay").classList.toggle("hidden", isMyTurn);
  if (!isMyTurn) $("watch-text").textContent = `${drawerName} 님이 그리는 중… 👀`;
  $("turn-status").textContent = isMyTurn ? "당신 차례! 그려보세요 ✏️" : `${drawerName} 님 차례`;
}

// ── 투표 ──
socket.on("votingStart", () => { stopCountdown(); show("vote"); renderVoteList(); });
function renderVoteList() {
  if (!state) return;
  const list = $("vote-list"); list.innerHTML = "";
  const iVoted = (state.players.find((p) => p.id === myId) || {}).hasVoted;
  state.players.filter((p) => p.connected).forEach((p) => {
    const li = document.createElement("li");
    li.className = "player-item vote-item";
    const btn = p.id === myId ? "" : `<button class="vote-btn" data-id="${p.id}">지목</button>`;
    li.innerHTML = `
      <span class="avatar" style="background:${avatarColor(p.id)}">${initial(p.nickname)}</span>
      <span class="pname">${escapeHtml(p.nickname)}${p.id === myId ? " (나)" : ""}</span>
      ${p.hasVoted ? '<span class="tick">✔ 투표함</span>' : ""}
      ${iVoted ? "" : btn}`;
    list.appendChild(li);
  });
  list.querySelectorAll(".vote-btn").forEach((b) => {
    b.onclick = () => { socket.emit("vote", { targetId: b.dataset.id }); toast("투표했어요!"); };
  });
  $("vote-progress").textContent = state.voteCount || 0;
}

// ── 라이어 최후의 기회 ──
socket.on("liarCaught", ({ liarName }) => {
  show("guess");
  $("guess-title").textContent = "🎯 라이어 지목 성공!";
  const amLiar = myRole && myRole.isLiar;
  $("guess-sub").textContent = amLiar
    ? "마지막 기회! 진짜 제시어를 맞히면 당신이 이겨요."
    : `${liarName} 님이 라이어로 지목됐어요. 제시어를 맞히는지 지켜보세요…`;
  $("guess-options").innerHTML = "";
  $("guess-wait").textContent = amLiar ? "" : "라이어가 고르는 중…";
});
socket.on("liarGuessPrompt", ({ options }) => {
  const box = $("guess-options"); box.innerHTML = "";
  options.forEach((opt) => {
    const chip = document.createElement("button");
    chip.className = "chip"; chip.textContent = opt;
    chip.onclick = () => { box.querySelectorAll(".chip").forEach((c) => (c.disabled = true)); chip.classList.add("selected"); socket.emit("liarGuess", { guess: opt }); };
    box.appendChild(chip);
  });
});

// ── 결과 ──
socket.on("gameResult", (r) => {
  stopCountdown();
  show("result");
  const banner = $("result-banner");
  banner.className = "result-banner " + (r.winner === "citizens" ? "citizens" : "liar");
  banner.textContent = r.winner === "citizens" ? "🎉 시민 승리!" : "😈 라이어 승리!";
  $("result-word").textContent = r.word;
  $("result-cat").textContent = "(" + r.category + ")";
  $("result-liar").textContent = r.liarName;
  const extra = $("result-extra");
  if (r.tie) extra.textContent = "표가 갈려 라이어를 잡지 못했어요.";
  else if (r.liarGuess) extra.textContent = r.winner === "liar" ? `라이어가 "${r.liarGuess}" 를 정확히 맞혔어요!` : `라이어는 "${r.liarGuess}" 라고 했지만 오답!`;
  else if (r.accusedId) { const acc = (r.breakdown.find((b) => b.id === r.accusedId) || {}).nickname; extra.textContent = `${acc || "시민"} 님이 지목됐지만 라이어가 아니었어요.`; }
  else extra.textContent = "";
  const votes = $("result-votes"); votes.innerHTML = "";
  (r.breakdown || []).forEach((b) => {
    const li = document.createElement("li");
    li.className = "player-item" + (b.id === r.liarId ? " me" : "");
    li.innerHTML = `<span class="avatar" style="background:${avatarColor(b.id)}">${initial(b.nickname)}</span>
      <span class="pname">${escapeHtml(b.nickname)} ${b.id === r.liarId ? "😈" : ""}</span>
      <span class="badge-ready on">${b.votes}표</span>`;
    votes.appendChild(li);
  });
  const iamHost = isHost();
  $("btn-again").classList.toggle("hidden", !iamHost);
  $("wait-host").classList.toggle("hidden", iamHost);
});
$("btn-again").onclick = () => socket.emit("playAgain");
$("btn-home").onclick = () => leaveToHome();

socket.on("returnedToLobby", () => { stopCountdown(); myRole = null; show("lobby"); });
socket.on("gameAborted", ({ reason }) => toast(reason));

// ─────────────────────────────────────────────
//  채팅 (대기방 ~ 게임 내내)
// ─────────────────────────────────────────────
const chatDock = $("chat-dock");
const chatMessages = $("chat-messages");
const chatInput = $("chat-input");
let chatUnread = 0;

function chatCollapsed() { return chatDock.classList.contains("collapsed"); }
function setUnread(n) {
  chatUnread = n;
  const badge = $("chat-unread");
  badge.textContent = n;
  badge.classList.toggle("hidden", n <= 0);
}
$("chat-head").onclick = (e) => {
  if (e.target === chatInput) return;
  chatDock.classList.toggle("collapsed");
  if (!chatCollapsed()) { setUnread(0); chatMessages.scrollTop = chatMessages.scrollHeight; }
};

function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit("chat", { text });
  chatInput.value = "";
}
$("chat-send").onclick = sendChat;
chatInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendChat(); } });

function appendChat(m) {
  const row = document.createElement("div");
  if (m.type === "system") {
    row.className = "chat-msg system";
    row.innerHTML = `<span class="bubble">${escapeHtml(m.text)}</span>`;
  } else {
    const mine = m.key === myId;
    row.className = "chat-msg" + (mine ? " mine" : "");
    const who = mine ? "나" : escapeHtml(m.nickname);
    const color = mine ? "" : ` style="color:${avatarColor(m.key)}"`;
    row.innerHTML = `<span class="who"${color}>${who}</span><span class="bubble">${escapeHtml(m.text)}</span>`;
  }
  chatMessages.appendChild(row);
  const nearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 60;
  if (nearBottom || (m.type !== "system" && m.key === myId)) chatMessages.scrollTop = chatMessages.scrollHeight;
}

socket.on("chatHistory", (list) => {
  chatMessages.innerHTML = "";
  (list || []).forEach(appendChat);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});
socket.on("chatMessage", (m) => {
  appendChat(m);
  if (chatCollapsed() && !(m.type !== "system" && m.key === myId)) setUnread(chatUnread + 1);
});
