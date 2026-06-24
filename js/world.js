/* ============================================================
   world.js — generates the big flat battlefield:
     - grass ground (shaded)
     - brown paths
     - cube rock walls (hard cover, maze-like, ~half density)
     - "christmas tree" trees from 4 figures (no hitbox)
     - green cube bushes (no hitbox)
     - lakes (drive-through, shoot-over, look distinct)
   Tanks all drive on the same Y plane.
   Shadows enabled via directional light + renderer.
   ============================================================ */

class World {
  constructor(scene){
    this.scene = scene;
    this.walls = [];        // {x,z,w,d, mesh} for collision (solid)
    this.trees = [];
    this.bushes = [];
    this.lakes = [];        // visual + slow zone (no collision)
    this.size = CONFIG.WORLD_SIZE;
    this.half = this.size/2;
    this._build();
  }

  _build(){
    this._makeGround();
    this._makeSkybox();
    this._makeLights();
    this._makeLakes();
    this._makePaths();
    this._makeWalls();
    this._makeTrees();
    this._makeBushes();
    this._makeBorder();
  }

  /* ---------- Ground (textured shader) ---------- */
  _makeGround(){
    // Procedural grass texture as fallback (always works)
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    const g = c.getContext('2d');
    g.fillStyle = '#4a7a2a'; g.fillRect(0,0,1024,1024);
    for(let i=0;i<2600;i++){
      const x=Math.random()*1024, y=Math.random()*1024, r=4+Math.random()*22;
      const tone = 40+Math.random()*60;
      g.fillStyle = `rgba(${tone+30},${tone+80},${tone+20},${0.2+Math.random()*0.2})`;
      g.beginPath(); g.arc(x,y,r,0,7); g.fill();
    }
    g.strokeStyle = '#7a6040'; g.lineWidth = 26; g.lineCap='round';
    for(let p=0;p<5;p++){
      g.beginPath();
      let x=Math.random()*1024, y=Math.random()*1024;
      g.moveTo(x,y);
      for(let s=0;s<8;s++){ x += (Math.random()-0.5)*220; y += (Math.random()-0.5)*220;
        g.lineTo(x,y); }
      g.stroke();
    }
    for(let i=0;i<600;i++){
      g.fillStyle = `rgba(${120+Math.random()*40},${100+Math.random()*30},${60+Math.random()*20},0.5)`;
      g.fillRect(Math.random()*1024,Math.random()*1024,2,2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6,6);
    
    // Try to load the real grass texture, fallback to procedural
    const grassImg = new Image();
    grassImg.src = 'Cartoon_green_texture_grass.jpg';
    grassImg.onload = function(){
      tex.image = grassImg;
      tex.needsUpdate = true;
    };
    grassImg.onerror = function(){
      // Keep the procedural texture
    };

    const mat = new THREE.MeshStandardMaterial({map: tex, roughness: 0.9, metalness: 0});
    this.groundMat = mat;
    const geo = new THREE.PlaneGeometry(this.size, this.size, 1, 1);
    geo.rotateX(-Math.PI/2);
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
  }

  _makeSkybox(){
    this.scene.background = new THREE.Color(COLORS.fog);
    this.scene.fog = new THREE.Fog(COLORS.fog, 80, 340);
  }

  _makeLights(){
    const hemi = new THREE.HemisphereLight(0xdfeaff, 0x6a7040, 1.3);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4dc, 1.6);
    sun.position.set(80,160,40);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 4096;
    sun.shadow.mapSize.height = 4096;
    // Shadow camera must cover the entire 600x600 world
    const d = 400;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = 500;
    sun.shadow.bias = -0.005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.sunLight = sun;
    const amb = new THREE.AmbientLight(0x7a7a8a, 0.6);
    this.scene.add(amb);
  }

