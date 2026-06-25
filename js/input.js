/* ============================================================
   input.js — keyboard + mouse + wheel + TOUCH (mobile dual joystick),
   with rebindable keybinds.
   ============================================================ */

class TouchJoystick {
  constructor(containerId, opts={}){
    this.container = document.getElementById(containerId);
    if(!this.container) return;
    this.opts = Object.assign({
      size: 130,
      deadZone: 0.08,
      fireOnMax: false,   // turret: fire when moved
    }, opts);

    this.active = false;
    this.touchId = -1;
    this.dx = 0;  // -1 to 1
    this.dy = 0;
    this.firing = false;

    this._build();
    this._bindEvents();
  }

  _build(){
    this.container.innerHTML = '';
    this.container.style.width = this.opts.size+'px';
    this.container.style.height = this.opts.size+'px';

    // Outer ring
    this.outer = document.createElement('div');
    this.outer.className = 'joystick-outer';
    this.container.appendChild(this.outer);

    // Inner knob
    this.knob = document.createElement('div');
    this.knob.className = 'joystick-knob';
    this.outer.appendChild(this.knob);

    this._half = this.opts.size / 2;
    this._maxDist = this._half - 12;
  }

  _bindEvents(){
    const el = this.container;

    const getPos = (touches, id) => {
      for(let t of touches){
        if(t.identifier === id) return {x: t.clientX, y: t.clientY};
      }
      return null;
    };

    const onStart = (e) => {
      e.preventDefault();
      for(let t of e.changedTouches){
        if(!this.active){
          this.active = true;
          this.touchId = t.identifier;
          this._centerX = t.clientX;
          this._centerY = t.clientY;
          this._updateKnob(0, 0);
          this.dx = 0;
          this.dy = 0;
        }
      }
    };

    const onMove = (e) => {
      e.preventDefault();
      const pos = getPos(e.changedTouches, this.touchId);
      if(!pos) return;

      let dx = pos.x - this._centerX;
      let dy = pos.y - this._centerY;
      let dist = Math.hypot(dx, dy);
      
      // Clamp to max distance
      if(dist > this._maxDist){
        dx = dx / dist * this._maxDist;
        dy = dy / dist * this._maxDist;
        dist = this._maxDist;
      }

      this._updateKnob(dx, dy);

      // Normalize to -1..1
      let nx = dx / this._maxDist;
      let ny = dy / this._maxDist;

      // Dead zone
      if(Math.abs(nx) < this.opts.deadZone) nx = 0;
      if(Math.abs(ny) < this.opts.deadZone) ny = 0;

      this.dx = nx;
      this.dy = ny;

      // Auto-fire for turret joystick
      if(this.opts.fireOnMax && (Math.abs(nx) > 0.1 || Math.abs(ny) > 0.1)){
        this.firing = true;
      }
    };

    const onEnd = (e) => {
      for(let t of e.changedTouches){
        if(t.identifier === this.touchId){
          this.active = false;
          this.touchId = -1;
          this.dx = 0;
          this.dy = 0;
          this.firing = false;
          this._updateKnob(0, 0);
        }
      }
    };

    el.addEventListener('touchstart', onStart, {passive: false});
    el.addEventListener('touchmove', onMove, {passive: false});
    el.addEventListener('touchend', onEnd, {passive: false});
    el.addEventListener('touchcancel', onEnd, {passive: false});
  }

