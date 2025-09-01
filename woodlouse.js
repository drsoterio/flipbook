// woodlouse.js — spawn on ANY visible page/cover (not just the cover)
// - Maintains layers for all visible .page elements (usually 1–2 at a time)
// - Each burst picks a random visible surface to spawn bugs on
// - Natural non-linear walk; despawn only after fully exiting that surface

(function () {
  const CFG = {
    burstEveryMs: 15000,
    burstSize: 2,
    activeMaxPerSurface: 2,   // cap per surface (keeps things tidy)
    size: 46,
    imgs: ["craw-2.png", "craw-3.png"],
    frameMs: 90,
    // faster + organic motion
    speedMin: 240, speedMax: 340, baseSpeed: [260, 320],
    accelMax: 900, inertia: 0.86,
    wanderStrength: 240, wanderTurnRate: 2.6, wanderJitter: 0.9,
    edgePad: 6, scatterBoost: 1.6
  };

  let $flip, running = false, lastT = 0, frameClock = 0, spawnTimerId = null;

  // Track multiple surfaces
  const surfaces = new Map(); // element -> { layer, lice:Set<L> }

  const q  = (s)=>document.querySelector(s);
  const qa = (s)=>Array.from(document.querySelectorAll(s));
  const rnd=(a,b)=>a+Math.random()*(b-a);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  // ---------- preload ----------
  function preloadImages(urls){
    return Promise.all(urls.map(src=>new Promise(res=>{
      const im = new Image(); im.onload=()=>res(); im.onerror=()=>res(); im.src = src;
    })));
  }

  // ---------- visible pages/covers ----------
  function getVisiblePages() {
    // Pick all .page nodes with a real box on screen
    const pages = qa(".flipbook .page").filter(el=>{
      const r = el.getBoundingClientRect();
      // visible in viewport and not zero-sized
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
    });
    // Prefer the two largest (typical turn.js view shows two)
    pages.sort((a,b)=>{
      const ra=a.getBoundingClientRect(), rb=b.getBoundingClientRect();
      return (rb.width*rb.height) - (ra.width*ra.height);
    });
    return pages.slice(0, 2);
  }

  function ensureLayersOnVisiblePages() {
    const vis = getVisiblePages();

    // Remove layers from pages that are no longer visible
    for (const [el, info] of Array.from(surfaces.entries())) {
      if (!vis.includes(el)) {
        // Keep existing lice until they leave; just leave layer mounted
        // If you prefer to remove immediately, uncomment next lines:
        // info.lice.forEach(L => { L.alive = false; L.el.remove(); info.lice.delete(L); });
        // info.layer.remove(); surfaces.delete(el);
      }
    }

    // Ensure each visible page has a layer
    vis.forEach(el=>{
      if (!surfaces.has(el)) {
        const layer = document.createElement("div");
        layer.className = "woodlouse-layer";
        el.appendChild(layer);
        surfaces.set(el, { layer, lice: new Set() });
      } else {
        // Re-append to keep on top of page contents if DOM changed
        const info = surfaces.get(el);
        if (info.layer.parentElement !== el) el.appendChild(info.layer);
      }
    });

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

  // Configure route: random edge → random opposite edge on this surface
  function configureRoute(L, W, H) {
    const S = CFG.size, pad = CFG.edgePad;
    const side = Math.floor(Math.random()*4); // 0=bottom,1=top,2=left,3=right
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

    // initial velocity toward exit
    const dx = (L.exit.x - L.x), dy = (L.exit.y - L.y);
    const ang = Math.atan2(dy, dx);
    const spd = rnd(...CFG.baseSpeed);
    L.vx = Math.cos(ang) * spd;
    L.vy = Math.sin(ang) * spd;
    L.wanderAngle = ang + rnd(-0.6, 0.6);

    L.el.style.transform = `translate3d(${L.x}px,${L.y}px,0) rotate(${ang + Math.PI/2}rad)`;
  }

  function spawnOneOn(surfaceEl) {
    const info = surfaces.get(surfaceEl);
    if (!info) return null;
    if (info.lice.size >= CFG.activeMaxPerSurface) return null;

    const W = info.layer.clientWidth, H = info.layer.clientHeight;
    const L = makeLouse(info);
    configureRoute(L, W, H);
    info.lice.add(L);
    return L;
  }

  function spawnBurst() {
    const vis = ensureLayersOnVisiblePages();
    if (vis.length === 0) return;

    // Spawn up to burstSize across random visible surfaces,
    // respecting per-surface cap
    let remaining = CFG.burstSize;
    // Shuffle visible surfaces for variety
    const shuffled = vis.slice().sort(()=>Math.random()-0.5);

    for (const el of shuffled) {
      if (remaining <= 0) break;
      const L = spawnOneOn(el);
      if (L) remaining--;
    }

    // If still need more and we have capacity, loop again
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
    const W = layer.clientWidth, H = layer.clientHeight, S = CFG.size;
    if (L.x < -S || L.x > W || L.y < -S || L.y > H) {
      L.alive = false;
      L.el.classList.add("woodlouse--despawn");
      setTimeout(()=>{ L.el.remove(); L.surfaceInfo.lice.delete(L); }, 180);
    }
  }

  function stepFrame(L){
    L.frame = (L.frame + 1) % CFG.imgs.length;
    L.el.style.backgroundImage = `url("${CFG.imgs[L.frame]}")`;
  }

  // ---------- main loop ----------
  function tick(dt){
    surfaces.forEach(({ layer, lice: set })=>{
      set.forEach(L=>{
        if (!L.alive) return;

        // forces: wander + steer to exit
        const w = wanderForce(L, dt);
        const s = steerToward(L, L.exit.x, L.exit.y, CFG.accelMax);

        // combine, cap accel
        let ax = w.ax + s.ax, ay = w.ay + s.ay;
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
    $flip.on("turning", ()=>{ /* small burst of speed on turn */ });
    $flip.on("turned",  ()=>{ ensureLayersOnVisiblePages(); });
  }

  async function start(){
    $flip = $(".flipbook");
    if (!$flip.length) return;

    await preloadImages(CFG.imgs);
    ensureLayersOnVisiblePages();
    bindFlipbookEvents();

    // First burst, then every 20s
    setTimeout(spawnBurst, 800);
    spawnTimerId = setInterval(spawnBurst, CFG.burstEveryMs);

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    running = !media.matches;
    if (running) requestAnimationFrame(loop);
  }

  // tiny API
  window.woodlouse = { start, burst: ()=>spawnBurst() };

  document.addEventListener("DOMContentLoaded", start);
})();
