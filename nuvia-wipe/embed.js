/* NUVIA V204 — production integration of the original site-ready engine.
 * The 3D geometry, V97 morphs, V98-A materials and physics live in engine.html.
 * This transparent layer never intercepts navigation or native scrolling.
 * The legacy 2D wipe remains visible until the real 3D model is ready.
 * Layer order: sky #sky=0 < this 3D iframe=1 < site main=2, nav and actions higher. */
(()=>{
  "use strict";
  const TOKEN="NUVIA_WIPE_V204";
  const script=document.currentScript;
  if(document.querySelector('iframe[data-nuvia-wipe-v204]'))return;
  const iframe=document.createElement("iframe");
  iframe.dataset.nuviaWipeV204="";
  iframe.title="Lingette NUVIA animée en 3D";
  iframe.setAttribute("aria-hidden","true");
  iframe.tabIndex=-1;
  iframe.setAttribute("scrolling","no");
  iframe.style.cssText="position:fixed!important;inset:0!important;width:100vw!important;height:100dvh!important;border:0!important;background:transparent!important;pointer-events:none!important;z-index:1!important;overflow:visible!important;opacity:0;transition:none!important;will-change:opacity,transform,clip-path;color-scheme:normal!important;";
  const engineUrl=new URL("engine.html",script?.src||document.baseURI);
  iframe.src=engineUrl.href;
  const video=document.getElementById("nv-video-footer");
  let protocolReady=false,modelReady=false,paused=false,destroyed=false;
  let modelReadyAt=0,fadeRAF=0;
  let frameLoaded=false,frameVerified=false,lastError="",lastSnapshot=null;
  const startedAt=performance.now();
  const status=()=>({
    iframePresent:iframe.isConnected,
    engineLoaded:frameLoaded,
    engineVerified:frameVerified,
    protocolReady,modelReady,active:!!window.__NUVIA_V204_ACTIVE,
    iframeOpacity:iframe.style.opacity,
    legacyFallback:!document.documentElement.classList.contains("nv-v204-model-ready"),
    engineUrl:engineUrl.href,lastError,lastSnapshot
  });
  let queuedDelta=0,scrollFrame=0,poll=0,lastWheel=-Infinity,lastY=window.scrollY,touchY=null;
  let videoVisible=false;
  const sendMessage=(type,extra={})=>{
    if(!protocolReady||!iframe.contentWindow)return;
    iframe.contentWindow.postMessage({channel:TOKEN,type,...extra},location.origin);
  };
  /* Pas de rafales liées à la molette ou au tactile : elles déplacent le
     tissu différemment selon le sens, et cassent la trajectoire réversible.
     Le moteur WebGL continue d'animer la matière indépendamment. */
  const sendGust=()=>{};
  const enqueue=(delta)=>{
    queuedDelta+=delta;
    if(scrollFrame)return;
    scrollFrame=requestAnimationFrame(()=>{
      scrollFrame=0;
      const d=queuedDelta;
      queuedDelta=0;
      sendGust(d);
    });
  };
  const smooth=(v)=>{v=Math.max(0,Math.min(1,v));return v*v*(3-2*v);};
  const setVisible=(visible,opacity)=>{
    if(destroyed)return;
    iframe.style.opacity=(modelReady&&visible?opacity:0).toFixed(3);
    if(modelReady&&paused===visible){
      // Le moteur interne utilise un bouton pause à bascule.
      paused=!visible;
      sendMessage("pause");
    }
  };
  const refreshVisibility=()=>{
    if(destroyed)return;
    const launch=window.NuviaWipeLaunch?.getState?.();
    const progress=launch?.progress||0;
    const finishing=launch?.fade||0;
    if(video){
      const r=video.getBoundingClientRect();
      videoVisible=r.top<innerHeight+60&&r.bottom>-60;
    }else videoVisible=false;
    // Blender se déploie sous le cadre ; la vraie 3D prend le relais en fondu.
    // Le paquet 2D original n'est pas déployé : le vrai moteur V204 doit
    // pouvoir apparaître dès le bord du cadre, même sans images Blender.
    const hasBitmapFallback=window.__NUVIA_WIPE_FALLBACK_AVAILABLE===true;
    const scrollBlend=hasBitmapFallback
      ?smooth((progress-.68)/.54)
      :smooth((progress-.015)/.14);
    const readyBlend=modelReady?smooth((performance.now()-modelReadyAt)/900):0;
    const blend=!videoVisible?scrollBlend*readyBlend:0;
    const opacity=blend*finishing;

    /* Centre du cadre vidéo -> centre de l'écran.
       Les coordonnées ne dépendent QUE du scroll et de la géométrie stable.
       Ainsi, descendre et remonter donnent exactement la même trajectoire. */
    const vh=Math.max(1,innerHeight), vw=Math.max(1,innerWidth);
    const frameX=Number.isFinite(launch?.x)?launch.x:vw*.5;
    const tabBottom=Number.isFinite(launch?.tabBottom)?launch.tabBottom:vh;
    const release=smooth((progress-.20)/.80);
    const recenter=smooth((progress-.65)/.60);
    const half=Math.max(78,Math.min(150,vh*.135));
    const targetX=frameX+(vw*.5-frameX)*recenter;
    const targetY=(tabBottom+half)*(1-release)+(vh*.54)*release;
    const shiftX=targetX-vw*.5;
    const shiftY=targetY-vh*.51;
    iframe.style.transform="translate3d("+shiftX.toFixed(2)+"px,"+shiftY.toFixed(2)+"px,0)";

    /* Clipping horizontal stable jusqu'au bas des onglets.
       Plus de polygone évidé pouvant couper la lingette sur un côté,
       ni de morceau visible à travers la barre translucide. */
    const clipTop=Math.max(0,Math.min(vh,tabBottom-shiftY));
    iframe.style.clipPath="inset("+clipTop.toFixed(2)+"px 0 0 0)";
    window.__NUVIA_V204_BLEND=opacity;
    document.documentElement.classList.toggle("nv-wipe-v204-full",modelReady&&opacity>=.999);
    setVisible(opacity>.001,opacity);
  };
  const animateArrival=()=>{
    fadeRAF=0;
    if(destroyed)return;
    refreshVisibility();
    if(modelReady&&performance.now()-modelReadyAt<1000){
      fadeRAF=requestAnimationFrame(animateArrival);
    }
  };
  const checkModel=()=>{
    if(destroyed||modelReady)return;
    try{
      const doc=iframe.contentDocument;
      if(frameLoaded&&!frameVerified){
        if(doc?.title?.includes("Wet Wipe V204 transparent motion engine")){
          frameVerified=true;
          protocolReady=true; // same-origin, full engine document loaded
        }else{
          lastError="Le document intégré ne correspond pas au moteur V204.";
          console.error("[NUVIA V204]",lastError,engineUrl.href);
          clearInterval(poll);
          return;
        }
      }
      const debug=iframe.contentWindow?.__NUVIA_DEBUG__;
      const snapshot=debug?.snapshot?.();
      if(snapshot)lastSnapshot=snapshot;
      if(!snapshot?.ready){
        if(frameLoaded&&performance.now()-startedAt>20000&&!lastError){
          lastError="Le moteur a chargé sa page, mais pas encore sa géométrie WebGL.";
          console.warn("[NUVIA V204]",lastError,"Diagnostic :",status());
        }
        return;
      }
      modelReady=true;
      modelReadyAt=performance.now();
      lastError="";
      window.__NUVIA_V204_ACTIVE=true;
      document.documentElement.classList.add("nv-v204-model-ready");
      clearInterval(poll);
      refreshVisibility();
      if(!fadeRAF)fadeRAF=requestAnimationFrame(animateArrival);
      console.info("[NUVIA V204] Géométrie réelle chargée, entrée depuis le cadre vidéo.");
    }catch(error){
      lastError=String(error);
      if(frameLoaded)console.warn("[NUVIA V204] Validation du moteur :",lastError);
    }
  };
  const onMessage=(event)=>{
    if(event.source!==iframe.contentWindow||event.origin!==location.origin)return;
    if(event.data?.channel===TOKEN&&event.data?.type==="ready"){
      protocolReady=true;
      checkModel();
    }
  };
  const onFrameLoad=()=>{
    frameLoaded=true;
    checkModel();
  };
  const onFrameError=()=>{
    lastError="Le document engine.html n'a pas pu être chargé.";
    console.error("[NUVIA V204]",lastError,engineUrl.href);
    clearInterval(poll);
  };
  const onWheel=(event)=>{
    lastWheel=performance.now();
    const px=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?innerHeight:1);
    enqueue(px);
  };
  const onScroll=()=>{
    const now=window.scrollY;
    const difference=now-lastY;
    lastY=now;
    if(performance.now()-lastWheel>250)enqueue(difference);
    refreshVisibility();
  };
  const onTouchStart=(event)=>{touchY=event.touches.length===1?event.touches[0].clientY:null;};
  const onTouchMove=(event)=>{
    if(touchY===null||event.touches.length!==1)return;
    const pos=event.touches[0].clientY;
    enqueue(touchY-pos);
    touchY=pos;
    lastWheel=performance.now();
  };
  const onTouchEnd=()=>{touchY=null;};
  const onResize=()=>refreshVisibility();
  function bind(){
    if(destroyed)return;
    // Register before navigating the heavy frame to avoid losing its handshake.
    window.addEventListener("message",onMessage);
    iframe.addEventListener("load",onFrameLoad);
    iframe.addEventListener("error",onFrameError);
    document.body.appendChild(iframe);
    window.addEventListener("wheel",onWheel,{passive:true});
    window.addEventListener("scroll",onScroll,{passive:true});
    window.addEventListener("resize",onResize,{passive:true});
    window.addEventListener("touchstart",onTouchStart,{passive:true});
    window.addEventListener("touchmove",onTouchMove,{passive:true});
    window.addEventListener("touchend",onTouchEnd,{passive:true});
    window.addEventListener("touchcancel",onTouchEnd,{passive:true});
    poll=setInterval(checkModel,240);
    refreshVisibility();
  }
  if(document.body)bind();else document.addEventListener("DOMContentLoaded",bind,{once:true});
  window.NuviaWipeV204={
    gustDown:()=>enqueue(250),gustUp:()=>enqueue(-250),
    setZIndex:()=>{ /* Reserved: V204 always remains behind site content. */ },
    getStatus:status,
    destroy:()=>{
      destroyed=true;
      clearInterval(poll);
      if(scrollFrame)cancelAnimationFrame(scrollFrame);
      if(fadeRAF)cancelAnimationFrame(fadeRAF);
      window.__NUVIA_V204_BLEND=0;
      for(const [type,fn] of [
        ["message",onMessage],["wheel",onWheel],["scroll",onScroll],
        ["resize",onResize],["touchstart",onTouchStart],
        ["touchmove",onTouchMove],["touchend",onTouchEnd],["touchcancel",onTouchEnd]
      ])window.removeEventListener(type,fn);
      iframe.removeEventListener("load",onFrameLoad);
      iframe.removeEventListener("error",onFrameError);
      iframe.remove();
      document.documentElement.classList.remove("nv-v204-model-ready","nv-wipe-v204-full");
      window.__NUVIA_V204_ACTIVE=false;
      delete window.NuviaWipeV204;
    }
  };
})();
