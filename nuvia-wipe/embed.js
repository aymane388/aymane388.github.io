/* NUVIA V204 — production integration of the original site-ready engine.
 * The 3D geometry, V97 morphs, V98-A materials and physics live in engine.html.
 * This transparent layer never intercepts navigation or native scrolling.
 * The legacy 2D wipe remains visible until the real 3D model is ready.
 * Layer order: sky #sky=0 < site main=2 < this 3D iframe=4 < nav and actions.
 * Only the SECOND section's video card and its tabs occlude the 3D cloth.
 * The card masks are released entirely once the card has left the viewport. */
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
  iframe.style.cssText="position:fixed!important;inset:0!important;width:100vw!important;height:100dvh!important;border:0!important;background:transparent!important;pointer-events:none!important;z-index:4!important;overflow:visible!important;opacity:0;transition:none!important;will-change:opacity,transform,clip-path;color-scheme:normal!important;";
  const engineUrl=new URL("engine.html",script?.src||document.baseURI);
  iframe.src=engineUrl.href;
  const video=document.getElementById("nv-video-footer");
  // Seule la carte blanche du formulaire doit occulter la lingette.
  // Ni le titre, ni l'arrière-plan de la section contact ne sont masqués.
  const contactCard=document.querySelector("#nv-contact-sequence .nv-contact-card");
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
  /* Restore the original V204 scroll-to-physics gust channel.
     The scroll-linked carrier stays centered/reversible; the actual
     cloth is once again pulled and deformed by wheel/touch/scroll.
     A smooth ramp near the video edge avoids a sudden physics kick
     while the cloth is still emerging from beneath the tabs. */
  const sendGust=(delta)=>{
    if(!protocolReady||!modelReady||paused||videoVisible||
       !Number.isFinite(delta)||Math.abs(delta)<.01)return;
    const launch=window.NuviaWipeLaunch?.getState?.();
    if(!launch?.ready||launch.fade<=0)return;
    const progress=launch.progress||0;
    const strength=smooth((progress-.18)/.72);
    if(strength<=0)return;
    sendMessage("gust",{
      deltaY:Math.max(-550,Math.min(550,delta*strength))
    });
  };
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
    /* La transparence est pilotée seulement par le chargement du moteur
       et les vraies limites du site. La carte cache le tissu par géométrie :
       plus de fondu anticipé avant que le tissu ne l'atteigne. */
    const readyBlend=modelReady?smooth((performance.now()-modelReadyAt)/900):0;
    const scrollEntrance=smooth(progress/.06);
    const opacity=(!videoVisible?readyBlend*scrollEntrance*finishing:0);

    /* Trajectoire scroll déterministe : on part DERRIÈRE la carte, pas sous
       une ligne de coupe pleine largeur. Le centre reste aligné au cadre. */
    const vh=Math.max(1,innerHeight), vw=Math.max(1,innerWidth);
    const frameX=Number.isFinite(launch?.x)?launch.x:vw*.5;
    const frameBottom=Number.isFinite(launch?.frameBottom)?launch.frameBottom:vh;
    const release=smooth((progress-.50)/.72);
    const recenter=smooth((progress-.65)/.60);
    const half=Math.max(90,Math.min(155,vh*.17));
    const entry=smooth(progress/.62);
    const attachedY=frameBottom-half+entry*(half*2);
    const targetX=frameX+(vw*.5-frameX)*recenter;
    const targetY=attachedY*(1-release)+(vh*.54)*release;
    const shiftX=targetX-vw*.5;
    const shiftY=targetY-vh*.51;
    iframe.style.transform="translate3d("+shiftX.toFixed(2)+"px,"+shiftY.toFixed(2)+"px,0)";

    /* La lingette reste devant les sections éditoriales, mais passe derrière
       la carte vidéo, ses onglets et la SEULE carte blanche du formulaire.
       Aucun masque de section, aucun clipping sur toute la page. */
    iframe.style.clipPath="none";
    const formRect=contactCard?.getBoundingClientRect();
    const cardRects=[
      [launch?.frameLeft,launch?.frameTop,launch?.frameRight,launch?.frameBottom],
      [launch?.tabLeft,launch?.tabTop,launch?.tabRight,launch?.tabBottom],
      [formRect?.left,formRect?.top,formRect?.right,formRect?.bottom]
    ];
    const activeRects=cardRects.filter(([x1,y1,x2,y2])=>
      [x1,y1,x2,y2].every(Number.isFinite)&&
      x2>x1&&y2>y1&&x2>0&&x1<vw&&y2>0&&y1<vh
    );
    const canExclude=typeof CSS!=="undefined"&&
      (CSS.supports("mask-composite","exclude")||
       CSS.supports("-webkit-mask-composite","xor"));
    if(canExclude&&activeRects.length){
      // Le premier calque couvre tout le viewport du moteur ;
      // chaque calque suivant ne retranche QUE sa carte visible.
      const holes=activeRects.map(([x1,y1,x2,y2])=>({
        x:x1-shiftX-1,y:y1-shiftY-1,
        w:Math.max(1,x2-x1+2),h:Math.max(1,y2-y1+2)
      }));
      const masks=Array(holes.length+1).fill("linear-gradient(#000,#000)");
      const maskPositions=["0px 0px",...holes.map(r=>r.x.toFixed(2)+"px "+r.y.toFixed(2)+"px")];
      const maskSizes=["100% 100%",...holes.map(r=>r.w.toFixed(2)+"px "+r.h.toFixed(2)+"px")];
      iframe.style.maskImage=masks.join(",");
      iframe.style.webkitMaskImage=masks.join(",");
      iframe.style.maskPosition=maskPositions.join(",");
      iframe.style.webkitMaskPosition=maskPositions.join(",");
      iframe.style.maskSize=maskSizes.join(",");
      iframe.style.webkitMaskSize=maskSizes.join(",");
      iframe.style.maskRepeat="no-repeat";
      iframe.style.webkitMaskRepeat="no-repeat";
      iframe.style.maskComposite=Array(holes.length).fill("exclude").join(",");
      iframe.style.webkitMaskComposite=Array(holes.length).fill("xor").join(",");
    }else{
      // Hors des cartes visibles, ne conserver aucun masque persistant.
      iframe.style.maskImage="none";
      iframe.style.webkitMaskImage="none";
      iframe.style.maskComposite="";
      iframe.style.webkitMaskComposite="";
    }
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
