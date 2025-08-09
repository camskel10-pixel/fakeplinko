(() => {
  // DOM helpers
  const canvas = document.getElementById('stage');
  const ctx    = canvas.getContext('2d');
  const manualBtn   = document.getElementById('manualBtn');
  const autoBtn     = document.getElementById('autoBtn');
  const betEl       = document.getElementById('bet');
  const betHalf     = document.getElementById('betHalf');
  const betDouble   = document.getElementById('betDouble');
  const riskEl      = document.getElementById('risk');
  const patternEl   = document.getElementById('pattern');
  const rowsEl      = document.getElementById('rows');
  const rowsLabel   = document.getElementById('rowsLabel');
  const dropBtn     = document.getElementById('dropBtn');
  const balanceEl   = document.getElementById('balance');
  const streakEl    = document.getElementById('streak');
  const lbList      = document.getElementById('lbList');
  const resetBtn    = document.getElementById('resetBtn');
  const chipsWrap   = document.getElementById('ballColors');
  let DPR   = Math.max(1, window.devicePixelRatio || 1);
  let W=0, H=0;

  // Settings with local save
  const SAVE_KEY = 'plinko.save.v2';
  let settings = {
    risk:    riskEl.value,
    pattern: patternEl.value,
    rows:    parseInt(rowsEl.value, 10),
    bet:     parseFloat(betEl.value) || 1,
    ballColor: '#8cb6ff',
    balance: 1000,
    streak: 1,
    leaderboard: []
  };
  loadSave();

  // Game state
  let pegs=[], slots=[], balls=[];
  let boardScale=1, tx=0, ty=0, boardHeightEst=0, availW=0;
  let leftPad=0, rightPad=0;
  let topOffset = 68;
  let pegSpacingX=30, pegSpacingY=34, pegRadius=5;
  let topLeft, topRight, baseLeft, baseRight, nLeft, nRight;
  // Physics constants
  const GRAVITY=0.31, RESTITUTION=0.50, TANGENTIAL=0.88, WALL_REST=0.40, AIR_DRAG=0.010;
  const JITTER=0.10, MAX_VX=1.6, SPAWN_HEIGHT=60, INITIAL_VY=0.65, MIN_VY_AFTER_HIT=0.12;
  let auto=false, lastDrop=0, dropInterval=260;
  let balance=settings.balance, streak=settings.streak;
  let rng = mulberry32(Date.now()>>>0);

  // Size & board build
  function size(){
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width  = Math.floor(W*DPR);
    canvas.height = Math.floor(H*DPR);
    ctx.setTransform(DPR,0,0,DPR,0,0);
    // compute side space
    leftPad  = document.getElementById('left').getBoundingClientRect().width + 10;
    rightPad = document.getElementById('right').getBoundingClientRect().width + 10;
    buildBoard();
    computeScale();
  }
  function buildBoard(){
    pegs = []; slots = [];
    settings.rows = parseInt(rowsEl.value, 10);
    rowsLabel.textContent = settings.rows;
    availW  = Math.max(220, W - leftPad - rightPad);
    pegSpacingY = Math.min(44, Math.max(24, Math.floor((H-220)/settings.rows)));
    pegSpacingX = Math.min(48, Math.max(22, Math.floor(availW/(3 + settings.rows))));
    pegRadius   = Math.max(4, Math.min(6, Math.floor(Math.min(pegSpacingX, pegSpacingY) * 0.22)));
    topOffset   = Math.max(54, Math.min(110, Math.floor(H * 0.10)));
    let firstCount = settings.pattern === 'point' ? 1 : 3;
    const lastCount  = settings.pattern === 'point' ? settings.rows : (3 + settings.rows - 1);
    const baseY = topOffset + (settings.rows - 1)*pegSpacingY + 36;
    const firstRowWidth = (firstCount - 1) * pegSpacingX;
    const centerX = leftPad + availW/2;
    topLeft  = {x: centerX - firstRowWidth/2 - 12, y: topOffset};
    topRight = {x: centerX + firstRowWidth/2 + 12, y: topOffset};
    const lastRowWidth = (lastCount - 1) * pegSpacingX;
    baseLeft  = {x: centerX - lastRowWidth/2 - 16, y: baseY};
    baseRight = {x: centerX + lastRowWidth/2 + 16, y: baseY};
    nLeft  = inwardNormal(topLeft.x, topLeft.y, baseLeft.x, baseLeft.y);
    nRight = inwardNormal(topRight.x, topRight.y, baseRight.x, baseRight.y);
    // Build pegs by pattern
    for(let r=0; r<settings.rows; r++){
      let count = settings.pattern === 'point' ? (1 + r) : (3 + r);
      let rowY = topOffset + r * pegSpacingY;
      let rowWidth = (count - 1) * pegSpacingX;
      let bias = 0;
      if(settings.pattern==='leanL') bias = -r*0.18*pegSpacingX;
      if(settings.pattern==='leanR') bias =  r*0.18*pegSpacingX;
      let startX = centerX - rowWidth / 2 + bias;
      for(let c=0; c<count; c++){
        if(settings.pattern==='sparse' && r>1 && rng() < 0.12) continue;
        pegs.push({x: startX + c * pegSpacingX, y: rowY, r: pegRadius});
      }
    }
    const nSlots=lastCount+1, slotW=pegSpacingX;
    let slotStart = centerX - (nSlots-1) * slotW / 2;
    for(let i=0; i<nSlots; i++) slots.push({x: slotStart + i*slotW, y: baseY, w: slotW, mult:1});
    updateMultipliers();
    boardHeightEst = baseY + 64;
  }
  function computeScale(){
    const maxH = H - 16;
    boardScale = Math.min(1, maxH / boardHeightEst);
    const scaledBoardW = (W - leftPad - rightPad) * boardScale;
    tx = leftPad + ((W - leftPad - rightPad) - scaledBoardW)/2 - leftPad*(boardScale-1);
    ty = Math.max(8, (H - boardHeightEst*boardScale) / 2);
  }
  function inwardNormal(ax,ay,bx,by){
    let nx=-(by-ay), ny=(bx-ax); const len=Math.hypot(nx,ny)||1; nx/=len; ny/=len;
    const cx=(ax+bx)/2, cy=(ay+by)/2; const toC = (W/2-cx)*nx + (H/2-cy)*ny;
    if(toC < 0){ nx=-nx; ny=-ny; }
    return {x:nx,y:ny};
  }

  // Multipliers based on risk
  function buildMultipliers(effectiveRows, risk){
    const nSlots=effectiveRows+1, nRows=effectiveRows;
    const probs=[]; for(let k=0; k<nSlots; k++) probs.push(binom(nRows,k,0.5));
    let edgeBoost, centerPenalty;
    switch(risk){
      case 'verylow': edgeBoost=1.6; centerPenalty=0.95; break;
      case 'low':     edgeBoost=2.1; centerPenalty=0.86; break;
      case 'medium':  edgeBoost=3.0; centerPenalty=0.70; break;
      case 'high':    edgeBoost=4.2; centerPenalty=0.52; break;
      case 'extreme': edgeBoost=6.0; centerPenalty=0.40; break;
      case 'safe':    edgeBoost=1.3; centerPenalty=0.98; break;
      default:        edgeBoost=3.0; centerPenalty=0.70;
    }
    const mid=(nSlots-1)/2;
    const raw=[]; for(let k=0; k<nSlots; k++){
      const d=Math.abs(k-mid)/Math.max(1,mid);
      const shape=1+d*(edgeBoost-1);
      const centerAdj=1-(1-centerPenalty)*(1-d);
      raw.push(shape*centerAdj);
    }
    const rtp=0.98; let expected=0; for(let i=0;i<nSlots;i++) expected+=probs[i]*raw[i];
    const scale=rtp/expected;
    return raw.map(v=>{
      const m=Math.max(0.1, Math.round(v*scale*100)/100);
      if(m>=10) return Math.round(m);
      if(m>=5)  return Math.round(m*2)/2;
      return Math.round(m*10)/10;
    });
  }
  function updateMultipliers(){
    const effectiveRows = settings.pattern==='point' ? settings.rows-1 : (3 + settings.rows - 1);
    const arr = buildMultipliers(effectiveRows, settings.risk || 'medium');
    for(let i=0; i<slots.length; i++) slots[i].mult = arr[i] || arr[arr.length-1];
  }

  // Ball physics
  class Ball{
    constructor(x,y,color){
      this.x=x; this.y=y; this.r=Math.max(4,pegRadius);
      this.vx=(rng()-0.5)*0.8; this.vy=INITIAL_VY;
      this.done=false; this.trail=[]; this.color=color || settings.ballColor;
    }
    step(){
      if(this.done) return;
      this.vy += GRAVITY; this.vx *= (1-AIR_DRAG); this.vy *= (1-AIR_DRAG*0.5);
      this.x += this.vx; this.y += this.vy;
      collideEdge(this, topLeft, nLeft);
      collideEdge(this, topRight, nRight);
      for(const p of pegs) collidePeg(this,p);
      const floorY = baseLeft.y + 2; if(this.y>floorY) this.land();
    }
    land(){
      this.done=true;
      let idx=0,md=1e9; for(let i=0; i<slots.length; i++){
        const d=Math.abs(this.x - slots[i].x);
        if(d<md){ md=d; idx=i; }
      }
      const mult=slots[idx].mult; const bet = parseFloat(betEl.value || '1');
      const payout=bet*mult*streak; balance += payout; streak = (mult>=5) ? (streak+1) : 1;
      renderHUD();
      pushLeaderboard({ payout, mult, rows:settings.rows, risk:settings.risk });
      saveNow();
      setTimeout(()=>{ const j=balls.indexOf(this); if(j>=0) balls.splice(j,1); },120);
    }
    draw(){ drawBall(this); }
  }

  function pushLeaderboard({payout, mult, rows, risk}){
    const entry = { payout: +payout.toFixed(2), mult: +mult, rows, risk, date: Date.now() };
    settings.leaderboard.push(entry);
    settings.leaderboard.sort((a,b) => b.payout - a.payout);
    settings.leaderboard = settings.leaderboard.slice(0,10);
  }
  function renderLeaderboard(){
    lbList.innerHTML = '';
    (settings.leaderboard || []).forEach((e,i)=>{
      const li = document.createElement('li');
      const d = new Date(e.date).toLocaleDateString();
      li.textContent = `#${i+1} $${e.payout.toFixed(2)} — ${e.mult}x · ${e.rows} rows · ${e.risk} · ${d}`;
      lbList.appendChild(li);
    });
  }

  // UI events
  manualBtn.addEventListener('click', () => { auto=false; manualBtn.classList.add('active'); autoBtn.classList.remove('active'); });
  autoBtn.addEventListener('click',  () => { auto=!auto; autoBtn.classList.toggle('active',auto); manualBtn.classList.toggle('active',!auto); });
  betHalf.addEventListener('click', ()=>{ betEl.value = (parseFloat(betEl.value)/2).toFixed(2); settings.bet = parseFloat(betEl.value); updateDropBtn(); saveNow(); });
  betDouble.addEventListener('click', ()=>{ betEl.value = (parseFloat(betEl.value)*2).toFixed(2); settings.bet = parseFloat(betEl.value); updateDropBtn(); saveNow(); });
  betEl.addEventListener('input', ()=>{ settings.bet = parseFloat(betEl.value)||1; updateDropBtn(); saveNow(); });
  riskEl.addEventListener('change', ()=>{ settings.risk = riskEl.value; updateMultipliers(); draw(); saveNow(); });
  patternEl.addEventListener('change', ()=>{ settings.pattern = patternEl.value; buildBoard(); computeScale(); draw(); saveNow(); });
  rowsEl.addEventListener('input', ()=>{ settings.rows = parseInt(rowsEl.value,10); buildBoard(); computeScale(); draw(); saveNow(); });
  resetBtn.addEventListener('click', ()=>{ localStorage.removeItem(SAVE_KEY); location.reload(); });
  chipsWrap.addEventListener('click',(e)=>{
    const btn = e.target.closest('.chip'); if(!btn) return;
    settings.ballColor = btn.getAttribute('data-color');
    [...chipsWrap.querySelectorAll('.chip')].forEach(c=>c.classList.toggle('active', c===btn));
    saveNow();
  });
  dropBtn.addEventListener('click', drop);
  canvas.addEventListener('pointerdown', e => { if(e.clientY < window.innerHeight*0.35) drop(); });

  function drop(){
    const bet = Math.max(0.1, parseFloat(betEl.value || '1'));
    if(balance < bet) return;
    balance -= bet; renderHUD(); saveNow();
    const spread = pegSpacingX*0.30; const centerX = (topLeft.x + topRight.x)/2;
    const spawnX = centerX + (rng()-0.5)*spread; const spawnY = topLeft.y - SPAWN_HEIGHT;
    balls.push(new Ball(spawnX, spawnY, settings.ballColor));
  }

  function renderHUD(){
    balanceEl.textContent = '$' + balance.toFixed(2);
    streakEl.textContent  = 'x' + streak;
    updateDropBtn();
    renderLeaderboard();
  }
  function updateDropBtn(){
    const bet = Math.max(0.1, parseFloat(betEl.value || '1'));
    dropBtn.disabled = balance < bet;
  }

  // Save/load
  function saveNow(){
    settings.balance = balance; settings.streak = streak;
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      ...settings,
      bet: parseFloat(betEl.value)||1,
      risk: riskEl.value,
      pattern: patternEl.value,
      rows: parseInt(rowsEl.value,10)
    }));
  }
  function loadSave(){
    try{
      const raw = localStorage.getItem(SAVE_KEY);
      if(!raw) return;
      const s = JSON.parse(raw);
      Object.assign(settings, s);
      betEl.value   = (s.bet ?? 1).toFixed(2);
      riskEl.value  = s.risk || 'medium';
      patternEl.value= s.pattern || 'flat3';
      rowsEl.value  = s.rows || rowsEl.value;
      if(s.ballColor){
        settings.ballColor = s.ballColor;
        const chip = document.querySelector(`.chip[data-color=\"${s.ballColor}\"]`);
        if(chip) chip.classList.add('active');
      }
      balance = s.balance;
      streak  = s.streak;
    }catch(e){}
  }

  // Math helpers
  function mulberry32(a){return function(){var t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;}}
  const factCache={}; function fact(n){ if(factCache[n]) return factCache[n]; let r=1; for(let i=2;i<=n;i++) r*=i; return factCache[n]=r; }
  const comb=(n,k)=> fact(n)/(fact(k)*fact(n-k)); 
  function binom(n,k,p){ return comb(n,k)*Math.pow(p,k)*Math.pow(1-p,n-k); }

  // Initialize
  size();
  renderHUD();
  (function loop(){ const now=performance.now(); if(auto && now-lastDrop>dropInterval){ drop(); lastDrop=now; } balls.forEach(b=> b.step()); draw(); requestAnimationFrame(loop); })();
})();
