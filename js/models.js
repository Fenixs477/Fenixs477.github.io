/* ============================================================
   models.js — GLTF / Collada loader + cache. Tries to load the 
   real tank model from mini_tank_legends_models/<name>.gltf or
   .dae; if missing it falls back to the cube body+turret.
   Uses Three.js GLTFLoader or ColladaLoader.
   ============================================================ */

const Models = {
  _cache: {},        // key -> {gltf:Scene|null, tried:bool}
  _loader: null,
  _colladaLoader: null,
  _available: null,  // null = not yet probed

  loader(){
    if(!this._loader){
      if(window.THREE && window.THREE.GLTFLoader){
        this._loader = new THREE.GLTFLoader();
      } else if(window.GLTFLoader){
        this._loader = new GLTFLoader();
      } else {
        this._loader = null; // addon not present; cube fallback always
      }
    }
    return this._loader;
  },

  colladaLoader(){
    if(!this._colladaLoader){
      if(window.THREE && window.THREE.ColladaLoader){
        this._colladaLoader = new THREE.ColladaLoader();
      } else if(window.ColladaLoader){
        this._colladaLoader = new ColladaLoader();
      } else {
        this._colladaLoader = null;
      }
    }
    return this._colladaLoader;
  },

  /* Probe which model files exist. We can't list a dir from the
     browser, so we HEAD each candidate URL once and cache the result. */
  async probe(names){
    const out = {};
    await Promise.all(names.map(async n=>{
      // Check .gltf first, then .dae
      out[n] = await this._exists(CONFIG.MODEL_DIR + n + '.gltf');
      if(!out[n]) out[n] = await this._exists(CONFIG.MODEL_DIR + n + '.dae');
    }));
    this._available = out;
    return out;
  },

  _exists(url){
    return new Promise(res=>{
      try{
        const xhr = new XMLHttpRequest();
        xhr.open('HEAD', url, true);
        xhr.onload = ()=> res(xhr.status>=200 && xhr.status<300);
      // Some servers don't allow HEAD; fall back to GET range
        xhr.onerror = ()=> this._getProbe(url).then(res);
        xhr.send();
      }catch(e){ res(false); }
    });
  },
  _getProbe(url){
    return new Promise(res=>{
      try{
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.onreadystatechange = ()=>{ if(xhr.readyState>=2){ res(xhr.status<400); xhr.abort(); } };
        xhr.onerror = ()=> res(false);
        xhr.send();
      }catch(e){ res(false); }
    });
  },

  hasModel(name){
    return !!(this._available && this._available[name]);
  },

  /* Load a model async; returns a Promise<THREE.Group|null> */
  load(name){
    if(this._cache[name]) return Promise.resolve(this._cache[name].gltf && this._clone(name));
    this._cache[name] = {gltf:null, tried:false};
    if(!this.hasModel(name)){
      this._cache[name].tried = true;
      return Promise.resolve(null);
    }
    // Try .gltf first
    const loader = this.loader();
    if(loader){
      return new Promise(resolve=>{
        loader.load(
          CONFIG.MODEL_DIR + name + '.gltf',
          (gltf)=>{
            this._cache[name].gltf = gltf.scene;
            this._cache[name].tried = true;
            resolve(this._clone(name));
          },
          undefined,
          (err)=>{
            // gltf failed, try .dae
            this._loadCollada(name).then(resolve).catch(()=> resolve(null));
          }
        );
      });
    }
    // No GLTF loader, try Collada
    return this._loadCollada(name);
  },

  _loadCollada(name){
    return new Promise(resolve=>{
      const loader = this.colladaLoader();
      if(!loader){ this._cache[name].tried = true; resolve(null); return; }
      loader.load(
        CONFIG.MODEL_DIR + name + '.dae',
        (result)=>{
          const scene = result.scene;
          if(!scene){ this._cache[name].tried = true; resolve(null); return; }
          // Scale the model appropriately for our game
          scene.scale.setScalar(0.5);
          scene.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
          this._cache[name].gltf = scene;
          this._cache[name].tried = true;
          resolve(this._clone(name));
        },
        undefined,
        (err)=>{ this._cache[name].tried = true; resolve(null); }
      );
    });
  },

  _clone(name){
    const src = this._cache[name].gltf;
    if(!src) return null;
    return src.clone(true);
  },
};