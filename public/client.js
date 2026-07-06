/* 라이어 그림 게임 - 클라이언트 */
const socket = io();

// ── 상태 ──
let myId = null;
let roomCode = null;
let state = null; // 최신 roomUpdate
let myRole = null; // { isLiar, word, category }
const AVATAR_COLORS = ["#ff5c5c", "#4c7dff", "#ffc93c", "#23c9a0", "#a66bff", "#ff8c42", "#e05fa0", "#5bc0eb"];

// ── DOM 헬퍼 ──
const $ = (id) => document.getElementById(id);
const screens = ["login", "lobby", "reveal", "draw", "vote", "guess", "result"];
function show(name) {
  screens.forEach((s) => $("screen-" + s).classList.toggle("active", s === name));
}
let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}
function avatarColor(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}
function initial(name) { return (name || "?").trim().charAt(0).toUpperCase(); }

// ── 로그인 ──
$("btn-create").onclick = () => {
  const nickname = $("nickname").value.trim();
  if (!nickname) return toast("닉네임을 적어주세요!");
  socket.emit("createRoom", { nickname });
};
$("btn-join").onclick = () => {
  const nickname = $("nickname").value.trim();
  const code = $("roomCode").value.trim().toUpperCase();
  if (!nickname) return toast("닉네임을 적어주세요!");
  if (code.length !== 4) return toast("방 코드 4자리를 입력하세요.");
  socket.emit("joinRoom", { nickname, roomCode: code });
};
$("roomCode").addEventListener("input", (e) => (e.target.value = e.target.value.toUpperCase()));

// URL 에 ?room=CODE 있으면 자동 채우기
const urlRoom = new URLSearchParams(location.search).get("room");
if (urlRoom) $("roomCode").value = urlRoom.toUpperCase().slice(0, 4);

socket.on("joined", ({ roomCode: code, playerId }) => {
  roomCode = code;
  myId = playerId;
  $("lobby-code").textContent = code;
  show("lobby");
});

socket.on("errorMsg", ({ message }) => toast(message));

// ── 대기실 ──
$("btn-copy").onclick = () => {
  const link = `${location.origin}?room=${roomCode}`;
  navigator.clipboard?.writeText(link).then(
    () => toast("초대 링크를 복사했어요!"),
    () => toast("복사 실패 — 코드: " + roomCode)
  );
};
$("btn-ready").onclick = () => socket.emit("toggleReady");
$("btn-start").onclick = () => {
  socket.emit("startGame", { category: selectedCategory });
};
$("btn-leave-lobby").onclick = () => location.reload();

let selectedCategory = null;
function renderCategoryPicker(categories) {
  const box = $("category-picker");
  if (box.dataset.built) return;
  box.dataset.built = "1";
  categories.forEach((c) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = c;
    chip.onclick = () => {
      selectedCategory = c;
      [...box.children].forEach((el) => el.classList.toggle("selected", el === chip));
    };
    box.appendChild(chip);
  });
}
const CATEGORIES = ["동물", "음식", "영화", "직업", "장소", "물건", "스포츠"];

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
  renderCategoryPicker(CATEGORIES);
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

function isHost() { return state && state.hostId === myId; }
function escapeHtml(s) { return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ── roomUpdate ──
socket.on("roomUpdate", (room) => {
  state = room;
  if (room.phase === "lobby") { show("lobby"); renderLobby(); }
  else if (room.phase === "reveal") { $("confirm-progress").textContent = room.confirmedCount || 0; }
  else if (room.phase === "voting") { $("vote-progress").textContent = room.voteCount || 0; renderVoteList(); }
  else if (room.phase === "drawing") { updateDrawUI(); }
});

// ── 제시어 확인 ──
socket.on("yourRole", (role) => {
  myRole = role;
  const back = $("role-back");
  const card = $("role-card");
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
  show("reveal");
  $("btn-confirm-word").disabled = false;
  $("btn-confirm-word").textContent = "확인했어요";
});

$("role-card").onclick = () => $("role-card").classList.toggle("flipped");
$("btn-confirm-word").onclick = () => {
  socket.emit("confirmWord");
  $("btn-confirm-word").disabled = true;
  $("btn-confirm-word").textContent = "다른 사람 기다리는 중…";
};

// ─────────────────────────────────────────────
//  그리기 (캔버스)
// ─────────────────────────────────────────────
const canvas = $("board");
const ctx = canvas.getContext("2d");
let drawing = false;
let last = null;
let curColor = "#2b2a33";
let curSize = 10;
let eraser = false;
let isMyTurn = false;

const PALETTE = ["#2b2a33", "#ff5c5c", "#4c7dff", "#ffc93c", "#23c9a0", "#a66bff", "#ff8c42", "#ffffff"];
function buildPalette() {
  const box = $("palette");
  box.innerHTML = "";
  PALETTE.forEach((c, i) => {
    const s = document.createElement("div");
    s.className = "swatch" + (i === 0 ? " active" : "");
    s.style.background = c;
    s.onclick = () => {
      curColor = c; eraser = false;
      $("btn-eraser").classList.remove("active");
      [...box.children].forEach((el) => el.classList.remove("active"));
      s.classList.add("active");
    };
    box.appendChild(s);
  });
}
buildPalette();

document.querySelectorAll(".tool-btn[data-size]").forEach((b) => {
  b.onclick = () => {
    curSize = +b.dataset.size;
    document.querySelectorAll(".tool-btn[data-size]").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
  };
});
$("btn-eraser").onclick = () => {
  eraser = !eraser;
  $("btn-eraser").classList.toggle("active", eraser);
};
$("btn-done").onclick = () => {
  if (!isMyTurn) return;
  socket.emit("endTurn");
};

// 좌표 정규화(0~1) 저장 → 어떤 화면 크기든 동일하게 재현
function pos(e) {
  const r = canvas.getBoundingClientRect();
  const src = e.touches ? e.touches[0] : e;
  return { x: (src.clientX - r.left) / r.width, y: (src.clientY - r.top) / r.height };
}
function drawSeg(seg) {
  ctx.strokeStyle = seg.erase ? "#ffffff" : seg.color;
  ctx.lineWidth = seg.size * (canvas.width / 1000);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(seg.x0 * canvas.width, seg.y0 * canvas.height);
  ctx.lineTo(seg.x1 * canvas.width, seg.y1 * canvas.height);
  ctx.stroke();
}
function startDraw(e) {
  if (!isMyTurn) return;
  drawing = true;
  last = pos(e);
  e.preventDefault();
}
function moveDraw(e) {
  if (!drawing || !isMyTurn) return;
  const p = pos(e);
  const seg = { x0: last.x, y0: last.y, x1: p.x, y1: p.y, color: curColor, size: curSize, erase: eraser };
  drawSeg(seg);
  socket.emit("draw", seg);
  last = p;
  e.preventDefault();
}
function endDraw() { drawing = false; }

canvas.addEventListener("mousedown", startDraw);
canvas.addEventListener("mousemove", moveDraw);
window.addEventListener("mouseup", endDraw);
canvas.addEventListener("touchstart", startDraw, { passive: false });
canvas.addEventListener("touchmove", moveDraw, { passive: false });
canvas.addEventListener("touchend", endDraw);

// 다른 사람이 그린 선 수신
socket.on("draw", (seg) => drawSeg(seg));
socket.on("canvasHistory", (history) => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  history.forEach(drawSeg);
});

