(() => {
  // DOM
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const L = document.getElementById('left');
  const R = document.getElementById('right');

  // UI refs
  const manualBtn = document.getElementById('manualBtn');
  const autoBtn   = document.getElementById('autoBtn');
  const betEl     = document.getElementById('bet');
  const betHalf   = document.getElementById('betHalf');
  const betDouble = document.getElementById('betDouble');
  const riskEl    = document.getElementById('risk');
  const patternEl = document.getElementById('pattern');
  const rowsEl    = document.getElementById('rows');
  const rowsLabel = document.getElementById('rowsLabel');
  const dropBtn   = document.getElementById('dropBtn');
  const balanceEl = document.getElementById('balance');
  const streakEl  = document.getElementById('streak');
  const lbList    = document.getElementById('lbList');
  const resetBtn  = document.getElementById('resetBtn');
  const chipsWrap = document.getElementById('ballColors');

  // DPR & canvas size
  let DPR = Math.max(1, Math.min(2, window.devicePixelRatio||1));
  let W=0, H=0; const TAU = Math.PI*2;

  // Settings / Save
  const SAVE_KEY = 'plinko.save.v2';
  let settings = {
    risk: (riskEl.value),
    pattern: (patternEl.value),
    rows: parseInt(rowsEl.value,10),
    bet: parseFloat(betEl.value)||1,
    ballColor: '#8cb6ff',
    balance: 1000,
    streak: 1,
    leaderboard: [] // {payout, mult, rows, risk, date}
  };

  loadSaveIntoUI();

  // Geometry & physics
  let pegs=[], slots=[], balls=[];
  let leftPad=0, rightPad=0;
  let topOffset = 68;
  let pegSpacingX=30, pegSpacingY=34, pegRadius=5;

  // Trapezoid frame points
  let topLeft={x:0,y:0}, topRight={x:0,y:0}, baseLeft={x:0,y:0}, baseRight={x:0,y:0};
  let nLeft={x:0,y:0}, nRight={x:0,y:0};

  // Physics constants
  const GRAVITY=0.31, RESTITUTION=0.50, TANGENTIAL=0.88, WALL_REST=0.40, AIR_DRAG=0.010;
  const JITTER=0.10, MAX_VX=1.6, SPAWN_HEIGHT=60, INITIAL_VY=0.65, MIN_VY_AFTER_HIT=0.12;

  // State
  let auto=false, lastDrop=0, dropInterval=260;
  let balance=settings.balance, streak=settings.streak;

  // RNG
  let rng = mulberry32(Date.now()>>>0);

  // Board scaling
  let boardScale=1, tx=0, ty=0, boardHeightEst=0, availW=0;

  // ===== Size & layout =====
  function size(){
    const cssW = window.innerWidth; const cssH = window.innerHeight;
    canvas.style.width = cssW+'px'; canvas.style.height = cssH+'px';
    canvas.width = Math.floor(cssW*DPR); canvas.height = Math.floor(cssH*DPR);
    ctx.setTransform(DPR,0,0,DPR,0,0);
    W = cssW; H = cssH;

    const leftW  = Math.ceil(L.getBoundingClientRect().width);
    const rightW = Math.ceil(R.getBoundingClientRect().width);
    leftPad = leftW + 10; rightPad = rightW + 10;

    buildBoard();
    computeBoardScale();
  }
  addEventListener('resize', size, {passive:true});
  addEventListener('orientationchange', ()=> setTimeout(size, 100));

  // ===== Board builder (supports patterns) =====
  function inwardNormal(ax,ay,bx,by){
    let nx=-(by-ay), ny=(bx-ax); const len=Math.hypot(nx,ny)||1; nx/=len; ny/=len;
    const cx=(ax+bx)/2, cy=(ay+by)/2; const toC = (W/2-cx)*nx + (H/2-cy)*ny; if(toC<0){ nx=-nx; ny=-ny; }
    return {x:nx,y:ny};
  }

  function buildBoard(){
    settings.rows = parseInt(rowsEl.value,10); rowsLabel.textContent = settings.rows;
    pegs.length=0; slots.length=0;

    availW = Math.max(220, W - leftPad - rightPad);
    pegSpacingY = Math.min(44, Math.max(24, Math.floor((H-220)/settings.rows)));
    pegSpacingX = Math.min(48, Math.max(22, Math.floor(availW/(3 + settings.rows))));
    pegRadius   = Math.max(4, Math.min(6, Math.floor(Math.min(pegSpacingX,pegSpacingY)*0.22)));
    topOffset   = Math.max(54, Math.min(110, Math.floor(H*0.10)));

    let firstCount = 3; // default flat-3
    if(settings.pattern==='point') firstCount = 1;

    const lastCount  = (settings.pattern==='point') ? (settings.rows) : (3 + settings.rows - 1);
    const baseY = topOffset + (settings.rows-1)*pegSpacingY + 36;

    const centerX = leftPad + availW/2;
    const firstRowWidth = (firstCount-1)*pegSpacingX;
    topLeft  = {x: centerX - firstRowWidth/2 - 12, y: topOffset};
    topRight = {x: centerX + firstRowWidth/2 + 12, y: topOffset};

    const lastRowWidth = (lastCount-1)*pegSpacingX;
    baseLeft  = {x: centerX - lastRowWidth/2 - 16, y: baseY};
    baseRight = {x: centerX + lastRowWidth/2 + 16, y: baseY};

    nLeft  = inwardNormal(topLeft.x, topLeft.y, baseLeft.x, baseLeft.y);
    nRight = inwardNormal(topRight.x, topRight.y, baseRight.x, baseRight.y);

    // Build pegs by pattern
    for(let r=0;r<settings.rows;r++){
      let count = (settings.pattern==='point') ? (1 + r) : (3 + r);
      const y = topOffset + r*pegSpacingY;
      const rowWidth=(count-1)*pegSpacingX;
      // bias offsets
      let bias = 0;
      if(settings.pattern==='leanL') bias = -r*0.18*pegSpacingX;
      if(settings.pattern==='leanR') bias =  r*0.18*pegSpacingX;

      const startX=centerX - rowWidth/2 + bias;
      for(let c=0;c<count;c++){
        // sparse removes some pegs
        if(settings.pattern==='sparse' && (r>1) && rng()<0.12) continue;
        pegs.push({x:startX + c*pegSpacingX, y, r:pegRadius});
      }
    }

    // Slots align to last row spacing
    const nSlots=lastCount+1; const slotW=pegSpacingX; const startX = centerX - (nSlots-1)*slotW/2;
    for(let i=0;i<nSlots;i++) slots.push({x:startX + i*slotW, y: baseY, w: slotW, mult:1});

    updateMultipliers();
    boardHeightEst = baseY + 64;
  }

  function computeBoardScale(){
    const maxH = H - 16;
    boardScale = Math.min(1, maxH / boardHeightEst);
    const scaledBoardW = (W - leftPad - rightPad) * boardScale;
    tx = leftPad + ((W - leftPad - rightPad) - scaledBoardW)/2 - leftPad*(boardScale-1);
    ty = Math.max(8, (H - boardHeightEst*boardScale)/2);
  }

  // ===== Multipliers =====
  const factCache={}; function fact(n){ if(factCache[n]) return factCache[n]; let r=1; for(let i=2;i<=n;i++) r*=i; return factCache[n]=r; }
  const comb=(n,k)=> fact(n)/(fact(k)*fact(n-k));
  function binom(n,k,p){ return comb(n,k)*Math.pow(p,k)*Math.pow(1-p,n-k); }

  function buildMultipliers(effectiveRows, risk){
    const nSlots=effectiveRows+1; const nRows=effectiveRows;
    const probs=[]; for(let k=0;k<nSlots;k++) probs.push(binom(nRows,k,0.5));

    // expanded risk mapping
    let edgeBoost, centerPenalty;
    switch(risk){
      case 'verylow': edgeBoost=1.6; centerPenalty=0.95; break;
      case 'low':     edgeBoost=2.1; centerPenalty=0.86; break;
      case 'medium':  edgeBoost=3.0; centerPenalty=0.70; break;
      case 'high':    edgeBoost=4.2; centerPenalty=0.52; break;
      case 'extreme': edgeBoost=6.0; centerPenalty=0.40; break;
      default:        edgeBoost=3.0; centerPenalty=0.70;
    }

    const mid=(nSlots-1)/2, raw=[];
    for(let k=0;k<nSlots;k++){
      const d=Math.abs(k-mid)/Math.max(1,mid);
      const shape=1+d*(edgeBoost-1);
      const centerAdj=1-(1-centerPenalty)*(1-d);
      raw.push(shape*centerAdj);
    }

    const rtp=0.98; let expected=0;
    for(let i=0;i<nSlots;i++) expected += probs[i]*raw[i];
    const scale=rtp/expected;

    return raw.map(v=>{
      const m=Math.max(0.1, Math.round(v*scale*100)/100);
      if(m>=10) return Math.round(m);
      if(m>=5)  return Math.round(m*2)/2;
      return Math.round(m*10)/10;
    });
  }

  function updateMultipliers(){
    // effective rows is last peg count - 1
    const effectiveRows = (settings.pattern==='point') ? (settings.rows-1) : (3 + settings.rows - 1);
    const arr=buildMultipliers(effectiveRows, settings.risk || 'medium');
    for (let i=0;i<slots.length;i++) slots[i].mult=arr[i]||arr[arr.length-1];
  }

  // ===== Physics & Ball =====
  function collideEdge(ball, A, n){
    const d=(ball.x-A.x)*n.x + (ball.y-A.y)*n.y; const pen=ball.r - d; if(pen>0){
      ball.x += n.x*pen; ball.y += n.y*pen;
      const vdot = ball.vx*n.x + ball.vy*n.y;
      const tx=-n.y, ty=n.x; const vtan = ball.vx*tx + ball.vy*ty;
      const vn = -WALL_REST*vdot; const vt = vtan*TANGENTIAL;
      ball.vx = tx*vt + (ball.vx - vdot*n.x) + vn*n.x;
      ball.vy = ty*vt + (ball.vy - vdot*n.y) + vn*n.y;
      if(ball.vy < MIN_VY_AFTER_HIT) ball.vy = MIN_VY_AFTER_HIT;
    }
  }

  function collidePeg(ball, p){
    const dx=ball.x-p.x, dy=ball.y-p.y; const dist=Math.hypot(dx,dy), minD=ball.r+p.r;
    if(dist<minD){
      const nx=dx/(dist||1), ny=dy/(dist||1);
      const overlap=minD-dist+0.004; ball.x+=nx*overlap; ball.y+=ny*overlap;
      const vdot=ball.vx*nx + ball.vy*ny; if(vdot<0){ ball.vx -= (1+RESTITUTION)*vdot*nx; ball.vy -= (1+RESTITUTION)*vdot*ny; }
      const tx=-ny, ty=nx; const vtan=ball.vx*tx + ball.vy*ty; const vnorm=ball.vx*nx + ball.vy*ny; const vtanD=vtan*TANGENTIAL;
      ball.vx = tx*vtanD + nx*vnorm; ball.vy = ty*vtanD + ny*vnorm;
      ball.vx += (rng()-0.5)*JITTER; if(ball.vy < MIN_VY_AFTER_HIT) ball.vy = MIN_VY_AFTER_HIT;
      if(Math.abs(ball.vx)>MAX_VX) ball.vx=Math.sign(ball.vx)*MAX_VX;
    }
  }

  class Ball{
    constructor(x,y,color){
      this.x=x; this.y=y; this.r=Math.max(4,pegRadius);
      this.vx=(rng()-0.5)*0.8; this.vy=INITIAL_VY;
      this.done=false; this.trail=[]; this.color=color||settings.ballColor;
    }
    step(){
      if(this.done) return;
      this.vy += GRAVITY; this.vx *= (1-AIR_DRAG); this.vy *= (1-AIR_DRAG*0.5);
      this.x += this.vx; this.y += this.vy;
      collideEdge(this, topLeft,  nLeft);
      collideEdge(this, topRight, nRight);
      for(const p of pegs) collidePeg(this,p);
      const floorY = baseLeft.y + 2; if(this.y>floorY) this.land();
    }
    land(){
      this.done=true;
      let idx=0,md=1e9; for(let i=0;i<slots.length;i++){ const d=Math.abs(this.x - slots[i].x); if(d<md){ md=d; idx=i; } }
      const mult=slots[idx].mult; const bet=Math.max(0.1, parseFloat(betEl.value||'1'));
      const payout=bet*mult*streak; balance+=payout; streak=(mult>=5)?(streak+1):1;
      renderHUD();
      pushLeaderboard({payout, mult, rows:settings.rows, risk:settings.risk});
      saveNow();
      setTimeout(()=>{ const j=balls.indexOf(this); if(j>=0) balls.splice(j,1); }, 120);
    }
    draw(){ drawBall(this); }
  }

  // ===== UI actions =====
  manualBtn.addEventListener('click',()=>{ auto=false; manualBtn.classList.add('active'); autoBtn.classList.remove('active'); });
  autoBtn  .addEventListener('click',()=>{ auto=!auto; autoBtn.classList.toggle('active',auto); manualBtn.classList.toggle('active',!auto); });
  dropBtn  .addEventListener('click', drop);
  canvas   .addEventListener('pointerdown',(e)=>{ if(e.clientY < window.innerHeight*0.35) drop(); });
  betHalf  .addEventListener('click',()=>{ betEl.value = Math.max(0.1, (+betEl.value||1)/2).toFixed(2); settings.bet=parseFloat(betEl.value); updateDropBtn(); saveNow(); });
  betDouble.addEventListener('click',()=>{ betEl.value = Math.max(0.1, (+betEl.value||1)*2).toFixed(2); settings.bet=parseFloat(betEl.value); updateDropBtn(); saveNow(); });
  betEl    .addEventListener('input', ()=>{ settings.bet=parseFloat(betEl.value)||1; updateDropBtn(); saveNow(); });
  riskEl   .addEventListener('change',()=>{ settings.risk=riskEl.value; updateMultipliers(); draw(); saveNow(); });
  patternEl.addEventListener('change',()=>{ settings.pattern=patternEl.value; buildBoard(); computeBoardScale(); draw(); saveNow(); });
  rowsEl   .addEventListener('input',()=>{ settings.rows=parseInt(rowsEl.value,10); buildBoard(); computeBoardScale(); draw(); saveNow(); });
  resetBtn .addEventListener('click',()=>{ localStorage.removeItem(SAVE_KEY); location.reload(); });

  // ball color chips
  chipsWrap.addEventListener('click',(e)=>{
    const btn = e.target.closest('.chip'); if(!btn) return;
    settings.ballColor = btn.getAttribute('data-color');
    [...chipsWrap.querySelectorAll('.chip')].forEach(c=>c.classList.toggle('active', c===btn));
    saveNow();
  });

  // ===== Draw helpers =====
  function drawBackground(){
    ctx.setTransform(DPR*boardScale,0,0,DPR*boardScale, tx*DPR, ty*DPR);
    ctx.clearRect(-tx, -ty, W, H);
    const g = ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,'#09162e'); g.addColorStop(1,'#070f22'); ctx.fillStyle=g; ctx.fillRect(-tx, -ty, W, H);
    ctx.strokeStyle='rgba(156,209,255,.38)'; ctx.lineWidth=1.6/boardScale; ctx.beginPath();
    ctx.moveTo(topLeft.x, topLeft.y); ctx.lineTo(baseLeft.x, baseLeft.y); ctx.lineTo(baseRight.x, baseRight.y); ctx.lineTo(topRight.x, topRight.y);
    ctx.closePath(); ctx.stroke();
  }
  function drawPeg(p){
    ctx.save(); ctx.globalCompositeOperation='lighter'; ctx.shadowColor='rgba(130,170,255,.45)'; ctx.shadowBlur=8; ctx.beginPath(); ctx.arc(p.x,p.y,p.r*0.9,0,TAU); ctx.fillStyle='rgba(130,170,255,.18)'; ctx.fill(); ctx.restore();
    const grad = ctx.createRadialGradient(p.x-2,p.y-2,1, p.x,p.y, p.r+5); grad.addColorStop(0,'#f4fbff'); grad.addColorStop(.35,'#cfe2ff'); grad.addColorStop(1,'#2b4c80');
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,TAU); ctx.fillStyle=grad; ctx.fill();
  }
  function roundRect(x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
  function chipColor(i,n){ const t=Math.abs(i-(n-1)/2)/((n-1)/2); if(t>0.85) return '#ef2b43'; if(t>0.70) return '#ff6b2e'; if(t>0.50) return '#ff9c2e'; if(t>0.30) return '#ffc43c'; return '#ffd95a'; }
  function shade(hex, amt){ const c=parseInt(hex.slice(1),16); let r=(c>>16)&255,g=(c>>8)&255,b=c&255; r=Math.min(255,Math.max(0,r+amt)); g=Math.min(255,Math.max(0,g+amt)); b=Math.min(255,Math.max(0,b+amt)); return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1); }
  function formatMult(m){ const v=+m; return (v>=10?Math.round(v):v.toFixed(1))+'x'; }
  function drawSlots(){
    const y = (slots[0]?.y || (topOffset + (settings.rows-1)*pegSpacingY + 36)) + 6; const h=28;
    for(let i=0;i<slots.length;i++){
      const s=slots[i]; const x=s.x - (s.w-8)/2, w=s.w-8; const col=chipColor(i,slots.length);
      ctx.save(); ctx.shadowColor='rgba(0,0,0,.4)'; ctx.shadowBlur=10; roundRect(x,y,w,h,9);
      const gg=ctx.createLinearGradient(0,y,0,y+h); gg.addColorStop(0, shade(col, 14)); gg.addColorStop(1, col); ctx.fillStyle=gg; ctx.fill(); ctx.restore();
      ctx.strokeStyle='rgba(0,0,0,.35)'; ctx.stroke(); ctx.save(); ctx.globalAlpha=.25; roundRect(x+2,y+2,w-4,h*.42,7); ctx.fillStyle='#fff'; ctx.fill(); ctx.restore();
      const label=formatMult(s.mult); ctx.font=`800 ${12/boardScale}px ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial`; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillStyle=(i<2||i>slots.length-3)?'#fff':'#1a1400'; ctx.fillText(label, x+w/2, y+h/2+0.5);
    }
  }
  function drawBall(b){
    if(!b.trail) b.trail=[]; b.trail.push({x:b.x,y:b.y}); if(b.trail.length>10) b.trail.shift();
    ctx.save(); ctx.globalCompositeOperation='lighter';
    for(let i=0;i<b.trail.length;i++){ const t=b.trail[i], a=i/b.trail.length; ctx.globalAlpha=0.08+a*0.14; ctx.beginPath(); ctx.arc(t.x,t.y,b.r*(0.7+a*0.5),0,TAU); ctx.fillStyle='rgba(156,209,255,.55)'; ctx.fill(); }
    ctx.restore(); ctx.globalAlpha=1;
    const c = b.color||settings.ballColor;
    const grad=ctx.createRadialGradient(b.x-2,b.y-3,1.5,b.x,b.y,b.r+7);
    grad.addColorStop(0,'#ffffff'); grad.addColorStop(.25, c); grad.addColorStop(1, shade(c,-90));
    ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,TAU); ctx.fillStyle=grad; ctx.fill();
  }

  function draw(){ drawBackground(); for(const p of pegs) drawPeg(p); drawSlots(); balls.forEach(b=> b.draw()); }
  function update(){ const now=performance.now(); if(auto && now-lastDrop>dropInterval){ drop(); lastDrop=now; } balls.forEach(b=> b.step()); }
  function loop(){ update(); draw(); requestAnimationFrame(loop); }

  // ===== Game/HUD =====
  function drop(){
    const bet=Math.max(0.1, parseFloat(betEl.value||'1')); if(balance<bet) return;
    balance-=bet; renderHUD(); saveNow();
    const spread=pegSpacingX*0.30; const centerX=(topLeft.x+topRight.x)/2;
    const spawnX = centerX + (rng()-0.5)*spread; const spawnY = topLeft.y - SPAWN_HEIGHT;
    balls.push(new Ball(spawnX,spawnY, settings.ballColor));
  }

  function renderHUD(){
    balanceEl.textContent='$'+balance.toFixed(2);
    streakEl.textContent='x'+streak;
    updateDropBtn();
    renderLeaderboard();
  }
  function updateDropBtn(){ const bet=Math.max(0.1, parseFloat(betEl.value||'1')); dropBtn.disabled = balance < bet; }

  // ===== Leaderboard (local) =====
  function pushLeaderboard({payout, mult, rows, risk}){
    const entry = {payout: +payout.toFixed(2), mult:+mult, rows, risk, date: Date.now()};
    settings.leaderboard.push(entry);
    settings.leaderboard.sort((a,b)=> b.payout - a.payout);
    settings.leaderboard = settings.leaderboard.slice(0,10);
  }
  function renderLeaderboard(){
    if(!lbList) return;
    lbList.innerHTML = '';
    (settings.leaderboard||[]).forEach((e,i)=>{
      const li = document.createElement('li');
      const d  = new Date(e.date).toLocaleDateString();
      li.textContent = `#${i+1}  $${e.payout.toFixed(2)} — ${e.mult}x  · ${e.rows} rows · ${e.risk} · ${d}`;
      lbList.appendChild(li);
    });
  }

  // ===== Save/Load =====
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
  function loadSaveIntoUI(){
    try{
      const raw = localStorage.getItem(SAVE_KEY);
      if(!raw) return;
      const s = JSON.parse(raw);
      Object.assign(settings, s);
      // hydrate UI
      betEl.value = (s.bet ?? 1).toFixed(2);
      riskEl.value = s.risk || 'medium';
      patternEl.value = s.pattern || 'flat3';
      rowsEl.value = s.rows || rowsEl.value;
      // ball color chip active state
      const chip = document.querySelector(`.chip[data-color="${s.ballColor}"]`);
      if(chip){ chip.classList.add('active'); }
    }catch(e){}
  }

  // ===== Utils =====
  function mulberry32(a){return function(){var t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;}}

  // Init
  function init(){ size(); renderHUD(); loop(); }
  init();
})();