  /* ---------- Lakes ---- */
  _makeLakes(){
    const waterMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(SHADERS.water.uniforms),
      vertexShader: SHADERS.water.vertexShader,
      fragmentShader: SHADERS.water.fragmentShader,
      transparent:true,
      depthWrite:true,
      side:THREE.DoubleSide,
    });
    this.waterMat = waterMat;

    const lakeDefs = [
      {x:-120, z:60,  r:42},
      {x:140,  z:-90, r:55},
      {x:-60,  z:-160,r:36},
      {x:200,  z:160, r:48},
      {x:-220, z:-40, r:30},
    ];
    lakeDefs.forEach(d=>{
      const geo = new THREE.CircleGeometry(d.r, 48);
      geo.rotateX(-Math.PI/2);
      const m = new THREE.Mesh(geo, waterMat);
      m.position.set(d.x, 0.15, d.z);
      m.renderOrder = 1;
      m.receiveShadow = true;
      this.scene.add(m);
      const rim = new THREE.Mesh(
        new THREE.RingGeometry(d.r*0.96, d.r*1.10, 40),
        new THREE.MeshBasicMaterial({color:0x5a4a2a, side:THREE.DoubleSide}));
      rim.rotation.x = -Math.PI/2; rim.position.set(d.x,0.10,d.z);
      this.scene.add(rim);
      this.lakes.push({x:d.x, z:d.z, r:d.r});
      this._lakeColliders = this._lakeColliders || [];
      this._lakeColliders.push({x:d.x, z:d.z, r:d.r});
    });
  }

  _makePaths(){
    // nothing extra needed; paths are part of ground texture
  }

  /* ---------- Cube rock walls (hard cover) with proper materials (receive shadows) ---- */
  _makeWalls(){
    const rockMat = new THREE.MeshStandardMaterial({color:COLORS.rock, roughness:0.9, metalness:0.05, flatShading:true});
    const rockMatD = new THREE.MeshStandardMaterial({color:COLORS.rockDark, roughness:0.95, flatShading:true});

    const cells = 12;
    const step = this.size / cells;
    const wallH = 5;
    for(let i=0;i<=cells;i++){
      for(let j=0;j<cells;j++){
        if(Math.random()<0.32){
          this._addWallSegment(
            -this.half + i*step, -this.half + (j+0.5)*step,
            step*0.78, 3, wallH, rockMat, rockMatD
          );
        }
        if(Math.random()<0.32){
          this._addWallSegment(
            -this.half + (j+0.5)*step, -this.half + i*step,
            3, step*0.78, wallH, rockMat, rockMatD
          );
        }
      }
    }
    for(let k=0;k<14;k++){
      const s = 6+Math.random()*10;
      const x=(Math.random()-0.5)*this.size*0.9, z=(Math.random()-0.5)*this.size*0.9;
      if(this._inLake(x,z,6)) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(s,s*1.1,s), rockMatD);
      m.position.set(x, s*0.55, z); m.rotation.y = Math.random()*Math.PI;
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
      this.walls.push({x,z,w:s,d:s,mesh:m});
    }
  }

  _addWallSegment(x, z, w, d, h, mat, matD){
    if(this._inLake(x,z, Math.max(w,d))) return;
    if(Math.abs(x) > this.half-6 || Math.abs(z) > this.half-6) return;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, h/2, z);
    m.castShadow = m.receiveShadow = true;
    const base = new THREE.Mesh(new THREE.BoxGeometry(w*1.04, 0.6, d*1.04), matD);
    base.position.set(x, 0.3, z); base.receiveShadow = true;
    this.scene.add(m); this.scene.add(base);
    this.walls.push({x,z,w,d,mesh:m});
  }

  /* ---------- Christmas-tree trees ---- */
  _makeTrees(){
    const trunkMat = new THREE.MeshStandardMaterial({color:COLORS.treeTrunk, roughness:1});
    const leafMat  = new THREE.MeshStandardMaterial({color:COLORS.treeLeaf, roughness:0.9, flatShading:true});
    const leafMat2 = new THREE.MeshStandardMaterial({color:COLORS.treeLeaf2, roughness:0.9, flatShading:true});

    for(let i=0;i<160;i++){
      const x=(Math.random()-0.5)*this.size*0.95, z=(Math.random()-0.5)*this.size*0.95;
      if(this._inLake(x,z,4)) continue;
      if(this._nearWall(x,z,5)) continue;
      const tree = this._buildChristmasTree(trunkMat, leafMat, leafMat2);
      tree.position.set(x, 0, z);
      tree.rotation.y = Math.random()*Math.PI*2;
      const s = 0.8+Math.random()*0.7;
      tree.scale.setScalar(s);
      this.scene.add(tree);
      this.trees.push({x,z,mesh:tree});
    }
  }

  _buildChristmasTree(trunkMat, leafMat, leafMat2){
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4,0.55,6.0,7), trunkMat);
    trunk.position.y = 3.0; trunk.castShadow = true; g.add(trunk);
    const tiers = [
      {y:5.6, r:3.2, h:2.6, m:leafMat},
      {y:7.4, r:2.4, h:2.2, m:leafMat},
      {y:9.0, r:1.7, h:1.9, m:leafMat2},
      {y:10.4, r:0.9, h:1.4, m:leafMat2},
    ];
    tiers.forEach(t=>{
      const c = new THREE.Mesh(new THREE.ConeGeometry(t.r, t.h, 8), t.m);
      c.position.y = t.y; c.castShadow = true; g.add(c);
    });
    return g;
  }

  /* ---------- Bushes ---- */
  _makeBushes(){
    const bushMat   = new THREE.MeshStandardMaterial({color:COLORS.bush, roughness:1, flatShading:true});
    const bushMat2  = new THREE.MeshStandardMaterial({color:COLORS.bush2, roughness:1, flatShading:true});
    const bushMatBig= new THREE.MeshStandardMaterial({color:COLORS.bushBig, roughness:0.95, flatShading:true});

    const patches = 34;
    for(let p=0;p<patches;p++){
      let cx, cz;
      if(Math.random() < 0.4 && this.trees.length > 0){
        const refTree = this.trees[Math.floor(Math.random() * this.trees.length)];
        cx = refTree.x + (Math.random()-0.5)*12;
        cz = refTree.z + (Math.random()-0.5)*12;
      } else {
        cx = (Math.random()-0.5)*this.size*0.9;
        cz = (Math.random()-0.5)*this.size*0.9;
      }
      if(this._inLake(cx,cz,8)) continue;
      const count = 5 + Math.floor(Math.random()*6);
      for(let i=0;i<count;i++){
        const ang = Math.random()*Math.PI*2;
        const rad = Math.random()*7;
        const x = cx + Math.cos(ang)*rad, z = cz + Math.sin(ang)*rad;
        if(this._inLake(x,z,3)) continue;
        const s = 1.4+Math.random()*1.6;
        const m = new THREE.Mesh(new THREE.BoxGeometry(s, s*0.9, s), Math.random()<0.5?bushMat:bushMat2);
        m.position.set(x, s*0.45, z);
        m.rotation.y = Math.random()*Math.PI;
        m.rotation.x = (Math.random()-0.5)*0.2;
        m.castShadow = true; m.receiveShadow = true;
        this.scene.add(m);
        this.bushes.push({x,z,r:s*0.9+1.8,mesh:m});
      }
      const bigs = 1 + Math.floor(Math.random()*2);
      for(let i=0;i<bigs;i++){
        const ang = Math.random()*Math.PI*2;
        const x = cx + Math.cos(ang)*4, z = cz + Math.sin(ang)*4;
        if(this._inLake(x,z,5)) continue;
        const s = 4.2+Math.random()*1.4;
        const m = new THREE.Mesh(new THREE.BoxGeometry(s, s*0.95, s), bushMatBig);
        m.position.set(x, s*0.48, z);
        m.rotation.y = Math.random()*Math.PI;
        m.castShadow = true; m.receiveShadow = true;
        this.scene.add(m);
        this.bushes.push({x,z,r:s*0.8+2.2,mesh:m});
      }
    }
  }

  /* ---------- Camouflage queries ---------- */
  hidingIn(x, z){
    for(const b of this.bushes){
      if(Math.hypot(x-b.x, z-b.z) < (b.r||CONFIG.BUSH_HIDE_RADIUS)) return 'bush';
    }
    for(const t of this.trees){
      if(Math.hypot(x-t.x, z-t.z) < CONFIG.TREE_HIDE_RADIUS) return 'tree';
    }
    return null;
  }
  camoFactor(x, z){
    const h = this.hidingIn(x, z);
    if(h==='bush') return 0;
    if(h==='tree') return 0.5;
    return 1;
  }

  /* ---------- Invisible border walls ---------- */
  _makeBorder(){
    const mat = new THREE.MeshBasicMaterial({color:0x000000, transparent:true, opacity:0});
    const t = 6, h = 20;
    const segs = [
      {x:0, z: this.half, w:this.size, d:t},
      {x:0, z:-this.half, w:this.size, d:t},
      {x: this.half, z:0, w:t, d:this.size},
      {x:-this.half, z:0, w:t, d:this.size},
    ];
    segs.forEach(s=>{
      const m = new THREE.Mesh(new THREE.BoxGeometry(s.w,h,s.d), mat);
      m.position.set(s.x,h/2,s.z);
      this.scene.add(m);
      this.walls.push({x:s.x,z:s.z,w:s.w,d:s.d,mesh:m,border:true});
    });
  }

  /* ---------- Helpers ---------- */
  _inLake(x,z,pad=0){
    return this.lakes.some(l=> Math.hypot(x-l.x, z-l.z) < l.r+pad);
  }
  _nearWall(x,z,pad){
    return this.walls.some(w=> Math.abs(x-w.x) < w.w/2+pad && Math.abs(z-w.z) < w.d/2+pad);
  }
  lakeAt(x,z){ return this.lakes.find(l=> Math.hypot(x-l.x, z-l.z) < l.r) || null; }

  collides(x, z, r){
    if(this.collidesWallsOnly(x, z, r)) return true;
    const lakes = this._lakeColliders || this.lakes;
    for(const l of lakes){
      if(Math.hypot(x-l.x, z-l.z) < l.r + r) return true;
    }
    return false;
  }
  collidesWallsOnly(x, z, r){
    for(const w of this.walls){
      const hx = w.w/2 + r, hz = w.d/2 + r;
      if(Math.abs(x-w.x) < hx && Math.abs(z-w.z) < hz) return true;
    }
    return false;
  }
  randomSpawn(){
    for(let tries=0; tries<200; tries++){
      const x = (Math.random()-0.5)*this.size*0.9;
      const z = (Math.random()-0.5)*this.size*0.9;
      if(this._inLake(x,z,4)) continue;
      if(this.collides(x,z,3)) continue;
      return {x,z};
    }
    return {x:0,z:0};
  }

  loadCustomMapData(data){
    if(!data || !data.objects) return;
    const rockMat = new THREE.MeshStandardMaterial({color:COLORS.rock, roughness:0.9, flatShading:true});
    const bushMat = new THREE.MeshStandardMaterial({color:COLORS.bush, roughness:1, flatShading:true});
    
    data.objects.forEach(d=>{
      let mesh;
      
      // Handle model assets
      if(d.isModel && d.modelName){
        // Create a placeholder box while model loads
        const geo = new THREE.BoxGeometry(4,4,4);
        const mat = new THREE.MeshStandardMaterial({color:d.color||0x888888});
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(d.x, d.y, d.z);
        mesh.scale.set(d.sx, d.sy, d.sz);
        mesh.rotation.y = d.ry;
        mesh.castShadow = mesh.receiveShadow = true;
        this.scene.add(mesh);
        
        if(d.type==='water'){
          const r = Math.max(d.sx, d.sz)*3;
          this._lakeColliders = this._lakeColliders || [];
          this._lakeColliders.push({x:d.x, z:d.z, r});
          this.lakes.push({x:d.x, z:d.z, r});
        } else if(d.type==='bush'){
          this.bushes.push({x:d.x, z:d.z, mesh});
        } else {
          const w = 4*d.sx, dd = 4*d.sz;
          this.walls.push({x:d.x, z:d.z, w, d:dd, mesh});
        }
        
        // Try to load the actual model async
        if(window.Models){
          Models.load(d.modelName).then(grp => {
            if(!grp) return;
            const clone = grp.clone(true);
            clone.position.set(d.x, d.y, d.z);
            clone.scale.set(d.sx, d.sy, d.sz);
            clone.rotation.y = d.ry;
            clone.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
            this.scene.add(clone);
            // Remove placeholder, replace wall/bush refs
            this.scene.remove(mesh);
            if(d.type==='water'){
              // update lake ref
              const idx = this.lakes.findIndex(l=> l.x===d.x && l.z===d.z);
              if(idx>=0) this.lakes[idx].mesh = clone;
            } else if(d.type==='bush'){
              const idx = this.bushes.findIndex(b=> b.mesh===mesh);
              if(idx>=0) this.bushes[idx].mesh = clone;
            } else {
              const idx = this.walls.findIndex(w=> w.mesh===mesh);
              if(idx>=0){ this.walls[idx].mesh = clone; }
            }
          });
        }
        return;
      }
      
      // Regular figures
      let geo;
      switch(d.kind){
        case 'cube':     geo = new THREE.BoxGeometry(6,6,6); break;
        case 'pyramid':  geo = new THREE.ConeGeometry(4,7,4); break;
        case 'cone':     geo = new THREE.ConeGeometry(3.5,7,18); break;
        case 'torus':    geo = new THREE.TorusGeometry(3,1.2,12,24); break;
        case 'cylinder': geo = new THREE.CylinderGeometry(3,3,6,18); break;
        default: geo = new THREE.BoxGeometry(6,6,6);
      }
      const mat = (d.type==='water') ? new THREE.MeshBasicMaterial({color:d.color||0x2a6f96, transparent:true, opacity:0.85})
                 : (d.type==='bush' ? bushMat : rockMat);
      mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(d.x, d.y, d.z);
      mesh.scale.set(d.sx, d.sy, d.sz);
      mesh.rotation.y = d.ry;
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);

      if(d.type==='water'){
        const r = Math.max(d.sx, d.sz)*3;
        this._lakeColliders = this._lakeColliders || [];
        this._lakeColliders.push({x:d.x, z:d.z, r});
        this.lakes.push({x:d.x, z:d.z, r});
      } else if(d.type==='bush'){
        this.bushes.push({x:d.x, z:d.z, mesh});
      } else {
        const w = 6*d.sx, dd = 6*d.sz;
        this.walls.push({x:d.x, z:d.z, w, d:dd, mesh});
      }
    });
  }

  clearCustomMapData(){
    if(this._customMeshes){
      this._customMeshes.forEach(m=>{ this.scene.remove(m); });
    }
    this._customMeshes = [];
  }

  update(dt, time){
    if(this.waterMat) this.waterMat.uniforms.uTime.value = time;
  }

  renderToCanvas(ctx, w, h, opts={}){
    const scale = w / this.size;
    const ox = w/2, oy = h/2;
    const toPx = (x,z)=> [ox + x*scale, oy + z*scale];
    ctx.fillStyle = '#4a6a2a'; ctx.fillRect(0,0,w,h);
    ctx.fillStyle = 'rgba(90,67,41,0.15)'; ctx.fillRect(0,0,w,h);
    this.lakes.forEach(l=>{
      const [px,py] = toPx(l.x,l.z);
      ctx.fillStyle = '#2a8aba';
      ctx.beginPath(); ctx.arc(px,py, l.r*scale, 0, 7); ctx.fill();
    });
    ctx.fillStyle = '#6a6e72';
    this.walls.forEach(wl=>{
      if(wl.border) return;
      ctx.fillRect(ox+(wl.x-wl.w/2)*scale, oy+(wl.z-wl.d/2)*scale, wl.w*scale, wl.d*scale);
    });
    ctx.fillStyle = '#3a7a34';
    this.trees.forEach(t=>{
      const [px,py] = toPx(t.x,t.z);
      ctx.fillRect(px-1, py-1, 2, 2);
    });
    ctx.strokeStyle='#888'; ctx.lineWidth=2;
    ctx.strokeRect(1,1,w-2,h-2);
  }

  worldToMap(x, z, canvasSize){
    const scale = canvasSize / this.size;
    return [canvasSize/2 + x*scale, canvasSize/2 + z*scale];
  }
}