// 그리기 시작
socket.on("turnUpdate", (t) => {
  show("draw");
  $("round-num").textContent = t.round;
  $("round-total").textContent = t.totalRounds;
  isMyTurn = t.currentDrawerId === myId;
  // 새로 들어온 사람도 현재까지 그림을 받아오도록
  socket.emit("requestCanvas");
  updateDrawUI(t);
});

function updateDrawUI(t) {
  const drawerId = t ? t.currentDrawerId : state && state.currentDrawerId;
  isMyTurn = drawerId === myId;
  const drawerName = t ? t.drawerName : (state && state.players.find((p) => p.id === drawerId)?.nickname) || "?";

  // 내 제시어 표시
  const wordBox = $("my-word");
  if (myRole) {
    if (myRole.isLiar) { wordBox.textContent = "🤫 나는 라이어"; wordBox.classList.add("liar"); }
    else { wordBox.textContent = "내 제시어: " + myRole.word; wordBox.classList.remove("liar"); }
  }

  $("tools").classList.toggle("hidden", !isMyTurn);
  const overlay = $("watch-overlay");
  overlay.classList.toggle("hidden", isMyTurn);
  if (!isMyTurn) $("watch-text").textContent = `${drawerName} 님이 그리는 중… 👀`;
  $("turn-status").textContent = isMyTurn ? "당신 차례! 그려보세요 ✏️" : `${drawerName} 님 차례`;
}

// ── 투표 ──
socket.on("votingStart", () => { show("vote"); renderVoteList(); });
function renderVoteList() {
  const list = $("vote-list");
  list.innerHTML = "";
  const iVoted = state.players.find((p) => p.id === myId)?.hasVoted;
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
    b.onclick = () => {
      socket.emit("vote", { targetId: b.dataset.id });
      toast("투표했어요!");
    };
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
  const box = $("guess-options");
  box.innerHTML = "";
  options.forEach((opt) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = opt;
    chip.onclick = () => {
      box.querySelectorAll(".chip").forEach((c) => (c.disabled = true));
      chip.classList.add("selected");
      socket.emit("liarGuess", { guess: opt });
    };
    box.appendChild(chip);
  });
});

// ── 결과 ──
socket.on("gameResult", (r) => {
  show("result");
  const banner = $("result-banner");
  banner.className = "result-banner " + (r.winner === "citizens" ? "citizens" : "liar");
  banner.textContent = r.winner === "citizens" ? "🎉 시민 승리!" : "😈 라이어 승리!";

  $("result-word").textContent = r.word;
  $("result-cat").textContent = "(" + r.category + ")";
  $("result-liar").textContent = r.liarName;

  const extra = $("result-extra");
  if (r.tie) extra.textContent = "표가 갈려 라이어를 잡지 못했어요.";
  else if (r.liarGuess) {
    extra.textContent = r.winner === "liar"
      ? `라이어가 "${r.liarGuess}" 를 정확히 맞혔어요!`
      : `라이어는 "${r.liarGuess}" 라고 했지만 오답!`;
  } else if (r.accusedId) {
    const acc = (r.breakdown.find((b) => b.id === r.accusedId) || {}).nickname;
    extra.textContent = `${acc || "시민"} 님이 지목됐지만 라이어가 아니었어요.`;
  } else extra.textContent = "";

  const votes = $("result-votes");
  votes.innerHTML = "";
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
$("btn-home").onclick = () => location.reload();

socket.on("returnedToLobby", () => { myRole = null; show("lobby"); });
socket.on("gameAborted", ({ reason }) => toast(reason));
