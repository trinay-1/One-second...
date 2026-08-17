/* ════════════════════════════════════════════════
   ONE SECOND — game.js
   Canvas-based reflex game. All targets drawn on
   <canvas>; click detection via distance checks.
   ════════════════════════════════════════════════ */

// ── DOM REFS ─────────────────────────────────────
var SS   = document.getElementById('screen-start');
var SG   = document.getElementById('screen-game');
var SR   = document.getElementById('screen-result');
var CANV = document.getElementById('canvas');
var CTX  = CANV.getContext('2d');
var W = 0, H = 0;

var HUD = {
  score:  document.getElementById('h-score'),
  combo:  document.getElementById('h-combo'),
  best:   document.getElementById('h-best'),
  stage:  document.getElementById('stage-lbl'),
  tbar:   document.getElementById('tbar'),
  lives:  document.getElementById('lives'),
  cpop:   document.getElementById('combo-pop'),
  endLbl: document.getElementById('endless-lbl'),
};

var RES = {
  verdict: document.getElementById('verdict'),
  score:   document.getElementById('final-score'),
  acc:     document.getElementById('r-acc'),
  avg:     document.getElementById('r-avg'),
  brt:     document.getElementById('r-brt'),
  bc:      document.getElementById('r-bc'),
  stg:     document.getElementById('r-stg'),
  pb:      document.getElementById('r-pb'),
  nb:      document.getElementById('new-best'),
};

// ── GAME STATE ───────────────────────────────────
var G = {
  running:   false,
  endless:   false,
  muted:     false,
  score:     0,
  combo:     0,
  bestCombo: 0,
  hits:      0,
  misses:    0,
  rtimes:    [],
  stage:     1,
  round:     0,
  lives:     3,      // misses allowed in normal mode
  roundStart:0,
  roundActive:false,
  bestScore: 0,
  bestEndless:0,
  raf:       null,
  roundTimer:null,
};

// ── TARGETS / PARTICLES / FEEDBACKS ─────────────
var targets   = [];
var particles = [];
var feedbacks = [];

// ── DIFFICULTY ───────────────────────────────────
// minR/maxR = radius in pixels; speed = px/frame at 60fps
var STAGES = [
  null,
  { time:2800, minR:42, maxR:60, speed:0,    types:['n','n','n','s'],             fakeP:0,    dangP:0,    perfP:0.05, goldP:0.02 },
  { time:2200, minR:32, maxR:50, speed:1.8,  types:['n','m','s','s'],             fakeP:0.06, dangP:0.02, perfP:0.06, goldP:0.02 },
  { time:1800, minR:24, maxR:40, speed:2.8,  types:['m','m','s','v','u'],         fakeP:0.10, dangP:0.05, perfP:0.07, goldP:0.03 },
  { time:1400, minR:18, maxR:30, speed:3.8,  types:['m','s','v','u','u','f'],     fakeP:0.18, dangP:0.08, perfP:0.08, goldP:0.04 },
  { time:1100, minR:13, maxR:22, speed:5.0,  types:['m','s','v','u','f','f','u'], fakeP:0.25, dangP:0.12, perfP:0.10, goldP:0.05 },
];
// type codes: n=normal m=moving s=shrinking v=multiple u=invisible f=fake

function cfg() { return STAGES[Math.min(G.stage, 5)]; }

function chooseType() {
  var c = cfg();
  if (Math.random() < c.goldP) return 'gold';
  if (Math.random() < c.perfP) return 'perfect';
  if (Math.random() < c.dangP) return 'danger';
  if (Math.random() < c.fakeP) return 'fake';
  var t = c.types[Math.floor(Math.random() * c.types.length)];
  return {n:'normal', m:'moving', s:'shrinking', v:'multiple', u:'invisible', f:'fake'}[t] || 'normal';
}

// ── CANVAS RESIZE ────────────────────────────────
function resizeCanvas() {
  var rect = CANV.getBoundingClientRect();
  W = CANV.width  = Math.floor(rect.width)  || window.innerWidth;
  H = CANV.height = Math.floor(rect.height) || window.innerHeight - 80;
}

