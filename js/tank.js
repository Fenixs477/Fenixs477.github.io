/* ============================================================
   tank.js — Tank entity: BODY + TURRET groups (so we always know
   which is which). Billboard HP bar/name (face camera, not gun).
   Camouflage in bushes/trees. View-range circle. Box collider +
   mass (ram damage). Full death sequence: turret launches, body
   blackens + burns, 8-point star decal, sinks after 5s.
   ============================================================ */

class Tank {
  constructor(def, opts={}){
    this.def = def;
    this.id   = opts.id   || ('tank_'+Math.random().toString(36).slice(2,8));
    this.name = opts.name || 'Tank';
    this.isLocal = !!opts.isLocal;
    this.isBot   = !!opts.isBot;
    this.color   = opts.color != null ? opts.color : def.color;
    this.ownerPeer = opts.ownerPeer || null;

    // transform
    this.x = opts.x || 0;
    this.z = opts.z || 0;
    this.heading = opts.heading || 0;
    this.turretAngle = opts.turretAngle || 0;
    this.speed = 0;
    this.vx = 0; this.vz = 0;
    this.drifting = false;

    // stats
    this.maxHp = def.hp; this.hp = this.maxHp;
    this.mass  = def.mass || 30;
    this.viewRange = def.viewRange || 70;
    this.alive = true; this.respawnAt = 0;
    this.damageDealt = 0; this.kills = 0;
    this.reloadLeft = 0;

    // camo
    this.camoState = null;     // 'bush' | 'tree' | null
    this.camoFactor = 1;       // 1 visible, 0 hidden

    // death animation
    this.dying = false;        // playing death sequence
    this.deathT = 0;           // elapsed death time
    this.removeAt = -1;        // when to fully remove (-1 = manual)

    // collider half-extents (box)
    this.colHalfW = def.body.w*0.55;
    this.colHalfL = def.body.l*0.55;

    this._buildCubeMesh();
    if(Models && Models.hasModel(def.model||def.id)) this._loadModel();
  }

