// woodlouse.js — Faster, natural/random directions ON the current visible page/cover.
// - 2 bugs per burst, every 20s
// - Each spawn: random edge -> random opposite edge (varied directions)
// - Gentle wander + soft steering (no straight-line gliding, no billiard bounces)
// - Despawn only after fully outside the page/cover

(function () {
  const CFG = {
    burstEveryMs: 15000,       // 15s
    burstSize: 2,              // try to add up to 2 (respects active cap)
    activeMax: 2,              // never more than 2 alive at once

    size: 46,
    imgs: ["craw-2.png", "craw-3.png"],
    frameMs: 90,               // slightly quicker leg cycle

    // Speed / dynamics (faster than before)
    speedMin: 320,             // min
    speedMax: 460,             // max
    baseSpeed: [360, 440],     // initial speed (px/s)
    accelMax: 900,             // steering accel cap (px/s^2)
    inertia: 0.86,             // 0..1 (lower = snappier turns)

    // Organic wandering
    wanderStrength: 240,       // px/s^2
    wanderTurnRate: 2.6,       // rad/s (how quickly wander angle can drift)
    wanderJitter: 0.9,         // 0..1 extra randomness

    edgePad: 6,                // spawn padding
    scatterBoost: 1.9          // mild speed-up on page turn
  };

  let $flip, hostSurface = null, layer = null;
  let lice = new Set(), running = false, lastT = 0, frameClock = 0, spawnTimerId = null;

  const q=(s)=>document.querySelector(s);
  const qa=(s)=>Array.from(document.querySelectorAll(s));
  const rnd=(a,b)=>a+Math.random()*(b-a);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const nowMs=()=>performance.now ? performance.now() : Date.now();

  // ---------- preload ----------
  function preloadImages(urls){
    return Promise.all(urls.map(src=>new Promise(res=>{
      const im = new Image(); im.onload=()=>res(); im.onerror=()=>res(); im.src = src;
    })));
  }

  // ---------- find visible page/cover ----------
  function resolveCurrentSurface() {
    const book = q(".flipbook");
    if (!book) return null;
    const br = book.getBoundingClientRect();
    const cx = br.left + br.width/2, cy = br.top + br.height/2;

    const candidates = qa(".flipbook .page").filter(el=>{
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0;
    });

    for (const el of candidates){
      const r = el.getBoundingClientRect();
      if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) return el;
    }
    const byArea = (a,b)=> (b.getBoundingClientRect().width*b.getBoundingClientRect().height) -
                           (a.getBoundingClientRect().width*a.getBoundingClientRect().height);
    const hards = candidates.filter(el=>el.classList.contains("hard")).sort(byArea);
    if (hards[0]) return hards[0];
    candidates.sort(byArea);
    return candidates[0] || null;
  }

  function mountLayerToCurrentSurface() {
    const target = resolveCurrentSurface();
    if (!target) return;
    if (hostSurface === target && layer && layer.parentElement === hostSurface) return;
    hostSurface = target;

    if (!layer) {
      layer = document.createElement("div");
      layer.className = "woodlouse-layer";
    } else {
      layer.remove();
    }
    hostSurface.appendChild(layer);
  }

  // ---------- entity ----------
  function makeLouse() {
    const el = document.createElement("div");
    el.className = "woodlouse";
    el.style.width = el.style.height = CFG.size + "px";
    el.style.backgroundImage = `url("${CFG.imgs[0]}")`;
    layer.appendChild(el);
    return {
      el, x:0, y:0,
      vx:0, vy:0,
      frame:0, alive:true,
      wanderAngle: rnd(0, Math.PI*2),
      exit:{x:0,y:0}
    };
  }

  // Configure random edge->opposite edge (varied directions, incl. diagonals)
  function configureRoute(L, side, W, H, S, pad){
    if (side === 0) { // bottom -> up
      L.x = clamp(rnd(pad, W - S - pad), pad, W - S - pad);
      L.y = H - S;
      L.exit.x = clamp(rnd(pad, W - S - pad), pad, W - S - pad);
      L.exit.y = -S - 4;
    } else if (side === 1) { // top -> down
      L.x = clamp(rnd(pad, W - S - pad), pad, W - S - pad);
      L.y = 0;
      L.exit.x = clamp(rnd(pad, W - S - pad), pad, W - S - pad);
      L.exit.y = H + 4;
    } else if (side === 2) { // left -> right
      L.x = 0;
      L.y = clamp(rnd(pad, H - S - pad), pad, H - S - pad);
      L.exit.x = W + 4;
      L.exit.y = clamp(rnd(pad, H - S - pad), pad, H - S - pad);
    } else { // right -> left
      L.x = W - S;
      L.y = clamp(rnd(pad, H - S - pad), pad, H - S - pad);
      L.exit.x = -S - 4;
      L.exit.y = clamp(rnd(pad, H - S - pad), pad, H - S - pad);
    }

    // initial velocity toward exit, with your faster baseline
    const dx = (L.exit.x - L.x), dy = (L.exit.y - L.y);
    const ang = Math.atan2(dy, dx);
    const spd = rnd(...CFG.baseSpeed);
    L.vx = Math.cos(ang) * spd;
    L.vy = Math.sin(ang) * spd;
    L.wanderAngle = ang + rnd(-0.6, 0.6); // start with slight bias

    L.el.style.transform = `translate3d(${L.x}px,${L.y}px,0) rotate(${ang + Math.PI/2}rad)`;
  }

  function spawnOne(){
    if (!layer) return null;
    if (lice.size >= CFG.activeMax) return null;

    const W = layer.clientWidth, H = layer.clientHeight, S = CFG.size, pad = CFG.edgePad;
    const L = makeLouse();
    const side = Math.floor(Math.random()*4); // random edge each time
    configureRoute(L, side, W, H, S, pad);
    lice.add(L);
    return L;
  }

  function spawnBurst() {
    mountLayerToCurrentSurface();
    const need = Math.max(0, CFG.activeMax - lice.size);
    const toSpawn = Math.min(CFG.burstSize, need);
    for (let i=0; i<toSpawn; i++) spawnOne();
  }

  // ---------- helpers ----------
  function limit(x, y, max){
    const m = Math.hypot(x,y);
    if (m > max && m > 0) { const k = max/m; return {x:x*k, y:y*k}; }
    return {x, y};
  }

  function steerToward(L, tx, ty, accelBudget){
    const dx = tx - L.x, dy = ty - L.y;
    let desiredX = dx, desiredY = dy;
    const len = Math.hypot(desiredX, desiredY) || 1;
    const desiredSpeed = clamp(Math.hypot(L.vx, L.vy), CFG.speedMin, CFG.speedMax);
    desiredX = desiredX / len * desiredSpeed;
    desiredY = desiredY / len * desiredSpeed;

    let ax = desiredX - L.vx;
    let ay = desiredY - L.vy;
    ({x:ax, y:ay} = limit(ax, ay, accelBudget));
    return {ax, ay};
  }

  function wanderForce(L, dt){
    const maxDelta = CFG.wanderTurnRate * dt;
    const delta = rnd(-maxDelta, maxDelta) * (0.5 + 0.5*CFG.wanderJitter);
    L.wanderAngle += delta;
    const ax = Math.cos(L.wanderAngle) * CFG.wanderStrength;
    const ay = Math.sin(L.wanderAngle) * CFG.wanderStrength;
    return {ax, ay};
  }

  function maybeDespawn(L){
    const W = layer.clientWidth, H = layer.clientHeight, S = CFG.size;
    if (L.x < -S || L.x > W || L.y < -S || L.y > H) {
      L.alive = false;
      L.el.classList.add("woodlouse--despawn");
      setTimeout(()=>{ L.el.remove(); lice.delete(L); }, 200);
    }
  }

  function stepFrame(L){
    L.frame = (L.frame + 1) % CFG.imgs.length;
    L.el.style.backgroundImage = `url("${CFG.imgs[L.frame]}")`;
  }

  // ---------- main loop ----------
  function tick(dt){
    if (!layer) return;
    lice.forEach(L=>{
      if (!L.alive) return;

      // Wander + soft steering toward exit → naturally curved paths
      const w = wanderForce(L, dt);
      const s = steerToward(L, L.exit.x, L.exit.y, CFG.accelMax);

      // Combine, cap accel
      let ax = w.ax + s.ax, ay = w.ay + s.ay;
      ({x:ax, y:ay} = limit(ax, ay, CFG.accelMax));

      // Integrate velocity with a bit of inertia
      L.vx = L.vx * CFG.inertia + ax * dt;
      L.vy = L.vy * CFG.inertia + ay * dt;

      // Clamp speed
      const sp = Math.hypot(L.vx, L.vy) || 1;
      const spClamped = clamp(sp, CFG.speedMin, CFG.speedMax);
      if (sp !== spClamped) { L.vx *= spClamped / sp; L.vy *= spClamped / sp; }

      // Integrate position
      L.x += L.vx * dt;
      L.y += L.vy * dt;

      // Face velocity; sprites oriented "up"
      const ang = Math.atan2(L.vy, L.vx) + Math.PI/2;
      L.el.style.transform = `translate3d(${L.x}px,${L.y}px,0) rotate(${ang}rad)`;

      maybeDespawn(L);
    });
  }

  function scatterAll(mult = CFG.scatterBoost){
    lice.forEach(L=>{
      if (!L.alive) return;
      const sp = Math.hypot(L.vx, L.vy) * mult;
      const ang = Math.atan2(L.vy, L.vx);
      L.vx = Math.cos(ang) * sp;
      L.vy = Math.sin(ang) * sp;
    });
  }

  function loop(ts){
    if (!running) return;
    if (!lastT) lastT = ts;
    const dt = Math.min(0.05, (ts - lastT)/1000); lastT = ts;

    frameClock += dt*1000;
    if (frameClock >= CFG.frameMs){
      lice.forEach(stepFrame);
      frameClock = 0;
    }

    tick(dt);
    requestAnimationFrame(loop);
  }

  async function start(){
    $flip = $(".flipbook");
    if (!$flip.length) return;

    await preloadImages(CFG.imgs);
    mountLayerToCurrentSurface();

    // Keep layer on current page/cover
    window.addEventListener("resize", mountLayerToCurrentSurface);
    $flip.on("turning", ()=>{ scatterAll(1.2); });
    $flip.on("turned",  ()=>{ mountLayerToCurrentSurface(); scatterAll(1.2); });

    // First burst, then every 20s
    setTimeout(spawnBurst, 800);
    spawnTimerId = setInterval(spawnBurst, CFG.burstEveryMs);

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    running = !media.matches;
    if (running) requestAnimationFrame(loop);
  }

  // Optional tiny API
  window.woodlouse = { start, burst: ()=>spawnBurst(), scatter: ()=>scatterAll() };

  document.addEventListener("DOMContentLoaded", start);
})();