window.addEventListener('resize', function() {
  resizeCanvas();
  // Clamp active targets inside new bounds
  targets.forEach(function(t) {
    t.x = Math.max(t.r, Math.min(W - t.r, t.x));
    t.y = Math.max(t.r, Math.min(H - t.r, t.y));
  });
});

// ── AUDIO ────────────────────────────────────────
var AX = null;
function ax() { if (!AX) AX = new (window.AudioContext || window.webkitAudioContext)(); return AX; }

function snd(type) {
  if (G.muted) return;
  try {
    var c = ax(), gn = c.createGain(); gn.connect(c.destination);
    function osc(freq, t0, dur, wave, vol) {
      var o = c.createOscillator(), g = c.createGain();
      o.type = wave || 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(vol||0.18, c.currentTime+t0);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime+t0+dur);
      o.connect(g); g.connect(c.destination);
      o.start(c.currentTime+t0); o.stop(c.currentTime+t0+dur+0.01);
    }
    switch(type) {
      case 'hit':     osc(440,0,0.07,'sine',0.2); osc(660,0.06,0.12,'sine',0.15); break;
      case 'perfect': [660,880,1100].forEach(function(f,i){osc(f,i*0.08,0.2,'sine',0.18);}); break;
      case 'gold':    [523,659,784,1047,1319].forEach(function(f,i){osc(f,i*0.07,0.18,'sine',0.15);}); break;
      case 'miss':    osc(220,0,0.09,'sawtooth',0.15); osc(120,0.07,0.15,'sawtooth',0.12); break;
      case 'danger':  osc(80,0,0.12,'square',0.25); osc(60,0.1,0.2,'square',0.2); break;
      case 'stage':   [330,440,550,660].forEach(function(f,i){osc(f,i*0.14,0.24,'sine',0.13);}); break;
      case 'gameover':[330,220,110].forEach(function(f,i){osc(f,i*0.2,0.28,'sawtooth',0.18);}); break;
      case 'combo':   osc(550 + G.combo*6, 0, 0.1, 'sine', 0.12); break;
    }
  } catch(e) {}
}

// ── COLORS ───────────────────────────────────────
var TC = {
  normal:   { c0:'#38bdf8', c1:'#005da8', c2:'rgba(56,189,248,0.8)', glow:'#38bdf8' },
  moving:   { c0:'#06ffd4', c1:'#007755', c2:'rgba(6,255,212,0.7)',  glow:'#06ffd4' },
  shrinking:{ c0:'#ff8c00', c1:'#993300', c2:'rgba(255,140,0,0.8)',  glow:'#ff8c00' },
  invisible:{ c0:'#38bdf8', c1:'#004488', c2:'rgba(56,189,248,0.5)', glow:'#38bdf8' },
  fake:     { c0:'#ff3b5c', c1:'#770011', c2:'rgba(255,59,92,0.7)',  glow:'#ff3b5c' },
  danger:   { c0:'#ff0044', c1:'#660000', c2:'rgba(255,0,68,0.9)',   glow:'#ff0044' },
  perfect:  { c0:'#ffe066', c1:'#996600', c2:'rgba(255,215,0,0.9)',  glow:'#ffd700' },
  gold:     { c0:'#fff0a0', c1:'#cc8800', c2:'rgba(255,215,0,1.0)',  glow:'#ffd700' },
  correct:  { c0:'#00ff88', c1:'#006633', c2:'rgba(0,255,136,0.8)', glow:'#00ff88' },
  decoy:    { c0:'#38bdf8', c1:'#003366', c2:'rgba(56,189,248,0.6)', glow:'#38bdf8' },
};

