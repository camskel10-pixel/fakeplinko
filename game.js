(()=>{
  'use strict';

  // Constants
  const GRAVITY_BASE = 1.0; // vertical only
  const RESTITUTION_BASE = 0.10; // gentle bounces
  const TANGENTIAL_BASE = 1.0; // preserve slide
  const WALL_REST = 0.03; // low restitution on walls/static
  const AIR_DRAG = 0.012; // light damping  const JITTER = 0.0; // no random kicks
  const MAX_VX = 2.0; // further limited per vy each tick
  const SPAWN_HEIGHT = 60;
  const INITIAL_VY = 1.0;
  const MIN_VY_AFTER_HIT = 0.10;

  const STORAGE_KEY = 'plinko.save.v2';

  // Elements
  const canvas = document.getElementById('board');
  const leftPanel = document.getElementById('leftPanel');
  const rightPanel = document.getElementById('rightPanel');
  const collapseLeftBtn = document.getElementById('collapseLeft');
  const collapseRightBtn = document.getElementById('collapseRight');

  const modeTabs = document.getElementById('modeTabs');
  const modeManualBtn = document.getElementById('modeManual');
  const modeAutoBtn = document.getElementById('modeAuto');

  const betHalfBtn = document.getElementById('betHalf');
  const betDoubleBtn = document.getElementById('betDouble');
  const betInput = document.getElementById('betInput');

  const riskSelect = document.getElementById('riskSelect');
  const patternSelect = document.getElementById('patternSelect');
  const rowsRange = document.getElementById('rowsRange');
  const rowsLabel = document.getElementById('rowsLabel');

  const chipRow = document.getElementById('chipRow');
  const dropBtn = document.getElementById('dropBtn');

  const balanceEl = document.getElementById('balance');
  const streakEl = document.getElementById('streak');
  const leaderboardEl = document.getElementById('leaderboard');
  const resetProgressBtn = document.getElementById('resetProgress');
  const resetBalanceBtn = document.getElementById('resetBalance');

  const powerButtons = Array.from(document.querySelectorAll('.power'));

  // Canvas state
  const ctx = canvas.getContext('2d');
  let DPR = Math.max(1, Math.min(3, window.devicePixelRatio || 1));

  // Game state
  const defaultState = {
    risk: 'medium',
    shape: 'triangle',
    rows: 12,
    bet: 1.0,
    ballColor: '#4dd2ff',
    balance: 100.0,
    streak: 0,
    leaderboard: [],
    mode: 'manual',
  };

  let state = loadState();

  // RNG
  function mulberry32(seed) {
    let t = seed >>> 0;
    return function() {
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ t >>> 15, 1 | t);
      r ^= r + Math.imul(r ^ r >>> 7, 61 | r);
      return ((r ^ r >>> 14) >>> 0) / 4294967296;
    };
  }
  let rng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);

  // Peg grid and geometry
  let pegs = [];
  let slots = [];
  let trapezoid = { top: 0, bottom: 0, leftTop: 0, rightTop: 0, leftBottom: 0, rightBottom: 0 };
  let boardScale = 1;
  let tx = 0, ty = 0;

  // Power-ups (applied to next drop only)
  const powerups = {
    magnet: false,
    wind: false,
    slow: false,
    bumper: false,
    multiball: false,
    explode: false,
  };

  // Runtime
  let nextBallId = 1;
  let balls = [];
  let lastTime = 0;
  let autoTimer = 0;
  const AUTO_INTERVAL = 260; // ms

  // Initialize UI
  initChips();
  attachEvents();
  syncUIFromState();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...defaultState };
      const parsed = JSON.parse(raw);
      return { ...defaultState, ...parsed };
    } catch {
      return { ...defaultState };
    }
  }
  function saveState() {
    const {risk, shape, rows, bet, ballColor, balance, streak, leaderboard, mode} = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({risk, shape, rows, bet, ballColor, balance, streak, leaderboard, mode}));
  }

  function initChips() {
    const chips = chipRow.querySelectorAll('.chip');
    chips.forEach((chip, idx) => {
      const hex = chip.getAttribute('data-color');
      const label = chip.getAttribute('aria-label') || hex;
      chip.title = label;
      chip.style.background = `radial-gradient(140% 140% at 30% 20%, ${hex} 0%, ${hex}80 50%, ${hex}33 75%, #111 100%)`;
      if (hex.toLowerCase() === state.ballColor.toLowerCase() || (idx === 0 && !state.ballColor)) {
        chip.classList.add('active');
      }
      chip.addEventListener('click', () => {
        chipRow.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.ballColor = hex;
        saveState();
      });
    });
  }

  function attachEvents() {
    // Mode
    modeTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      modeManualBtn.classList.toggle('active', btn === modeManualBtn);
      modeAutoBtn.classList.toggle('active', btn === modeAutoBtn);
      modeManualBtn.setAttribute('aria-selected', String(btn === modeManualBtn));
      modeAutoBtn.setAttribute('aria-selected', String(btn === modeAutoBtn));
      state.mode = btn.dataset.mode;
      saveState();
    });

    // Bet
    betHalfBtn.addEventListener('click', () => { setBet(Math.max(0.1, roundMoney(state.bet / 2))); });
    betDoubleBtn.addEventListener('click', () => { setBet(roundMoney(state.bet * 2)); });
    betInput.addEventListener('input', () => {
      const v = Math.max(0.1, parseFloat(betInput.value || '0'));
      setBet(v);
    });

    // Selects and range
    riskSelect.addEventListener('change', () => { state.risk = riskSelect.value; recomputeBoard(); saveState(); });
    patternSelect.addEventListener('change', () => { state.shape = patternSelect.value; recomputeBoard(); saveState(); });
    rowsRange.addEventListener('input', () => { state.rows = parseInt(rowsRange.value, 10); rowsLabel.textContent = String(state.rows); recomputeBoard(); saveState(); });

    // Drop
    dropBtn.addEventListener('click', tryDrop);

    // Canvas pointer to drop when clicking near top 35%
    canvas.addEventListener('pointerdown', (e) => {
      if (state.mode !== 'manual') return;
      const rect = canvas.getBoundingClientRect();
      const y = e.clientY - rect.top;
      if (y <= rect.height * 0.35) tryDrop();
    });

    // Reset
    resetProgressBtn.addEventListener('click', () => {
      localStorage.removeItem(STORAGE_KEY);
      state = { ...defaultState };
      syncUIFromState();
      recomputeBoard();
    });

    // Reset balance to $1,000
    resetBalanceBtn?.addEventListener('click', () => {
      state.balance = 1000.0;
      state.streak = 0;
      updateBalanceAndStreak();
      saveState();
    });

    // Collapse panels
    collapseLeftBtn.addEventListener('click', () => {
      leftPanel.classList.toggle('collapsed');
      resizeCanvas();
    });
    collapseRightBtn.addEventListener('click', () => {
      rightPanel.classList.toggle('collapsed');
      resizeCanvas();
    });

    // Resize
    window.addEventListener('resize', () => { applyResponsivePanels(); resizeCanvas(); });
    window.addEventListener('orientationchange', () => { applyResponsivePanels(); resizeCanvas(); });

    // Apply initial responsive layout for mobile
    applyResponsivePanels();

    // Auto loop will handle auto mode timing inside update
  }

  function syncUIFromState() {
    // Mode
    const isManual = state.mode !== 'auto';
    modeManualBtn.classList.toggle('active', isManual);
    modeAutoBtn.classList.toggle('active', !isManual);
    modeManualBtn.setAttribute('aria-selected', String(isManual));
    modeAutoBtn.setAttribute('aria-selected', String(!isManual));

    // Bet
    betInput.value = String(state.bet.toFixed(2));

    // Selects
    riskSelect.value = state.risk;
    patternSelect.value = state.shape || 'triangle';
    rowsRange.value = String(state.rows);
    rowsLabel.textContent = String(state.rows);

    // Balance/Streak
    updateBalanceAndStreak();

    // Chips active state
    chipRow.querySelectorAll('.chip').forEach(ch => {
      const hex = ch.getAttribute('data-color') || '';
      ch.classList.toggle('active', hex.toLowerCase() === state.ballColor.toLowerCase());
    });

    updateDropEnabled();

    renderLeaderboard();
  }

  function setBet(v) {
    state.bet = Math.max(0.1, roundMoney(v));
    betInput.value = String(state.bet.toFixed(2));
    updateDropEnabled();
    saveState();
  }

  function updateDropEnabled() {
    dropBtn.disabled = state.balance < state.bet - 1e-9;
  }

  function updateBalanceAndStreak() {
    balanceEl.textContent = state.balance.toFixed(2);
    streakEl.textContent = String(state.streak);
    updateDropEnabled();
  }

  function renderLeaderboard() {
    leaderboardEl.innerHTML = '';
    const top = (state.leaderboard || []).slice(0, 10);
    for (let i = 0; i < top.length; i++) {
      const e = top[i];
      const li = document.createElement('li');
      const date = new Date(e.date || Date.now());
      const rank = i + 1;
      li.textContent = `#${rank}  ${formatMoney(e.payout)} — ${e.mult}x · ${e.rows} rows · ${e.risk} · ${date.toLocaleDateString()}`;
      leaderboardEl.appendChild(li);
    }
  }

  function formatMoney(n){ return `$${n.toFixed(2)}`; }
  function roundMoney(n){ return Math.round(n * 100) / 100; }

  // Board compute
  function recomputeBoard() {
    computeGeometry();
    computePegs();
    computeMultipliers();
    resizeCanvas();
  }

  function computeGeometry() {
    const rows = state.rows;
    const gapX = 28; // horizontal spacing between pegs
    const gapY = 24; // vertical spacing

    let topCount;
    let bottomCount;
    if ((state.shape || 'triangle') === 'triangle') {
          const TOP_COUNT = 3; // flat top of 3
    topCount = TOP_COUNT;
    bottomCount = TOP_COUNT + (rows - 1);
} else {
      // square/circle use a constant width across matching slots = rows + 1
      const cols = rows + 1;
      topCount = cols;
      bottomCount = cols;
    }

    const topPegWidth = Math.max(0, (topCount - 1) * gapX);
    const bottomPegWidth = Math.max(0, (bottomCount - 1) * gapX);

    // Board horizontal padding inside outline
    const padTopX = 60;
    const padBottomX = 140;

    const topWidth = topPegWidth + padTopX;
    const bottomWidth = bottomPegWidth + padBottomX;

    // Height to include spawn area + all rows + slot area
    const gridRowsForHeight = ((state.shape || 'triangle') === 'triangle') ? rows : (rows + 2);
    const height = SPAWN_HEIGHT + (gridRowsForHeight - 1) * gapY + 120;

    trapezoid.top = 0;
    trapezoid.bottom = height;
    trapezoid.leftTop = -topWidth / 2;
    trapezoid.rightTop = topWidth / 2;
    trapezoid.leftBottom = -bottomWidth / 2;
    trapezoid.rightBottom = bottomWidth / 2;

    // Slots aligned to bottom width
    const effRows = effectiveRows();
    const slotCount = effRows + 1; // slots = rows + 1
    const slotGap = (trapezoid.rightBottom - trapezoid.leftBottom) / slotCount;
    slots = [];
    for (let i = 0; i < slotCount; i++) {
      const x0 = trapezoid.leftBottom + i * slotGap;
      const x1 = trapezoid.leftBottom + (i + 1) * slotGap;
      const cx = (x0 + x1) / 2;
      slots.push({ index: i, cx, x0, x1, mult: 1 });
    }
  }

  function effectiveRows() {
    const shape = state.shape || 'triangle';
    if (shape === 'triangle') {
      // With top=3, bottom pegs = rows + 2, slots = bottom + 1 = rows + 3
      return state.rows + 2;
    }
    // Square/Circle: constant width => slots = rows + 2 => effRows = rows + 1
    return state.rows + 1;
  }

  function computePegs() {
    pegs = [];
    const rows = state.rows;
    const shape = state.shape || 'triangle';
    const gapX = 28;
    const gapY = 24;
    const startY = SPAWN_HEIGHT + 30; // topY offset

    if (shape === 'triangle') {
      const TOP_COUNT = 3;
      for (let r = 0; r < rows; r++) {
        const count = TOP_COUNT + r; // 3,4,5,...
        const rowY = startY + r * gapY;
        const totalWidth = (count - 1) * gapX;
        for (let c = 0; c < count; c++) {
          const x = -totalWidth / 2 + c * gapX;
          pegs.push({ x, y: rowY, r: 5 });
        }
      }
      return;
    }

    // Square / Circle
    const cols = rows + 1;
    const totalWidth = (cols - 1) * gapX;
    const gridRows = rows + 1;

    for (let r = 0; r < gridRows; r++) {
      const rowY = startY + r * gapY;
      for (let c = 0; c < cols; c++) {
        const x = -totalWidth / 2 + c * gapX;
        pegs.push({ x, y: rowY, r: 5 });
      }
    }

    if (shape === 'circle') {
      // Keep only pegs within a circle centered at (0, startY + (gridRows-1)*gapY/2)
      const cy = startY + (gridRows - 1) * gapY / 2;
      const radius = Math.min(totalWidth / 2, (gridRows - 1) * gapY / 2);
      pegs = pegs.filter(p => {
        const dx = p.x - 0;
        const dy = p.y - cy;
        return (dx*dx + dy*dy) <= (radius * radius);
      });
    }
  }

  // Multipliers and probabilities
  let slotMultipliers = [];
  function computeMultipliers() {
    const rowsEff = effectiveRows();
    const slotsCount = rowsEff + 1;
    const risk = state.risk || 'medium';

    // Exact symmetric sets for 16 rows
    const presets16 = {
      low:   [18, 8, 4, 2.5, 1.8, 1.4, 1.2, 1.0, 0.9, 1.0, 1.2, 1.4, 1.8, 2.5, 4, 8, 18],
      medium:[110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
      high:  [220, 75, 20, 8, 4, 2.2, 1.2, 0.6, 0.25, 0.6, 1.2, 2.2, 4, 8, 20, 75, 220],
    };

    if (rowsEff === 16) {
      const arr = presets16[risk] || presets16.medium;
      slotMultipliers = arr.slice();
      for (let i = 0; i < slots.length && i < slotMultipliers.length; i++) slots[i].mult = slotMultipliers[i];
      return;
    }

    // Otherwise generate programmatically using binomial probabilities
    const RTPs = { low: 0.96, medium: 0.94, high: 0.92 };
    const targetRTP = RTPs[risk] || 0.94;
    const probs = [];
    for (let k = 0; k <= rowsEff; k++) probs.push(binomial(rowsEff, k) / Math.pow(2, rowsEff));
    const centerIdx = Math.floor(slotsCount / 2);

    // Binomial-shaped multipliers: high edges, low center
    const gamma = risk === 'low' ? 0.55 : risk === 'high' ? 1.15 : 0.9; // edge emphasis
    const centerFloor = risk === 'low' ? 1.0 : risk === 'high' ? 0.3 : 0.5;
    const shape = probs.map(x => Math.pow(1 / Math.max(1e-9, x), gamma));
    const sC = shape[centerIdx];
    for (let i = 0; i < shape.length; i++) shape[i] /= sC;

    // Solve scale so EV matches RTP: sum p[i]*(base + s*(shape[i]-1)) = RTP
    const base = centerFloor;
    const denom = probs.reduce((a, pi, i) => a + pi * (shape[i] - 1), 0);
    const s = Math.max(0.01, (targetRTP - base) / Math.max(1e-9, denom));
    slotMultipliers = shape.map(v => Math.max(0.1, base + s * (v - 1)));

    // Round presentation
    slotMultipliers = slotMultipliers.map(m => {
      if (m >= 100) return Math.round(m);
      if (m >= 10) return Math.round(m);
      if (m >= 5) return Math.round(m * 2) / 2;
      return Math.round(m * 10) / 10;
    });

    if (slots.length === slotMultipliers.length) {
      for (let i = 0; i < slots.length; i++) slots[i].mult = slotMultipliers[i];
    }
  }

  function binomial(n, k) {
    if (k < 0 || k > n) return 0;
    if (k === 0 || k === n) return 1;
    k = Math.min(k, n - k);
    let c = 1;
    for (let i = 0; i < k; i++) {
      c = (c * (n - i)) / (i + 1);
    }
    return c;
  }

  // Collapse side panels automatically on small screens for mobile usability
  function applyResponsivePanels() {
    const isNarrow = window.innerWidth < 700;
    leftPanel.classList.toggle('collapsed', isNarrow);
    rightPanel.classList.toggle('collapsed', false); // keep stats visible; user can collapse manually
  }

  // Resize and fit canvas between panels
  function resizeCanvas() {
    DPR = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const leftW = leftPanel.classList.contains('collapsed') ? 22 : leftPanel.offsetWidth;
    const rightW = rightPanel.classList.contains('collapsed') ? 22 : rightPanel.offsetWidth;

    const availW = Math.max(200, window.innerWidth - leftW - rightW);
    const availH = window.innerHeight;

    // Compute transform to fit trapezoid into available area with some padding
    const pad = 8; // reduced padding to make board appear larger
    const boardWidthTop = trapezoid.rightTop - trapezoid.leftTop;
    const boardWidthBottom = trapezoid.rightBottom - trapezoid.leftBottom;
    const boardWidth = Math.max(boardWidthTop, boardWidthBottom);
    const boardHeight = trapezoid.bottom - trapezoid.top;

    const scaleX = (availW - pad * 2) / boardWidth;
    const scaleY = (availH - pad * 2) / boardHeight;
    boardScale = Math.max(0.1, Math.min(scaleX, scaleY));

    const canvasWidth = Math.floor(availW * DPR);
    const canvasHeight = Math.floor(availH * DPR);
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    canvas.style.width = `${availW}px`;
    canvas.style.height = `${availH}px`;

    tx = Math.floor((availW / 2) * DPR);
    ty = Math.floor((pad + 0) * DPR);

    drawStatic();
  }

  function setTransform() {
    ctx.setTransform(DPR * boardScale, 0, 0, DPR * boardScale, tx, ty);
  }

  function clearAll() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawStatic() {
    clearAll();
    setTransform();

    // Trapezoid frame
    ctx.save();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#2f3852';
    ctx.fillStyle = '#0a0c12';
    ctx.beginPath();
    ctx.moveTo(trapezoid.leftTop, trapezoid.top);
    ctx.lineTo(trapezoid.rightTop, trapezoid.top);
    ctx.lineTo(trapezoid.rightBottom, trapezoid.bottom);
    ctx.lineTo(trapezoid.leftBottom, trapezoid.bottom);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Pegs
    for (const p of pegs) {
      if (p.r <= 0) continue;
      ctx.beginPath();
      ctx.fillStyle = '#7ab8ff';
      ctx.shadowColor = '#7ab8ff88';
      ctx.shadowBlur = 8;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Slots
    drawSlots();
  }

  function drawSlots() {
    const gap = (trapezoid.rightBottom - trapezoid.leftBottom) / (slots.length);
    if (!slots.length) return;
    const mults = slots.map(s => s.mult);
    const min = Math.min(...mults), max = Math.max(...mults);

    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const cx = s.cx;
      const cy = trapezoid.bottom - 24;
      // colored text only, no boxes
      const color = colorForMultiplier(s.mult, min, max);
      ctx.fillStyle = color;
      ctx.font = 'bold 13px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${s.mult}x`, cx, cy);
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function colorForMultiplier(m, min, max) {
    const denom = Math.max(1e-6, max - min);
    const t = Math.pow((m - min) / denom, 0.7);
    const hue = 200 - t * 200; // 200 (blue) -> 0 (red)
    const sat = 88;
    const light = 52;
    return `hsl(${hue}, ${sat}%, ${light}%)`;
  }

  // Physics
  function spawnBall() {
    const xCenter = (trapezoid.leftTop + trapezoid.rightTop) / 2;
    const color = state.ballColor;
    const sign = ((state._dropId = (state._dropId || 0) + 1) % 2 === 0) ? 1 : -1;
    const rand = Math.random();
    const jx = (rand * 2 - 1) * 0.08; // tiny horizontal jitter per spec
    const base = {
      x: xCenter + sign * 0.5,
      y: SPAWN_HEIGHT,
      vx: jx,
      vy: INITIAL_VY,
      r: 6.5,
      color,
      windApplied: false,
      explodedPegId: null,
      trail: [],
      contact: { pegId: null, sinceMs: 0 },
    };
    if (powerups.multiball) {
      const dx = 8;
      return [
        { ...base, x: base.x - dx, vx: base.vx - 0.12 },
        { ...base },
        { ...base, x: base.x + dx, vx: base.vx + 0.12 },
      ];
    }
    return [base];
  }

  function tryDrop() {
    if (state.balance < state.bet - 1e-9) return;
    // Consume powerups flags after spawning
    const active = { ...powerups };

    const spawned = spawnBall();
    for (const b of spawned) {
      b.power = { ...active };
      b.id = nextBallId++;
      balls.push(b);
    }

    // Deduct bet once per drop (not per ball)
    state.balance = roundMoney(state.balance - state.bet);
    updateBalanceAndStreak();

    // Reset powerup UI and flags (next drop only)
    for (const key of Object.keys(powerups)) powerups[key] = false;
    powerButtons.forEach(btn => btn.classList.remove('active'));

    saveState();
  }

  powerButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.power;
      powerups[key] = !powerups[key];
      btn.classList.toggle('active', powerups[key]);
    });
  });

  function update(time) {
    if (!lastTime) lastTime = time;
    const dtRaw = time - lastTime;
    const dt = Math.min(32, Math.max(8, dtRaw)); // clamp timestep spikes
    lastTime = time;

    autoTimer += dt;
    if (state.mode === 'auto' && autoTimer >= AUTO_INTERVAL) {
      autoTimer = 0;
      if (!dropBtn.disabled) tryDrop();
    }

    // Solver quality hints (no Matter.js, but we emulate via substeps in stepPhysics)
    stepPhysics(dt);
    drawFrame();

    requestAnimationFrame(update);
  }

  function stepPhysics(dtMs) {
    const steps = Math.max(1, Math.floor(dtMs / 16));
    const dt = 16 / 1000; // fixed step ~60fps

    for (let s = 0; s < steps; s++) {
      for (const b of balls) {
        // Gravity with slow-motion
        const gScale = b.power?.slow ? 0.45 : 1;
        const grav = GRAVITY_BASE * gScale;

        // Air drag
        b.vx *= (1 - AIR_DRAG);
        b.vy *= (1 - AIR_DRAG);

        // Magnet removed for stable plinko physics

        // Integrate
        b.vy += grav * dt * 60 / 60; // faster gravity application
        b.x += b.vx;
        b.y += b.vy;

        // Trail
        const tr = b.trail;
        if (tr) {
          tr.push({ x: b.x, y: b.y });
          if (tr.length > 18) tr.shift();
        }

        // Wind removed for stable plinko physics

        // Collide with pegs
        for (let i = 0; i < pegs.length; i++) {
          const p = pegs[i];
          if (p.r <= 0) continue;
          const dx = b.x - p.x;
          const dy = b.y - p.y;
          const r = (b.r + p.r);
          const d2 = dx*dx + dy*dy;
          if (d2 <= r*r) {
            const d = Math.sqrt(Math.max(1e-6, d2));
            const nx = dx / d;
            const ny = dy / d;
            // pushout
            const overlap = r - d + 0.01;
            b.x += nx * overlap;
            b.y += ny * overlap;

            // Minimal horizontal bias to break perfect top-center symmetry (no vy change)
            if (b.vy > 0 && Math.abs(b.vx) < 0.02) {
              const sign = (b.id % 2 === 0) ? 1 : -1;
              b.vx += sign * 0.06;
            }
          }
        }

                 // Collide with trapezoid walls (lines)
         collideWalls(b);
}

      // Remove balls that reached bottom and settle payouts
      const remain = [];
      for (const b of balls) {
        if (b.y < trapezoid.bottom - 12) { remain.push(b); continue; }
        // Determine slot by x at bottom
        const xBottom = remapXAtBottom(b.x);
        const idx = Math.max(0, Math.min(slots.length - 1, Math.floor((xBottom - trapezoid.leftBottom) / ((trapezoid.rightBottom - trapezoid.leftBottom) / slots.length))));
        const mult = slots[idx]?.mult || 1;
        const payout = roundMoney(state.bet * mult);
        state.balance = roundMoney(state.balance + payout);

        // Streak update
        if (mult > 1) state.streak += 1; else state.streak = 0;

        // Leaderboard
        addLeaderboard({ payout, mult, rows: state.rows, risk: state.risk, date: Date.now() });

        updateBalanceAndStreak();
        saveState();
      }
      balls = remain;
    }
  }

  function collideWalls(b) {
    // Left and right walls are lines between top and bottom edges
    // Parametric wall x(y) = leftTop + t*(leftBottom-leftTop) with t = (y-top)/(bottom-top)
    const t = (b.y - trapezoid.top) / (trapezoid.bottom - trapezoid.top);
    const leftX = trapezoid.leftTop + t * (trapezoid.leftBottom - trapezoid.leftTop);
    const rightX = trapezoid.rightTop + t * (trapezoid.rightBottom - trapezoid.rightTop);

    // Left wall normal points inward (1,0)
    if (b.x - b.r < leftX) {
      const pen = leftX - (b.x - b.r);
      b.x += pen + 0.01;
      b.vx = Math.abs(b.vx) * WALL_REST;
    }
    // Right wall normal points inward (-1,0)
    if (b.x + b.r > rightX) {
      const pen = (b.x + b.r) - rightX;
      b.x -= pen + 0.01;
      b.vx = -Math.abs(b.vx) * WALL_REST;
    }

    // Top cap
    if (b.y - b.r < trapezoid.top) {
      const pen = trapezoid.top - (b.y - b.r);
      b.y += pen + 0.01;
      b.vy = Math.abs(b.vy) * WALL_REST;
    }
  }

  function remapXAtBottom(x) {
    // No change; bottom is linear
    return x;
  }

  function drawFrame() {
    drawStatic();
    setTransform();

    // Trails
    for (const b of balls) {
      const tr = b.trail || [];
      for (let i = 0; i < tr.length; i++) {
        const t = i / tr.length;
        const alpha = Math.max(0, Math.min(1, t)) * 0.6; // fade in
        const radius = Math.max(1.5, b.r * (0.35 + 0.65 * t));
        ctx.beginPath();
        ctx.fillStyle = hexWithAlpha(b.color, alpha);
        ctx.arc(tr[i].x, tr[i].y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Balls
    for (const b of balls) {
      ctx.beginPath();
      ctx.fillStyle = b.color;
      ctx.shadowColor = b.color + '33';
      ctx.shadowBlur = 3;
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function addLeaderboard(entry) {
    state.leaderboard.push(entry);
    state.leaderboard.sort((a, b) => b.payout - a.payout);
    state.leaderboard = state.leaderboard.slice(0, 10);
    renderLeaderboard();
  }

  function hexWithAlpha(hex, alpha) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return `rgba(255,255,255,${alpha})`;
    const r = parseInt(m[1], 16);
    const g = parseInt(m[2], 16);
    const b = parseInt(m[3], 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // Initial build
  recomputeBoard();
  resizeCanvas();
  requestAnimationFrame(update);

})();