  /* ---------- Mesh ---------- */
  _buildCubeMesh(){
    this.bodyGroup = new THREE.Group();
    const b = this.def.body;
    this.bodyMat = this._tankMat(this.color);
    this.bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.l), this.bodyMat);
    this.bodyMesh.position.y = b.h/2 + 0.45;
    this.bodyGroup.add(this.bodyMesh);

    const treadMat = new THREE.MeshStandardMaterial({color:0x222226, roughness:1});
    [-1,1].forEach(s=>{
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, b.l+0.2), treadMat);
      t.position.set(s*(b.w/2+0.05), 0.35, 0);
      this.bodyGroup.add(t);
    });

    this.turretGroup = new THREE.Group();
    const t = this.def.turret;
    this.turretMat = this._tankMat(this.def.turretColor);
    this.turretMesh = new THREE.Mesh(new THREE.BoxGeometry(t.w, t.h, t.l), this.turretMat);
    this.turretMesh.position.y = t.h/2;
    this.turretGroup.add(this.turretMesh);

    const barrelMat = new THREE.MeshStandardMaterial({color:0x2a2a2e, roughness:0.4, metalness:0.6});
    const bl = this.def.barrelLen, br = this.def.barrelR;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(br, br, bl, 10), barrelMat);
    barrel.rotation.x = Math.PI/2;
    barrel.position.set(0, t.h*0.4, t.l/2 + bl/2);
    this.turretGroup.add(barrel);
    this.barrelEnd = new THREE.Object3D();
    this.barrelEnd.position.set(0, t.h*0.4, t.l/2 + bl + 0.2);
    this.turretGroup.add(this.barrelEnd);

    this.root = new THREE.Group();
    this.root.add(this.bodyGroup);
    this.root.add(this.turretGroup);
    this._addOverlays(t.h);
    this._syncTransform();
  }

  _tankMat(color){
    return new THREE.MeshStandardMaterial({color, roughness:0.45, metalness:0.55, flatShading:false});
  }

  _loadModel(){
    Models.load(this.def.model||this.def.id).then(grp=>{
      if(!grp) return;
      this._clearGroup(this.bodyGroup);
      this._clearGroup(this.turretGroup);
      const scale = this.def.modelScale || 1.0;
      grp.scale.setScalar(scale);
      grp.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
      this.bodyGroup.add(grp);
      const t = this.def.turret;
      this.barrelEnd = new THREE.Object3D();
      this.barrelEnd.position.set(0, t.h*0.6, t.l + this.def.barrelLen);
      this.turretGroup.add(this.barrelEnd);
      this._addOverlays(t.h);
      this._syncTransform();
    });
  }

  _clearGroup(g){
    for(let i=g.children.length-1;i>=0;i--){
      const c = g.children[i];
      if(c.userData && c.userData.isOverlay) continue;
      g.remove(c);
    }
  }

  _addOverlays(turretH){
    // Billboard HP bar (sprite faces camera automatically)
    this.hpSprite = this._makeHpSprite();
    this.hpSprite.userData.isOverlay = true;
    this.hpSprite.position.y = turretH + 2.0;
    this.root.add(this.hpSprite);              // on root so it doesn't spin with turret

    this.nameSprite = this._makeNameTag(this.name);
    this.nameSprite.userData.isOverlay = true;
    this.nameSprite.position.y = turretH + 2.8;
    this.root.add(this.nameSprite);
  }

  _makeHpSprite(){
    const c = document.createElement('canvas'); c.width=256; c.height=40;
    this._hpCanvas = c; this._hpCtx = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    this._hpTex = tex;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({map:tex, depthTest:false, transparent:true}));
    spr.scale.set(3.4, 0.53, 1);
    this._drawHp();
    return spr;
  }
  _drawHp(){
    const c=this._hpCanvas, g=this._hpCtx;
    g.clearRect(0,0,256,40);
    const pct = Math.max(0, this.hp/this.maxHp);
    g.fillStyle='rgba(0,0,0,0.6)'; g.fillRect(8,10,240,20);
    const col = pct>0.6?'#3ad17a':(pct>0.3?'#ffb12b':'#ff3b3b');
    g.fillStyle=col; g.fillRect(11,13,234*pct,14);
    if(this._hpTex) this._hpTex.needsUpdate=true;
  }

  _makeNameTag(text){
    const c = document.createElement('canvas'); c.width=256; c.height=64;
    const g = c.getContext('2d');
    g.fillStyle='rgba(0,0,0,0.5)'; g.fillRect(0,18,256,30);
    g.font='bold 22px Segoe UI'; g.fillStyle='#fff'; g.textAlign='center'; g.textBaseline='middle';
    g.fillText(text, 128, 33);
    const tex = new THREE.CanvasTexture(c);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({map:tex, depthTest:false, transparent:true}));
    spr.scale.set(3.2, 0.8, 1);
    return spr;
  }

  attach(scene){ this.scene = scene; scene.add(this.root); }
  detach(){ if(this.scene){ this.scene.remove(this.root); this.scene=null; } }

  /* ---------- View range circle ---------- */
  makeViewRangeCircle(){
    const w = this.def;
    const viewRange = w.viewRange || 70;
    // Width factor: inner radius = viewRange * (1 - widthFactor), outer = viewRange
    // Default width factor from settings (0-1)
    const wf = Menu && Menu.settings ? Menu.settings.viewRangeWidth : 0.5;
    const innerR = viewRange * (1 - wf * 0.4); // 0% -> same as outer (thin), 100% -> 0.6*outer (fat)
    const geo = new THREE.RingGeometry(Math.max(0.1, innerR), viewRange, 64);
    geo.rotateX(-Math.PI/2);
    const mat = new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0.25, side:THREE.DoubleSide, depthWrite:false});
    this.viewCircle = new THREE.Mesh(geo, mat);
    this.viewCircle.position.y = 0.2;
    this.root.add(this.viewCircle);
    return this.viewCircle;
  }

  refreshViewRangeWidth(){
    if(!this.viewCircle) return;
    const wf = Menu && Menu.settings ? Menu.settings.viewRangeWidth : 0.5;
    const viewRange = this.def.viewRange || 70;
    const innerR = viewRange * (1 - wf * 0.4);
    this.viewCircle.geometry.dispose();
    this.viewCircle.geometry = new THREE.RingGeometry(Math.max(0.1, innerR), viewRange, 64);
    this.viewCircle.geometry.rotateX(-Math.PI/2);
  }

  setViewRangeStyle(opacity, color){
    if(!this.viewCircle) return;
    this.viewCircle.material.opacity = opacity;
    this.viewCircle.material.color.set(color);
  }

  /* ---------- Movement / Drift ---------- */
  setInput(input){ this._input = input; }

  update(dt, world, game){
    // ---- death animation ----
    if(this.dying){
      this._updateDeath(dt, game);
      return;
    }
    if(!this.alive){
      // alive=false but not yet dying -> should not normally happen (death starts immediately)
      return;
    }
    const d = this.def;
    const inp = this._input || {};

    // camo update
    this.camoState = world.hidingIn(this.x, this.z);
    this.camoFactor = world.camoFactor(this.x, this.z);
    // hidden tanks are visually faded
    this._applyCamoVisual();

    // throttle -> desired speed (mass adds drag to top speed)
    const speedCap = d.speed * (1 - Math.min(0.35, (this.mass-18)/120));
    const target = (inp.throttle||0) * speedCap;
    if(this.speed < target) this.speed = Math.min(target, this.speed + d.accel*dt);
    else if(this.speed > target) this.speed = Math.max(target, this.speed - d.accel*dt*1.4);

    const kmh = Math.abs(this.speed) * CONFIG.U_TO_KMH;

    this.drifting = false;
    if(inp.handbrake && kmh >= CONFIG.DRIFT_MIN_KMH && inp.turn){
      this.drifting = true;
      this.heading += inp.turn * d.turn * CONFIG.DRIFT_TURN_BOOST * dt;
      if(this.vx === 0 && this.vz === 0){
        this.vx = Math.sin(this.heading) * this.speed;
        this.vz = Math.cos(this.heading) * this.speed;
      }
      this.speed *= (1 - 0.15*dt);
    }
    if(!this.drifting && inp.turn) this.heading += inp.turn * d.turn * dt;

    let fx = Math.sin(this.heading) * this.speed;
    let fz = Math.cos(this.heading) * this.speed;
    this.vx += (fx - this.vx) * Math.min(1, (this.drifting?0.2:3.0)*dt);
    this.vz += (fz - this.vz) * Math.min(1, (this.drifting?0.2:3.0)*dt);

    let nx = this.x + this.vx * dt;
    let nz = this.z + this.vz * dt;

    if(world.lakeAt(nx, nz)){
      nx = this.x; nz = this.z;
      this.speed *= 0.3; this.vx *= 0.3; this.vz *= 0.3;
    }

    const r = Math.max(this.colHalfW, this.colHalfL);
    if(!world.collides(nx, this.z, r)) this.x = nx;
    else { this.speed *= 0.5; this.vx *= 0.4; }
    if(!world.collides(this.x, nz, r)) this.z = nz;
    else { this.speed *= 0.5; this.vz *= 0.4; }

    // ---- tank-vs-tank ram (box overlap, mass-based damage) ----
    if(game) this._ramCheck(game);

    const lim = world.half - 3;
    this.x = Math.max(-lim, Math.min(lim, this.x));
    this.z = Math.max(-lim, Math.min(lim, this.z));

    if(inp.turretWorldAngle != null){
      let diff = ((inp.turretWorldAngle - this.turretAngle + Math.PI) % (Math.PI*2)) - Math.PI;
      const maxStep = d.turretTurn * dt;
      diff = Math.max(-maxStep, Math.min(maxStep, diff));
      this.turretAngle += diff;
    }

    if(this.reloadLeft > 0) this.reloadLeft -= dt;
    if(inp.fire && this.reloadLeft <= 0){
      this.reloadLeft = d.reload;
      if(game) game.spawnShot(this);
    }

    this._syncTransform();
  }

  _applyCamoVisual(){
    const op = this.camoFactor; // 1 = fully visible
    // fade overlays + body a bit when hidden
    if(this.hpSprite) this.hpSprite.material.opacity = op;
    if(this.nameSprite) this.nameSprite.material.opacity = op;
  }

  _ramCheck(game){
    for(const o of game.tanks){
      if(o===this || !o.alive || o.dying) continue;
      const dx = o.x - this.x, dz = o.z - this.z;
      const overlapX = (this.colHalfW + o.colHalfW) - Math.abs(dx);
      const overlapZ = (this.colHalfL + o.colHalfL) - Math.abs(dz);
      if(overlapX>0 && overlapZ>0){
        // separate along smallest overlap
        if(overlapX < overlapZ){
          const push = overlapX/2 * (dx<0?1:-1);
          this.x -= push; o.x += push;
        } else {
          const push = overlapZ/2 * (dz<0?1:-1);
          this.z -= push; o.z += push;
        }
        // ram damage based on closing speed & mass difference
        const rel = Math.abs(this.speed) + Math.abs(o.speed);
        if(rel > 8){
          const heavier = this.mass >= o.mass ? this : o;
          const lighter = heavier === this ? o : this;
          const dmg = Math.min(40, rel * 0.5 * (heavier.mass/lighter.mass) * 0.3);
          lighter.takeDamage(dmg, heavier, game);
        }
        this.speed *= 0.6; this.vx *= 0.5; this.vz *= 0.5;
      }
    }
  }

  _syncTransform(){
    this.root.position.set(this.x, 0, this.z);
    this.bodyGroup.rotation.y = this.heading;
    this.turretGroup.rotation.y = this.turretAngle;
    this.turretGroup.position.y = this.def.body.h + 0.45;
    if(this.drifting){
      this.bodyGroup.rotation.z = THREE.MathUtils.lerp(this.bodyGroup.rotation.z, -0.08, 0.2);
    } else {
      this.bodyGroup.rotation.z = THREE.MathUtils.lerp(this.bodyGroup.rotation.z, 0, 0.2);
    }
  }

  /* ---------- Combat ---------- */
  takeDamage(amount, fromTank, game){
    if(!this.alive || this.dying) return;
    this.hp -= amount;
    if(fromTank && fromTank !== this) fromTank.damageDealt += amount;
    if(this.hp <= 0){
      this.hp = 0; this.alive = false;
      if(fromTank && fromTank !== this) fromTank.kills++;
      this._startDeath(game, fromTank);
    }
    this._drawHp();
  }
  heal(amount){ this.hp = Math.min(this.maxHp, this.hp + amount); this._drawHp(); }

  /* ---------- Death sequence ---------- */
  _startDeath(game, killer){
    this.dying = true; this.deathT = 0;
    this.removeAt = (game? game.time : 0) + 9;   // wreck fully removed at 9s
    // hide overlays
    if(this.hpSprite) this.hpSprite.visible = false;
    if(this.nameSprite) this.nameSprite.visible = false;
    if(this.viewCircle) this.viewCircle.visible = false;

    // 1) TURRET launches up immediately (impulse + gravity + spin)
    this._turretVel = new THREE.Vector3(
      (Math.random()-0.5)*4, 14 + Math.random()*4, (Math.random()-0.5)*4);
    this._turretSpin = new THREE.Vector3((Math.random()-0.5)*4,(Math.random()-0.5)*6,(Math.random()-0.5)*4);

    // 2) BODY blackens
    if(this.bodyMat){ this.bodyMat.color.setHex(0x141414); this.bodyMat.emissive=new THREE.Color(0x3a1500); this.bodyMat.emissiveIntensity=0.6; }
    // TURRET + barrel also blacken (burnt metal) — FIXED to work properly!
    if(this.turretMat){ this.turretMat.color.setHex(0x1a1a1a); this.turretMat.emissive=new THREE.Color(0x2a1000); this.turretMat.emissiveIntensity=0.5; }
    // Force turretMesh color update
    if(this.turretMesh && this.turretMesh.material){
      this.turretMesh.material.color.setHex(0x1a1a1a);
      this.turretMesh.material.emissive = new THREE.Color(0x2a1000);
      this.turretMesh.material.emissiveIntensity = 0.5;
    }
    // Body mesh too
    if(this.bodyMesh && this.bodyMesh.material){
      this.bodyMesh.material.color.setHex(0x141414);
      this.bodyMesh.material.emissive = new THREE.Color(0x3a1500);
      this.bodyMesh.material.emissiveIntensity = 0.6;
    }

    // 3) fire particles (attach to root, updated in _updateDeath)
    this._firePts = this._makeFireParticles();
    this.root.add(this._firePts);

    // 4) eight-pointed black star decal on ground — 2x bigger!
    this._star = this._makeStarDecal();
    this._star.position.set(0, 0.25, 0);
    this.root.add(this._star);

    if(game) game.onTankKilled(this, killer);
  }

  _makeFireParticles(){
    const g = new THREE.Group();
    const cols=[0xffd24a,0xff7a1a,0xff3b1a,0x6a2a00];
    for(let i=0;i<18;i++){
      const m=new THREE.Mesh(new THREE.SphereGeometry(0.4+Math.random()*0.5,6,6),
        new THREE.MeshBasicMaterial({color:cols[i%4],transparent:true,opacity:0.9}));
      m.position.set((Math.random()-0.5)*2, 0.5+Math.random()*1.5, (Math.random()-0.5)*2);
      m.userData.baseY=m.position.y;
      m.userData.phase=Math.random()*6.28;
      g.add(m);
    }
    return g;
  }

  _makeStarDecal(){
    // 8-pointed star (two overlapping squares) as a flat shape on the ground
    // 2x bigger than before (outer = 13.6 instead of 6.8)
    const shape = new THREE.Shape();
    const spikes=8, outer=13.6, inner=4.8;
    for(let i=0;i<spikes*2;i++){
      const r = (i%2===0)?outer:inner;
      const a = (i/(spikes*2))*Math.PI*2;
      const px=Math.cos(a)*r, py=Math.sin(a)*r;
      if(i===0) shape.moveTo(px,py); else shape.lineTo(px,py);
    }
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI/2);
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({color:0x000000, transparent:true, opacity:0.8, depthWrite:false}));
  }

  _updateDeath(dt, game){
    this.deathT += dt;

    // turret ballistic
    if(this._turretVel){
      this.turretGroup.position.x += this._turretVel.x*dt;
      this.turretGroup.position.y += this._turretVel.y*dt;
      this.turretGroup.position.z += this._turretVel.z*dt;
      this._turretVel.y -= 22*dt;            // gravity
      this.turretGroup.rotation.x += this._turretSpin.x*dt;
      this.turretGroup.rotation.z += this._turretSpin.z*dt;
      // when it lands, stop bouncing
      if(this.turretGroup.position.y <= this.def.body.h+0.45 && this._turretVel.y<0){
        this.turretGroup.position.y = this.def.body.h+0.45;
        this._turretVel.y *= -0.3;
        this._turretVel.x *= 0.5; this._turretVel.z *= 0.5;
        if(Math.abs(this._turretVel.y)<1){ this._turretVel=null; }
      }
    }

    // fire flicker
    if(this._firePts){
      this._firePts.children.forEach(p=>{
        p.position.y = p.userData.baseY + Math.sin(game.time*8+p.userData.phase)*0.3;
        p.scale.setScalar(1+Math.sin(game.time*10+p.userData.phase)*0.2);
      });
    }

    // after 3s, start sinking + fade star + fire
    if(this.deathT > 3){
      const sink = (this.deathT-3);
      this.root.position.y = -sink*1.2;
      if(this._star){ this._star.material.opacity = Math.max(0, 0.85 - sink*0.4); }
      if(this._firePts){ this._firePts.children.forEach(p=>{ p.material.opacity=Math.max(0,0.9-sink*0.5); }); }
    }

    // send player to menu at 4s (non-local tanks keep sinking until removed)
    if(this.deathT > 4 && game && this.isLocal && !this._notifiedDeath){
      this._notifiedDeath = true;
      game.onLocalDeath();              // -> main menu
    }
    if(this.deathT > 8){
      this.root.visible = false;
    }
  }

  respawn(world, game){
    const sp = world.randomSpawn();
    this.x = sp.x; this.z = sp.z;
    this.heading = Math.random()*Math.PI*2;
    this.turretAngle = this.heading;
    this.hp = this.maxHp; this.alive = true;
    this.dying = false; this.deathT = 0;
    this.speed = 0; this.vx = 0; this.vz = 0; this.reloadLeft = 0;
    this.root.visible = true;
    this.root.position.y = 0;
    if(this.hpSprite) this.hpSprite.visible = true;
    if(this.nameSprite) this.nameSprite.visible = true;
    if(this.viewCircle) this.viewCircle.visible = true;
    this._drawHp();
  }

  _updateHpBar(){ this._drawHp(); }

  muzzle(){
    const p = new THREE.Vector3();
    this.barrelEnd.getWorldPosition(p);
    const dir = new THREE.Vector3(Math.sin(this.turretAngle), 0, Math.cos(this.turretAngle));
    return {pos:p, dir};
  }

  snapshot(){
    return {
      id:this.id, x:this.x, z:this.z, h:this.heading, t:this.turretAngle,
      sp:this.speed, hp:this.hp, alive:this.alive, dying:this.dying,
      dd:this.damageDealt, k:this.kills, tank:this.def.id, name:this.name, col:this.color,
    };
  }
  applySnapshot(s){
    this.x=s.x; this.z=s.z; this.heading=s.h; this.turretAngle=s.t;
    this.speed=s.sp; this.hp=s.hp; this.alive=s.alive;
    this.damageDealt=s.dd; this.kills=s.k;
    this.root.visible=this.alive; this._syncTransform(); this._drawHp();
  }
  applyPartialSnapshot(s){
    this.x += (s.x - this.x)*0.3;
    this.z += (s.z - this.z)*0.3;
    this.heading = s.h; this.turretAngle = s.t;
    this.hp = s.hp; this.alive=s.alive;
    this.damageDealt=s.dd; this.kills=s.k;
    this.root.visible=this.alive; this._syncTransform(); this._drawHp();
  }
}