// ── DRAW ─────────────────────────────────────────
function drawCircleTarget(t, now) {
  var col = TC[t.type] || TC.normal;
  var alpha = (t.alpha !== undefined) ? t.alpha : 1;
  if (alpha <= 0.01 && t.type !== 'invisible') return;

  CTX.save();
  CTX.globalAlpha = alpha;

  // Glow
  CTX.shadowBlur   = 28;
  CTX.shadowColor  = col.glow;

  // Radial fill
  var gr = CTX.createRadialGradient(t.x - t.r*0.33, t.y - t.r*0.33, t.r*0.05, t.x, t.y, t.r);
  gr.addColorStop(0, col.c0);
  gr.addColorStop(0.6, col.c1);
  gr.addColorStop(1, '#010208');
  CTX.beginPath();
  CTX.arc(t.x, t.y, t.r, 0, Math.PI*2);
  CTX.fillStyle = gr;
  CTX.fill();

  // Specular
  CTX.shadowBlur = 0;
  var hl = CTX.createRadialGradient(t.x-t.r*0.38, t.y-t.r*0.38, 0, t.x-t.r*0.28, t.y-t.r*0.28, t.r*0.5);
  hl.addColorStop(0, 'rgba(255,255,255,0.42)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  CTX.beginPath();
  CTX.arc(t.x, t.y, t.r, 0, Math.PI*2);
  CTX.fillStyle = hl;
  CTX.fill();

  // Pulse ring
  if (t.type === 'normal' || t.type === 'correct' || t.type === 'perfect' || t.type === 'gold') {
    var rAge = (now - t.spawnTime) % 900;
    var rf   = rAge / 900;
    CTX.globalAlpha = alpha * (1 - rf) * 0.45;
    CTX.beginPath();
    CTX.arc(t.x, t.y, t.r * (1 + rf * 0.65), 0, Math.PI*2);
    CTX.strokeStyle = col.c0;
    CTX.lineWidth = 2.5;
    CTX.stroke();
    CTX.globalAlpha = alpha;
  }

  // Icons
  CTX.shadowBlur = 0;
  var fs = Math.max(10, Math.floor(t.r * 0.85));
  CTX.textAlign = 'center'; CTX.textBaseline = 'middle';
  if (t.type === 'danger') {
    CTX.font = 'bold ' + fs + 'px serif';
    CTX.fillStyle = 'rgba(255,220,220,0.88)';
    CTX.fillText('☠', t.x, t.y + 1);
  }
  if (t.type === 'fake') {
    CTX.font = 'bold ' + Math.floor(fs*0.85) + 'px sans-serif';
    CTX.fillStyle = 'rgba(255,255,255,0.5)';
    CTX.fillText('✕', t.x, t.y + 1);
  }
  if (t.type === 'gold') {
    CTX.font = 'bold ' + Math.floor(fs*0.72) + 'px serif';
    CTX.fillStyle = 'rgba(60,40,0,0.85)';
    CTX.fillText('★', t.x, t.y + 1);
  }
  if (t.type === 'perfect') {
    CTX.font = 'bold ' + Math.floor(fs*0.65) + 'px serif';
    CTX.fillStyle = 'rgba(80,60,0,0.9)';
    CTX.fillText('◈', t.x, t.y + 1);
  }
  CTX.textAlign = 'left'; CTX.textBaseline = 'alphabetic';

  // Danger pulsing glow
  if (t.type === 'danger') {
    var pulse = 0.5 + 0.5 * Math.sin((now - t.spawnTime) / 130);
    CTX.globalAlpha = alpha * pulse * 0.45;
    CTX.shadowBlur = 50; CTX.shadowColor = '#ff0044';
    CTX.beginPath(); CTX.arc(t.x, t.y, t.r + 4, 0, Math.PI*2);
    CTX.strokeStyle = '#ff4466'; CTX.lineWidth = 3; CTX.stroke();
  }

  CTX.restore();
}

function drawParticles(now) {
  particles.forEach(function(p) {
    var elapsed = now - p.born;
    if (elapsed >= p.life) return;
    var life = 1 - elapsed / p.life;
    var px = p.x + p.vx * elapsed / 1000;
    var py = p.y + p.vy * elapsed / 1000;
    CTX.save();
    CTX.globalAlpha = life * life;
    CTX.fillStyle = p.color;
    CTX.beginPath();
    CTX.arc(px, py, p.r * (0.3 + 0.7 * life), 0, Math.PI*2);
    CTX.fill();
    CTX.restore();
  });
}

function drawFeedbacks(now) {
  feedbacks.forEach(function(f) {
    var elapsed = now - f.born;
    if (elapsed >= f.dur) return;
    var life = 1 - elapsed / f.dur;
    var yOff = elapsed * 0.045;
    CTX.save();
    CTX.globalAlpha = Math.pow(life, 0.6);
    CTX.fillStyle = f.color;
    CTX.shadowBlur = 12; CTX.shadowColor = f.color;
    CTX.font = 'bold ' + f.px + 'px Orbitron, monospace';
    CTX.textAlign = 'center';
    CTX.fillText(f.text, f.x, f.y - yOff);
    CTX.restore();
  });
  CTX.textAlign = 'left';
}

// ── UPDATE ───────────────────────────────────────
function update(now) {
  targets.forEach(function(t) {
    if (t.gone) return;

    // Moving & decoy bounce
    if (t.type === 'moving' || (t.type === 'decoy' && t.vx)) {
      t.x += t.vx; t.y += t.vy;
      if (t.x - t.r < 0)  { t.x = t.r;    t.vx =  Math.abs(t.vx); }
      if (t.x + t.r > W)  { t.x = W-t.r;  t.vx = -Math.abs(t.vx); }
      if (t.y - t.r < 0)  { t.y = t.r;    t.vy =  Math.abs(t.vy); }
      if (t.y + t.r > H)  { t.y = H-t.r;  t.vy = -Math.abs(t.vy); }
    }

    // Shrinking
    if (t.type === 'shrinking') {
      var prog = Math.min(1, (now - t.spawnTime) / t.lifeTime);
      t.r = Math.max(t.minR, t.origR * (1 - prog * 0.88));
    }

    // Invisible fade
    if (t.type === 'invisible') {
      var age = now - t.spawnTime;
      if (age < 380) {
        t.alpha = 1 - (age / 380) * 0.96;
      } else {
        // subtly visible (findable by outline)
        t.alpha = 0.04 + 0.06 * Math.sin(age / 220);
      }
    }
  });

  // Timer bar
  if (G.roundActive && targets.length) {
    var lead = targets[0];
    var frac = 1 - (now - lead.spawnTime) / lead.lifeTime;
    frac = Math.max(0, Math.min(1, frac));
    HUD.tbar.style.width = (frac * 100) + '%';
    HUD.tbar.className = frac < 0.25 ? 'crit' : frac < 0.5 ? 'warn' : '';
  }

  // Prune old particles/feedbacks
  var cutoff = now - 1200;
  particles = particles.filter(function(p){ return (now - p.born) < p.life; });
  feedbacks  = feedbacks.filter(function(f){ return (now - f.born) < f.dur;  });
}

// ── GAME LOOP ────────────────────────────────────
function loop(ts) {
  if (!G.running) return;
  update(ts);
  CTX.clearRect(0, 0, W, H);
  targets.forEach(function(t){ if (!t.gone) drawCircleTarget(t, ts); });
  drawParticles(ts);
  drawFeedbacks(ts);
  G.raf = requestAnimationFrame(loop);
}

// ── SPAWN ────────────────────────────────────────
function safePos(r) {
  var pad = r + 12;
  var sw  = Math.max(W - pad*2, pad);
  var sh  = Math.max(H - pad*2, pad);
  return { x: pad + Math.random()*sw, y: pad + Math.random()*sh };
}

function randInt(a,b){ return Math.floor(a + Math.random()*(b-a+1)); }

function makeTarget(type, r, x, y) {
  var c = cfg();
  var t = {
    type: type,
    x: x, y: y, r: r,
    origR: r, minR: Math.max(8, Math.floor(r * 0.18)),
    spawnTime: performance.now(),
    lifeTime:  c.time,
    valid: (type !== 'fake' && type !== 'danger' && type !== 'decoy'),
    gone: false,
    alpha: (type === 'invisible') ? 1 : undefined,
    vx: 0, vy: 0,
  };
  if (type === 'moving') {
    var ang = Math.random() * Math.PI * 2;
    t.vx = Math.cos(ang) * c.speed;
    t.vy = Math.sin(ang) * c.speed;
  }
  if (type === 'perfect' || type === 'gold') {
    t.r = Math.max(10, Math.floor(r * 0.52));
    t.origR = t.r;
  }
  return t;
}

function spawnRound() {
  if (!G.running) return;
  targets = []; particles = []; feedbacks = [];
  clearTimeout(G.roundTimer);

  var type = chooseType();
  var c    = cfg();

  if (type === 'multiple') {
    spawnMultiple(c);
  } else {
    var r   = randInt(c.minR, c.maxR);
    var pos = safePos(r);
    targets.push(makeTarget(type, r, pos.x, pos.y));
  }

  G.roundStart  = performance.now();
  G.roundActive = true;
  G.round++;

  // Timeout
  var life = targets[0].lifeTime;
  G.roundTimer = setTimeout(function() {
    if (G.roundActive) onTimeout();
  }, life + 100);
}

function spawnMultiple(c) {
  var count = randInt(3, Math.min(5, 2 + G.stage));
  var cidx  = randInt(0, count - 1);
  var placed = [];
  var r = Math.floor((c.minR + c.maxR) / 2 * 0.9);

  for (var i = 0; i < count; i++) {
    var type = (i === cidx) ? 'correct' : 'decoy';
    var pos, tries = 0, ok;
    do {
      pos = safePos(r); ok = true;
      for (var j = 0; j < placed.length; j++) {
        var dx = pos.x - placed[j].x, dy = pos.y - placed[j].y;
        if (Math.sqrt(dx*dx+dy*dy) < r*2.8) { ok = false; break; }
      }
    } while (!ok && ++tries < 40);

    var t = makeTarget(type, r, pos.x, pos.y);
    if (type === 'decoy') {
      var ang = Math.random() * Math.PI * 2;
      t.vx = Math.cos(ang) * c.speed * 0.6;
      t.vy = Math.sin(ang) * c.speed * 0.6;
    }
    targets.push(t);
    placed.push({x: pos.x, y: pos.y});
  }
}

// ── CLICK / HIT DETECTION ────────────────────────
CANV.addEventListener('pointerdown', function(e) {
  if (!G.running || !G.roundActive) return;
  e.preventDefault();
  var rect = CANV.getBoundingClientRect();
  var mx = e.clientX - rect.left;
  var my = e.clientY - rect.top;

  var hitTarget = null;
  for (var i = 0; i < targets.length; i++) {
    var t = targets[i];
    if (t.gone) continue;
    var dx = mx - t.x, dy = my - t.y;
    if (Math.sqrt(dx*dx + dy*dy) <= t.r) { hitTarget = t; break; }
  }

  if (!hitTarget) {
    // Background click = miss only if there is a valid (non-fake) target
    var hasValid = targets.some(function(t){ return !t.gone && t.valid; });
    if (hasValid) onMiss(mx, my);
    return;
  }

  if (hitTarget.type === 'danger')       onDanger(hitTarget, mx, my);
  else if (!hitTarget.valid)             onFake(hitTarget, mx, my);
  else                                   onHit(hitTarget, mx, my);
});

// ── SCORE TABLE ──────────────────────────────────
var BASE_PTS = { normal:100, moving:150, shrinking:130, invisible:200, correct:120, perfect:500, gold:900 };

function onHit(t, mx, my) {
  if (!G.roundActive) return;
  G.roundActive = false;
  clearTimeout(G.roundTimer);
  t.gone = true;
  // Hide all other targets in multiple
  targets.forEach(function(o){ o.gone = true; });

  var rt  = performance.now() - G.roundStart;
  var isPerfect = rt < 320 && t.type !== 'gold';
  var isGold    = t.type === 'gold';

  G.hits++;
  G.combo++;
  if (G.combo > G.bestCombo) G.bestCombo = G.combo;
  G.rtimes.push(rt);

  // Score
  var base   = BASE_PTS[t.type] || 100;
  var mult   = 1 + Math.floor(G.combo / 5) * 0.15;
  var rtBonus= Math.max(0, Math.floor((2500 - rt) / 10));
  var pts    = Math.floor((base + rtBonus) * mult);
  if (isPerfect) pts = Math.floor(pts * 2.5);

  G.score += pts;

  // Particles
  var pcol = TC[t.type] ? TC[t.type].c0 : '#38bdf8';
  spawnParticles(mx, my, pcol, isGold || isPerfect ? 30 : 18);

  // Feedback
  addFeed('+' + pts, mx, my - 8, '#06ffd4', 22, 900);
  addFeed(Math.round(rt) + 'ms', mx + 30, my + 14, '#667799', 14, 700);
  if (isPerfect) addFeed('PERFECT!', mx, my - 44, '#ffd700', 26, 950);
  if (isGold)    addFeed('GOLD!!',   mx, my - 44, '#ffd700', 28, 1000);

  snd(isGold ? 'gold' : isPerfect ? 'perfect' : G.combo >= 5 ? 'combo' : 'hit');

  checkComboMilestone(G.combo);
  updateHUD();
  saveBests();
  checkStageUp();
  updateLives();

  setTimeout(spawnRound, 130);
}

function onFake(t, mx, my) {
  if (!G.roundActive) return;
  G.roundActive = false;
  clearTimeout(G.roundTimer);
  targets.forEach(function(o){ o.gone = true; });

  G.combo = 0; G.misses++;
  G.score = Math.max(0, G.score - 80);
  addFeed('WRONG!', mx, my, '#ff3b5c', 22, 900);
  snd('miss'); shake();
  updateHUD(); saveBests(); updateLives();

  if (G.endless) { endGame(); return; }
  if (G.misses >= G.lives) { endGame(); return; }
  setTimeout(spawnRound, 280);
}

function onDanger(t, mx, my) {
  t.gone = true;
  addFeed('DANGER!', mx, my, '#ff0044', 28, 1000);
  snd('danger'); shake();
  setTimeout(endGame, 150);
}

function onMiss(mx, my) {
  G.combo = 0; G.misses++;
  G.score = Math.max(0, G.score - 40);
  addFeed('MISS', mx, my, '#ff3b5c', 18, 700);
  snd('miss');
  updateHUD(); updateLives();
}

function onTimeout() {
  if (!G.roundActive) return;
  G.roundActive = false;
  targets.forEach(function(o){ o.gone = true; });

  G.combo = 0; G.misses++;
  snd('miss');
  updateHUD(); updateLives();

  if (G.endless) { endGame(); return; }
  if (G.misses >= G.lives) { endGame(); return; }
  setTimeout(spawnRound, 260);
}

// ── PARTICLES & FEEDBACK ─────────────────────────
function spawnParticles(x, y, color, count) {
  var now = performance.now();
  var cols = [color, '#ffffff', color];
  for (var i = 0; i < count; i++) {
    var ang   = (i / count) * Math.PI*2 + Math.random()*0.5;
    var spd   = 50 + Math.random()*120;
    particles.push({
      x:x, y:y, r:2.5 + Math.random()*5,
      vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd,
      color: cols[Math.floor(Math.random()*cols.length)],
      born: now, life: 380 + Math.random()*420,
    });
  }
}

function addFeed(text, x, y, color, px, dur) {
  feedbacks.push({ text:text, x:x, y:y, color:color, px:px||20, born:performance.now(), dur:dur||900 });
}

// ── COMBO MILESTONES ─────────────────────────────
var MILESTONES = [
  {at:5,  t:'NICE',    c:'#06ffd4'},
  {at:10, t:'FAST!',   c:'#38bdf8'},
  {at:15, t:'HOT',     c:'#ff8c00'},
  {at:20, t:'INSANE',  c:'#cc44ff'},
  {at:30, t:'GODLIKE', c:'#ffd700'},
  {at:50, t:'LEGEND',  c:'#ffffff'},
];

function checkComboMilestone(combo) {
  for (var i = 0; i < MILESTONES.length; i++) {
    if (combo === MILESTONES[i].at) {
      showComboPop(MILESTONES[i].t, MILESTONES[i].c);
      return;
    }
  }
}

function showComboPop(text, color) {
  HUD.cpop.className = '';
  void HUD.cpop.offsetWidth;
  HUD.cpop.textContent = text;
  HUD.cpop.style.color = color;
  HUD.cpop.style.textShadow = '0 0 30px ' + color;
  HUD.cpop.className = 'cpanim';
  setTimeout(function(){ HUD.cpop.className = ''; HUD.cpop.textContent = ''; }, 800);
}

// ── STAGE ────────────────────────────────────────
function checkStageUp() {
  var newStage;
  if (G.endless) {
    newStage = Math.min(5, 1 + Math.floor(G.round / 10));
  } else {
    if      (G.score >= 9000) newStage = 5;
    else if (G.score >= 4500) newStage = 4;
    else if (G.score >= 2000) newStage = 3;
    else if (G.score >= 700)  newStage = 2;
    else                      newStage = 1;
  }
  if (newStage !== G.stage) {
    G.stage = newStage;
    showStageFlash(newStage);
  }
}

function showStageFlash(n) {
  HUD.stage.textContent = 'STAGE ' + n;
  var div = document.createElement('div'); div.className = 'sf';
  var sp  = document.createElement('span'); sp.textContent = 'STAGE ' + n;
  div.appendChild(sp); document.body.appendChild(div);
  snd('stage');
  setTimeout(function(){ if (div.parentNode) div.parentNode.removeChild(div); }, 1000);
}

// ── HUD ──────────────────────────────────────────
function updateHUD() {
  HUD.score.textContent = G.score;
  HUD.combo.textContent = 'x' + G.combo;
  HUD.best.textContent  = G.endless ? G.bestEndless : G.bestScore;
  HUD.combo.className   = G.combo >= 5 ? 'hv glow' : 'hv';
}

function updateLives() {
  if (G.endless) {
    HUD.lives.textContent = '';
    return;
  }
  var left = G.lives - G.misses;
  var s = '';
  for (var i = 0; i < G.lives; i++) s += (i < left ? '♥' : '♡');
  HUD.lives.textContent = s;
}

// ── GAME FLOW ────────────────────────────────────
function startGame(endless) {
  // Reset state
  G.score=0; G.combo=0; G.bestCombo=0; G.hits=0; G.misses=0;
  G.rtimes=[]; G.stage=1; G.round=0; G.running=true;
  G.endless=!!endless; G.roundActive=false; G.lives=3;
  targets=[]; particles=[]; feedbacks=[];
  clearTimeout(G.roundTimer);
  cancelAnimationFrame(G.raf);

  // Switch screens
  SS.classList.remove('active');
  SR.classList.remove('active');
  SG.classList.add('active');

  // UI
  HUD.stage.textContent = 'STAGE 1';
  HUD.tbar.style.width  = '100%';
  HUD.tbar.className    = '';
  HUD.cpop.textContent  = '';
  HUD.endLbl.className  = endless ? 'endless-lbl' : 'hidden';
  updateHUD();
  updateLives();

  // Resize canvas AFTER the screen is visible (layout computed)
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      resizeCanvas();
      G.raf = requestAnimationFrame(loop);
      spawnRound();
    });
  });
}

