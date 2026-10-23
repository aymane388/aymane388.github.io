/* NUVIA / Aceternity CloudShader: faithful standalone WebGL1 port.
 * Shader expressions and colors are taken from the supplied component.
 * Only the HERO section renders this scene; legacy canvas is a fallback.
 */
(function(){
  "use strict";
  const section=document.getElementById("entree");
  const canvas=document.getElementById("nv-cloudshader-canvas");
  if(!section||!canvas||canvas.dataset.initialized==="1")return;
  const mq=matchMedia("(prefers-reduced-motion: reduce)");
  const config={speed:1,count:6,cloudColor:"#fbf8f2",skyTopColor:"#3876ba",skyBottomColor:"#8cbfe8"};
  let gl=null,program=null,buffer=null,shaders=[],observer=null,resizeObserver=null;
  let raf=0,visible=false,ready=false,destroyed=false,frames=0,lastDraw=0,elapsed=0,lastClock=0,error="";
  const uniform={};
  const status=()=>({ready,visible,frames,renderWidth:canvas.width,renderHeight:canvas.height,
    cloudCount:config.count,speed:config.speed,reason:error});
  window.NuviaCloudShader={getStatus:status,config:config};
  function color3(s){
    const v=s.trim();
    if(v[0]==="#"){
      const h=v.slice(1),f=h.length===3?h.split("").map(c=>c+c):[h.slice(0,2),h.slice(2,4),h.slice(4,6)];
      return f.map(x=>parseInt(x,16)/255);
    }
    const rgb=v.match(/[\d.]+/g);
    return rgb?.length>=3?rgb.slice(0,3).map(Number).map(n=>n/255):[.95,.95,.95];
  }
  function shader(type,source){
    const sh=gl.createShader(type);
    if(!sh)throw Error("Impossible de créer le shader");
    gl.shaderSource(sh,source);gl.compileShader(sh);
    if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)){
      const message=gl.getShaderInfoLog(sh)||"Unknown compile error";
      gl.deleteShader(sh);
      throw Error("Cloud shader GLSL: "+message);
    }
    shaders.push(sh);
    return sh;
  }
  function fit(){
    if(!gl||destroyed)return;
    const r=section.getBoundingClientRect();
    const width=Math.max(1,Math.round(r.width)),height=Math.max(1,Math.round(r.height));
    // Billow + domain-warp sampling is expensive. Resolution budget avoids
    // starving the V204 wipe and the existing cloud/cloth experiences.
    const mobile=width<=700;
    const maxPixels=mobile?320000:820000;
    const ratio=Math.min(devicePixelRatio||1,mobile?1.1:1.5,
      Math.sqrt(maxPixels/(width*height)));
    const w=Math.max(1,Math.round(width*ratio)),h=Math.max(1,Math.round(height*ratio));
    if(canvas.width!==w)canvas.width=w;
    if(canvas.height!==h)canvas.height=h;
    gl.viewport(0,0,w,h);
    gl.uniform2f(uniform.res,w,h);
    canvas.dataset.resolution=w+"x"+h;
  }
  function render(now){
    raf=0;
    if(!ready||!visible||destroyed||document.hidden)return;
    // 30fps shader: other site animations are kept responsive.
    if(now-lastDraw>=32||frames===0){
      if(lastClock&&!mq.matches)elapsed+=Math.min((now-lastClock)/1000,.10)*config.speed;
      lastClock=now;lastDraw=now;
      const c=color3(config.cloudColor),top=color3(config.skyTopColor),
        bottom=color3(config.skyBottomColor);
      gl.uniform1f(uniform.time,mq.matches?0:elapsed);
      gl.uniform1f(uniform.count,Math.max(1,Math.min(6,config.count)));
      gl.uniform3f(uniform.cloud,...c);
      gl.uniform3f(uniform.skyTop,...top);
      gl.uniform3f(uniform.skyBottom,...bottom);
      gl.drawArrays(gl.TRIANGLES,0,3);
      frames++;
      if(frames%30===0)canvas.dataset.frames=String(frames);
    }
    if(!mq.matches)raf=requestAnimationFrame(render);
  }
  function stop(){
    if(raf)cancelAnimationFrame(raf);
    raf=0;lastClock=0;
  }
  function updateVisibility(){
    if(destroyed)return;
    const r=section.getBoundingClientRect();
    const active=r.bottom>-80&&r.top<innerHeight+80;
    visible=active&&!document.hidden;
    stop();
    if(visible&&ready)raf=requestAnimationFrame(render);
  }
  function cleanup(){
    stop();observer?.disconnect();resizeObserver?.disconnect();
    if(gl){
      if(buffer)gl.deleteBuffer(buffer);
      if(program)gl.deleteProgram(program);
      shaders.forEach(sh=>gl.deleteShader(sh));
    }
  }
  try{
    gl=canvas.getContext("webgl",{alpha:false,antialias:false,premultipliedAlpha:false,
      depth:false,stencil:false,preserveDrawingBuffer:false});
    if(!gl)throw Error("WebGL1 indisponible");
    const v=shader(gl.VERTEX_SHADER,"\nattribute vec2 a_pos;\nvarying vec2 v_uv;\nvoid main() {\n  v_uv = a_pos * 0.5 + 0.5;\n  gl_Position = vec4(a_pos, 0.0, 1.0);\n}\n"),f=shader(gl.FRAGMENT_SHADER,"\nprecision highp float;\n\nvarying vec2 v_uv;\n\nuniform vec2 u_res;\nuniform float u_time;\nuniform float u_count;\nuniform vec3 u_cloud;\nuniform vec3 u_skyTop;\nuniform vec3 u_skyBottom;\n\nconst mat2 R = mat2(0.80, 0.60, -0.60, 0.80);\n\nfloat hash(vec2 p) {\n  return fract(sin(dot(p, vec2(41.31, 289.17))) * 26737.367);\n}\n\nfloat vnoise(vec2 p) {\n  vec2 i = floor(p);\n  vec2 f = fract(p);\n  f = f * f * (3.0 - 2.0 * f);\n  float a = hash(i);\n  float b = hash(i + vec2(1.0, 0.0));\n  float c = hash(i + vec2(0.0, 1.0));\n  float d = hash(i + vec2(1.0, 1.0));\n  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);\n}\n\nfloat fbm(vec2 p) {\n  float sum = 0.0;\n  float amp = 0.5;\n  for (int i = 0; i < 4; i++) {\n    sum += amp * vnoise(p);\n    p = R * p * 2.03 + 19.19;\n    amp *= 0.5;\n  }\n  return sum;\n}\n\n// billow noise: sharp puffy ridges, like cauliflower cloud tops\nfloat billow(vec2 p) {\n  float sum = 0.0;\n  float amp = 0.5;\n  for (int i = 0; i < 5; i++) {\n    sum += amp * (1.0 - abs(2.0 * vnoise(p) - 1.0));\n    p = R * p * 2.11 + 13.37;\n    amp *= 0.5;\n  }\n  return sum;\n}\n\n// raw density for one cloud at point p\nfloat cloudDensity(vec2 p, vec2 c, vec2 r, float seed, float t) {\n  vec2 q = p - c;\n\n  // envelope: dome above the center, flat base below\n  float ry = q.y > 0.0 ? r.y : r.y * 0.42;\n  float env = 1.0 - length(vec2(q.x / r.x, q.y / ry));\n  if (env < -0.35) return 0.0;\n\n  // domain-warped billow detail, moves with the cloud, evolves slowly\n  vec2 dp = q * (2.4 / r.x) + seed;\n  dp += 0.6 * vec2(\n    fbm(dp * 1.4 + t * 0.04),\n    fbm(dp * 1.4 + 7.7 - t * 0.03)\n  );\n  float detail = billow(dp * 1.6);\n\n  return env + (detail - 0.62) * 0.62;\n}\n\n// shades one cloud and blends it over the current color\nvec3 shadeCloud(vec3 color, vec3 sky, vec2 p, vec2 c, vec2 r, float seed, float t, float dist) {\n  float d = cloudDensity(p, c, r, seed, t);\n  if (d < 0.02) return color;\n\n  // sample density toward the sun (straight up) for self-shadowing\n  float dUp = cloudDensity(p + vec2(0.0, r.y * 0.55), c, r, seed, t);\n  float occl = clamp((dUp - d) * 1.1 + d * 0.55, 0.0, 1.0);\n\n  vec3 lit = u_cloud * 1.04;\n  vec3 shadow = mix(u_cloud * 0.60, sky, 0.38);\n  vec3 cloudCol = mix(lit, shadow, occl * 0.85);\n\n  float alpha = smoothstep(0.02, 0.38, d);\n\n  // silver lining on thin edges\n  float rim = smoothstep(0.02, 0.14, d) * (1.0 - smoothstep(0.14, 0.40, d));\n  cloudCol += rim * 0.10;\n\n  // atmospheric perspective: far clouds fade into the sky\n  cloudCol = mix(cloudCol, sky, dist * 0.35);\n  alpha *= mix(1.0, 0.8, dist);\n\n  return mix(color, cloudCol, alpha);\n}\n\n// one drifting cloud: horizontal wrap + gentle vertical bob\nvec3 cloudPass(vec3 color, vec3 sky, vec2 p, float aspect, float t,\n               float spd, float phase, float y, vec2 r, float seed, float dist) {\n  float cx = mix(-r.x - 0.25, aspect + r.x + 0.25, fract(t * spd + phase));\n  float cy = y + sin(t * 0.05 + phase * 6.2831) * 0.012;\n  return shadeCloud(color, sky, p, vec2(cx, cy), r, seed, t, dist);\n}\n\nvoid main() {\n  float aspect = u_res.x / u_res.y;\n  vec2 p = vec2(v_uv.x * aspect, v_uv.y);\n  float t = u_time;\n\n  vec3 sky = mix(u_skyBottom, u_skyTop, v_uv.y);\n  vec3 color = sky;\n\n  // faint haze band near the horizon\n  color = mix(color, u_skyBottom * 1.06, smoothstep(0.35, 0.0, v_uv.y) * 0.5);\n\n  // soft sun glow, upper area\n  vec2 sunPos = vec2(aspect * 0.78, 0.92);\n  float sunDist = length(p - sunPos);\n  color += vec3(1.0, 0.95, 0.82) * exp(-sunDist * sunDist * 5.0) * 0.28;\n\n  // thin cirrus streaks, stretched horizontally, high in the sky\n  float cirrusBand = smoothstep(0.55, 0.8, v_uv.y) * (1.0 - smoothstep(0.9, 1.0, v_uv.y));\n  if (cirrusBand > 0.01) {\n    float streak = fbm(vec2(p.x * 1.6 - t * 0.006, p.y * 12.0));\n    float wisp = smoothstep(0.52, 0.78, streak) * cirrusBand;\n    color = mix(color, u_cloud * 0.98, wisp * 0.35);\n  }\n\n  // far layer: small, high, slow\n  if (u_count > 5.5) {\n    color = cloudPass(color, sky, p, aspect, t, 0.006, 0.10, 0.84, vec2(0.20, 0.10), 43.7, 1.0);\n  }\n  if (u_count > 4.5) {\n    color = cloudPass(color, sky, p, aspect, t, 0.008, 0.62, 0.73, vec2(0.24, 0.12), 71.3, 0.85);\n  }\n\n  // middle layer\n  if (u_count > 3.5) {\n    color = cloudPass(color, sky, p, aspect, t, 0.011, 0.33, 0.60, vec2(0.34, 0.16), 17.3, 0.55);\n  }\n  if (u_count > 2.5) {\n    color = cloudPass(color, sky, p, aspect, t, 0.013, 0.80, 0.47, vec2(0.30, 0.15), 29.9, 0.45);\n  }\n\n  // near layer: big, low, fast\n  if (u_count > 1.5) {\n    color = cloudPass(color, sky, p, aspect, t, 0.016, 0.05, 0.35, vec2(0.46, 0.20), 91.1, 0.15);\n  }\n  color = cloudPass(color, sky, p, aspect, t, 0.020, 0.48, 0.20, vec2(0.56, 0.24), 57.2, 0.0);\n\n  gl_FragColor = vec4(color, 1.0);\n}\n");
    program=gl.createProgram();
    if(!program)throw Error("Programme WebGL indisponible");
    gl.attachShader(program,v);gl.attachShader(program,f);
    gl.bindAttribLocation(program,0,"a_pos");
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))
      throw Error("CloudShader link: "+(gl.getProgramInfoLog(program)||"unknown"));
    gl.useProgram(program);
    buffer=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    const uniforms={res:"u_res",time:"u_time",count:"u_count",cloud:"u_cloud",
      skyTop:"u_skyTop",skyBottom:"u_skyBottom"};
    Object.keys(uniforms).forEach(k=>uniform[k]=gl.getUniformLocation(program,uniforms[k]));
    ready=true;
    // Do this synchronously, before the 2D fallback's script executes.
    canvas.dataset.initialized="1";
    document.documentElement.classList.add("nv-cloudshader-active");
    fit();
    updateVisibility();
    if("ResizeObserver" in window){
      resizeObserver=new ResizeObserver(()=>{fit();if(mq.matches&&visible)render(performance.now());});
      resizeObserver.observe(section);
    }
    if("IntersectionObserver" in window){
      observer=new IntersectionObserver(()=>updateVisibility(),{rootMargin:"80px 0px",threshold:0});
      observer.observe(section);
    }
    addEventListener("resize",fit,{passive:true});
    document.addEventListener("visibilitychange",updateVisibility);
    if(mq.addEventListener)mq.addEventListener("change",()=>{
      stop();elapsed=0;if(visible)raf=requestAnimationFrame(render);
    });
    canvas.addEventListener("webglcontextlost",e=>{
      e.preventDefault();ready=false;stop();
      document.documentElement.classList.remove("nv-cloudshader-active");
      error="Contexte WebGL perdu. Recharger pour restaurer l'animation.";
    },{passive:false});
  }catch(e){
    error=String(e?.message||e);ready=false;cleanup();
    canvas.style.display="none";
    console.warn("[NUVIA CloudShader] Fallback to original cumulus:",error);
  }
})();
