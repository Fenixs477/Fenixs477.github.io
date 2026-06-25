/* ============================================================
   game.js — main controller: renderer, scene, world, tanks,
   projectiles, camera, loop, HUD, minimap, entry modes
   (singleplayer / host / client).
   FULLY WORKING P2P MULTIPLAYER.
   ============================================================ */

class Game {
  constructor(){
    this.settings = Menu.settings;
    this.mode = null;     // 'sp' | 'host' | 'client'
    this.running = false;
    this.tanks = [];
    this.projectiles = [];
    this.explosions = [];
    this.localTank = null;
    this.time = 0;
    this.dt = 0;
    this._last = 0;
    this._netSendAcc = 0;
    this.clientTankInputs = {}; // peerId -> last input (host side)
    this.clientTanks = {};      // peerId -> Tank (host side)
    this._shake = 0;            // camera shake magnitude
  }

  /* ---------- Three.js bootstrap ---------- */
  init(){
    this.renderer = new THREE.WebGLRenderer({antialias:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('game-root').appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.__renderer = this.renderer;
    this.camera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, 0.1, 1000);
    this.camera.position.set(0, CONFIG.CAM_HEIGHT, -CONFIG.CAM_DIST);

    this.world = new World(this.scene);
    this.input = new Input(this.settings);

    // camera zoom state
    this.camDist = CONFIG.CAM_DIST;

    // aim/trajectory line (from muzzle, length = shellRange)
    this._initAimLine();

    // probe available tank models (async; tanks built later will use cache)
    Models.probe(TANK_ORDER).catch(()=>{});

    addEventListener('resize', ()=> this._onResize());
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  /* Trajectory / aim line: a thin dashed line that always points where
     the turret faces, clipped to the tank's shell range. */
  _initAimLine(){
    const mat = new THREE.LineBasicMaterial({
      color: 0xffffff, transparent:true, opacity:this.settings.aimLineOpacity,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.aimLine = new THREE.Line(geo, mat);
    this.aimLine.visible = false;
    this.aimLine.frustumCulled = false;
    this.scene.add(this.aimLine);
  }
  refreshAimLineStyle(){
    if(!this.aimLine) return;
    this.aimLine.material.opacity = this.settings.aimLineOpacity;
    this.aimLine.material.color.set(this.settings.aimLineColor);
  }

  _onResize(){
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth/innerHeight;
    this.camera.updateProjectionMatrix();
  }

  applySettings(s){
    this.settings = s;
    if(this.input) this.input.binds = s.binds;
    this.refreshAimLineStyle();
    this.refreshViewRangeStyle();
    this.refreshViewRangeWidth();
  }

  setUseCustomMap(v){ this._useCustomMap = !!v; }

  refreshViewRangeStyle(){
    if(!this.tanks) return;
    for(const t of this.tanks){
      t.setViewRangeStyle(this.settings.viewRangeOpacity, this.settings.viewRangeColor);
    }
  }

  refreshViewRangeWidth(){
    if(!this.tanks) return;
    for(const t of this.tanks){
      if(t.refreshViewRangeWidth) t.refreshViewRangeWidth();
    }
  }

  /* ===========================================================
     ENTRY MODES
     =========================================================== */

  /* ---------- SINGLEPLAYER ---------- */
  startSingleplayer(){
    this.mode='sp'; this._resetArena();
    if(this._useCustomMap){
      const m = loadCustomMap();
      if(m) this.world.loadCustomMapData(m);
    }
    this._spawnLocal();
    for(let i=0;i<5;i++) this._spawnBot();
    this._begin();
  }

  /* ---------- HOST ---------- */
  async startHost(cfg){
    Menu.showConnecting('Creating room…');
    try{
      await Net.hostRoom({maxPlayers:cfg.maxPlayers, isPublic:cfg.isPublic, fakePlayers:cfg.fakePlayers, code:cfg.code});
    }catch(e){
      Menu.hideConnecting();
      Menu.toast(e.message||'Failed to host');
      return;
    }
    Menu.hideConnecting();
    Menu.toast('Room live • Code: '+cfg.code);
    this.mode='host'; this._resetArena();
    if(this._useCustomMap){
      const m = loadCustomMap();
      if(m) this.world.loadCustomMapData(m);
    }
    this._spawnLocal();
    // fake players (bots)
    for(let i=0;i<cfg.fakePlayers;i++) this._spawnBot();
    
    // Network callbacks
    Net.onPlayerJoin = (info)=> this._onClientJoin(info);
    Net.onPlayerLeave = (peerId)=> this._onClientLeave(peerId);
    Net.onInput = (peerId, inp)=> { this.clientTankInputs[peerId] = inp; };
    
    this._begin();
  }

  _onClientJoin(info){
    // info = {peerId, name, tank, color}
    const def = TANKS[info.tank] || TANKS.coolbuddy;
    const sp = this.world.randomSpawn();
    const t = new Tank(def, {
      id:'remote-'+info.peerId,
      name: info.name || 'Player',
      ownerPeer: info.peerId,
      x: sp.x,
      z: sp.z,
      heading: Math.random()*6,
      color: info.color || def.color
    });
    this._finalizeTank(t);
    this.tanks.push(t);
    this.clientTanks[info.peerId] = t;
    
    // Send spawn data to this client so they know where they are
    Net.sendSpawnToClient(info.peerId, {
      id: t.id,
      x: t.x,
      z: t.z,
      heading: t.heading,
      tankId: info.tank || 'coolbuddy',
      name: info.name || 'Player'
    });
    
    // Send full current state to the newly joined client so they see everyone
    Net.sendFullStateToClient(info.peerId, {
      time: this.time,
      tanks: this.tanks.map(tk => tk.snapshot())
    });
  }
  
  _onClientLeave(peerId){
    const t = this.clientTanks[peerId];
    if(t){ t.detach(); this.tanks = this.tanks.filter(x=>x!==t); delete this.clientTanks[peerId]; }
    delete this.clientTankInputs[peerId];
  }

  /* ---------- CLIENT ---------- */
  async startClient(code){
    Menu.showConnecting('Joining room…');
    try{
      await Net.joinRoom(code);
    }catch(e){
      Menu.hideConnecting();
      Menu.toast(e.message||'Could not join room');
      return;
    }
    Menu.hideConnecting();
    this.mode='client'; this._resetArena();
    
    // Set up network callbacks for client
    Net.onWelcome = (msg)=> this._onClientWelcome(msg);
    Net.onState = (snap)=> this._applyHostState(snap);
    Net.onPlayerLeave = (peerId)=>{
      if(peerId==='host'){
        Menu.toast('Host disconnected');
        this.leaveToMenu();
      }
    };
    
    // Send our join info immediately
    const def = TANKS[this.settings.selectedTank] || TANKS.coolbuddy;
    Net.sendJoinInfo(this.settings.playerName, this.settings.selectedTank, def.color);
    
    // Spawn local tank (position will be corrected by host's spawn message)
    this._spawnLocal();
    this._begin();
  }

  _onClientWelcome(msg){
    // Host tells us we connected, optionally with spawn data
    if(msg.t === 'spawn' || msg.t === undefined){
      // We already spawned our local tank, host will send full state
    }
  }

  _applyHostState(snap){
    if(!snap || !snap.tanks) return;
    if(snap.time) this.time = snap.time;
    
    const seen = new Set([this.localTank ? this.localTank.id : '']);
    
    (snap.tanks||[]).forEach(s=>{
      if(seen.has(s.id)) return;
      // Check if we already have this tank
      let t = this.tanks.find(x=>x.id===s.id);
      if(!t){
        const def = TANKS[s.tank]||TANKS.coolbuddy;
        t = new Tank(def, {id:s.id, name:s.name, x:s.x, z:s.z, heading:s.h, color:s.col});
        this._finalizeTank(t);
        this.tanks.push(t);
      }
      t.applyPartialSnapshot(s);
      seen.add(s.id);
    });
    
    // Remove unseen tanks (that aren't local)
    this.tanks = this.tanks.filter(t=>{
      if(t.isLocal) return true;
      if(!seen.has(t.id)){ t.detach(); return false; }
      return true;
    });
  }

  /* ---------- arena reset / spawn ---------- */
  _resetArena(){
    this.tanks.forEach(t=>t.detach());
    this.projectiles.forEach(p=>p.detach());
    this.explosions.forEach(e=>e.detach());
    this.tanks=[]; this.projectiles=[]; this.explosions=[];
    this.localTank=null; this.time=0;
  }

  _spawnLocal(){
    const def = TANKS[this.settings.selectedTank] || TANKS.coolbuddy;
    const sp = this.world.randomSpawn();
    const t = new Tank(def, {id:'local', name:this.settings.playerName, isLocal:true, x:sp.x, z:sp.z, heading:Math.random()*6});
    this._finalizeTank(t); this.tanks.push(t); this.localTank = t;
  }

  _spawnBot(){
    const ids = TANK_ORDER.filter(id=>id!==this.settings.selectedTank);
    const id = ids[Math.floor(Math.random()*ids.length)];
    const def = TANKS[id];
    const sp = this.world.randomSpawn();
    const t = new Tank(def, {id:'bot-'+Math.random().toString(36).slice(2,6), name:BOTNAMES[Math.floor(Math.random()*BOTNAMES.length)], isBot:true, x:sp.x, z:sp.z, heading:Math.random()*6});
    t.brain = new BotBrain(t);
    this._finalizeTank(t); this.tanks.push(t);
  }

  _finalizeTank(t){
    t.attach(this.scene);
    t.makeViewRangeCircle();
    t.setViewRangeStyle(this.settings.viewRangeOpacity, this.settings.viewRangeColor);
    return t;
  }

  _begin(){
    Menu.showHUD();
    this.running = true;
    this._last = performance.now();
    // Show touch joysticks when game starts (only on mobile)
    if(this.input && this.input.setJoysticksVisible){
      this.input.setJoysticksVisible(true);
    }
  }

  leaveToMenu(){
    this.running = false;
    this.mode = null;
    try { Net.disconnect(); } catch(e){}
    this._resetArena();
    // Hide all overlays
    document.getElementById('esc-menu').classList.add('hidden');
    document.getElementById('bigmap').classList.add('hidden');
    if(Menu.escOpen) Menu.escOpen = false;
    Menu.show('menu-main');
    // Hide touch joysticks when returning to menu
    if(this.input && this.input.setJoysticksVisible){
      this.input.setJoysticksVisible(false);
    }
  }

  /* ===========================================================
     GAME LOOP
     =========================================================== */
  _loop(now){
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, (now - this._last)/1000 || 0);
    this._last = now;
    if(this.running){
      this.dt = dt; this.time += dt;
      this._update(dt);
    }
    this.renderer.render(this.scene, this.camera);
  }

  _update(dt){
    this.world.update(dt, this.time);

    // Camera zoom
    const zoom = this.input.consumeZoom();
    if(zoom !== 0){
      this.camDist = Math.max(CONFIG.CAM_DIST_MIN, Math.min(CONFIG.CAM_DIST_MAX,
        this.camDist - zoom*CONFIG.CAM_ZOOM_STEP));
    }

    // Local tank input (keyboard/mouse OR touch)
    if(this.localTank && this.localTank.alive && !this.localTank.dying){
      let throttle, turn, turretAngle, fire, handbrake;
      
      const touchInput = this.input.getTouchInput();
      
      if(touchInput && touchInput.isTouch){
        // Touch device: use joystick values
        throttle = touchInput.throttle;
        turn = touchInput.turn;
        // Turret: joystick X axis controls angle offset
        const baseAngle = this.localTank.turretAngle;
        turretAngle = baseAngle + touchInput.turretAngle * 0.05;
        fire = touchInput.fire;
        handbrake = false;
      } else {
        // Desktop: keyboard + mouse
        throttle = (this.input.pressed('forward')?1:0) - (this.input.pressed('backward')?1:0);
        turn = (this.input.pressed('right')?1:0)   - (this.input.pressed('left')?1:0);
        turretAngle = this._mouseWorldAngle();
        fire = this.input.pressed('fire');
        handbrake = this.input.pressed('handbrake');
      }
      
      const input = {throttle, turn, turretWorldAngle:turretAngle, fire, handbrake};
      this.localTank.setInput(input);
      // Client: forward input to host
      if(this.mode==='client'){
        Net.sendInput(input);
      }
    }

    // Update all tanks
    this.tanks.forEach(t=>{
      if(t.brain){
        t.setInput(t.brain.decide(this));
      } else if(t.ownerPeer && this.clientTankInputs[t.ownerPeer]){
        t.setInput(this.clientTankInputs[t.ownerPeer]);
      } else if(t === this.localTank){
        // Already set above
      } else {
        t.setInput({throttle:0,turn:0,turretWorldAngle:t.turretAngle,fire:false});
      }
      t.update(dt, this.world, this);
    });

    // Projectiles
    this.projectiles.forEach(p=> p.update(dt, this.world, this));
    this.projectiles = this.projectiles.filter(p=>{ if(p.dead){p.detach(); return false;} return true; });
    this.explosions.forEach(e=> e.update(dt));
    this.explosions = this.explosions.filter(e=>{ if(e.dead){e.detach(); return false;} return true; });

    // Camera
    if(this.localTank && this.localTank.alive && !this.localTank.dying){
      const t = this.localTank;
      const sx = Math.sin(t.heading), cz = Math.cos(t.heading);
      const camTarget = new THREE.Vector3(
        t.x - sx*this.camDist,
        this.camDist*0.78 + 3,
        t.z - cz*this.camDist);
      this.camera.position.lerp(camTarget, CONFIG.CAM_LERP);
      this.camera.lookAt(t.x, 1.2, t.z);
      if(this._shake > 0){
        this._shake = Math.max(0, this._shake - dt*2.5);
        const s = this._shake;
        this.camera.position.x += (Math.random()-0.5)*s;
        this.camera.position.y += (Math.random()-0.5)*s;
        this.camera.position.z += (Math.random()-0.5)*s;
      }
    } else if(this.localTank && !this.localTank.alive){
      // Keep camera at last position when dead (don't follow dying tank)
    }

    // Aim line
    this._updateAimLine();

    // Visibility
    this._updateVisibility();

    // Networking: Host broadcasts state
    if(this.mode==='host'){
      this._netSendAcc += dt;
      if(this._netSendAcc > 0.05){ // ~20Hz
        this._netSendAcc = 0;
        Net.broadcast({time:this.time, tanks:this.tanks.map(t=>t.snapshot())});
      }
    }

    // HUD
    this._updateHUD();
  }

  _updateAimLine(){
    if(!this.aimLine) return;
    const t = this.localTank;
    if(!t || !t.alive || t.def.shellType==='flame'){
      this.aimLine.visible = false; return;
    }
    this.aimLine.visible = true;
    const {pos, dir} = t.muzzle();
    const startX = pos.x, startZ = pos.z;
    const range = t.def.shellRange;
    const step = 1.5;
    let endX = startX, endZ = startZ;
    for(let d=0; d<=range; d+=step){
      const tx = startX + dir.x*d, tz = startZ + dir.z*d;
      if(this.world.collidesWallsOnly(tx, tz, 0.3)){ endX=tx; endZ=tz; break; }
      endX=tx; endZ=tz;
    }
    const y = t.def.body.h + 0.6;
    const arr = this.aimLine.geometry.attributes.position.array;
    arr[0]=startX; arr[1]=y; arr[2]=startZ;
    arr[3]=endX;   arr[4]=y; arr[5]=endZ;
    this.aimLine.geometry.attributes.position.needsUpdate = true;
  }

  _mouseWorldAngle(){
    if(!this.localTank) return 0;
    const ray = new THREE.Raycaster();
    const v = new THREE.Vector2(this.input.mouse.ndcX, this.input.mouse.ndcY);
    ray.setFromCamera(v, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0,1,0), -(this.localTank.def.body.h+0.5));
    const hit = new THREE.Vector3();
    if(!ray.ray.intersectPlane(plane, hit)) return this.localTank.turretAngle;
    return Math.atan2(hit.x - this.localTank.x, hit.z - this.localTank.z);
  }

  /* ===========================================================
     COMBAT HOOKS
     =========================================================== */
  spawnShot(tank){
    const {pos, dir} = tank.muzzle();
    const y = tank.def.body.h + 0.5;
    const p = tank.def.shellType==='flame'
      ? new FlameCone(tank, new THREE.Vector3(pos.x, y, pos.z), dir, tank.def)
      : new Shell(tank, new THREE.Vector3(pos.x, y, pos.z), dir, tank.def);
    p.attach(this.scene); this.projectiles.push(p);
    if(tank===this.localTank) this._muzzleFlash(pos, dir);
  }

  _muzzleFlash(pos, dir){
    const ex = new Explosion(pos.x, pos.y+0.2, pos.z, 0xffe08a, 5);
    ex.attach(this.scene); this.explosions.push(ex);
  }

  spawnExplosion(x,y,z,color,count){
    const e = new Explosion(x,y,z,color,count||6);
    e.attach(this.scene); this.explosions.push(e);
  }

  onTankKilled(tank, byTank){
    this.spawnExplosion(tank.x, 1.4, tank.z, 0xff5b3b, 16);
    this.spawnExplosion(tank.x, 2.0, tank.z, 0xffaa33, 10);
    if(this.localTank){
      const d = Math.hypot(this.localTank.x-tank.x, this.localTank.z-tank.z);
      if(d < 45){
        this._shake = Math.max(this._shake, 0.9 * (1 - d/45));
      }
    }
  }

  onLocalDeath(){
    this.running = false;
    Menu.toast('Your tank was destroyed');
    setTimeout(()=> this.leaveToMenu(), 600);
  }

  addShake(amount){ this._shake = Math.max(this._shake, amount); }

  /* ---------- Visibility ---------- */
  _updateVisibility(){
    if(!this.localTank) return;
    const me = this.localTank;
    for(const t of this.tanks){
      if(t === me){ t.root.visible = true; continue; }
      if(t.dying){ t.root.visible = true; continue; }
      const d = Math.hypot(t.x-me.x, t.z-me.z);
      let visible;
      if(d < 18) visible = true;
      else if(d <= me.viewRange) visible = (t.camoFactor >= 0.5);
      else visible = false;
      t.root.visible = visible;
    }
  }

  /* ===========================================================
     HUD
     =========================================================== */
  _updateHUD(){
    if(!this.localTank) return;
    const t = this.localTank;
    document.getElementById('speed-val').textContent = Math.max(0, Math.round(Math.abs(t.speed) * U_TO_KMH));
    const hpBar = document.getElementById('hp-bar');
    const pct = Math.max(0, t.hp/t.maxHp);
    hpBar.style.width = (pct*100)+'%';
    document.getElementById('hp-text').textContent = `${Math.ceil(t.hp)} / ${t.maxHp}`;
    
    const dot = document.getElementById('camo-dot');
    const camoTxt = document.getElementById('camo-text');
    if(dot && camoTxt){
      if(t.camoState === 'bush'){
        dot.className = 'camo-dot on'; camoTxt.textContent = 'You are in bush';
      } else if(t.camoState === 'tree'){
        dot.className = 'camo-dot mid'; camoTxt.textContent = 'Partial cover';
      } else {
        dot.className = 'camo-dot off'; camoTxt.textContent = '';
      }
    }
    
    // Leaderboard: ALL tanks sorted by damage
    const sorted = [...this.tanks]
      .sort((a,b)=> b.damageDealt - a.damageDealt).slice(0,5);
    const lb = document.getElementById('lb-list');
    lb.innerHTML = sorted.map((o,i)=> `<li><span class="lname">${o.name}</span><span class="ldmg">${Math.round(o.damageDealt)}</span></li>`).join('');
  }

  /* ---------- Big map ---------- */
  openBigMap(){
    const wrap = document.getElementById('bigmap');
    const cv = document.getElementById('bigmap-canvas');
    const S = 720;
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    this.world.renderToCanvas(ctx, S, S);
    if(this.localTank){
      const [px,py] = this.world.worldToMap(this.localTank.x, this.localTank.z, S);
      ctx.save(); ctx.translate(px,py); ctx.rotate(-this.localTank.heading);
      ctx.fillStyle='#ffb12b'; ctx.beginPath();
      ctx.moveTo(0,-8); ctx.lineTo(6,8); ctx.lineTo(-6,8); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    wrap.classList.remove('hidden');
  }
}

const BOTNAMES = ['Rommel','Patton','Guderian','Zhukov','Abrams','Leclerc','Tiger','Panther','Sherman','T-34','Challenger','Merkava','Karl','Bovington','Stug','Hetzer','IS-2','Comet','Cromwell','Hellcat'];

/* ---------- Bootstrap ---------- */
window.addEventListener('DOMContentLoaded', ()=>{
  const game = new Game();
  game.init();
  Menu.init(game);
  window.__game = game; // debug
});