function endGame() {
  G.running    = false;
  G.roundActive = false;
  clearTimeout(G.roundTimer);
  cancelAnimationFrame(G.raf);
  targets=[]; particles=[];

  saveBests();
  snd('gameover');

  setTimeout(showResult, 500);
}

function toMenu() {
  G.running = false;
  clearTimeout(G.roundTimer);
  cancelAnimationFrame(G.raf);

  SG.classList.remove('active');
  SR.classList.remove('active');
  SS.classList.add('active');

  document.getElementById('s-best').textContent    = G.bestScore;
  document.getElementById('s-endless').textContent = G.bestEndless;
}

// ── RESULT SCREEN ────────────────────────────────
var VERDICTS = [
  function(acc,rt){ return acc >= 90 && rt < 250; }, "YOUR REACTION TIME IS ILLEGAL.",
  function(acc,rt){ return acc >= 80 && rt < 380; }, "YOU WERE FAST.",
  function(acc,rt){ return acc >= 70; },             "NOT BAD.",
  function(acc,rt){ return acc >= 50; },             "THE TARGET WASN'T EVEN THAT HARD.",
  function()      { return true; },                  "YOU ALMOST HAD IT.",
];

function getVerdict(acc, rt) {
  for (var i = 0; i < VERDICTS.length; i += 2) {
    if (VERDICTS[i](acc, rt)) return VERDICTS[i+1];
  }
  return "YOU ALMOST HAD IT.";
}

