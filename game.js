(function () {
  // ---------- Canvas ----------
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d', { alpha: false });
  const DPR = Math.max(1, window.devicePixelRatio || 1);

  // ---------- State ----------
  let rows = 16, bet = 1.0, balance = 1000, risk = 'medium', mode = 'manual';
  let auto = false, lastDrop = 0, dropInterval = 320, combo = 1;
  let balls = [], pegs = [], slots = [];
  let rng = mulberry32(Date.now() % 2 ** 32);

  const BALL_THEMES = [
    { key: 'Sky',    fill: '#57a9ff', trail: 'rgba(87,169,255,0.23)' },
    { key: 'Neon',   fill: '#3ef3ff', trail: 'rgba(62,243,255,0.23)' },
    { key: 'Sun',    fill: '#ffd351', trail: 'rgba(255,211,81,0.23)' },
    { key: 'Rose',   fill: '#ff6fa3', trail: 'rgba(255,111,163,0.23)' },
    { key: 'Violet', fill: '#9c7bff', trail: 'rgba(156,123,255,0.23)' },
    { key: 'Lime',   fill: '#6dff6a', trail: 'rgba(109,255,106,0.23)' },
  ];
  let ballTheme = BALL_THEMES[0];

  // Physics
  let gravity = 0.26, restitution = 0.5, wallRest = 0.38, friction = 0.008, maxVX = 1.6;
  const MIN_DOWN_VY = 0.18, JITTER = 0.08, APEX_GUARD_Y_OFFSET = 6;

  // Layout / UI
  let boardRect = { x: 0, y: 0, w: 0, h: 0 };
  let isMobile = false, overlayOpen = false;
  let sideW = 320 * DPR, railW = 58 * DPR;

  class Rect { constructor(x,y,w,h){ this.x=x; this.y=y; this.w=w; this.h=h; } contains(px,py){ return px>=this.x&&py>=this.y&&px<=this.x+this.w&&py<=this.y+this.h; } }
  const R = {}; // click zones

  const GEOM = { pegSpacingX: 40 * DPR, pegSpacingY: 38 * DPR, pegRadius: 6 * DPR,
                 apex:{x:0,y:0}, left:{x:0,y:0}, right:{x:0,y:0}, nLeft:{x:0,y:0}, nRight:{x:0,y:0} };

  // ---------- Sizing ----------
  function recomputeSpacing() {
    const pegSpacingY = Math.min(46 * DPR, Math.max(30 * DPR, Math.floor((boardRect.h - 210 * DPR) / rows)));
    const pegSpacingX = Math.min(52 * DPR, Math.max(28 * DPR, Math.floor(boardRect.w / (rows + 1))));
    const pegRadius   = Math.max(5 * DPR, Math.min(7 * DPR, Math.floor(pegSpacingX * 0.14)));
    GEOM.pegSpacingY = pegSpacingY; GEOM.pegSpacingX = pegSpacingX; GEOM.pegRadius = pegRadius;
  }

  function sizeCanvas() {
    canvas.width  = Math.max(1, Math.floor(canvas.clientWidth  * DPR));
    canvas.height = Math.max(1, Math.floor(canvas.clientHeight * DPR));

    isMobile = Math.min(window.innerWidth, window.innerHeight) < 700;

    if (isMobile) {
      sideW = railW;
      boardRect.x = sideW + 12 * DPR;
      boardRect.w = canvas.width - boardRect.x - 12 * DPR;
    } else {
      sideW = Math.max(280 * DPR, Math.min(360 * DPR, Math.floor(canvas.width * 0.28)));
      boardRect.x = sideW + 18 * DPR;
      boardRect.w = canvas.width - boardRect.x - 18 * DPR;
    }
    boardRect.y = 14 * DPR;
    boardRect.h = canvas.height - boardRect.y - 12 * DPR;

    recomputeSpacing();
    buildBoard();
    layoutUI();
  }

  // Wait one frame so CSS lays out before we read clientWidth/Height
  function safeInitSize() {
    requestAnimationFrame(() => {
      sizeCanvas();
      // if still tiny, try once more next frame
      if (canvas.width < 10 || canvas.height < 10) requestAnimationFrame(sizeCanvas);
    });
  }

  window.addEventListener('resize', sizeCanvas);
  window.addEventListener('orientationchange', () => setTimeout(sizeCanvas, 150));

  // ---------- Board ----------
  function buildBoard() {
    pegs.length = 0; slots.length = 0;

    for (let r = 0; r < rows; r++) {
      const count = r + 1;
      const y = boardRect.y + 70 * DPR + r * GEOM.pegSpacingY;
      const rowWidth = (count - 1) * GEOM.pegSpacingX;
      const startX = boardRect.x + boardRect.w / 2 - rowWidth / 2;
      for (let c = 0; c < count; c++) pegs.push({ x: startX + c * GEOM.pegSpacingX, y, r: GEOM.pegRadius });
    }

    const baseY  = boardRect.y + 70 * DPR + rows * GEOM.pegSpacingY + 36 * DPR;
    const widest = (rows - 1) * GEOM.pegSpacingX;
    GEOM.apex  = { x: boardRect.x + boardRect.w / 2, y: boardRect.y + 28 * DPR };
    GEOM.left  = { x: boardRect.x + boardRect.w / 2 - widest / 2 - GEOM.pegSpacingX * 0.5, y: baseY };
    GEOM.right = { x: boardRect.x + boardRect.w / 2 + widest / 2 + GEOM.pegSpacingX * 0.5, y: baseY };
    GEOM.nLeft  = inwardNormal(GEOM.apex, GEOM.left);
    GEOM.nRight = inwardNormal(GEOM.apex, GEOM.right);

    const nSlots = rows + 1, slotW = GEOM.pegSpacingX;
    const startX = boardRect.x + boardRect.w / 2 - (nSlots - 1) * slotW / 2;
    for (let i = 0; i < nSlots; i++) slots.push({ x: startX + i * slotW, y: baseY, w: slotW, mult: 1 });
    updateMultipliers();
  }

  // ---------- Multipliers ----------
  const factCache = {};
  function fact(n){ if (factCache[n]) return factCache[n]; let r = 1; for (let i=2;i<=n;i++) r*=i; return factCache[n]=r; }
  const comb=(n,k)=> fact(n)/(fact(k)*fact(n-k));
  function binomialPMF(n,k,p){ return comb(n,k)*Math.pow(p,k)*Math.pow(1-p,n-k); }

  function buildMultipliers(nRows, risk) {
    const nSlots = nRows + 1, probs=[]; for (let k=0;k<nSlots;k++) probs.push(binomialPMF(nRows,k,0.5));
    let edgeBoost, centerPenalty;
    if (risk==='high'){ edgeBoost=4.2; centerPenalty=0.52; }
    else if (risk==='low'){ edgeBoost=2.1; centerPenalty=0.86; }
    else { edgeBoost=3.0; centerPenalty=0.70; }
    const mid=(nSlots-1)/2, raw=[];
    for (let k=0;k<nSlots;k++){
      const d=Math.abs(k-mid)/mid;
      raw.push((1+d*(edgeBoost-1)) * (1-(1-centerPenalty)*(1-d)));
    }
    const rtp=0.98; let expected=0; for (let i=0;i<nSlots;i++) expected += probs[i]*raw[i];
    const scale=rtp/expected;
    return raw.map(v=>{
      const m=Math.max(0.1, Math.round(v*scale*100)/100);
      if (m>=10) return Math.round(m);
      if (m>=5)  return Math.round(m*2)/2;
      return Math.round(m*10)/10;
    });
  }
  function updateMultipliers(){ const arr=buildMultipliers(rows, risk); for (let i=0;i<slots.length;i++) slots[i].mult=arr[i]; }

  // ---------- Physics ----------
  function inwardNormal(a,b){
    const abx=b.x-a.x, aby=b.y-a.y; let nx=-aby, ny=abx;
    const len=Math.hypot(nx,ny)||1; nx/=len; ny/=len;
    const cx=boardRect.x+boardRect.w/2, cy=(a.y+b.y)/2;
    const d=(cx-a.x)*nx+(cy-a.y)*ny; if (d<0){ nx=-nx; ny=-ny; }
    return {x:nx,y:ny};
  }
  function collideWithSide(ball, a, n){
    const tipGuard = 10 * DPR;
    const nearTip = Math.hypot(ball.x-a.x, ball.y-a.y) < tipGuard;
    const d=(ball.x-a.x)*n.x + (ball.y-a.y)*n.y;
    const pen = ball.r - d;
    if (pen>0 && !nearTip){
      ball.x += n.x*pen; ball.y += n.y*pen;
      const vdot = ball.vx*n.x + ball.vy*n.y;
      if (vdot < 0){
        ball.vx -= (1+wallRest)*vdot*n.x;
        ball.vy -= (1+wallRest)*vdot*n.y;
        ball.vy = Math.max(ball.vy, MIN_DOWN_VY);
      }
      if (Math.abs(ball.vx)>maxVX) ball.vx = Math.sign(ball.vx)*maxVX;
    }
  }

  function Ball(x,y){
    this.x=x; this.y=y;
    this.r = Math.max(5*DPR, Math.min(7*DPR, GEOM.pegRadius*0.95));
    this.vx=(rng()-0.5)*0.25; this.vy=0.12;
    this.done=false; this.trail=[];
  }
  Ball.prototype.step=function(dt){
    if (this.done) return;

    if (this.y < GEOM.apex.y + APEX_GUARD_Y_OFFSET*DPR){
      this.vy = Math.max(this.vy, MIN_DOWN_VY);
      this.vx += (rng()-0.5)*JITTER;
    }

    this.vy += gravity*dt;
    this.vx *= (1 - friction*dt/60);
    this.vy *= (1 - friction*0.3*dt/60);
    this.x += this.vx; this.y += this.vy;

    collideWithSide(this, GEOM.apex, GEOM.nLeft);
    collideWithSide(this, GEOM.apex, GEOM.nRight);

    for (let i=0;i<pegs.length;i++){
      const p=pegs[i], dx=this.x-p.x, dy=this.y-p.y, dist=Math.hypot(dx,dy), minD=this.r+p.r;
      if (dist<minD){
        const nx=dx/(dist||1), ny=dy/(dist||1), overlap=minD-dist;
        this.x+=nx*overlap; this.y+=ny*overlap;
        const vdot=this.vx*nx + this.vy*ny;
        if (vdot<0){
          this.vx -= 2*vdot*nx; this.vy -= 2*vdot*ny;
          this.vx *= restitution; this.vy *= restitution;
          this.vx += (rng()-0.5)*0.18;
          this.vy = Math.max(this.vy, MIN_DOWN_VY);
        }
      }
    }

    const floorY = GEOM.left.y;
    if (this.y > floorY){
      let idx=0, best=1e9;
      for (let i=0;i<slots.length;i++){ const d=Math.abs(this.x-slots[i].x); if (d<best){best=d; idx=i;} }
      const mult=slots[idx].mult; balance += bet*mult*combo; combo = (mult>=5)?(combo+1):1;
      this.done=true;
      setTimeout(()=>{ const j=balls.indexOf(this); if (j>=0) balls.splice(j,1); }, 120);
    }

    this.trail.push({x:this.x,y:this.y,r:this.r}); if (this.trail.length>6) this.trail.shift();
  };
  Ball.prototype.draw=function(){
    for (let i=0;i<this.trail.length;i++){
      const t=this.trail[i], a=(i+1)/this.trail.length * 0.22;
      ctx.beginPath(); ctx.arc(t.x,t.y,t.r,0,Math.PI*2);
      ctx.fillStyle = ballTheme.trail.replace(/0\.23\)/, (a.toFixed(2)+')'));
      ctx.fill();
    }
    ctx.save(); ctx.globalAlpha=.26; ctx.beginPath(); ctx.arc(this.x+2*DPR,this.y+2*DPR,this.r,0,Math.PI*2); ctx.fillStyle='#000'; ctx.fill(); ctx.restore();
    const g=ctx.createRadialGradient(this.x-0.45*this.r, this.y-0.45*this.r, this.r*0.12, this.x, this.y, this.r);
    g.addColorStop(0,'#ffffff');
    g.addColorStop(0.18, blend(ballTheme.fill, '#ffffff', 0.6));
    g.addColorStop(1,   blend(ballTheme.fill, '#2a447a', 0.25));
    ctx.beginPath(); ctx.arc(this.x,this.y,this.r,0,Math.PI*2); ctx.fillStyle=g; ctx.fill();
  };

  // ---------- UI layout ----------
  function layoutUI(){
    if (!isMobile){
      const x=12*DPR, W=sideW-24*DPR; let y=12*DPR;
      R.mode = new Rect(x,y,W,38*DPR); y+=38*DPR + 12*DPR;
      R.bet  = new Rect(x,y,W,68*DPR); y+=68*DPR + 12*DPR;
      R.color= new Rect(x,y,W,74*DPR); y+=74*DPR + 12*DPR;
      R.risk = new Rect(x,y,W,64*DPR); y+=64*DPR + 12*DPR;
      R.rows = new Rect(x,y,W,64*DPR); y+=64*DPR + 14*DPR;
      R.drop = new Rect(x,y,W,52*DPR);

      // Right stats
      const rx = canvas.width - (sideW - 24*DPR) - 12*DPR;
      const RW = sideW - 24*DPR; let ry = 12*DPR;
      R.balance = new Rect(rx, ry, RW, 48*DPR); ry += 58*DPR;
      R.streak  = new Rect(rx, ry, RW, 48*DPR);

      R.rail=null; R.openBtn=null; R.overlay=null;
    } else {
      R.rail = new Rect(0,0,railW,canvas.height);
      R.openBtn = new Rect(6*DPR, 10*DPR, railW-12*DPR, 42*DPR);

      const px = railW + 8*DPR, pW = Math.min(320*DPR, canvas.width - railW - 16*DPR);
      let py = 8*DPR;
      R.overlay = new Rect(px, py, pW, canvas.height - 16*DPR);

      let y = py + 10*DPR;
      R.mode = new Rect(px+10*DPR, y, pW-20*DPR, 38*DPR); y += 50*DPR;
      R.bet  = new Rect(px+10*DPR, y, pW-20*DPR, 68*DPR); y += 80*DPR;
      R.color= new Rect(px+10*DPR, y, pW-20*DPR, 74*DPR); y += 86*DPR;
      R.risk = new Rect(px+10*DPR, y, pW-20*DPR, 64*DPR); y += 76*DPR;
      R.rows = new Rect(px+10*DPR, y, pW-20*DPR, 64*DPR); y += 88*DPR;
      R.drop = new Rect(px+10*DPR, y, pW-20*DPR, 52*DPR);

      R.balance=null; R.streak=null;
    }
  }

  // ---------- UI drawing ----------
  function drawPanel(x,y,w,h,r=12*DPR){
    ctx.save();
    shadow(0,6*DPR,18*DPR,'rgba(0,0,0,.35)');
    roundRect(x,y,w,h,r);
    const g=ctx.createLinearGradient(0,y,0,y+h);
    g.addColorStop(0,'#243349'); g.addColorStop(1,'#1b273b');
    ctx.fillStyle=g; ctx.fill();
    ctx.shadowColor='transparent';
    ctx.save(); ctx.clip();
    const hl=ctx.createLinearGradient(0,y,0,y+h);
    hl.addColorStop(0,'rgba(255,255,255,.08)');
    hl.addColorStop(.35,'rgba(255,255,255,.02)');
    hl.addColorStop(.65,'rgba(0,0,0,.07)');
    hl.addColorStop(1,'rgba(0,0,0,.12)');
    ctx.fillStyle=hl; ctx.fillRect(x,y,w,h); ctx.restore();
    ctx.strokeStyle='#2a3a54'; ctx.lineWidth=1*DPR; ctx.stroke();
    ctx.restore();
  }
  function drawBtn(x,y,w,h,label,kind='default'){
    roundRect(x,y,w,h,12*DPR);
    const g=ctx.createLinearGradient(0,y,0,y+h);
    if (kind==='green'){ g.addColorStop(0,'#2af07a'); g.addColorStop(1,'#17b856'); }
    else { g.addColorStop(0,'#1b2840'); g.addColorStop(1,'#142036'); }
    ctx.fillStyle=g; ctx.fill(); ctx.strokeStyle = (kind==='green')?'rgba(0,0,0,.25)':'#2a3a54';
    ctx.lineWidth=1.2*DPR; ctx.stroke();
    ctx.save(); ctx.globalAlpha=.28; roundRect(x+2*DPR,y+2*DPR,w-4*DPR,h*0.42,10*DPR); ctx.fillStyle='#fff'; ctx.fill(); ctx.restore();
    font('800',14*DPR); ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle=(kind==='green')?'#062312':'#e9eef9';
    ctx.fillText(label, x+w/2, y+h/2+0.5*DPR);
  }
  function drawSegment(x,y,w,h,activeLeft){
    roundRect(x,y,w,h,h/2); ctx.fillStyle='#0f1a2b'; ctx.fill(); ctx.strokeStyle='#2a3a54'; ctx.stroke();
    const segW=w/2, r=h/2-3*DPR, kx = activeLeft? (x+3*DPR):(x+segW+3*DPR);
    roundRect(kx,y+3*DPR,segW-6*DPR,h-6*DPR,r);
    const g=ctx.createLinearGradient(0,y,0,y+h); g.addColorStop(0,'#1f2d46'); g.addColorStop(1,'#11213a'); ctx.fillStyle=g; ctx.fill();
    ctx.save(); ctx.globalAlpha=.25; roundRect(kx,y+3*DPR,segW-6*DPR,(h-6*DPR)*0.45,r); ctx.fillStyle='#fff'; ctx.fill(); ctx.restore();
    font('700',13*DPR); ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle= activeLeft ? '#e9eef9' : '#7f95ba'; ctx.fillText('Manual', x+segW/2, y+h/2+0.5*DPR);
    ctx.fillStyle= activeLeft ? '#7f95ba' : '#e9eef9'; ctx.fillText('Auto', x+segW+segW/2, y+h/2+0.5*DPR);
  }
  function drawBetField(r){
    drawPanel(r.x,r.y,r.w,r.h);
    label(r,'Bet Amount');
    const rowY=r.y+30*DPR, btnW=52*DPR, mainW=r.w-24*DPR - btnW*2 - 12*DPR, boxX=r.x+12*DPR;
    drawPanel(boxX,rowY,mainW,28*DPR,8*DPR);
    font('700',13*DPR); ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillStyle='#e9eef9';
    ctx.fillText('$ '+bet.toFixed(2), boxX+10*DPR, rowY+14*DPR+0.5*DPR);
    drawPanel(boxX+mainW+12*DPR,rowY,btnW,28*DPR,8*DPR); ctx.textAlign='center'; ctx.fillStyle='#e9eef9';
    ctx.fillText('½', boxX+mainW+12*DPR+btnW/2, rowY+14*DPR+0.5*DPR);
    drawPanel(boxX+mainW+12*DPR+btnW,rowY,btnW,28*DPR,8*DPR);
    ctx.fillText('2×', boxX+mainW+12*DPR+btnW+btnW/2, rowY+14*DPR+0.5*DPR);
  }
  function drawColorField(r){
    drawPanel(r.x,r.y,r.w,r.h);
    label(r,'Ball Color');
    const pad=12*DPR, sw=28*DPR, gap=8*DPR, Y=r.y+30*DPR; let X=r.x+pad;
    R.colorSwatches=[];
    for (const th of BALL_THEMES){
      ctx.save(); shadow(0,3*DPR,8*DPR,'rgba(0,0,0,.35)');
      roundRect(X,Y,sw,sw,6*DPR);
      const g=ctx.createLinearGradient(X,Y,X,Y+sw);
      g.addColorStop(0, blend(th.fill, '#ffffff', 0.35)); g.addColorStop(1, th.fill);
      ctx.fillStyle=g; ctx.fill(); ctx.shadowColor='transparent';
      ctx.strokeStyle = (th===ballTheme)?'#ffffff':'rgba(255,255,255,.25)'; ctx.lineWidth=(th===ballTheme)?2*DPR:1*DPR; ctx.stroke();
      ctx.restore();
      R.colorSwatches.push(new Rect(X,Y,sw,sw));
      X += sw + gap;
    }
  }
  function drawRiskField(r){ drawPanel(r.x,r.y,r.w,r.h); label(r,'Risk'); value(r, cap(risk)); }
  function drawRowsField(r){ drawPanel(r.x,r.y,r.w,r.h); label(r,'Rows'); value(r, String(rows)); }
  function label(r,text){ font('600',12*DPR); ctx.fillStyle='#9fb3d8'; ctx.textAlign='left'; ctx.textBaseline='top'; ctx.fillText(text, r.x+12*DPR, r.y+8*DPR); }
  function value(r,text){ const vx=r.x+12*DPR, vy=r.y+24*DPR, vw=r.w-24*DPR, vh=r.h-36*DPR; drawPanel(vx,vy,vw,vh,8*DPR); font('700',13*DPR); ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillStyle='#e9eef9'; ctx.fillText(text, vx+10*DPR, vy+vh/2+0.5*DPR); ctx.textAlign='right'; ctx.fillStyle='#7f95ba'; ctx.fillText('▾', vx+vw-8*DPR, vy+vh/2+0.5*DPR); }

  function drawSidebarDesktop(){
    drawPanel(12*DPR, 12*DPR, sideW-24*DPR, canvas.height-24*DPR, 16*DPR);
    drawSegment(R.mode.x, R.mode.y, R.mode.w, R.mode.h, mode==='manual');
    drawBetField(R.bet);
    drawColorField(R.color);
    drawRiskField(R.risk);
    drawRowsField(R.rows);
    drawBtn(R.drop.x, R.drop.y, R.drop.w, R.drop.h, 'Drop Ball', 'green');

    drawPanel(R.balance.x, R.balance.y, R.balance.w, R.balance.h, 12*DPR);
    font('700',14*DPR); ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='#e9eef9';
    ctx.fillText('Balance  $'+balance.toFixed(2), R.balance.x+R.balance.w/2, R.balance.y+R.balance.h/2+0.5*DPR);
    drawPanel(R.streak.x, R.streak.y, R.streak.w, R.streak.h, 12*DPR);
    ctx.fillText('Streak   x'+combo, R.streak.x+R.streak.w/2, R.streak.y+R.streak.h/2+0.5*DPR);
  }
  function drawRailMobile(){
    drawPanel(4*DPR, 4*DPR, railW-8*DPR, canvas.height-8*DPR, 16*DPR);
    drawBtn(6*DPR, 10*DPR, railW-12*DPR, 42*DPR, 'Menu');
  }
  function drawOverlayMobile(){
    ctx.fillStyle='rgba(0,0,0,.4)'; ctx.fillRect(0,0,canvas.width,canvas.height);
    drawPanel(R.overlay.x, R.overlay.y, R.overlay.w, R.overlay.h, 16*DPR);
    drawSegment(R.mode.x, R.mode.y, R.mode.w, R.mode.h, mode==='manual');
    drawBetField(R.bet);
    drawColorField(R.color);
    drawRiskField(R.risk);
    drawRowsField(R.rows);
    drawBtn(R.drop.x, R.drop.y, R.drop.w, R.drop.h, 'Drop Ball', 'green');
  }

  function drawTriangle(){
    ctx.save(); ctx.lineJoin='round'; ctx.lineWidth=3*DPR; ctx.strokeStyle='rgba(160,200,255,.55)';
    ctx.beginPath(); ctx.moveTo(GEOM.apex.x,GEOM.apex.y); ctx.lineTo(GEOM.left.x,GEOM.left.y); ctx.lineTo(GEOM.right.x,GEOM.right.y); ctx.closePath(); ctx.stroke(); ctx.restore();
  }
  function drawPegs(){
    for (const p of pegs){
      ctx.save(); ctx.globalAlpha=.26; ctx.beginPath(); ctx.arc(p.x+1.6*DPR,p.y+1.6*DPR,p.r,0,Math.PI*2); ctx.fillStyle='#000'; ctx.fill(); ctx.restore();
      const g=ctx.createRadialGradient(p.x-p.r*0.35,p.y-p.r*0.35,p.r*0.15,p.x,p.y,p.r);
      g.addColorStop(0,'#ffffff'); g.addColorStop(0.48,'#e7f0ff'); g.addColorStop(1,'#6fa0ff');
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fillStyle=g; ctx.fill();
    }
  }
  function drawSlotChips(){
    const baseY = (slots[0]?.y || (boardRect.y+boardRect.h-40*DPR)) + 44*DPR;
    const chipH = 26*DPR, r=8*DPR;
    for (let i=0;i<slots.length;i++){
      const s=slots[i], x=s.x - (s.w-8*DPR)/2, w=s.w-8*DPR;
      shadow(0,3*DPR,10*DPR,'rgba(0,0,0,.4)');
      roundRect(x, baseY, w, chipH, r);
      const col = chipColor(i, slots.length);
      const g=ctx.createLinearGradient(0,baseY,0,baseY+chipH);
      g.addColorStop(0, shade(col, 16)); g.addColorStop(1, col);
      ctx.fillStyle=g; ctx.fill(); ctx.shadowColor='transparent';
      ctx.strokeStyle='rgba(0,0,0,.28)'; ctx.stroke();
      ctx.save(); ctx.globalAlpha=.22; roundRect(x+2*DPR, baseY+2*DPR, w-4*DPR, chipH*0.42, r-2*DPR); ctx.fillStyle='#fff'; ctx.fill(); ctx.restore();
      const label = (s.mult>=5 ? s.mult.toFixed(1) : s.mult.toFixed(1)) + 'x';
      font('800',12*DPR); ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillStyle = chipText(col); ctx.fillText(label, x+w/2, baseY+chipH/2+0.5*DPR);
    }
  }
  function chipColor(idx,total){
    const t=Math.abs(idx-(total-1)/2)/((total-1)/2);
    if (t>0.85) return '#ef2b43';
    if (t>0.70) return '#ff6b2e';
    if (t>0.50) return '#ff9c2e';
    if (t>0.30) return '#ffc43c';
    return '#ffd95a';
  }
  function chipText(bg){ return (bg==='#ef2b43'||bg==='#ff6b2e')?'#ffffff':'#1a1400'; }

  function drawBoard(){
    const grad = ctx.createRadialGradient(boardRect.x+boardRect.w*0.5, boardRect.y+boardRect.h*0.2, 60*DPR, boardRect.x+boardRect.w*0.5, boardRect.y+boardRect.h*0.8, boardRect.h);
    grad.addColorStop(0,'rgba(130,170,255,.08)'); grad.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=grad; ctx.fillRect(boardRect.x, boardRect.y, boardRect.w, boardRect.h);

    ctx.save(); ctx.beginPath(); ctx.rect(boardRect.x, boardRect.y, boardRect.w, boardRect.h); ctx.clip();
    ctx.globalAlpha=0.05; const step=40*DPR; ctx.beginPath();
    for (let x=boardRect.x; x<boardRect.x+boardRect.w; x+=step){ ctx.moveTo(x,boardRect.y); ctx.lineTo(x,boardRect.y+boardRect.h); }
    for (let y=boardRect.y; y<boardRect.y+boardRect.h; y+=step){ ctx.moveTo(boardRect.x,y); ctx.lineTo(boardRect.x+boardRect.w,y); }
    ctx.strokeStyle='#8cb6ff'; ctx.stroke(); ctx.globalAlpha=1;

    drawTriangle();
    drawPegs();
    balls.forEach(b=> b.draw());
    ctx.restore();

    drawSlotChips();

    font('600',11*DPR); ctx.textAlign='center'; ctx.fillStyle='rgba(233,238,249,.7)';
    ctx.fillText('Tap near the top to drop', boardRect.x+boardRect.w/2, boardRect.y + 14*DPR);
  }

  // ---------- Loop ----------
  function drawAll(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if (isMobile){
      drawRailMobile();
      drawBoard();
      if (overlayOpen) drawOverlayMobile();
    } else {
      drawSidebarDesktop();
      drawBoard();
    }
  }
  function update(){
    const now = performance.now();
    if (auto && now-lastDrop>dropInterval){ drop(); lastDrop=now; }
    balls.forEach(b=> b.step(1));
  }
  function loop(){ update(); drawAll(); requestAnimationFrame(loop); }

  // ---------- Input ----------
  canvas.addEventListener('pointerdown', (e)=>{
    const p = getPt(e);

    if (isMobile){
      if (overlayOpen){
        if (hit(p,R.mode)) { mode = (p.x < R.mode.x + R.mode.w/2) ? 'manual':'auto'; auto=(mode==='auto'); return; }
        if (hit(p,R.bet))  { handleBetTap(p,R.bet); return; }
        if (hit(p,R.color)){ handleColorTap(p); return; }
        if (hit(p,R.risk)) { cycleRisk(); return; }
        if (hit(p,R.rows)) { cycleRows(); return; }
        if (hit(p,R.drop)) { drop(); return; }
        if (!hit(p,R.overlay)) { overlayOpen=false; drawAll(); return; }
      } else {
        if (R.openBtn && hit(p,R.openBtn)){ overlayOpen=true; drawAll(); return; }
      }
    } else {
      if (hit(p,R.mode)) { mode = (p.x < R.mode.x + R.mode.w/2) ? 'manual':'auto'; auto=(mode==='auto'); return; }
      if (hit(p,R.bet))  { handleBetTap(p,R.bet); return; }
      if (hit(p,R.color)){ handleColorTap(p); return; }
      if (hit(p,R.risk)) { cycleRisk(); return; }
      if (hit(p,R.rows)) { cycleRows(); return; }
      if (hit(p,R.drop)) { drop(); return; }
    }

    // Board top tap -> drop
    if (p.x>boardRect.x && p.x<boardRect.x+boardRect.w && p.y>boardRect.y && p.y<boardRect.y+boardRect.h){
      if (p.y < boardRect.y + boardRect.h*0.25) drop();
    }
  });

  function handleBetTap(p, rect){
    const rel=(p.x-rect.x)/rect.w;
    if (rel<0.33) bet = Math.max(0.1, Math.round((bet/2)*10)/10);
    else if (rel>0.66) bet = Math.max(0.1, Math.round((bet*2)*10)/10);
    else bet = Math.max(0.1, Math.round((bet+0.1)*10)/10);
  }
  function handleColorTap(p){
    if (!R.colorSwatches) return;
    for (let i=0;i<R.colorSwatches.length;i++){
      if (R.colorSwatches[i].contains(p.x,p.y)){ ballTheme = BALL_THEMES[i]; break; }
    }
  }
  function cycleRisk(){ risk = (risk==='low')?'medium':(risk==='medium')?'high':'low'; updateMultipliers(); }
  function cycleRows(){
    rows += 2; if (rows>16) rows=8;
    recomputeSpacing(); buildBoard(); // ensure geometry updates with rows
  }

  function drop(){
    if (balance < bet) return;
    balance -= bet;
    const spawnX = GEOM.apex.x + (rng()-0.5)*GEOM.pegSpacingX*0.2;
    const spawnY = GEOM.apex.y + (APEX_GUARD_Y_OFFSET+2)*DPR;
    balls.push(new Ball(spawnX, spawnY));
  }

  // ---------- Utils ----------
  function getPt(e){ const r=canvas.getBoundingClientRect(); return { x:(e.clientX-r.left)*(canvas.width/r.width), y:(e.clientY-r.top)*(canvas.height/r.height) }; }
  function hit(p,rect){ return rect && rect.contains(p.x,p.y); }
  function shadow(x,y,b,clr){ ctx.shadowColor=clr; ctx.shadowBlur=b; ctx.shadowOffsetX=x; ctx.shadowOffsetY=y; }
  function roundRect(x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
  function font(weight, px){ ctx.font = weight+' '+Math.round(px)+'px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif'; }
  function cap(s){ return s.charAt(0).toUpperCase()+s.slice(1); }
  function shade(hex, amt){ const c=parseInt(hex.slice(1),16); let r=(c>>16)&255,g=(c>>8)&255,b=c&255; r=clamp(r+amt); g=clamp(g+amt); b=clamp(b+amt); return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1); }
  function clamp(v){ return Math.min(255, Math.max(0, v)); }
  function blend(hex, hex2, t){ const a=parseInt(hex.slice(1),16), b=parseInt(hex2.slice(1),16);
    const ar=(a>>16)&255, ag=(a>>8)&255, ab=a&255, br=(b>>16)&255, bg=(b>>8)&255, bb=b&255;
    const r=Math.round(ar*(1-t)+br*t), g=Math.round(ag*(1-t)+bg*t), bl=Math.round(ab*(1-t)+bb*t);
    return '#'+((1<<24)+(r<<16)+(g<<8)+bl).toString(16).slice(1);
  }
  function mulberry32(a){return function(){var t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;}}

  // ---------- Start ----------
  safeInitSize();
  loop();
})();
