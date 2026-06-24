/* ============================================================
   menu.js — All UI: main menu, multiplayer, host/join, hidden
   code (copy + 5s toast), collections, settings (rebindable keys
   + aim-line opacity/color + view-range width), map editor
   launcher, ESC menu, background images, host map selection.
   ============================================================ */

const Menu = {
  settings: loadSettings(),
  hostCfg: { maxPlayers:8, isPublic:true, fakePlayers:4, code:'------', useCustomMap:false },
  escOpen: false,
  editor: null,

  init(game){
    this.game = game;
    this.editor = new MapEditor();
    this._wireButtons();
    this._renderBinds();
    this._renderAimSettings();
    this._renderViewSettings();
    this._renderCollections();
    this._applyBackgrounds();
    this._wireEsc();
    this.show('menu-main');
  },

  show(id){
    document.querySelectorAll('.menu').forEach(m=> m.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
    document.getElementById('hud').classList.add('hidden');
  },
  showHUD(){ document.querySelectorAll('.menu').forEach(m=> m.classList.add('hidden'));
    document.getElementById('hud').classList.remove('hidden'); },

  toast(msg){
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(()=> t.classList.add('hidden'), 5000);
  },

  /* ---------- background images (auto-detect; falls back to gradient) ---------- */
  _applyBackgrounds(){
    const tryImg = (url, el)=>{
      const i = new Image();
      i.onload = ()=>{ el.style.backgroundImage = `linear-gradient(rgba(10,10,10,.55),rgba(10,10,10,.75)), url(${url})`; el.style.backgroundSize='cover'; el.style.backgroundPosition='center'; };
      i.onerror = ()=>{};
      i.src = url;
    };
    tryImg('tank party.jpg', document.getElementById('menu-main'));
    tryImg('tank party.jpg', document.getElementById('menu-multiplayer'));
  },

  /* ---------- wiring ---------- */
  _wireButtons(){
    document.querySelectorAll('[data-open]').forEach(b=>{
      b.onclick = ()=>{
        const t = b.dataset.open;
        if(t==='singleplayer'){ this.game.startSingleplayer(); return; }
        if(t==='editor'){ this.editor.show(); return; }
        this.show('menu-'+t);
      };
    });
    document.querySelectorAll('[data-back]').forEach(b=>{
      b.onclick = ()=> this.show(b.dataset.back);
    });

    // multiplayer screen
    document.getElementById('btn-host-room').onclick = ()=>{
      this.hostCfg.code = Net.staticCode();
      this._refreshHostCode();
      this._refreshMapChoice();
      this.show('menu-host');
    };
    document.getElementById('btn-join-room').onclick = async ()=>{
      this.show('menu-join');
      const list = document.getElementById('room-list');
      list.innerHTML = '<div class="muted">Searching for public rooms…</div>';
      const rooms = await Net.listPublicRooms();
      if(!rooms.length){
        list.innerHTML = '<div class="muted">No public rooms found.<br>You can host one, or join a hidden room with a code.</div>';
        return;
      }
      list.innerHTML='';
      rooms.forEach(r=>{
        const row = document.createElement('div'); row.className='room-row';
        row.innerHTML = `<div><div class="rn">Room ${r.code}</div><div class="rm">${r.name||'Public'} • ${r.count||0}/${r.max||8}</div></div><div>Join →</div>`;
        row.onclick = ()=> this.game.startClient(r.code);
        list.appendChild(row);
      });
    };
    document.getElementById('btn-join-hidden').onclick = ()=> this.show('menu-join-hidden');

    // host settings
    document.querySelectorAll('.seg-opt').forEach(o=>{
      o.onclick = ()=>{
        o.parentElement.querySelectorAll('.seg-opt').forEach(x=>x.classList.remove('active'));
        o.classList.add('active');
        this.hostCfg.isPublic = (o.dataset.vis === 'public');
        document.getElementById('host-code-row').classList.toggle('hidden', this.hostCfg.isPublic);
      };
    });
    document.getElementById('host-maxplayers').oninput = e=> this.hostCfg.maxPlayers = Math.max(1,Math.min(20,+e.target.value||1));
    document.getElementById('host-fakeplayers').oninput = e=> this.hostCfg.fakePlayers = Math.max(0,Math.min(20,+e.target.value||0));
    document.getElementById('host-code').onclick = ()=> this._copyCode();
    document.getElementById('btn-start-host').onclick = ()=>{
      this.game.setUseCustomMap(this.hostCfg.useCustomMap);
      this.game.startHost(this.hostCfg);
    };
    // map choice in host screen
    const mapBig = document.getElementById('host-map-big');
    const mapMine = document.getElementById('host-map-mine');
    if(mapBig) mapBig.onclick = ()=>{ this.hostCfg.useCustomMap=false; this._refreshMapChoice(); };
    if(mapMine) mapMine.onclick = ()=>{ this.hostCfg.useCustomMap=true; this._refreshMapChoice(); };

    // hidden join
    document.getElementById('btn-connect-hidden').onclick = ()=>{
      const code = document.getElementById('hidden-code-input').value.trim().toUpperCase();
      if(code.length<4){ this.toast('Enter a valid code'); return; }
      this.game.startClient(code);
    };
    document.getElementById('bigmap-close').onclick = ()=> document.getElementById('bigmap').classList.add('hidden');
    document.getElementById('minimap-btn').onclick = ()=> this.game.openBigMap();

    // ESC menu buttons
    document.getElementById('esc-yes').onclick = ()=>{ this._closeEsc(); this.game.leaveToMenu(); };
    document.getElementById('esc-no').onclick  = ()=> this._closeEsc();
  },

  _refreshHostCode(){
    document.getElementById('host-code').textContent = this.hostCfg.code;
    document.getElementById('host-code-row').classList.toggle('hidden', this.hostCfg.isPublic);
  },
  _refreshMapChoice(){
    const big = document.getElementById('host-map-big');
    const mine = document.getElementById('host-map-mine');
    if(!big || !mine) return;
    big.classList.toggle('selected', !this.hostCfg.useCustomMap);
    mine.classList.toggle('selected', this.hostCfg.useCustomMap);
    mine.classList.toggle('disabled', !hasCustomMap());
    if(!hasCustomMap() && this.hostCfg.useCustomMap){ this.hostCfg.useCustomMap=false; big.classList.add('selected'); }
  },

  async _copyCode(){
    try{
      await navigator.clipboard.writeText(this.hostCfg.code);
      this.toast('Copied to clipboard');
    }catch(e){
      const ta=document.createElement('textarea'); ta.value=this.hostCfg.code;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      this.toast('Copied to clipboard');
    }
  },

  /* ---------- ESC menu (works anywhere) ---------- */
  _wireEsc(){
    window.addEventListener('keydown', e=>{
      if(e.code!=='Escape') return;
      // ignore ESC while typing in an input
      if(document.activeElement && /input|textarea/i.test(document.activeElement.tagName)) return;
      // ignore if editor is open (editor handles its own ESC)
      if(this.editor && this.editor.open) return;
      // ignore if a big map is open
      if(!document.getElementById('bigmap').classList.contains('hidden')){
        document.getElementById('bigmap').classList.add('hidden'); return;
      }
      this.toggleEsc();
    });
  },
  toggleEsc(){
    if(this.escOpen){ this._closeEsc(); }
    else{
      document.getElementById('esc-menu').classList.remove('hidden');
      this.escOpen = true;
    }
  },
  _closeEsc(){
    document.getElementById('esc-menu').classList.add('hidden');
    this.escOpen = false;
  },

  /* ---------- settings binds ---------- */
  _renderBinds(){
    const wrap = document.getElementById('bind-list');
    wrap.innerHTML='';
    Object.keys(DEFAULT_BINDS).forEach(action=>{
      const row = document.createElement('div'); row.className='bind-row';
      row.innerHTML = `<div class="bl">${DEFAULT_BINDS[action].label}</div><div class="bind-key" data-action="${action}">${this._keyLabel(this.settings.binds[action])}</div>`;
      wrap.appendChild(row);
    });
    wrap.querySelectorAll('.bind-key').forEach(el=>{
      el.onclick = async ()=>{
        el.classList.add('binding'); el.textContent='Press a key / wheel…';
        const captured = await Input.captureBind();
        this.settings.binds[el.dataset.action] = captured;
        saveSettings(this.settings);
        el.classList.remove('binding');
        el.textContent = this._keyLabel(captured);
        this.game.applySettings(this.settings);
      };
    });
  },
  _keyLabel(k){
    if(k==='LMB') return 'LMB';
    if(k==='WheelUp') return 'Wheel ↑';
    if(k==='WheelDown') return 'Wheel ↓';
    if(k==='Space') return 'Space';
    if(k.startsWith('Key')) return k.slice(3);
    if(k.startsWith('Arrow')) return k.slice(5)+' arrow';
    return k;
  },

  /* ---------- aim line settings ---------- */
  _renderAimSettings(){
    const wrap = document.getElementById('aim-settings');
    if(!wrap) return;
    wrap.innerHTML = `
      <label>Trajectory line opacity: <span id="aim-op-val">${Math.round(this.settings.aimLineOpacity*100)}%</span></label>
      <input type="range" id="aim-op" min="0" max="100" value="${Math.round(this.settings.aimLineOpacity*100)}">
      <label>Trajectory line color</label>
      <input type="color" id="aim-color" value="${this.settings.aimLineColor}">`;
    document.getElementById('aim-op').oninput = e=>{
      this.settings.aimLineOpacity = +e.target.value/100;
      document.getElementById('aim-op-val').textContent = e.target.value+'%';
      saveSettings(this.settings); this.game.applySettings(this.settings);
    };
    document.getElementById('aim-color').oninput = e=>{
      this.settings.aimLineColor = e.target.value;
      saveSettings(this.settings); this.game.applySettings(this.settings);
    };
  },

  /* ---------- view-range settings (opacity + color + WIDTH) ---------- */
  _renderViewSettings(){
    const wrap = document.getElementById('view-settings');
    if(!wrap) return;
    const w = Math.round(this.settings.viewRangeWidth * 100);
    wrap.innerHTML = `
      <label>View-range circle opacity: <span id="view-op-val">${Math.round(this.settings.viewRangeOpacity*100)}%</span></label>
      <input type="range" id="view-op" min="0" max="100" value="${Math.round(this.settings.viewRangeOpacity*100)}">
      <label>View-range circle color</label>
      <input type="color" id="view-color" value="${this.settings.viewRangeColor}">
      <label>View-range circle width (0% = thin ring, 100% = fat ring): <span id="view-width-val">${w}%</span></label>
      <input type="range" id="view-width" min="0" max="100" value="${w}">`;
    document.getElementById('view-op').oninput = e=>{
      this.settings.viewRangeOpacity = +e.target.value/100;
      document.getElementById('view-op-val').textContent = e.target.value+'%';
      saveSettings(this.settings); this.game.applySettings(this.settings);
    };
    document.getElementById('view-color').oninput = e=>{
      this.settings.viewRangeColor = e.target.value;
      saveSettings(this.settings); this.game.applySettings(this.settings);
    };
    document.getElementById('view-width').oninput = e=>{
      this.settings.viewRangeWidth = +e.target.value/100;
      document.getElementById('view-width-val').textContent = e.target.value+'%';
      saveSettings(this.settings); this.game.applySettings(this.settings);
    };
  },

  /* ---------- collections ---------- */
  _renderCollections(){
    const grid = document.getElementById('tank-grid');
    grid.innerHTML='';
    TANK_ORDER.forEach(id=>{
      const t = TANKS[id];
      const card = document.createElement('div');
      card.className='tank-card'+(id===this.settings.selectedTank?' selected':'');
      card.dataset.id=id;
      card.innerHTML = `
        <div class="tank-preview">
          <svg viewBox="0 0 80 50" width="80" height="50">
            <rect x="8" y="28" width="64" height="14" rx="3" fill="#${(t.color).toString(16).padStart(6,'0')}"/>
            <rect x="26" y="16" width="32" height="14" rx="3" fill="#${(t.turretColor).toString(16).padStart(6,'0')}"/>
            <rect x="54" y="20" width="22" height="4" fill="#222"/>
          </svg>
        </div>
        <div class="tank-name">${t.name}</div>
        <div class="tank-tier">Collection ${t.collection}</div>
        <div class="tank-stats">HP ${t.hp} • DMG ${t.damage}<br>Speed ${t.speed} • Reload ${t.reload}s</div>`;
      card.onclick = ()=>{
        this.settings.selectedTank = id;
        saveSettings(this.settings);
        this._renderCollections();
        this.game.applySettings(this.settings);
      };
      grid.appendChild(card);
    });
  },

  showConnecting(msg){ document.getElementById('connecting').querySelector('h2').textContent = msg||'Connecting…';
    document.getElementById('connecting').classList.remove('hidden'); },
  hideConnecting(){ document.getElementById('connecting').classList.add('hidden'); },
};