function showResult() {
  SG.classList.remove('active');
  SR.classList.add('active');

  var total = G.hits + G.misses;
  var acc   = total ? Math.round(G.hits/total*100) : 0;
  var avgRt = G.rtimes.length ? Math.round(G.rtimes.reduce(function(a,b){return a+b;},0)/G.rtimes.length) : 0;
  var bestRt= G.rtimes.length ? Math.round(Math.min.apply(null, G.rtimes)) : 0;
  var pb    = G.endless ? G.bestEndless : G.bestScore;

  RES.verdict.textContent = getVerdict(acc, avgRt);
  RES.score.textContent   = G.score;
  RES.acc.textContent     = acc + '%';
  RES.avg.textContent     = avgRt ? avgRt + 'ms' : '—';
  RES.brt.textContent     = bestRt ? bestRt + 'ms' : '—';
  RES.bc.textContent      = 'x' + G.bestCombo;
  RES.stg.textContent     = G.stage;
  RES.pb.textContent      = pb;

  var isNewBest = G.endless ? (G.score > 0 && G.score >= G.bestEndless) : (G.score > 0 && G.score >= G.bestScore);
  RES.nb.className = isNewBest ? '' : 'hidden';
}

// ── LOCALSTORAGE ─────────────────────────────────
function saveBests() {
  try {
    if (G.endless) {
      if (G.score > G.bestEndless) { G.bestEndless = G.score; localStorage.setItem('os_be', G.bestEndless); }
    } else {
      if (G.score > G.bestScore)   { G.bestScore   = G.score; localStorage.setItem('os_bs', G.bestScore);   }
    }
  } catch(e) {}
}

