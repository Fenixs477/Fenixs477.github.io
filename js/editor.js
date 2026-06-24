/* ============================================================
   editor.js — Blender-like Map Editor (fullscreen 3D).
   - Place figures OR GLTF/DAE model assets
   - Paint, scale, rotate, move
   - Drag-and-drop GLTF files to import
   - Save → automatically becomes the main map
   ============================================================ */

class MapEditor {
  constructor(){
    this.open = false;
    this.objects = [];          // {mesh, type, color, kind, isModel, modelName}
    this.selected = null;
    this.tool = 'move';         // move | scale | rotate
    this.paintColor = '#8a8f98';
    this.pencilSize = 1;
    this.typeTag = 'wall';      // water | bush | wall
    this._orbit = {az:0.6, el:0.9, dist:120, target:new THREE.Vector3(0,0,0)};
    this._dragging = null;
    this._assets = [];          // loaded GLTF models available for placement
  }

  show(){
    document.getElementById('editor-overlay').classList.remove('hidden');
    document.querySelectorAll('.menu').forEach(m=>m.classList.add('hidden'));
    document.getElementById('hud').classList.add('hidden');
    if(!this._inited) this._init();
    this.open = true;
    this._render();
  }
  hide(){
    document.getElementById('editor-overlay').classList.add('hidden');
    this.open = false;
    Menu.show('menu-main');
  }

