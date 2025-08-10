(()=>{
  'use strict';

  // Constants
  const GRAVITY_BASE = 0.52;
  const RESTITUTION_BASE = 0.50;
  const TANGENTIAL_BASE = 0.90;
  const WALL_REST = 0.40;
  const AIR_DRAG = 0.006;
  const JITTER = 0.12;
  const MAX_VX = 2.2;
  const SPAWN_HEIGHT = 60;
  const INITIAL_VY = 0.90;
  const MIN_VY_AFTER_HIT = 0.16;

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
  const shapeSelect = document.getElementById('shapeSelect');

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
    pattern: 'flat3',
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
    const {risk, pattern, shape, rows, bet, ballColor, balance, streak, leaderboard, mode} = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({risk, pattern, shape, rows, bet, ballColor, balance, streak, leaderboard, mode}));
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
    patternSelect.addEventListener('change', () => { state.pattern = patternSelect.value; recomputeBoard(); saveState(); });
    rowsRange.addEventListener('input', () => { state.rows = parseInt(rowsRange.value, 10); rowsLabel.textContent = String(state.rows); recomputeBoard(); saveState(); });
    shapeSelect.addEventListener('change', () => { state.shape = shapeSelect.value; recomputeBoard(); saveState(); });

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
    patternSelect.value = state.pattern;
    rowsRange.value = String(state.rows);
    rowsLabel.textContent = String(state.rows);
    shapeSelect.value = state.shape || 'triangle';

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
    const gapX = 36; // horizontal spacing between pegs
    const gapY = Math.round(gapX * Math.sqrt(3) / 2); // vertical spacing for equilateral triangle spacing

    let topCount;
    let bottomCount;
    if ((state.shape || 'triangle') === 'triangle') {
      topCount = (state.pattern === 'point') ? 1 : 3;
      bottomCount = topCount + (rows - 1);
    } else {
      // square/circle use a constant width across
      const cols = rows + 2;
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
    const slotCount = effRows + 1;
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
    // Effective row count equals the number of pegs in the bottom row.
    const shape = state.shape || 'triangle';
    if (shape === 'triangle') {
      return state.pattern === 'point' ? (state.rows - 1) : (state.rows + 2);
    }
    // square/circle: use a constant width across
    return state.rows + 2;
  }

  function computePegs() {
    pegs = [];
    const rows = state.rows;
    const shape = state.shape || 'triangle';
    const gapX = 36;
    const gapY = Math.round(gapX * Math.sqrt(3) / 2);
    const startY = SPAWN_HEIGHT;

    if (shape === 'triangle') {
      const pattern = state.pattern;
      for (let r = 0; r < rows; r++) {
        let count;
        if (pattern === 'point') {
          count = 1 + r;
        } else if (pattern === 'flat3') {
          count = 3 + r;
        } else {
          count = 3 + r;
        }
        let bias = 0;
        if (pattern === 'leanL') bias = -0.4 * r;
        if (pattern === 'leanR') bias = 0.4 * r;

        const rowY = startY + r * gapY;
        for (let c = 0; c < count; c++) {
          const totalWidth = (count - 1) * gapX;
          let x = -totalWidth / 2 + c * gapX + bias;
          pegs.push({ x, y: rowY, r: 5 });
        }
      }

      if (pattern === 'sparse') {
        pegs = pegs.filter((p, i) => {
          if (p.y === startY) return true; // keep first row
          return rng() > 0.12; // remove ~12%
        });
      }
      return;
    }

    // Square / Circle
    const cols = rows + 2;
    const totalWidth = (cols - 1) * gapX;
    const gridRows = rows + 2;

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
    // Binomial probabilities p=0.5
    const probs = [];
    let total = 0;
    for (let k = 0; k <= rowsEff; k++) {
      const p = binomial(rowsEff, k) / Math.pow(2, rowsEff);
      probs.push(p);
      total += p;
    }
    for (let i = 0; i < probs.length; i++) probs[i] /= total;

    // Risk shaping
    const profiles = {
      verylow: { edgeBoost: 1.6, centerPenalty: 0.95 },
      low: { edgeBoost: 2.1, centerPenalty: 0.86 },
      medium: { edgeBoost: 3.0, centerPenalty: 0.70 },
      high: { edgeBoost: 4.2, centerPenalty: 0.52 },
      extreme: { edgeBoost: 6.0, centerPenalty: 0.40 },
    };
    const prof = profiles[state.risk] || profiles.medium;

    const shaped = [];
    const center = rowsEff / 2;
    let sum = 0;
    for (let i = 0; i < probs.length; i++) {
      const dist = Math.abs(i - center);
      const maxDist = center;
      const t = maxDist === 0 ? 0 : dist / maxDist; // 0 center, 1 edge
      const weight = (1 - t) * prof.centerPenalty + (t) * prof.edgeBoost;
      const v = Math.max(1e-6, probs[i] * weight);
      shaped.push(v);
      sum += v;
    }
    for (let i = 0; i < shaped.length; i++) shaped[i] /= sum;

    // Given RTP ~ 0.98, compute multipliers such that sum(prob * mult) = RTP
    const RTP = 0.98;
    slotMultipliers = shaped.map(p => RTP / p);

    // Rounding rules
    slotMultipliers = slotMultipliers.map(m => {
      if (m >= 10) return Math.round(m);
      if (m >= 5) return Math.round(m * 2) / 2; // .5 steps
      return Math.round(m * 10) / 10; // .1 steps
    });

    // Assign to slots if computed
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
    const radius = 14;
    const gap = (trapezoid.rightBottom - trapezoid.leftBottom) / (slots.length);
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const cx = s.cx;
      const cy = trapezoid.bottom - 28;
      const w = gap - 8;
      const h = 26;
      const x = cx - w / 2;
      const y = cy - h / 2;

      // glossy rounded chip
      const r = 8;
      roundRect(ctx, x, y, w, h, r);
      const grad = ctx.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, '#1b2140');
      grad.addColorStop(1, '#0f142b');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = '#2a3150';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // label
      ctx.fillStyle = '#cde1ff';
      ctx.font = 'bold 12px system-ui';
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

  // Physics
  function spawnBall() {
    const xCenter = (trapezoid.leftTop + trapezoid.rightTop) / 2;
    const rx = (rng() - 0.5) * 18;
    const color = state.ballColor;
    const base = {
      x: xCenter + rx,
      y: SPAWN_HEIGHT,
      vx: (rng() - 0.5) * 0.3,
      vy: INITIAL_VY,
      r: 6.5,
      color,
      windApplied: false,
      explodedPegId: null,
      trail: [],
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
    const dt = Math.min(32, time - lastTime); // clamp dt
    lastTime = time;

    autoTimer += dt;
    if (state.mode === 'auto' && autoTimer >= AUTO_INTERVAL) {
      autoTimer = 0;
      if (!dropBtn.disabled) tryDrop();
    }

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

        // Magnet pull toward best multiplier slot
        if (b.power?.magnet && slots.length) {
          let bestIdx = 0;
          let best = -Infinity;
          for (let i = 0; i < slots.length; i++) {
            if (slots[i].mult > best) { best = slots[i].mult; bestIdx = i; }
          }
          const targetX = slots[bestIdx].cx;
          const dir = Math.sign(targetX - b.x);
          b.vx += 0.02 * dir;
        }

        // Integrate
        b.vy += grav * dt * 60 / 100; // scale to feel right
        b.x += b.vx;
        b.y += b.vy;

        // Trail
        const tr = b.trail;
        if (tr) {
          tr.push({ x: b.x, y: b.y });
          if (tr.length > 18) tr.shift();
        }

        // Wind once at mid
        const midY = (trapezoid.bottom - trapezoid.top) * 0.5;
        if (b.power?.wind && !b.windApplied && b.y > midY) {
          b.vx += (rng() < 0.5 ? -0.8 : 0.8);
          b.windApplied = true;
        }

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

            // Reflect
            const vn = b.vx * nx + b.vy * ny;
            const vtX = b.vx - vn * nx;
            const vtY = b.vy - vn * ny;

            let rest = RESTITUTION_BASE;
            let tang = TANGENTIAL_BASE;
            if (b.power?.bumper) {
              rest = Math.min(0.85, RESTITUTION_BASE + 0.25);
              tang = Math.min(1.0, TANGENTIAL_BASE + 0.08);
            }

            const j = -(1 + rest) * vn;
            b.vx = vtX * tang + j * nx;
            b.vy = vtY * tang + j * ny;

            // Jitter
            b.vx += (rng() - 0.5) * JITTER * 0.1;

            // Clamp and floor vy
            b.vx = Math.max(-MAX_VX, Math.min(MAX_VX, b.vx));
            if (Math.abs(b.vy) < MIN_VY_AFTER_HIT) b.vy = Math.sign(b.vy) * MIN_VY_AFTER_HIT;

            // Explode peg once
            if (b.power?.explode && b.explodedPegId == null) {
              p.r = 0; // remove
              b.explodedPegId = i;
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
      ctx.shadowColor = b.color + 'aa';
      ctx.shadowBlur = 6;
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