function loadBests() {
  try {
    var bs = parseInt(localStorage.getItem('os_bs'), 10);
    var be = parseInt(localStorage.getItem('os_be'), 10);
    if (!isNaN(bs)) G.bestScore   = bs;
    if (!isNaN(be)) G.bestEndless = be;
  } catch(e) {}
}

// ── SHAKE ────────────────────────────────────────
function shake() {
  document.body.classList.remove('shaking');
  void document.body.offsetWidth;
  document.body.classList.add('shaking');
  setTimeout(function(){ document.body.classList.remove('shaking'); }, 310);
}

// ── MUTE ─────────────────────────────────────────
function toggleMute() {
  G.muted = !G.muted;
  var icon = G.muted ? '🔇' : '🔊';
  document.getElementById('mute-s').textContent = icon;
  document.getElementById('mute-g').textContent = icon;
}

// ── EVENT LISTENERS ──────────────────────────────
document.getElementById('btn-play').addEventListener('click',  function(){ startGame(false); });
document.getElementById('btn-endl').addEventListener('click',  function(){ startGame(true);  });
document.getElementById('btn-again').addEventListener('click', function(){ startGame(G.endless); });
document.getElementById('btn-menu').addEventListener('click',  toMenu);
document.getElementById('mute-s').addEventListener('click',   toggleMute);
document.getElementById('mute-g').addEventListener('click',   toggleMute);

document.addEventListener('keydown', function(e) {
  if (e.key === ' ' || e.key === 'Enter') {
    if (SS.classList.contains('active')) { e.preventDefault(); startGame(false); }
  }
  if ((e.key === 'r' || e.key === 'R') && SR.classList.contains('active')) startGame(G.endless);
  if (e.key === 'm' || e.key === 'M') toggleMute();
});

// ── INIT ─────────────────────────────────────────
loadBests();
document.getElementById('s-best').textContent    = G.bestScore;
document.getElementById('s-endless').textContent = G.bestEndless;

console.log('%cONE SECOND', 'color:#38bdf8;font-size:20px;font-weight:bold;');
console.log('%cHit the target. Don\'t trust your eyes.', 'color:#555;font-size:11px;');
