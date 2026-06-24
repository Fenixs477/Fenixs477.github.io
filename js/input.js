/* ============================================================
   input.js — keyboard + mouse + wheel, with rebindable keybinds.
   ============================================================ */

class Input {
  constructor(settings){
    this.settings = settings;
    this.keys = {};
    this.mouse = { x:0, y:0, ndcX:0, ndcY:0, down:false };
    this.binds = settings.binds; // {forward:'KeyW',...}
    this.wheel = 0;             // accumulated wheel delta since last consume

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

    // wheel → zoom (sign normalized: up = zoom in)
    window.addEventListener('wheel', e=>{
      this.wheel += (e.deltaY < 0 ? 1 : -1);
    }, {passive:true});

    window.addEventListener('blur', ()=>{ this.keys={}; this.mouse.down=false; });
  }

  /* consume accumulated wheel steps (positive = zoom in, negative = zoom out) */
  consumeWheel(){
    const w = this.wheel; this.wheel = 0; return w;
  }

  /* rebind an action; resolves with: a key code, 'LMB', or 'WheelUp'/'WheelDown' */
  static captureBind(){
    return new Promise(resolve=>{
      const kd = (e)=>{
        cleanup();
        resolve(e.code);
      };
      const md = (e)=>{
        if(e.button!==0) return;
        cleanup(); resolve('LMB');
      };
      const wh = (e)=>{
        cleanup();
        resolve(e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
      };
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

  /* Returns the "pressed" state for an action.
     Zoom actions are handled via consumeZoom() — not here. */
  pressed(action){
    const k = this.binds[action];
    if(k==='LMB') return this.mouse.down;
    if(k==='WheelUp' || k==='WheelDown') return false; // edge-triggered elsewhere
    return !!this.keys[k];
  }

  /* Returns +1 / -1 / 0 for zoom this frame.
     Zoom-in bind = wheel up OR the zoomIn key; zoom-out bind = wheel down OR zoomOut key. */
  consumeZoom(){
    let z = this.consumeWheel();
    if(this.keys[this.binds.zoomIn] ) z += 1;
    if(this.keys[this.binds.zoomOut]) z -= 1;
    return z;
  }
}
