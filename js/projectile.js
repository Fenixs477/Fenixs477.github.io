/* ============================================================
   projectile.js — Shells + Helix flamethrower particles
   - Shell: travels, blocked by walls; flies OVER lakes (per spec)
   - Flame: short-lived particles, DPS at close range
   ============================================================ */

class Shell {
  constructor(owner, pos, dir, def){
    this.owner = owner;
    this.x = pos.x; this.y = pos.y; this.z = pos.z;
    this.dir = dir.clone().normalize();
    this.speed = def.shellSpeed;
    this.damage = def.damage;
    this.life = def.shellRange / def.shellSpeed; // distance-based life
    this.dead = false;
    this.type = 'shell';
    this.radius = 0.4;
    this._build();
  }

  _build(){
    const mat = new THREE.MeshStandardMaterial({color:0xffd24a, emissive:0xff7a1a, emissiveIntensity:0.6, roughness:0.4});
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8), mat);
    this.mesh.position.set(this.x, this.y, this.z);
    // trail
    const trail = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.22, 2.0, 6),
      new THREE.MeshBasicMaterial({color:0xffb12b, transparent:true, opacity:0.5}));
    trail.rotation.x = Math.PI/2;
    trail.position.z = -1.0;
    this.mesh.add(trail);
  }

  attach(scene){ scene.add(this.mesh); this.scene=scene; }
  detach(){ if(this.scene){ this.scene.remove(this.mesh); this.scene=null; } }

  update(dt, world, game){
    const nx = this.x + this.dir.x * this.speed * dt;
    const nz = this.z + this.dir.z * this.speed * dt;
    this.life -= dt;
    if(this.life <= 0){ this.dead = true; return; }
    // blocked by walls only — shells fly OVER lakes (use wallsOnly check)
    if(world.collidesWallsOnly(nx, nz, this.radius)){
      this.dead = true;
      game.spawnExplosion(this.x, 1.0, this.z, 0xffaa33, 6);
      return;
    }
    this.x = nx; this.z = nz;
    // world border
    if(Math.abs(this.x) > world.half || Math.abs(this.z) > world.half){ this.dead = true; return; }
    this.mesh.position.set(this.x, this.y, this.z);
    // orient trail
    this.mesh.lookAt(this.x + this.dir.x, this.y, this.z + this.dir.z);

    // tank hits
    for(const t of game.tanks){
      if(!t.alive) continue;
      if(t === this.owner && this.life > (this.owner.def.shellRange/this.speed) - 0.15) continue; // don't hit self immediately
      const dx = t.x - this.x, dz = t.z - this.z;
      const rad = Math.max(t.def.body.w, t.def.body.l)/2 + this.radius;
      if(dx*dx + dz*dz < rad*rad){
        t.takeDamage(this.damage, this.owner, game);
        game.spawnExplosion(this.x, 1.2, this.z, 0xff6a2a, 8);
        this.dead = true;
        return;
      }
    }
  }
}

/* Flamethrower cone (Helix) — spawns short-lived particles + applies DPS */
class FlameCone {
  constructor(owner, pos, dir, def){
    this.owner = owner;
    this.x = pos.x; this.y = pos.y; this.z = pos.z;
    this.dir = dir.clone().normalize();
    this.range = def.shellRange;
    this.dps = def.damage * 10; // damage is small per "tick" -> treat as dps
    this.life = 0.12;          // short burst; tank keeps firing (low reload)
    this.dead = false;
    this.type = 'flame';
    this.particles = [];
    this._build();
  }

  _build(){
    this.group = new THREE.Group();
    this.group.position.set(this.x, this.y, this.z);
    // a few sprite puffs
    const colors = [0xffd24a, 0xff7a1a, 0xff3b1a];
    for(let i=0;i<10;i++){
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.35+Math.random()*0.3, 6, 6),
        new THREE.MeshBasicMaterial({color:colors[i%3], transparent:true, opacity:0.85}));
      const d = i/10;
      m.position.set(
        this.dir.x*this.range*d + (Math.random()-0.5)*1.6*d,
        (Math.random()-0.5)*1.2*d,
        this.dir.z*this.range*d + (Math.random()-0.5)*1.6*d);
      m.userData.life = 0.1 + Math.random()*0.1;
      this.group.add(m);
      this.particles.push(m);
    }
  }

  attach(scene){ scene.add(this.group); this.scene=scene; }
  detach(){ if(this.scene){ this.scene.remove(this.group); this.scene=null; } }

  update(dt, world, game){
    this.life -= dt;
    // apply damage to tanks in cone in front
    for(const t of game.tanks){
      if(!t.alive || t === this.owner) continue;
      const dx = t.x - this.x, dz = t.z - this.z;
      const dist = Math.hypot(dx, dz);
      if(dist > this.range) continue;
      // angle to target vs dir
      const ang = Math.atan2(dx, dz);
      const dang = Math.atan2(this.dir.x, this.dir.z);
      let diff = Math.abs(((ang - dang + Math.PI)%(Math.PI*2)) - Math.PI);
      if(diff < 0.5){ // ~28° cone
        t.takeDamage(this.dps*dt, this.owner, game);
      }
    }
    // fade particles
    this.particles.forEach(p=>{
      p.userData.life -= dt;
      p.material.opacity = Math.max(0, p.userData.life/0.2);
      p.scale.multiplyScalar(1 + 2*dt);
    });
    if(this.life <= 0) this.dead = true;
  }
}

/* Visual-only explosion */
class Explosion {
  constructor(x,y,z,color,count){
    this.x=x;this.y=y;this.z=z;this.life=0.4;this.maxLife=0.4;this.dead=false;
    this.group=new THREE.Group(); this.group.position.set(x,y,z);
    this.parts=[];
    for(let i=0;i<count;i++){
      const m=new THREE.Mesh(new THREE.SphereGeometry(0.3+Math.random()*0.4,5,5),
        new THREE.MeshBasicMaterial({color,transparent:true,opacity:1}));
      const dir=new THREE.Vector3((Math.random()-0.5),(Math.random()*0.8),(Math.random()-0.5)).normalize();
      m.userData.v=dir.multiplyScalar(4+Math.random()*6);
      this.group.add(m); this.parts.push(m);
    }
  }
  attach(scene){ scene.add(this.group); this.scene=scene; }
  detach(){ if(this.scene){ this.scene.remove(this.group); this.scene=null; } }
  update(dt){
    this.life-=dt;
    this.parts.forEach(p=>{
      p.position.addScaledVector(p.userData.v, dt);
      p.userData.v.y -= 6*dt;
      p.material.opacity=Math.max(0,this.life/this.maxLife);
      p.scale.multiplyScalar(1+1.5*dt);
    });
    if(this.life<=0) this.dead=true;
  }
}
