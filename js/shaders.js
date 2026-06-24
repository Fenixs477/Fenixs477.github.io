/* ============================================================
   shaders.js — GLSL: water, metallic tank, ground, walls, trees,
   bushes, shell, flame, explosion, star decal, fire particles
   ============================================================ */

const SHADERS = {

  /* ---- Animated water for lakes ---- */
  water: {
    uniforms: {
      uTime:    { value: 0 },
      uColorA:  { value: new THREE.Color(0x17668f) },
      uColorB:  { value: new THREE.Color(0x49c6e8) },
      uDeep:    { value: new THREE.Color(0x0b2740) },
    },
    vertexShader: /*glsl*/`
      uniform float uTime;
      varying vec3 vWorld;
      varying float vWave;
      void main(){
        vec3 p = position;
        float w = sin((p.x*0.4) + uTime*1.6) * 0.10
                + cos((p.z*0.5) + uTime*1.2) * 0.08;
        p.y += w;
        vWave = w;
        vec4 wp = modelMatrix * vec4(p,1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /*glsl*/`
      uniform float uTime;
      uniform vec3 uColorA, uColorB, uDeep;
      varying vec3 vWorld;
      varying float vWave;
      void main(){
        float n = sin(vWorld.x*0.25 + uTime*0.8)
                * sin(vWorld.z*0.25 - uTime*0.6);
        n = smoothstep(-0.4, 0.6, n);
        vec3 col = mix(uDeep, uColorA, n);
        col = mix(col, uColorB, smoothstep(0.2,1.0,vWave+0.3));
        float spec = pow(max(vWave,0.0), 6.0);
        col += vec3(0.7,0.85,1.0)*spec*0.6;
        gl_FragColor = vec4(col, 0.88);
      }
    `,
  },

  /* ---- Metallic tank shader (fresnel rim + panel sheen) ---- */
  tank: {
    uniforms: {
      uTime:{value:0},
      uColor:{value:new THREE.Color(0x8a8f98)},
    },
    vertexShader: /*glsl*/`
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main(){
        vNormal = normalize(normalMatrix * normal);
        vec4 wp = modelMatrix * vec4(position,1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /*glsl*/`
      uniform vec3 uColor;
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main(){
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 L = normalize(vec3(0.5,1.0,0.3));
        float diff = max(dot(N,L),0.0);
        float fres = pow(1.0 - max(dot(N,V),0.0), 3.0);
        vec3 base = uColor * (0.35 + 0.65*diff);
        base += vec3(0.9,0.95,1.0) * fres * 0.5;
        float line = step(0.93, fract(vWorld.x*0.5 + vWorld.z*0.5));
        base *= (1.0 - line*0.25);
        gl_FragColor = vec4(base, 1.0);
      }
    `,
  },

  /* ---- Ground (grass) shader ---- */
  ground: {
    uniforms: {
      tMap:    { value: null },
      uTime:   { value: 0 },
      uFog:    { value: new THREE.Color(0x2a2a2a) },
      uHalf:   { value: 300 },
    },
    vertexShader: /*glsl*/`
      varying vec2 vUv;
      varying vec3 vWorld;
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position,1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /*glsl*/`
      uniform sampler2D tMap;
      uniform float uTime, uHalf;
      uniform vec3 uFog;
      varying vec2 vUv;
      varying vec3 vWorld;
      float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      void main(){
        vec3 base = texture2D(tMap, vUv).rgb;
        float dither = (hash(floor(vWorld.xz*2.0))-0.5)*0.04;
        vec3 col = base + dither;
        float dist = length(vWorld.xz) / uHalf;
        float fog = smoothstep(0.6, 1.05, dist);
        col = mix(col, uFog, fog*0.8);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  },

  /* ---- Rock/wall shader (rough stone with slight color variation) ---- */
  rock: {
    uniforms: {
      uColor:   { value: new THREE.Color(0x55585c) },
      uColorDark: { value: new THREE.Color(0x3c3e42) },
    },
    vertexShader: /*glsl*/`
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying float vHeight;
      void main(){
        vNormal = normalize(normalMatrix * normal);
        vec4 wp = modelMatrix * vec4(position,1.0);
        vWorld = wp.xyz;
        vHeight = position.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /*glsl*/`
      uniform vec3 uColor;
      uniform vec3 uColorDark;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying float vHeight;
      void main(){
        vec3 N = normalize(vNormal);
        vec3 L = normalize(vec3(0.5,1.0,0.3));
        float diff = max(dot(N,L),0.0);
        // Height-based color variation (darker at bottom)
        float h = smoothstep(0.0, 5.0, vHeight);
        vec3 base = mix(uColorDark, uColor, h);
        // Rough surface via noise
        float n = fract(sin(dot(floor(vWorld.xz*1.5), vec2(12.9898,78.233)))*43758.5453);
        base += (n - 0.5) * 0.06;
        base *= (0.4 + 0.6 * diff);
        gl_FragColor = vec4(base, 1.0);
      }
    `,
  },

  /* ---- Rock dark variant (boulders) ---- */
  rockDark: {
    uniforms: {
      uColor: { value: new THREE.Color(0x3c3e42) },
    },
    vertexShader: /*glsl*/`
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying float vHeight;
      void main(){
        vNormal = normalize(normalMatrix * normal);
        vec4 wp = modelMatrix * vec4(position,1.0);
        vWorld = wp.xyz;
        vHeight = position.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /*glsl*/`
      uniform vec3 uColor;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying float vHeight;
      void main(){
        vec3 N = normalize(vNormal);
        vec3 L = normalize(vec3(0.5,1.0,0.3));
        float diff = max(dot(N,L),0.0);
        float grain = fract(sin(dot(floor(vWorld.xz*2.0), vec2(98.1,51.7)))*21345.3);
        vec3 col = uColor + (grain - 0.5) * 0.08;
        col *= (0.35 + 0.65 * diff);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  },

  /* ---- Tree trunk (woody, rough) ---- */
  treeTrunk: {
    uniforms: {
      uColor: { value: new THREE.Color(0x4a3320) },
    },
    vertexShader: /*glsl*/`
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main(){
        vNormal = normalize(normalMatrix * normal);
        vec4 wp = modelMatrix * vec4(position,1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /*glsl*/`
      uniform vec3 uColor;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main(){
        vec3 N = normalize(vNormal);
        vec3 L = normalize(vec3(0.5,1.0,0.3));
        float diff = max(dot(N,L),0.0);
        // Bark texture: vertical stripes + random grain
        float bark = sin(vWorld.y * 2.0 + vWorld.x * 0.5) * 0.5 + 0.5;
        float grain = fract(sin(dot(floor(vWorld.xz*4.0), vec2(51.3,27.9)))*59423.7);
        vec3 col = uColor * (0.7 + 0.3 * bark) + (grain - 0.5) * 0.05;
        col *= (0.3 + 0.7 * diff);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  },

  /* ---- Tree leaf canopy (soft, layered) ---- */
  treeLeaf: {
    uniforms: {
      uColor: { value: new THREE.Color(0x2e5d2a) },
      uTime:  { value: 0 },
    },
    vertexShader: /*glsl*/`
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying float vWind;
      void main(){
        vNormal = normalize(normalMatrix * normal);
        // Gentle wind sway
        vec3 p = position;
        float wind = sin(p.y * 0.8 + uTime * 1.3) * 0.03
                   + cos(p.x * 0.5 + uTime * 0.9) * 0.02;
        p.x += wind;
        p.z += wind * 0.6;
        vWind = wind;
        vec4 wp = modelMatrix * vec4(p,1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /*glsl*/`
      uniform vec3 uColor;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying float vWind;
      void main(){
        vec3 N = normalize(vNormal);
        vec3 L = normalize(vec3(0.5,1.0,0.3));
        float diff = max(dot(N,L),0.0);
        // Subsurface scattering approximation
        float ss = max(0.0, dot(N, -L)) * 0.3;
        vec3 col = uColor * (0.3 + 0.7 * diff + ss);
        // Add slight brightness variation for depth
        float variation = sin(vWorld.x * 0.7 + vWorld.y * 1.2 + vWorld.z * 0.5) * 0.1;
        col += variation;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  },

  /* ---- Tree leaf 2 (lighter variant) ---- */
  treeLeaf2: {
    uniforms: {
      uColor: { value: new THREE.Color(0x356b30) },
      uTime:  { value: 0 },
    },
    vertexShader: /*glsl*/`
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main(){
        vNormal = normalize(normalMatrix * normal);
        vec3 p = position;
        float wind = sin(p.y*0.8 + uTime*1.3)*0.03 + cos(p.x*0.5 + uTime*0.9)*0.02;
        p.x += wind; p.z += wind*0.6;
        vec4 wp = modelMatrix * vec4(p,1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /*glsl*/`
      uniform vec3 uColor;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main(){
        vec3 N = normalize(vNormal);
        vec3 L = normalize(vec3(0.5,1.0,0.3));
        float diff = max(dot(N,L),0.0);
        float ss = max(0.0, dot(N, -L)) * 0.3;
        vec3 col = uColor * (0.3 + 0.7 * diff + ss);
        float variation = sin(vWorld.x*0.7 + vWorld.y*1.2 + vWorld.z*0.5)*0.1;
        col += variation;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  },

  /* ---- Bush shader (dense foliage look) ---- */
  bush: {
    uniforms: {
      uColor:  { value: new THREE.Color(0x2c5a2a) },
      uColor2: { value: new THREE.Color(0x357a33) },
    },
    vertexShader: /*glsl*/`
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying float vNoise;
      void main(){
        vNormal = normalize(normalMatrix * normal);
        vec4 wp = modelMatrix * vec4(position,1.0);
        vWorld = wp.xyz;
        vNoise = fract(sin(dot(floor(vWorld.xz*2.3), vec2(87.1,41.7)))*34251.3);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /*glsl*/`
      uniform vec3 uColor;
      uniform vec3 uColor2;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying float vNoise;
      void main(){
        vec3 N = normalize(vNormal);
        vec3 L = normalize(vec3(0.5,1.0,0.3));
        float diff = max(dot(N,L),0.0);
        vec3 base = mix(uColor, uColor2, vNoise);
        // Depth shading
        float depth = sin(vWorld.x*1.3 + vWorld.y*0.8 + vWorld.z*1.1) * 0.15;
        base += depth;
        base *= (0.35 + 0.65 * diff);
        gl_FragColor = vec4(base, 1.0);
      }
    `,
  },

  /* ---- Big bush shader (darker, more solid) ---- */
  bushBig: {
    uniforms: {
      uColor: { value: new THREE.Color(0x1e4520) },
    },
    vertexShader: /*glsl*/`
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main(){
        vNormal = normalize(normalMatrix * normal);
        vec4 wp = modelMatrix * vec4(position,1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /*glsl*/`
      uniform vec3 uColor;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main(){
        vec3 N = normalize(vNormal);
        vec3 L = normalize(vec3(0.5,1.0,0.3));
        float diff = max(dot(N,L),0.0);
        float grain = fract(sin(dot(floor(vWorld.xz*1.8), vec2(91.3,43.7)))*43127.5);
        vec3 col = uColor + (grain - 0.5) * 0.06;
        col *= (0.3 + 0.7 * diff);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  },

  /* ---- Shell projectile (glowing tracer) ---- */
  shell: {
    uniforms: {
      uColor: { value: new THREE.Color(0xffdd44) },
      uTime:  { value: 0 },
    },
    vertexShader: /*glsl*/`
      uniform float uTime;
      varying float vAlpha;
      void main(){
        vec4 wp = modelMatrix * vec4(position,1.0);
        vAlpha = 0.7 + 0.3 * sin(uTime * 30.0 + position.x * 10.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /*glsl*/`
      uniform vec3 uColor;
      varying float vAlpha;
      void main(){
        vec3 col = uColor;
        // Hot center, glowing edges
        float glow = 1.0 - abs(vAlpha - 0.8) * 3.0;
        col += vec3(1.0, 0.6, 0.2) * max(0.0, glow);
        gl_FragColor = vec4(col, vAlpha * 0.9);
      }
    `,
  },

  /* ---- Flame cone projectile ---- */
  flame: {
    uniforms: {
      uColor1: { value: new THREE.Color(0xff6600) },
      uColor2: { value: new THREE.Color(0xffdd00) },
      uTime:   { value: 0 },
    },
    vertexShader: /*glsl*/`
      uniform float uTime;
      varying vec3 vLocal;
      varying float vLife;
      void main(){
        vec3 p = position;
        // Animate flame expansion
        float life = 1.0 - (uTime * 0.5);
        vLife = clamp(life, 0.0, 1.0);
        p.x *= 1.0 + (1.0 - vLife) * 0.5;
        p.z *= 1.0 + (1.0 - vLife) * 0.5;
        vLocal = p;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /*glsl*/`
      uniform vec3 uColor1;
      uniform vec3 uColor2;
      uniform float uTime;
      varying vec3 vLocal;
      varying float vLife;
      void main(){
        // Radial gradient from center
        float d = length(vLocal.xz) / 0.8;
        float alpha = smoothstep(1.0, 0.0, d) * vLife;
        vec3 col = mix(uColor1, uColor2, d);
        // Pulsing brightness
        float pulse = 0.8 + 0.2 * sin(uTime * 40.0 + vLocal.y * 5.0);
        col *= pulse;
        gl_FragColor = vec4(col, alpha * 0.7);
      }
    `,
  },

  /* ---- Explosion particle shader ---- */
  explosion: {
    uniforms: {
      uColor:  { value: new THREE.Color(0xff6622) },
      uTime:   { value: 0 },
    },
    vertexShader: /*glsl*/`
      uniform float uTime;
      attribute float aLife;
      attribute vec3 aVel;
      varying float vAlpha;
      void main(){
        float t = uTime;
        vec3 p = position + aVel * t;
        float life = 1.0 - t;
        vAlpha = clamp(life, 0.0, 1.0);
        float size = 0.3 + 0.5 * (1.0 - life);
        vec4 wp = modelMatrix * vec4(p, 1.0);
        gl_PointSize = size * (300.0 / -wp.z);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /*glsl*/`
      uniform vec3 uColor;
      varying float vAlpha;
      void main(){
        vec2 c = gl_PointCoord - vec2(0.5);
        float d = length(c);
        if(d > 0.5) discard;
        float glow = 1.0 - smoothstep(0.0, 0.5, d);
        vec3 col = uColor * (1.0 + glow);
        gl_FragColor = vec4(col, vAlpha * glow);
      }
    `,
  },

  /* ---- Fire particle shader (tank death) ---- */
  fireParticle: {
    uniforms: {
      uTime:  { value: 0 },
      uColor: { value: new THREE.Color(0xff7a1a) },
    },
    vertexShader: /*glsl*/`
      uniform float uTime;
      attribute float aPhase;
      varying float vBright;
      void main(){
        float flicker = 0.7 + 0.3 * sin(uTime * 8.0 + aPhase);
        vBright = flicker;
        float s = 1.0 + 0.2 * sin(uTime * 10.0 + aPhase);
        vec3 p = position * s;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        gl_PointSize = 0.8 * (300.0 / -wp.z);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /*glsl*/`
      uniform vec3 uColor;
      varying float vBright;
      void main(){
        vec2 c = gl_PointCoord - vec2(0.5);
        float d = length(c);
        if(d > 0.5) discard;
        float alpha = 1.0 - smoothstep(0.0, 0.5, d);
        vec3 col = uColor * (0.5 + 0.5 * vBright);
        col = mix(col, vec3(1.0, 0.9, 0.5), vBright * 0.3);
        gl_FragColor = vec4(col, alpha * 0.8);
      }
    `,
  },

  /* ---- Star decal (death marker) ---- */
  starDecal: {
    uniforms: {
      uColor: { value: new THREE.Color(0x000000) },
    },
    vertexShader: /*glsl*/`
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /*glsl*/`
      uniform vec3 uColor;
      varying vec2 vUv;
      void main(){
        // Sharp edges for star shape
        vec2 c = vUv - vec2(0.5);
        float d = length(c);
        float alpha = smoothstep(0.5, 0.48, d);
        gl_FragColor = vec4(uColor, alpha * 0.85);
      }
    `,
  },

  /* ---- Dirt rim around lakes ---- */
  dirtRim: {
    uniforms: {
      uColor: { value: new THREE.Color(0x5a4a2a) },
    },
    vertexShader: /*glsl*/`
      varying vec3 vWorld;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /*glsl*/`
      uniform vec3 uColor;
      varying vec3 vWorld;
      void main(){
        float grain = fract(sin(dot(floor(vWorld.xz*3.0), vec2(67.1,33.7)))*23451.3);
        vec3 col = uColor + (grain - 0.5) * 0.05;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  },

  /* ---- Tread/ tracks shader ---- */
  tread: {
    uniforms: {
      uColor: { value: new THREE.Color(0x222226) },
    },
    vertexShader: /*glsl*/`
      varying vec3 vWorld;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /*glsl*/`
      uniform vec3 uColor;
      varying vec3 vWorld;
      void main(){
        // Track lines
        float lines = step(0.5, fract(vWorld.z * 2.0));
        vec3 col = uColor * (0.8 + 0.2 * lines);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  },

  /* ---- Barrel shader (dark metal) ---- */
  barrel: {
    uniforms: {
      uColor: { value: new THREE.Color(0x2a2a2e) },
    },
    vertexShader: /*glsl*/`
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main(){
        vNormal = normalize(normalMatrix * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /*glsl*/`
      uniform vec3 uColor;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main(){
        vec3 N = normalize(vNormal);
        vec3 L = normalize(vec3(0.5, 1.0, 0.3));
        float diff = max(dot(N, L), 0.0);
        float spec = pow(max(dot(N, normalize(L + normalize(cameraPosition - vWorld))), 0.0), 16.0);
        vec3 col = uColor * (0.3 + 0.7 * diff);
        col += vec3(0.6) * spec * 0.5;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  },
};