  _init(){
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x20242a);
    this.scene.fog = new THREE.Fog(0x20242a, 200, 600);
    this.camera = new THREE.PerspectiveCamera(50, innerWidth/innerHeight, 0.1, 2000);
    this.renderer = new THREE.WebGLRenderer({antialias:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('editor-canvas-host').appendChild(this.renderer.domElement);

    // lights
    this.scene.add(new THREE.HemisphereLight(0xdfeaff, 0x404032, 1.1));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.1);
    sun.position.set(60,120,40);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.left = -200;
    sun.shadow.camera.right = 200;
    sun.shadow.camera.top = 200;
    sun.shadow.camera.bottom = -200;
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0x404048, 0.5));

    // ground plane
    const planeGeo = new THREE.PlaneGeometry(CONFIG.WORLD_SIZE, CONFIG.WORLD_SIZE);
    planeGeo.rotateX(-Math.PI/2);
    const plane = new THREE.Mesh(planeGeo,
      new THREE.MeshStandardMaterial({color:0x3a4824, roughness:1}));
    plane.receiveShadow = true;
    this.scene.add(plane);
    this.ground = plane;
    const grid = new THREE.GridHelper(CONFIG.WORLD_SIZE, 30, 0x4a5a2a, 0x2a3a18);
    grid.position.y = 0.05;
    this.scene.add(grid);

    // selection highlight
    this._selRing = new THREE.Mesh(
      new THREE.TorusGeometry(3, 0.15, 8, 32),
      new THREE.MeshBasicMaterial({color:0xffb12b}));
    this._selRing.rotation.x = Math.PI/2;
    this._selRing.visible = false;
    this.scene.add(this._selRing);

    // gizmo axes (move handles)
    this._gizmoGroup = new THREE.Group();
    this._gizmoGroup.visible = false;
    ['x','y','z'].forEach((axis,i)=>{
      const col = [0xff4444, 0x44ff44, 0x4444ff][i];
      const dir = [new THREE.Vector3(1,0,0), new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,1)][i];
      const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(0,0,0), 4, col, 0.8, 0.4);
      arrow.name = 'gizmo-'+axis;
      this._gizmoGroup.add(arrow);
    });
    this.scene.add(this._gizmoGroup);

    // Load available models/assets
    this._probeAssets();

    this._wireUI();
    this._wireCanvas();
    this._loop = this._loop.bind(this);
    addEventListener('resize', ()=> this._onResize());
    this._inited = true;
    requestAnimationFrame(this._loop);

    // Load existing custom map
    const m = loadCustomMap();
    if(m) this._importMap(m);
  }

  async _probeAssets(){
    // Probe which .gltf/.dae assets are available
    const names = ['coolbuddy','helix','striker','ghost','sturmratte','PanzerIV'];
    const results = await Promise.all(names.map(async n=>{
      const exists = await Models._exists('mini_tank_legends_models/'+n+'.gltf')
                  || await Models._exists('mini_tank_legends_models/'+n+'.dae');
      return {name:n, exists};
    }));
    this._assets = results.filter(r=>r.exists);
    this._renderAssetPanel();
  }

  _renderAssetPanel(){
    const panel = document.getElementById('ed-assets-list');
    if(!panel) return;
    panel.innerHTML = this._assets.map(a => 
      `<div class="ed-btn ed-asset-btn" data-asset="${a.name}">📦 ${a.name}</div>`
    ).join('');
    panel.querySelectorAll('.ed-asset-btn').forEach(btn=>{
      btn.onclick = ()=> this._placeModel(btn.dataset.asset);
    });
  }

  async _placeModel(name){
    const grp = await Models.load(name);
    if(!grp){ Menu.toast('Could not load '+name); return; }
    
    // Clone and configure
    const clone = grp.clone(true);
    clone.scale.setScalar(0.5);
    clone.position.set(0, 0, 0);
    clone.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
    this.scene.add(clone);
    
    const obj = {
      mesh: clone,
      type: this.typeTag,
      color: 0x888888,
      kind: 'model',
      isModel: true,
      modelName: name,
      _baseScale: new THREE.Vector3(0.5, 0.5, 0.5),
    };
    this.objects.push(obj);
    this.select(obj);
    Menu.toast('Placed '+name);
  }

  _onResize(){
    if(!this.renderer) return;
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth/innerHeight;
    this.camera.updateProjectionMatrix();
  }

  _loop(){
    requestAnimationFrame(this._loop);
    if(!this.open) return;
    const {az, el, dist, target} = this._orbit;
    this.camera.position.set(
      target.x + dist*Math.cos(el)*Math.sin(az),
      target.y + dist*Math.sin(el),
      target.z + dist*Math.cos(el)*Math.cos(az));
    this.camera.lookAt(target);
    
    // Update gizmo position
    if(this.selected && this.tool === 'move'){
      this._gizmoGroup.position.copy(this.selected.mesh.position);
      this._gizmoGroup.position.y += 3;
      this._gizmoGroup.visible = true;
    } else {
      this._gizmoGroup.visible = false;
    }
    
    this.renderer.render(this.scene, this.camera);
  }

  /* ---------- UI ---------- */
  _wireUI(){
    const $ = id=>document.getElementById(id);

    ['cube','pyramid','cone','torus','cylinder'].forEach(kind=>{
      $('ed-fig-'+kind).onclick = ()=> this._addFigure(kind);
    });

    $('ed-tool-move').onclick   = ()=> this._setTool('move');
    $('ed-tool-scale').onclick  = ()=> this._setTool('scale');
    $('ed-tool-rotate').onclick = ()=> this._setTool('rotate');

    $('ed-color').oninput = e=>{ this.paintColor = e.target.value;
      if(this.selected) this._recolorSelected(); };
    $('ed-pencil-size').oninput = e=>{ this.pencilSize = +e.target.value;
      $('ed-pencil-size-val').textContent = e.target.value;
      if(this.selected) this._applyPencil(); };

    document.querySelectorAll('.ed-type').forEach(b=>{
      b.onclick = ()=>{
        document.querySelectorAll('.ed-type').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        this.typeTag = b.dataset.type;
        if(this.selected){ this.selected.type = this.typeTag; this._refreshInspector(); }
      };
    });

    $('ed-save').onclick = ()=> {
      this._save();
      // Auto-promote to main map!
      setMapUnlocked(true);
      Menu.toast('Map saved & set as MAIN!');
    };
    $('ed-load').onclick = ()=> {
      const m=loadCustomMap();
      if(m){ this._clearAll(); this._importMap(m); Menu.toast('Loaded your saved map'); }
      else Menu.toast('No saved map yet');
    };
    $('ed-clear').onclick  = ()=> this._clearAll();
    $('ed-delete').onclick = ()=> { if(this.selected) this._deleteSelected(); };
    
    // File upload for custom GLTF models
    $('ed-upload-model').onclick = ()=>{
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.gltf,.glb,.dae,.obj';
      input.onchange = async (e)=>{
        const file = e.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = async (ev)=>{
          const url = URL.createObjectURL(file);
          try{
            // Try to load with GLTFLoader or ColladaLoader
            let grp = null;
            if(file.name.endsWith('.gltf') || file.name.endsWith('.glb')){
              const loader = new THREE.GLTFLoader();
              const gltf = await new Promise((res,rej)=> loader.load(url, res, undefined, rej));
              grp = gltf.scene;
            } else if(file.name.endsWith('.dae')){
              const loader = new THREE.ColladaLoader();
              const result = await new Promise((res,rej)=> loader.load(url, res, undefined, rej));
              grp = result.scene;
            }
            if(grp){
              grp.scale.setScalar(0.5);
              grp.position.set(0, 0, 0);
              grp.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
              this.scene.add(grp);
              const obj = {
                mesh: grp,
                type: this.typeTag,
                color: 0x888888,
                kind: 'custom_'+file.name,
                isModel: true,
                modelName: file.name,
                _baseScale: new THREE.Vector3(0.5, 0.5, 0.5),
              };
              this.objects.push(obj);
              this.select(obj);
              Menu.toast('Loaded '+file.name);
            }
          } catch(err){
            Menu.toast('Could not load '+file.name);
          }
          URL.revokeObjectURL(url);
        };
        reader.readAsArrayBuffer(file);
      };
      input.click();
    };

    $('ed-unlock-go').onclick = ()=>{
      const code = $('ed-unlock-code').value.trim().toUpperCase();
      if(code === MAP_UNLOCK_CODE){ setMapUnlocked(true); Menu.toast('Unlocked!'); }
      else Menu.toast('Wrong code');
    };
    $('ed-back').onclick = ()=> this.hide();
  }

  _setTool(t){
    this.tool = t;
    ['move','scale','rotate'].forEach(x=>{
      document.getElementById('ed-tool-'+x).classList.toggle('active', x===t);
    });
  }

  /* ---------- Canvas interaction ---------- */
  _wireCanvas(){
    const dom = this.renderer.domElement;
    const ray = new THREE.Raycaster();
    const mouseNDC = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
    const planeY = new THREE.Plane(new THREE.Vector3(0,1,0), -3);

    const ndc = (e)=>{
      const r = dom.getBoundingClientRect();
      mouseNDC.set(((e.clientX-r.left)/r.width)*2-1, -((e.clientY-r.top)/r.height)*2+1);
    };
    const intersectGround = (y=0)=>{
      const p = new THREE.Plane(new THREE.Vector3(0,1,0), -y);
      ray.setFromCamera(mouseNDC, this.camera);
      const hit = new THREE.Vector3();
      ray.ray.intersectPlane(p, hit);
      return hit;
    };
    const intersectObjects = ()=>{
      ray.setFromCamera(mouseNDC, this.camera);
      const meshes = [];
      this.objects.forEach(o=>{
        if(o.isModel){
          o.mesh.traverse(c=>{ if(c.isMesh) meshes.push(c); });
        } else {
          meshes.push(o.mesh);
        }
      });
      const hits = ray.intersectObjects(meshes, true);
      return hits.length? hits[0] : null;
    };

    dom.addEventListener('mousedown', e=>{
      if(!this.open) return;
      ndc(e);
      if(e.button===2 || e.shiftKey){
        this._dragging = {mode:'orbit', x:e.clientX, y:e.clientY, az:this._orbit.az, el:this._orbit.el};
        return;
      }
      const hit = intersectObjects();
      if(hit){
        const obj = this._objOfMesh(hit.object);
        this.select(obj);
        this._dragging = {mode:this.tool, startGround:intersectGround(), obj};
      } else {
        this.select(null);
      }
    });
    dom.addEventListener('contextmenu', e=> e.preventDefault());
    dom.addEventListener('mousemove', e=>{
      if(!this._dragging) return;
      ndc(e);
      const d = this._dragging;
      if(d.mode==='orbit'){
        this._orbit.az = d.az - (e.clientX-d.x)*0.005;
        this._orbit.el = Math.max(0.15, Math.min(1.45, d.el + (e.clientY-d.y)*0.005));
        return;
      }
      if(!d.obj) return;
      const g = intersectGround(); if(!g) return;
      const m = d.obj.mesh;
      if(d.mode==='move'){
        m.position.x = g.x; m.position.z = g.z;
      } else if(d.mode==='scale'){
        const s = Math.max(0.2, Math.hypot(g.x-m.position.x, g.z-m.position.z)/3);
        m.scale.set(s, s, s);
      } else if(d.mode==='rotate'){
        m.rotation.y = Math.atan2(g.x-m.position.x, g.z-m.position.z);
      }
      this._refreshInspector();
    });
    window.addEventListener('mouseup', ()=> this._dragging=null);
    dom.addEventListener('wheel', e=>{
      if(!this.open) return;
      this._orbit.dist = Math.max(30, Math.min(400, this._orbit.dist + (e.deltaY>0?8:-8)));
    }, {passive:true});

    window.addEventListener('keydown', e=>{
      if(!this.open) return;
      if(e.code==='Delete' || e.code==='Backspace'){ if(this.selected) this._deleteSelected(); }
      if(e.code==='Escape') this.select(null);
      // Grid snap while moving: hold Control
      if(e.code==='ControlLeft' || e.code==='ControlRight') this._snapEnabled = true;
    });
    window.addEventListener('keyup', e=>{
      if(e.code==='ControlLeft' || e.code==='ControlRight') this._snapEnabled = false;
    });
  }

  _objOfMesh(mesh){
    while(mesh){
      const o = this.objects.find(o=>{
        if(o.mesh === mesh) return true;
        if(o.mesh.children && o.mesh.children.includes(mesh)) return true;
        if(o.isModel){
          let found = false;
          o.mesh.traverse(c=>{ if(c===mesh) found = true; });
          return found;
        }
        return false;
      });
      if(o) return o;
      mesh = mesh.parent;
    }
    return null;
  }

  /* ---------- Figures ---------- */
  _geometryFor(kind){
    switch(kind){
      case 'cube':     return new THREE.BoxGeometry(6,6,6);
      case 'pyramid':  return new THREE.ConeGeometry(4,7,4);
      case 'cone':     return new THREE.ConeGeometry(3.5,7,18);
      case 'torus':    return new THREE.TorusGeometry(3,1.2,12,24);
      case 'cylinder': return new THREE.CylinderGeometry(3,3,6,18);
    }
    return new THREE.BoxGeometry(6,6,6);
  }
  _addFigure(kind){
    const geo = this._geometryFor(kind);
    const color = parseInt(this.paintColor.slice(1),16);
    const mat = new THREE.MeshStandardMaterial({color, roughness:0.7, metalness:0.15, flatShading:true});
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, kind==='torus'?3:3, 0);
    if(kind==='torus') mesh.rotation.x = Math.PI/2;
    mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
    const obj = {mesh, type:this.typeTag, color, kind, isModel:false, _baseScale:mesh.scale.clone()};
    this.objects.push(obj);
    this.select(obj);
  }

  select(obj){
    this.selected = obj;
    if(obj){
      this._selRing.visible = true;
      this._selRing.position.copy(obj.mesh.position);
      this._selRing.position.y = 0.2;
      const r = Math.max(obj.mesh.scale.x, obj.mesh.scale.z)*3.2;
      this._selRing.scale.setScalar(r/3);
    } else {
      this._selRing.visible = false;
    }
    this._refreshInspector();
  }

  _refreshInspector(){
    const ins = document.getElementById('ed-inspector');
    if(!this.selected){
      ins.innerHTML = '<div class="muted">Click an object to edit it.<br>Left-drag: move/scale/rotate<br>Right-click/Shift+drag: orbit</div>';
      return;
    }
    const o = this.selected;
    ins.innerHTML = `
      <div class="insp-row"><b>${o.isModel ? '📦 '+o.modelName : o.kind}</b> <span class="tag tag-${o.type}">${o.type}</span></div>
      <div class="insp-row">Pos: ${o.mesh.position.x.toFixed(1)}, ${o.mesh.position.z.toFixed(1)}</div>
      <div class="insp-row">Scale: ${o.mesh.scale.x.toFixed(2)}</div>
      <div class="insp-row">Rotate: ${(o.mesh.rotation.y*57.3).toFixed(0)}°</div>`;
    document.querySelectorAll('.ed-type').forEach(b=> b.classList.toggle('active', b.dataset.type===o.type));
    document.getElementById('ed-color').value = '#'+(o.color||0x888888).toString(16).padStart(6,'0');
  }

  _recolorSelected(){
    if(!this.selected) return;
    const c = parseInt(this.paintColor.slice(1),16);
    this.selected.color = c;
    if(this.selected.isModel){
      // Recolor model children
      this.selected.mesh.traverse(o=>{
        if(o.isMesh && o.material) o.material.color.setHex(c);
      });
    } else {
      this.selected.mesh.material.color.setHex(c);
    }
  }
  _applyPencil(){
    if(!this.selected) return;
    const s = this.pencilSize;
    this.selected.mesh.scale.set(s,s,s);
    this.selected._baseScale.set(s,s,s);
    this._refreshInspector();
  }
  _deleteSelected(){
    if(!this.selected) return;
    this.scene.remove(this.selected.mesh);
    this.objects = this.objects.filter(o=>o!==this.selected);
    this.select(null);
  }
  _clearAll(){
    this.objects.forEach(o=> this.scene.remove(o.mesh));
    this.objects = []; this.select(null);
  }

  /* ---------- Save ---------- */
  _save(){
    const data = {
      version:2,
      objects: this.objects.map(o=>({
        kind: o.isModel ? 'model' : o.kind,
        type: o.type,
        color: o.color || 0x888888,
        x: o.mesh.position.x,
        y: o.mesh.position.y,
        z: o.mesh.position.z,
        sx: o.mesh.scale.x,
        sy: o.mesh.scale.y,
        sz: o.mesh.scale.z,
        ry: o.mesh.rotation.y,
        isModel: o.isModel || false,
        modelName: o.modelName || null,
      })),
    };
    saveCustomMap(data);
  }

  _importMap(data){
    (data.objects||[]).forEach(d=>{
      let mesh;
      if(d.isModel && d.modelName){
        // Try to load the model async; for now place a placeholder
        Models.load(d.modelName).then(grp=>{
          if(grp){
            const clone = grp.clone(true);
            clone.position.set(d.x, d.y, d.z);
            clone.scale.set(d.sx, d.sy, d.sz);
            clone.rotation.y = d.ry;
            clone.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; o.material.color.setHex(d.color); } });
            this.scene.add(clone);
            this.objects.push({mesh:clone, type:d.type, color:d.color, kind:'model', isModel:true, modelName:d.modelName, _baseScale:new THREE.Vector3(d.sx,d.sy,d.sz)});
          }
        });
        // Placeholder box while model loads
        const geo = new THREE.BoxGeometry(4,4,4);
        const mat = new THREE.MeshStandardMaterial({color:0x888888, wireframe:true});
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(d.x, d.y, d.z);
        mesh.scale.set(d.sx, d.sy, d.sz);
        mesh.rotation.y = d.ry;
        mesh.castShadow = mesh.receiveShadow = true;
        this.scene.add(mesh);
        const obj = {mesh, type:d.type, color:d.color, kind:'model_placeholder', isModel:false, modelName:d.modelName, _baseScale:new THREE.Vector3(d.sx,d.sy,d.sz)};
        this.objects.push(obj);
      } else {
        const geo = this._geometryFor(d.kind);
        const mat = new THREE.MeshStandardMaterial({color:d.color, roughness:0.7, metalness:0.15, flatShading:true});
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(d.x, d.y, d.z);
        mesh.scale.set(d.sx, d.sy, d.sz);
        mesh.rotation.y = d.ry;
        mesh.castShadow = mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.objects.push({mesh, type:d.type, color:d.color, kind:d.kind, isModel:false, _baseScale:new THREE.Vector3(1,1,1)});
      }
    });
  }
}