  _updateKnob(dx, dy){
    if(this.knob){
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  }

  getValue(){
    return {x: this.dx, y: this.dy, firing: this.firing};
  }
}

class Input {
  constructor(settings){
    this.settings = settings;
    this.keys = {};
    this.mouse = { x:0, y:0, ndcX:0, ndcY:0, down:false };
    this.binds = settings.binds;
    this.wheel = 0;

    // Touch state
    this.isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    this._touchInput = { throttle: 0, turn: 0, turretAngle: 0, fire: false };
    this._moveJoystick = null;
    this._turretJoystick = null;

    window.addEventListener('keydown', e=>{
      this.keys[e.code]=true;
      if(e.code==='Space') e.preventDefault();
    });
    window.addEventListener('keyup',   e=>{ this.keys[e.code]=false; });

    const canvas = ()=> document.querySelector('#game-root canvas');
    document.addEventListener('mousemove', e=>{
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      const c = canvas();
      if(c){
        const r = c.getBoundingClientRect();
        this.mouse.ndcX =  ((e.clientX-r.left)/r.width )*2-1;
        this.mouse.ndcY = -((e.clientY-r.top )/r.height)*2+1;
      }
    });
    document.addEventListener('mousedown', e=>{ if(e.button===0) this.mouse.down=true; });
    document.addEventListener('mouseup',   e=>{ if(e.button===0) this.mouse.down=false; });

    window.addEventListener('wheel', e=>{
      this.wheel += (e.deltaY < 0 ? 1 : -1);
    }, {passive:true});

    window.addEventListener('blur', ()=>{ this.keys={}; this.mouse.down=false; });

    // Initialize touch joysticks if on mobile
    if(this.isTouchDevice){
      // Create joystick containers if they don't exist
      let moveEl = document.getElementById('joystick-move');
      let turretEl = document.getElementById('joystick-turret');
      
      if(!moveEl){
        moveEl = document.createElement('div');
        moveEl.id = 'joystick-move';
        moveEl.className = 'joystick-container joystick-left';
        document.body.appendChild(moveEl);
      }
      if(!turretEl){
        turretEl = document.createElement('div');
        turretEl.id = 'joystick-turret';
        turretEl.className = 'joystick-container joystick-right';
        document.body.appendChild(turretEl);
      }

      this._moveJoystick = new TouchJoystick('joystick-move', {
        size: 130,
        fireOnMax: false,
      });

      this._turretJoystick = new TouchJoystick('joystick-turret', {
        size: 110,
        fireOnMax: true,   // auto-fire when moved
      });
      
      // Hide joysticks initially (only show during gameplay)
      this.setJoysticksVisible(false);
    }
  }

  /* Show/hide joystick overlays (called from game start/stop) */
  setJoysticksVisible(visible){
    const moveEl = document.getElementById('joystick-move');
    const turretEl = document.getElementById('joystick-turret');
    if(moveEl) moveEl.classList.toggle('joystick-hidden', !visible);
    if(turretEl) turretEl.classList.toggle('joystick-hidden', !visible);
  }

  consumeWheel(){
    const w = this.wheel; this.wheel = 0; return w;
  }

  static captureBind(){
    return new Promise(resolve=>{
      const kd = (e)=>{ cleanup(); resolve(e.code); };
      const md = (e)=>{ if(e.button!==0) return; cleanup(); resolve('LMB'); };
      const wh = (e)=>{ cleanup(); resolve(e.deltaY < 0 ? 'WheelUp' : 'WheelDown'); };
      function cleanup(){
        window.removeEventListener('keydown', kd);
        window.removeEventListener('mousedown', md);
        window.removeEventListener('wheel', wh);
      }
      window.addEventListener('keydown', kd);
      window.addEventListener('mousedown', md);
      window.addEventListener('wheel', wh, {passive:true});
    });
  }

  pressed(action){
    const k = this.binds[action];
    if(k==='LMB') return this.mouse.down;
    if(k==='WheelUp' || k==='WheelDown') return false;
    return !!this.keys[k];
  }

  consumeZoom(){
    let z = this.consumeWheel();
    if(this.keys[this.binds.zoomIn] ) z += 1;
    if(this.keys[this.binds.zoomOut]) z -= 1;
    return z;
  }

  /* Get touch input for the current frame */
  getTouchInput(){
    if(!this._moveJoystick && !this._turretJoystick){
      return null;
    }

    const move = this._moveJoystick ? this._moveJoystick.getValue() : {x:0, y:0, firing:false};
    const turret = this._turretJoystick ? this._turretJoystick.getValue() : {x:0, y:0, firing:false};

    // Movement: up/down = throttle, left/right = turn
    const throttle = -move.y;  // up = positive
    const turn = move.x;

    // Turret: x axis controls turret direction
    const turretAngle = turret.x;
    const fire = turret.firing || turret.y < -0.3;

    return {
      throttle: throttle,
      turn: turn,
      turretAngle: turretAngle,
      fire: fire,
      isTouch: this.isTouchDevice,
    };
  }
}