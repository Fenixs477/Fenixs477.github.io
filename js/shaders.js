/* ============================================================
   shaders.js — GLSL: water (lakes), metallic tank, ground
   ============================================================ */

const SHADERS = {

  /* ---- Animated water for lakes (fixed: no more half-disappear) ----
     depthWrite:false + solid-ish opacity + fresnel so it reads as a
     surface regardless of viewing angle. */
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
      uFog:    { value: new THREE.Color(0x141414) },
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
};
