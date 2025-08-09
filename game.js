(function(){
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  // UI elements
  const manualBtn = document.getElementById('manualBtn');
  const autoBtn = document.getElementById('autoBtn');
  const betEl = document.getElementById('bet');
  const betHalf = document.getElementById('betHalf');
  const betDouble = document.getElementById('betDouble');
  const riskEl = document.getElementById('risk');
  const rowsEl = document.getElementById('rows');
  const rowsLabel = document.getElementById('rowsLabel');
  const dropBtn = document.getElementById('dropBtn');
  const balanceEl = document.getElementById('balance');
  const streakEl = document.getElementById('streak');
  const leaderboardEl = document.getElementById('leaderboard');
  const patternEl = document.getElementById('pattern');
  const ballColorEl = document.getElementById('ballColor');

  // Game state
  let DPR = Math.max(1, window.devicePixelRatio || 1);
  let W=0, H=0;
  let balls = [];
  let pegs = [];
  let slots = [];
  let rows = parseInt(rowsEl.value,10);
  let balance = parseFloat(localStorage.getItem('balance')) || 1000;
  let streak = parseInt(localStorage.getItem('streak')) || 1;
  let auto = false;
  let ballColor = localStorage.getItem('ballColor') || '#9cd1ff';
  ballColorEl.value = ballColor;

  // Save progress
  function saveProgress(){
    localStorage.setItem('balance', balance);
    localStorage.setItem('streak', streak);
    localStorage.setItem('ballColor', ballColor);
  }

  function renderHUD(){
    balanceEl.textContent = '$' + balance.toFixed(2);
    streakEl.textContent = 'x' + streak;
    saveProgress();
  }

  function size(){
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    ctx.setTransform(DPR,0,0,DPR,0,0);
    buildBoard();
  }

  function buildBoard(){
    pegs = [];
    slots = [];
    rows = parseInt(rowsEl.value,10);
    rowsLabel.textContent = rows;
    const spacingX = 40;
    const spacingY = 36;

    for(let r=0;r<rows;r++){
      const cols = r+1;
      for(let c=0;c<cols;c++){
        let offsetX = (patternEl.value === 'zigzag' && r % 2 ? 20 : 0);
        pegs.push({
          x: W/2 - (cols-1)*spacingX/2 + c*spacingX + offsetX,
          y: 100 + r*spacingY
        });
      }
    }
    for(let i=0;i<rows+1;i++){
      slots.push({x: W/2 - rows*spacingX/2 + i*spacingX, mult: 1});
    }
  }

  function drop(){
    const bet = parseFloat(betEl.value);
    if(balance < bet) return;
    balance -= bet;
    renderHUD();
    balls.push({x: W/2, y: 50, vx: (Math.random()-0.5)*2, vy: 1, r: 6});
  }

  function update(){
    balls.forEach(b=>{
      b.vy += 0.1;
      b.x += b.vx;
      b.y += b.vy;
      pegs.forEach(p=>{
        let dx = b.x - p.x, dy = b.y - p.y;
        let dist = Math.sqrt(dx*dx+dy*dy);
        if(dist < b.r+5){
          let angle = Math.atan2(dy,dx);
          b.vx = Math.cos(angle) * 2;
          b.vy = Math.sin(angle) * 2;
        }
      });
    });
    balls = balls.filter(b => b.y < H);
  }

  function draw(){
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = '#09162e';
    ctx.fillRect(0,0,W,H);

    ctx.fillStyle = '#fff';
    pegs.forEach(p=>{
      ctx.beginPath();
      ctx.arc(p.x,p.y,5,0,Math.PI*2);
      ctx.fill();
    });

    balls.forEach(b=>{
      ctx.fillStyle = ballColor;
      ctx.beginPath();
      ctx.arc(b.x,b.y,b.r,0,Math.PI*2);
      ctx.fill();
    });
  }

  function loop(){
    update();
    draw();
    requestAnimationFrame(loop);
  }

  // Events
  dropBtn.addEventListener('click', drop);
  manualBtn.addEventListener('click', ()=>{auto=false;});
  autoBtn.addEventListener('click', ()=>{auto=!auto;});
  betHalf.addEventListener('click', ()=>{ betEl.value = (parseFloat(betEl.value)/2).toFixed(2); });
  betDouble.addEventListener('click', ()=>{ betEl.value = (parseFloat(betEl.value)*2).toFixed(2); });
  patternEl.addEventListener('change', buildBoard);
  rowsEl.addEventListener('input', buildBoard);
  ballColorEl.addEventListener('input', e=>{
    ballColor = e.target.value;
    saveProgress();
  });

  window.addEventListener('resize', size);

  // Init
  size();
  renderHUD();
  loop();
})();
