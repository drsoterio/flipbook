
// woodlouse.js — spawn on visible pages/covers, with solid edge→edge routes

(function(){
  const CFG = {
    burstEveryMs: 15000,
    burstSize: 2,
    activeMaxPerSurface: 2,
    size: 46,
    imgs: ["craw-2.png", "craw-3.png"],
    frameMs: 90,

    // Motion tuning
    speedMin: 300, speedMax: 420,           // slightly tighter band
    baseSpeed: [300, 420],
    accelMax: 800,
    inertia: 0.88,

    // Keep wander subtle so paths look purposeful
    wanderStrength: 120,
    wanderTurnRate: 2.0,
    wanderJitter: 0.7,

    // Strong bias toward the target to prevent meandering
    pathBias: 1.8,

    edgePad: 6,
    scatterBoost: 1.6
  };

  let $flip, running = false, lastT = 0, frameClock = 0, spawnTimerId = null;

  // element -> { layer, lice:Set<L> }
  const surfaces = new Map();

  const qa = (s)=>Array.from(document.querySelectorAll(s));
  const rnd=(a,b)=>a+Math.random()*(b-a);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  // ---------- preload ----------
  function preloadImages(urls){
    return Promise.all(urls.map(src=>new Promise(res=>{
      const im = new Image(); im.onload=()=>res(); im.onerror=()=>res(); im.src = src;
    })));
  }

  // ---------- visibility ----------
  function rectHasSize(r){ return r && r.width > 20 && r.height > 20; }

  function getVisiblePages() {
    // All .page nodes (including .hard covers)
    const pages = qa(".flipbook .page").filter(el=>{
      const r = el.getBoundingClientRect();
      return rectHasSize(r) && r.bottom > 0 && r.top < innerHeight;
    });

    // Prefer the two largest (typical Turn.js spread)
    pages.sort((a,b)=>{
      const ra=a.getBoundingClientRect(), rb=b.getBoundingClientRect();
      return (rb.width*rb.height) - (ra.width*ra.height);
    });

    return pages.slice(0, 2);
  }

  function ensureLayersOnVisiblePages() {
    const vis = getVisiblePages();

    // Ensure each visible page has a layer that actually occupies its box
    vis.forEach(el=>{
      let info = surfaces.get(el);
      if (!info) {
        const layer = document.createElement("div");
        layer.className = "woodlouse-layer";
        el.appendChild(layer);
        // Defensive: force the layer to fill even if styles load late
        layer.style.position = "absolute";
        layer.style.inset = "0";
        layer.style.pointerEvents = "none";
        layer.style.overflow = "hidden";
        layer.style.zIndex = "9";
        surfaces.set(el, { layer, lice: new Set() });
      } else {
        // If Turn.js reparented the page, keep layer on the same element
        if (info.layer.parentElement !== el) el.appendChild(info.layer);
        // Make sure inset is still correct (some resets can nuke it)
        info.layer.style.inset = "0";
      }
    });

    // Note: we do not destroy layers for non-visible pages; bugs finish their route and despawn naturally.

    return vis;
  }

  // ---------- entity ----------
  function makeLouse(surfaceInfo) {
    const el = document.createElement("div");
    el.className = "woodlouse";
    el.style.width = el.style.height = CFG.size + "px";
    el.style.backgroundImage = `url("${CFG.imgs[0]}")`;
    surfaceInfo.layer.appendChild(el);
    return {
      el, surfaceInfo,
      x:0, y:0, vx:0, vy:0,
      frame:0, alive:true,
      wanderAngle: rnd(0, Math.PI*2),
      exit:{x:0,y:0}
    };
  }

  // Safer measurement (avoid 0×0 during page turns)
  function measure(el){
    const r = el.getBoundingClientRect();
    // Fallback to offset if rect is temporarily 0
    const W = r.width  || el.offsetWidth  || 0;
    const H = r.height || el.offsetHeight || 0;
    return {W,H};
  }

  // Configure route: random edge → opposite edge
  function configureRoute(L, W, H) {
    const S = CFG.size, pad = CFG.edgePad;
    // Guard against transient zero sizes
    if (W < S + pad*2 || H < S + pad*2) {
      // Put something sensible; try again next frame
      L.x = pad; L.y = pad;
      L.exit.x = W - S - pad; L.exit.y = H - S - pad;
    } else {
      const side = Math.floor(Math.random()*4); // 0=bottom,1=top,2=left,3=right
      if (side === 0) { // bottom -> up
        L.x = clamp(rnd(pad, W - S - pad), pad, W - S - pad);
        L.y = H - S;
        L.exit.x = clamp(rnd(pad, W - S - pad), pad, W - S - pad);
        L.exit.y = -S - 6;
      } else if (side === 1) { // top -> down
        L.x = clamp(rnd(pad, W - S - pad), pad, W - S - pad);
        L.y = 0;
        L.exit.x = clamp(rnd(pad, W - S - pad), pad, W - S - pad);
        L.exit.y = H + 6;
      } else if (side === 2) { // left -> right
        L.x = 0;
        L.y = clamp(rnd(pad, H - S - pad), pad, H - S - pad);
        L.exit.x = W + 6;
        L.exit.y = clamp(rnd(pad, H - S - pad), pad, H - S - pad);
      } else { // right -> left
        L.x = W - S;
        L.y = clamp(rnd(pad, H - S - pad), pad, H - S - pad);
        L.exit.x = -S - 6;
        L.exit.y = clamp(rnd(pad, H - S - pad), pad, H - S - pad);
      }
    }

    // initial velocity toward exit
    const dx = (L.exit.x - L.x), dy = (L.exit.y - L.y);
    const ang = Math.atan2(dy, dx);
    const spd = rnd(...CFG.baseSpeed);
    L.vx = Math.cos(ang) * spd;
    L.vy = Math.sin(ang) * spd;
    L.wanderAngle = ang + rnd(-0.4, 0.4);

    L.el.style.transform = `translate3d(${L.x}px,${L.y}px,0) rotate(${ang + Math.PI/2}rad)`;
  }

  function spawnOneOn(surfaceEl) {
    const info = surfaces.get(surfaceEl);
    if (!info) return null;
    if (info.lice.size >= CFG.activeMaxPerSurface) return null;

    const {W,H} = measure(info.layer);
    if (W < 30 || H < 30) return null; // ignore transient zero/very small

    const L = makeLouse(info);
    configureRoute(L, W, H);
    info.lice.add(L);
    return L;
  }

  function spawnBurst() {
    const vis = ensureLayersOnVisiblePages();
    if (vis.length === 0) return;

    let remaining = CFG.burstSize;
    const shuffled = vis.slice().sort(()=>Math.random()-0.5);

    for (const el of shuffled) {
      if (remaining <= 0) break;
      const L = spawnOneOn(el);
      if (L) remaining--;
    }
    if (remaining > 0) {
      for (const el of shuffled) {
        if (remaining <= 0) break;
        const L = spawnOneOn(el);
        if (L) remaining--;
      }
    }
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
    return {
      ax: Math.cos(L.wanderAngle) * CFG.wanderStrength,
      ay: Math.sin(L.wanderAngle) * CFG.wanderStrength
    };
  }

  function maybeDespawn(L){
    const { layer } = L.surfaceInfo;
    const {W,H} = measure(layer);
    const S = CFG.size;
    const threshold = 64; // allow to fully clear the surface

    if (L.x < -S - threshold || L.x > W + threshold || L.y < -S - threshold || L.y > H + threshold) {
      L.alive = false;
      L.el.classList.add("woodlouse--despawn");
      setTimeout(()=>{ L.el.remove(); L.surfaceInfo.lice.delete(L); }, 160);
    }
  }

  function stepFrame(L){
    L.frame = (L.frame + 1) % CFG.imgs.length;
    L.el.style.backgroundImage = `url("${CFG.imgs[L.frame]}")`;
  }

  // ---------- main loop ----------
  function tick(dt){
    surfaces.forEach(({ layer, lice: set })=>{
      const {W,H} = measure(layer);
      if (W < 30 || H < 30) return; // skip while page is mid-turn with 0×0

      set.forEach(L=>{
        if (!L.alive) return;

        // forces: subtle wander + strong path bias to exit
        const w = wanderForce(L, dt);
        const s = steerToward(L, L.exit.x, L.exit.y, CFG.accelMax);
        let ax = w.ax + s.ax * CFG.pathBias;
        let ay = w.ay + s.ay * CFG.pathBias;
        ({x:ax, y:ay} = limit(ax, ay, CFG.accelMax));

        // integrate velocity with inertia
        L.vx = L.vx * CFG.inertia + ax * dt;
        L.vy = L.vy * CFG.inertia + ay * dt;

        // clamp speed
        const sp = Math.hypot(L.vx, L.vy) || 1;
        const spClamped = clamp(sp, CFG.speedMin, CFG.speedMax);
        if (sp !== spClamped) { L.vx *= spClamped / sp; L.vy *= spClamped / sp; }

        // integrate position
        L.x += L.vx * dt;
        L.y += L.vy * dt;

        // orient sprite (sprites point "up")
        const ang = Math.atan2(L.vy, L.vx) + Math.PI/2;
        L.el.style.transform = `translate3d(${L.x}px,${L.y}px,0) rotate(${ang}rad)`;

        maybeDespawn(L);
      });
    });
  }

  function loop(ts){
    if (!running) return;
    if (!lastT) lastT = ts;
    const dt = Math.min(0.05, (ts - lastT)/1000); lastT = ts;

    frameClock += dt*1000;
    if (frameClock >= CFG.frameMs){
      surfaces.forEach(({lice})=> lice.forEach(stepFrame));
      frameClock = 0;
    }

    tick(dt);
    requestAnimationFrame(loop);
  }

  // ---------- bootstrap ----------
  function bindFlipbookEvents(){
    window.addEventListener("resize", ensureLayersOnVisiblePages);
    if ($flip && $flip.on){
      $flip.on("turning", ()=>{ /* could add a small speed burst */ });
      $flip.on("turned",  ()=>{ ensureLayersOnVisiblePages(); });
    } else {
      // fallback: periodically re-ensure during non-jQuery use
      setInterval(ensureLayersOnVisiblePages, 800);
    }
  }

  async function start(){
    $flip = window.jQuery ? window.jQuery(".flipbook") : null;

    await preloadImages(CFG.imgs);
    ensureLayersOnVisiblePages();
    bindFlipbookEvents();

    // First burst, then at interval
    setTimeout(spawnBurst, 600);
    spawnTimerId = setInterval(spawnBurst, CFG.burstEveryMs);

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    running = !media.matches;
    if (running) requestAnimationFrame(loop);
  }

  // tiny API
  window.woodlouse = { start, burst: ()=>spawnBurst() };
  document.addEventListener("DOMContentLoaded", start);
})();

