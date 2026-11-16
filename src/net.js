/* ============================================================
   ONLINE CO-OP — PeerJS lobby, host-authoritative snapshots
   ============================================================ */
const NET = {
  role: null,
  peer: null,
  code: '',
  name: '',
  players: [],
  localId: null,
  hostCharId: null,
  hostConn: null,
  started: false,
  ready: false,
  seq: 0,
  leaving: false,
  hostTimer: null,
  watchTimer: null,
  inputTimer: null,
  feedSeen: new Set(),
  inputAt: 0
};
const mpEl = {
  open: $('mp-open'), lobby: $('mp-lobby'), setup: $('mp-setup'), room: $('mp-room'),
  name: $('mp-name'), create: $('mp-create'), code: $('mp-code'), join: $('mp-join'),
  error: $('mp-error'), roomCode: $('mp-room-code'), players: $('mp-players'),
  hint: $('mp-hint'), start: $('mp-start'), leave: $('mp-leave'), close: $('mp-close')
};

const NET_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const cleanNetName = v => String(v || '').replace(/[<>&"']/g, '').trim().slice(0, 8);
const escNet = v => String(v == null ? '' : v).replace(/[&<>"']/g, ch => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
));
const netCode = () => Array.from({ length: 4 }, () => NET_CODE_CHARS[Math.floor(Math.random() * NET_CODE_CHARS.length)]).join('');
const charOfNet = id => CHARS.find(c => c.id === id) || CHARS[0];

function netError(msg) {
  if (mpEl.error) mpEl.error.textContent = msg || '';
}
function netHint(msg) {
  if (mpEl.hint) mpEl.hint.textContent = msg || '';
}
function netSend(conn, msg) {
  if (!conn || !conn.open) return false;
  try { conn.send(msg); return true; } catch (e) { return false; }
}
function netIsClient() {
  return !!(NET.role === 'guest' && NET.started && netClientMode);
}
function netIsMultiplayer() {
  return NET.role === 'host' || NET.role === 'guest';
}
function netPublicPlayers() {
  return NET.players.map(p => ({ id: p.id, name: p.name, charId: p.charId, isHost: !!p.isHost }));
}
function netRenderPlayers() {
  if (!mpEl.players) return;
  const list = NET.players.slice(0, 4);
  let html = list.map(p => {
    const ch = charOfNet(p.charId);
    return `<div class="mp-player ${p.id === NET.localId ? 'me' : ''}" style="--c:${ch.color}">
      <span class="mp-stamp">${ch.stamp}</span>
      <strong>${escNet(p.name)}${p.isHost ? ' · 房主' : ''}${p.id === NET.localId ? ' · 你' : ''}</strong>
      <small>${escNet(ch.role)}</small>
    </div>`;
  }).join('');
  for (let i = list.length; i < 4; i++) {
    html += `<div class="mp-player empty"><span class="mp-stamp">?</span><strong>等待同学加入…</strong><small>${i + 1} / 4</small></div>`;
  }
  mpEl.players.innerHTML = html;
  if (mpEl.start) {
    mpEl.start.classList.toggle('hidden', NET.role !== 'host');
    mpEl.start.disabled = NET.players.length < 2;
    mpEl.start.textContent = `开始搬迁 · ${NET.players.length} 人`;
  }
}
function netShowRoom() {
  if (mpEl.setup) mpEl.setup.classList.add('hidden');
  if (mpEl.room) mpEl.room.classList.remove('hidden');
  if (mpEl.roomCode) mpEl.roomCode.textContent = NET.code || '----';
  netRenderPlayers();
}
function netOpenLobby() {
  if (!mpEl.lobby) return;
  if (state === 'playing' || state === 'paused') return;
  state = 'lobby';
  ui.menu.classList.add('hidden');
  ui.hud.classList.add('hidden');
  ui.result.classList.add('hidden');
  ui.pause.classList.add('hidden');
  ui.help.classList.add('hidden');
  mpEl.lobby.classList.remove('hidden');
  if (mpEl.setup) mpEl.setup.classList.remove('hidden');
  if (mpEl.room) mpEl.room.classList.add('hidden');
  netError('');
  if (!window.Peer) netError('联机组件没有加载，请刷新页面重试。');
}
function netHideLobby() {
  if (mpEl.lobby) mpEl.lobby.classList.add('hidden');
}
function netClearTimers() {
  if (NET.hostTimer) { clearInterval(NET.hostTimer); NET.hostTimer = null; }
  if (NET.watchTimer) { clearInterval(NET.watchTimer); NET.watchTimer = null; }
  if (NET.inputTimer) { clearInterval(NET.inputTimer); NET.inputTimer = null; }
}
function netDestroyPeer() {
  netClearTimers();
  try { if (NET.hostConn) NET.hostConn.close(); } catch (e) { /* ignore */ }
  NET.players.forEach(p => {
    if (p.conn) { try { p.conn.close(); } catch (e) { /* ignore */ } }
  });
  try { if (NET.peer) NET.peer.destroy(); } catch (e) { /* ignore */ }
  NET.peer = null;
  NET.hostConn = null;
  NET.hostTimer = null;
  NET.watchTimer = null;
  NET.inputTimer = null;
  NET.started = false;
  NET.ready = false;
  NET.players = [];
  NET.localId = null;
  NET.code = '';
  NET.seq = 0;
  NET.feedSeen = new Set();
}
function netReturnToMenu(message) {
  if (NET.leaving) return;
  NET.leaving = true;
  netClientMode = false;
  NET.role = null;
  netDestroyPeer();
  netHideLobby();
  if (ui.pauseBtn) ui.pauseBtn.classList.remove('hidden');
  showMenu();
  state = 'menu';
  NET.leaving = false;
  if (message) showToast('📴', '房间已关闭', message, 'bad', 4200);
}
function netLeave() {
  if (!NET.role) return false;
  const wasHost = NET.role === 'host';
  if (wasHost) {
    NET.players.forEach(p => {
      if (p.conn) netSend(p.conn, { type: 'close', reason: '房主关掉了房间。' });
    });
  } else if (NET.hostConn) {
    netSend(NET.hostConn, { type: 'leave' });
  }
  netReturnToMenu('');
  return true;
}

/* ---------------- host ---------------- */
function netCreateRoom() {
  if (!window.Peer) { netError('联机组件没有加载，请刷新页面重试。'); return; }
  if (NET.role) netLeave();
  netError('');
  NET.role = 'host';
  NET.name = cleanNetName(mpEl.name && mpEl.name.value) || charOfNet(selectedCharId).name;
  NET.localId = 'host';
  NET.players = [{ id: 'host', name: NET.name, charId: selectedCharId, isHost: true, conn: null }];
  NET.ready = false;
  NET.started = false;
  netHint('正在创建房间…');
  netShowRoom();
  netRenderPlayers();
  netOpenHostPeer(0);
}
function netOpenHostPeer(attempt) {
  const code = netCode();
  NET.code = code;
  if (mpEl.roomCode) mpEl.roomCode.textContent = code;
  let peer;
  try {
    peer = new Peer('bagheist-' + code, { debug: 0 });
  } catch (e) {
    netError('无法创建联机组件，请刷新页面重试。');
    return;
  }
  NET.peer = peer;
  let settled = false;
  const timeout = setTimeout(() => {
    if (settled || NET.peer !== peer) return;
    settled = true;
    netError('连接信令服务器超时，请检查网络后重试。');
    netHint('房间没有创建成功。');
  }, 12000);

  peer.on('open', () => {
    if (NET.peer !== peer) return;
    settled = true;
    clearTimeout(timeout);
    NET.ready = true;
    netHint('把房间码发给朋友。至少 2 人开始，最多 4 人。');
    netRenderPlayers();
  });

  peer.on('connection', conn => netHostAccept(conn));

  peer.on('error', err => {
    if (NET.peer !== peer) return;
    clearTimeout(timeout);
    const type = err && err.type ? err.type : 'unknown';
    if (type === 'unavailable-id' && attempt < 5) {
      try { peer.destroy(); } catch (e) { /* ignore */ }
      netOpenHostPeer(attempt + 1);
      return;
    }
    netError(type === 'network' || type === 'server-error'
      ? '信令服务器连不上，请检查网络后重试。'
      : '创建房间失败：' + type);
    netHint('房间没有创建成功。');
  });
}
function netHostAccept(conn) {
  if (NET.role !== 'host' || NET.started) {
    netSend(conn, { type: 'close', reason: '房间已经开始游戏了。' });
    try { conn.close(); } catch (e) { /* ignore */ }
    return;
  }
  conn.on('data', data => netHostData(conn, data));
  conn.on('close', () => netHostClosed(conn));
  conn.on('error', () => { /* the close event decides */ });
}
function netHostData(conn, data) {
  if (!data || NET.role !== 'host') return;
  const seen = NET.players.find(x => x.conn === conn);
  if (seen) seen.lastSeen = Date.now();
  if (data.type === 'hello') {
    netHostHello(conn, data);
  } else if (data.type === 'input' && NET.started && G) {
    const p = NET.players.find(x => x.conn === conn);
    if (!p || p.slot == null) return;
    const s = G.students[p.slot];
    if (!s || !s.alive) return;
    s.input.dx = clamp(+data.dx || 0, -1, 1);
    s.input.dy = clamp(+data.dy || 0, -1, 1);
    if (data.dash) s.input.dash = true;
    if (data.deposit) s.pendingDeposit = true;
  } else if (data.type === 'leave') {
    try { conn.close(); } catch (e) { /* ignore */ }
  }
}
function netHostHello(conn, data) {
  if (NET.started) {
    netSend(conn, { type: 'close', reason: '房间已经开始游戏了。' });
    try { conn.close(); } catch (e) { /* ignore */ }
    return;
  }
  if (NET.players.length >= 4) {
    netSend(conn, { type: 'full' });
    try { conn.close(); } catch (e) { /* ignore */ }
    return;
  }
  if (NET.players.some(p => p.conn === conn)) return;

  const used = new Set(NET.players.map(p => p.charId));
  const ch = CHARS.find(c => !used.has(c.id)) || CHARS[NET.players.length % CHARS.length];
  const slot = NET.players.length;
  const p = {
    id: 'p' + (++NET.seq),
    name: cleanNetName(data.name) || ('同学' + slot),
    charId: ch.id,
    isHost: false,
    conn,
    slot,
    lastSeen: Date.now()
  };
  NET.players.push(p);
  conn.__pid = p.id;
  netSend(conn, {
    type: 'welcome',
    id: p.id,
    code: NET.code,
    name: p.name,
    charId: p.charId,
    hostCharId: selectedCharId,
    players: netPublicPlayers()
  });
  netRenderPlayers();
  netHint('有人加入了。至少 2 人就可以开始。');
  feed(`${p.name} 加入了房间。`, ch.color);
}
function netHostClosed(conn) {
  if (NET.role !== 'host') return;
  const p = NET.players.find(x => x.conn === conn);
  if (!p) return;
  if (!NET.started) {
    NET.players = NET.players.filter(x => x !== p);
    netRenderPlayers();
    netHint(NET.players.length > 1 ? '有人离开了。' : '等朋友加入。');
    return;
  }
  if (p.slot == null || !G) return;
  const s = G.students[p.slot];
  if (s) {
    s.remote = false;
    s.isAI = true;
    s.isHuman = false;
    s.input.dx = 0; s.input.dy = 0;
    feed(`${s.name} 掉线了，转由 AI 接管。`, '#b98118');
    showToast('📴', s.name + ' 掉线了', '这一局剩下的路，AI 帮他走。', 'bad', 2800);
  }
  NET.players = NET.players.filter(x => x !== p);
}
function netHostStart() {
  if (NET.role !== 'host' || NET.started) return;
  if (!NET.ready) { netError('房间还没准备好，稍等一下。'); return; }
  if (NET.players.length < 2) { netError('至少需要 2 名真人。把房间码发给朋友。'); return; }
  netError('');
  const remoteList = NET.players.slice(1).map(p => ({ id: p.id, name: p.name, charId: p.charId }));
  startMultiGame(selectedCharId, remoteList);
  NET.started = true;
  NET.hostCharId = selectedCharId;
  NET.players.forEach((p, i) => {
    p.slot = i;
    p.lastSeen = Date.now();
    if (G && G.students[i]) G.students[i].netId = p.id;
  });
  const assignments = G.students.map((s, i) => ({
    id: s.netId || ('ai' + i),
    name: s.name,
    charId: s.charId,
    human: s.isHuman,
    host: i === 0
  }));
  NET.players.forEach(p => {
    if (p.conn) netSend(p.conn, {
      type: 'start',
      hostCharId: selectedCharId,
      code: NET.code,
      assignments
    });
  });
  netHideLobby();
  if (ui.pauseBtn) ui.pauseBtn.classList.add('hidden');
  clearInterval(NET.hostTimer);
  NET.hostTimer = setInterval(netHostBroadcast, 50);
  clearInterval(NET.watchTimer);
  NET.watchTimer = setInterval(netHostWatchdog, 2000);
  netHostBroadcast();
}
function netHostWatchdog() {
  if (NET.role !== 'host' || !NET.started) return;
  if (state !== 'playing' || !G || G.ending) return;
  const now = Date.now();
  NET.players.slice(1).forEach(p => {
    if (!p.conn || now - (p.lastSeen || 0) <= 8000) return;
    try { p.conn.close(); } catch (e) { /* ignore */ }
    netHostClosed(p.conn);
  });
}
function netHostBroadcast() {
  if (NET.role !== 'host' || !G || !NET.started) return;
  const snap = netPackSnapshot();
  NET.players.forEach(p => {
    if (p.conn) netSend(p.conn, snap);
  });
}

/* ---------------- pack host state ---------------- */
function netPackSnapshot() {
  const r = v => Math.round(v * 10) / 10;
  const until = v => +Math.max(0, v - G.t).toFixed(1);
  return {
    type: 'snap',
    t: +G.t.toFixed(2),
    tl: +G.timeLeft.toFixed(2),
    gl: +G.graceLeft.toFixed(2),
    go: G.graceOver ? 1 : 0,
    sr: G.sorted,
    tb: G.totalBags,
    en: G.ending ? 1 : 0,
    er: G.endReason || '',
    fa: +((G.finishAt || 0) - G.t).toFixed(2),
    st: G.students.map(s => [
      s.id, r(s.x), r(s.y), +s.facing.toFixed(2), +s.walkPhase.toFixed(2),
      s.hearts, s.alive ? 1 : 0, s.captured ? 1 : 0, Math.round(s.score),
      s.deposits, s.rescues, s.shield, until(s.invulnUntil), until(s.invisUntil),
      until(s.speedUntil), until(s.alarmSpeedUntil), until(s.dashReadyAt),
      s.carrying.map(b => b.room), s.doubleNext ? 1 : 0
    ]),
    bn: G.bins.map(b => [b.room, b.filled, until(b.flashUntil)]),
    bg: G.bags.filter(b => !b.sorted && !b.carriedBy).map(b => [b.id, b.room, r(b.x), r(b.y), '', until(b.lockUntil)]),
    wd: [
      r(G.warden.x), r(G.warden.y), G.warden.mode || 'idle',
      G.warden.target && G.warden.targetKind === 'student' ? G.warden.target.id : '',
      G.warden.targetKind || '',
      until(G.warden.freezeUntil), until(G.warden.stunUntil),
      +G.warden.facing.toFixed(2),
      G.warden.target && G.warden.targetKind === 'decoy' ? r(G.warden.target.x) : 0,
      G.warden.target && G.warden.targetKind === 'decoy' ? r(G.warden.target.y) : 0
    ],
    cp: G.capture ? [G.capture.victim.id, +G.capture.endsAt.toFixed(2)] : null,
    bl: G.bells.map(b => [r(b.x), r(b.y), until(b.until), +(b.phase || 0).toFixed(2)]),
    stt: [G.stats.captures, G.stats.rescues, G.stats.deposits],
    fd: (G.netFeed || []).slice(-6)
  };
}

/* ---------------- guest ---------------- */
function netJoinRoom() {
  if (!window.Peer) { netError('联机组件没有加载，请刷新页面重试。'); return; }
  const code = String(mpEl.code && mpEl.code.value || '').trim().toUpperCase();
  if (code.length !== 4) { netError('请输入 4 位房间码。'); return; }
  if (NET.role) netLeave();
  netError('');
  NET.role = 'guest';
  NET.name = cleanNetName(mpEl.name && mpEl.name.value) || '同学';
  NET.code = code;
  NET.localId = null;
  NET.players = [];
  NET.ready = false;
  NET.started = false;
  netShowRoom();
  netHint('正在连接房间…');
  netRenderPlayers();

  let peer;
  try {
    peer = new Peer({ debug: 0 });
  } catch (e) {
    netError('无法创建联机组件，请刷新页面重试。');
    return;
  }
  NET.peer = peer;
  let connected = false;
  const timeout = setTimeout(() => {
    if (NET.started || connected || NET.role !== 'guest') return;
    netError('连接超时。确认房主还开着页面，再检查网络。');
    netHint('没有连上房间。');
  }, 12000);

  peer.on('open', () => {
    if (NET.role !== 'guest' || NET.peer !== peer) return;
    let conn;
    try {
      conn = peer.connect('bagheist-' + code, { reliable: true, serialization: 'json' });
    } catch (e) {
      netError('房间连接失败。');
      return;
    }
    NET.hostConn = conn;
    conn.on('open', () => {
      connected = true;
      clearTimeout(timeout);
      netSend(conn, { type: 'hello', name: NET.name });
    });
    conn.on('data', data => netGuestData(conn, data));
    conn.on('close', () => {
      if (NET.leaving || NET.role !== 'guest') return;
      netReturnToMenu('房主关掉了房间，或者网络断了。');
    });
    conn.on('error', () => { /* close handles it */ });
  });
  peer.on('error', err => {
    if (NET.role !== 'guest' || NET.peer !== peer) return;
    clearTimeout(timeout);
    const type = err && err.type ? err.type : 'unknown';
    if (type === 'peer-unavailable') {
      netError('房间不存在，或者房主已经关页。');
      netHint('检查房间码，让房主保持页面打开。');
    } else if (type === 'network' || type === 'server-error') {
      netError('信令服务器连不上，请检查网络后重试。');
    } else {
      netError('连接失败：' + type);
    }
  });
}
function netGuestData(conn, data) {
  if (!data || NET.role !== 'guest') return;
  if (data.type === 'welcome') {
    NET.localId = data.id;
    NET.code = data.code || NET.code;
    NET.hostCharId = data.hostCharId;
    NET.players = data.players || [];
    NET.ready = true;
    netShowRoom();
    if (mpEl.roomCode) mpEl.roomCode.textContent = NET.code;
    if (mpEl.start) mpEl.start.classList.add('hidden');
    netHint('等待房主开始…');
    netRenderPlayers();
  } else if (data.type === 'lobby') {
    NET.players = data.players || [];
    netRenderPlayers();
    netHint(NET.players.length > 1 ? '等房主开始。' : '等房主再叫一个人…');
  } else if (data.type === 'full') {
    netError('房间满了，最多 4 名真人。');
    netHint('换一个房间试试。');
  } else if (data.type === 'start') {
    netStartClient(data);
  } else if (data.type === 'snap') {
    netApplySnapshot(data);
  } else if (data.type === 'close') {
    netReturnToMenu(data.reason || '房主关掉了房间。');
  }
}
function netStartClient(data) {
  const list = data && data.assignments;
  if (!Array.isArray(list) || list.length !== 8) {
    netReturnToMenu('房间信息不完整，请重新加入。');
    return;
  }
  const li = list.findIndex(a => a.id === NET.localId);
  if (li < 0) {
    netReturnToMenu('找不到你的座位，请重新加入。');
    return;
  }
  const g = createWorld(data.hostCharId || 'swift', false);
  g.students = list.map((a, i) => {
    const ch = charOfNet(a.charId);
    const s = makeStudent(ch, i, false, spawnPoint(i));
    s.isPlayer = i === li;
    s.isHuman = !!a.human;
    s.isAI = !a.human;
    s.remote = i !== li;
    s.netId = a.id;
    s.name = a.name || ch.name;
    s.hearts = a.human ? 3 : 2;
    s.maxHearts = a.human ? 3 : 2;
    return s;
  });
  g.player = g.students[li];
  g.playerCharId = data.hostCharId || g.playerCharId;
  g.multiplayer = true;
  g.netClient = true;
  g.netFeed = [];
  g.bags = [];
  g.bells = [];
  g.decoys = [];
  g.particles = [];
  g.floats = [];
  g.flying = [];
  g.outMarks = [];
  g.capture = null;
  g.ending = false;
  g.endReason = null;
  g.finishAt = 0;
  g.resultShown = false;
  g.preview = false;
  g.sorted = 0;
  g.graceOver = false;
  g.timeLeft = GAME_TIME;
  g.t = 0;

  G = g;
  NET.started = true;
  NET.feedSeen = new Set();
  netClientMode = true;
  state = 'playing';
  lastFrame = performance.now();
  ui.menu.classList.add('hidden');
  ui.pause.classList.add('hidden');
  ui.help.classList.add('hidden');
  ui.result.classList.add('hidden');
  netHideLobby();
  ui.hud.classList.remove('hidden');
  ui.pauseBtn.classList.add('hidden');
  clearFeed();
  clearToasts();
  updateHUD(true);
  maybeRotateHint();
  clearInterval(NET.inputTimer);
  NET.inputTimer = setInterval(netSendInput, 33);
}
function netSendInput() {
  if (!netClientMode || state !== 'playing' || !G || G.ending || !NET.started) return;
  let dx = 0, dy = 0;
  if (keys.has('w') || keys.has('arrowup')) dy -= 1;
  if (keys.has('s') || keys.has('arrowdown')) dy += 1;
  if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
  if (keys.has('d') || keys.has('arrowright')) dx += 1;
  if (joystick.active && (Math.abs(joystick.nx) > 0.12 || Math.abs(joystick.ny) > 0.12)) {
    dx = joystick.nx;
    dy = joystick.ny;
  }
  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }
  const dash = dashQueued;
  const deposit = depositQueued;
  dashQueued = false;
  depositQueued = false;
  netSend(NET.hostConn, {
    type: 'input',
    dx: Math.round(dx * 100) / 100,
    dy: Math.round(dy * 100) / 100,
    dash: !!dash,
    deposit: !!deposit
  });
}
function netFindStudent(id) {
  return G && G.students.find(s => s.id === id);
}
function netApplySnapshot(d) {
  if (!G || !netClientMode) return;
  G.t = d.t;
  G.timeLeft = d.tl;
  G.graceLeft = d.gl;
  G.graceOver = !!d.go;
  G.sorted = d.sr;
  G.totalBags = d.tb || 48;
  G.ending = !!d.en;
  G.endReason = d.er || null;
  if (d.en && !G.resultShown) {
    G.finishAt = G.t + Math.max(0, d.fa || 0);
  }

  (d.st || []).forEach(row => {
    const s = netFindStudent(row[0]);
    if (!s) return;
    s._tx = row[1];
    s._ty = row[2];
    if (s._nx == null) { s._nx = row[1]; s._ny = row[2]; }
    s.facing = row[3];
    s.walkPhase = row[4];
    s.hearts = row[5];
    s.alive = !!row[6];
    s.captured = !!row[7];
    s.score = row[8];
    s.deposits = row[9];
    s.rescues = row[10];
    s.shield = row[11];
    s.invulnUntil = G.t + row[12];
    s.invisUntil = G.t + row[13];
    s.speedUntil = G.t + row[14];
    s.alarmSpeedUntil = G.t + row[15];
    s.dashReadyAt = G.t + row[16];
    const ch = charOfNet(s.charId);
    s.carrying = (row[17] || []).map((roomId, i) => {
      const room = ROOMS.find(r => r.id === roomId) || ROOMS[0];
      return { id: 'c' + s.id + '_' + i, room: room.id, roomName: room.name, color: room.color, sorted: false, carriedBy: s.id };
    });
    s.doubleNext = !!row[18];
  });

  G.bins.forEach(b => {
    const row = (d.bn || []).find(x => x[0] === b.room);
    if (!row) return;
    b.filled = row[1];
    b.flashUntil = G.t + row[2];
  });

  G.bags = (d.bg || []).map(row => {
    const room = ROOMS.find(r => r.id === row[1]) || ROOMS[0];
    return {
      id: row[0], room: room.id, roomName: room.name, color: room.color,
      x: row[2], y: row[3], carriedBy: row[4] || null,
      lockUntil: G.t + row[5], phase: 0, sorted: false
    };
  });

  const w = G.warden;
  const wd = d.wd || [];
  w.x = wd[0]; w.y = wd[1]; w._nx = wd[0]; w._ny = wd[1];
  w.mode = wd[2] || 'idle';
  w.freezeUntil = G.t + (wd[5] || 0);
  w.stunUntil = G.t + (wd[6] || 0);
  w.facing = wd[7] || 0;
  w.targetKind = wd[4] || null;
  w.target = null;
  if (w.targetKind === 'student') w.target = netFindStudent(wd[3]);
  else if (w.targetKind === 'decoy') w.target = { x: wd[8], y: wd[9] };
  w.path = [];
  w.pathIdx = 0;

  if (d.cp) {
    const victim = netFindStudent(d.cp[0]);
    G.capture = victim ? { victim, endsAt: d.cp[1] } : null;
  } else {
    G.capture = null;
  }

  G.bells = (d.bl || []).map(row => ({
    x: row[0], y: row[1], until: G.t + row[2], phase: row[3] || 0
  }));

  if (d.stt) {
    G.stats.captures = d.stt[0];
    G.stats.rescues = d.stt[1];
    G.stats.deposits = d.stt[2];
  }

  (d.fd || []).forEach(item => {
    const key = item.at + '|' + item.text;
    if (NET.feedSeen.has(key)) return;
    NET.feedSeen.add(key);
    feed(item.text, item.color);
  });

  if (d.en) {
    if (!G.resultShown) showResultScreen();
  } else {
    updateHUD(false);
  }
}
function netClientFrame(dt) {
  if (!G || !netClientMode) return;
  const local = G.player;
  if (local && local._tx != null) {
    // Local prediction: react to keys immediately instead of waiting one snapshot.
    if (local.alive && !local.captured) {
      let dx = 0, dy = 0;
      if (keys.has('w') || keys.has('arrowup')) dy -= 1;
      if (keys.has('s') || keys.has('arrowdown')) dy += 1;
      if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
      if (keys.has('d') || keys.has('arrowright')) dx += 1;
      if (joystick.active && (Math.abs(joystick.nx) > 0.12 || Math.abs(joystick.ny) > 0.12)) {
        dx = joystick.nx;
        dy = joystick.ny;
      }
      if (dx || dy) {
        const len = Math.hypot(dx, dy);
        if (len > 1) { dx /= len; dy /= len; }
        moveAgent(local, dx, dy, dt, getStudentSpeed(local), 12);
        local.lastRoom = roomAt(local.x, local.y);
      }
    }
    // Reconcile softly. A wildly different position means a teleport/capture.
    const err = Math.hypot(local.x - local._tx, local.y - local._ty);
    if (err > 150) {
      local.x = local._tx;
      local.y = local._ty;
    } else if (err > 0.8) {
      const k = Math.min(1, dt * 8);
      local.x += (local._tx - local.x) * k;
      local.y += (local._ty - local.y) * k;
    }
  }
  for (const s of G.students) {
    if (s._tx == null || s.isPlayer) continue;
    const k = Math.min(1, dt * 18);
    s.x += (s._tx - s.x) * k;
    s.y += (s._ty - s.y) * k;
  }
  if (G.warden && G.warden._nx != null) {
    const k = Math.min(1, dt * 18);
    G.warden.x += (G.warden._nx - G.warden.x) * k;
    G.warden.y += (G.warden._ny - G.warden.y) * k;
  }
}

/* ---------------- restart / ui ---------------- */
function netRestart() {
  if (NET.role === 'host' && NET.started) {
    if (NET.players.length < 2) {
      showToast('👥', '还差一个人', '把房间码发给朋友，至少 2 人才能再来一局。', 'gold', 3000);
      return true;
    }
    const remoteList = NET.players.slice(1).map(p => ({ id: p.id, name: p.name, charId: p.charId }));
    startMultiGame(selectedCharId, remoteList);
    NET.hostCharId = selectedCharId;
    NET.players.forEach((p, i) => {
      p.slot = i;
      p.lastSeen = Date.now();
      if (G && G.students[i]) G.students[i].netId = p.id;
    });
    const assignments = G.students.map((s, i) => ({
      id: s.netId || ('ai' + i), name: s.name, charId: s.charId,
      human: s.isHuman, host: i === 0
    }));
    NET.players.forEach(p => {
      if (p.conn) netSend(p.conn, {
        type: 'start', hostCharId: selectedCharId, code: NET.code, assignments
      });
    });
    if (ui.pauseBtn) ui.pauseBtn.classList.add('hidden');
    netHostBroadcast();
    return true;
  }
  if (NET.role === 'guest') {
    showToast('⏳', '等房主开下一局', '联机模式的重开由房主决定。', 'gold', 2600);
    return true;
  }
  return false;
}

function netInit() {
  if (!mpEl.open || !mpEl.lobby) return;
  mpEl.open.addEventListener('click', () => {
    SFX.click();
    netOpenLobby();
  });
  if (mpEl.create) mpEl.create.addEventListener('click', () => { SFX.click(); netCreateRoom(); });
  if (mpEl.join) mpEl.join.addEventListener('click', () => { SFX.click(); netJoinRoom(); });
  if (mpEl.code) {
    mpEl.code.addEventListener('input', () => {
      mpEl.code.value = mpEl.code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      netError('');
    });
    mpEl.code.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); netJoinRoom(); }
    });
  }
  if (mpEl.start) mpEl.start.addEventListener('click', () => { SFX.click(); netHostStart(); });
  if (mpEl.leave) mpEl.leave.addEventListener('click', () => { SFX.click(); netLeave(); });
  if (mpEl.close) mpEl.close.addEventListener('click', () => {
    if (NET.role) netLeave();
    else { netHideLobby(); showMenu(); }
  });

  netHooks = {
    isClient: netIsClient,
    isMultiplayer: netIsMultiplayer,
    clientFrame: netClientFrame,
    restart: netRestart,
    leave: netLeave
  };
  window.__BAGHEIST_NET__ = {
    open: netOpenLobby,
    create: netCreateRoom,
    join: netJoinRoom,
    start: netHostStart,
    leave: netLeave,
    state: () => ({
      role: NET.role, code: NET.code, ready: NET.ready, started: NET.started,
      localId: NET.localId, players: netPublicPlayers(),
      client: netClientMode, gameState: state
    })
  };
}

netInit();

