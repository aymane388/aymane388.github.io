/* NUVIA V8 — vidéos natives découpées sur les tracés SVG; moteur de courbe conservé. */
(function(){
  'use strict';
  var host=document.getElementById('nuvia-curved-gallery');
  if(!host || host.dataset.ncgMediaReady)return;
  var svg=host.querySelector('.ncg-svg');
  if(!svg)return;
  var panels=Array.from(svg.querySelectorAll('.ncg-panel'));
  var glints=svg.querySelector('.ncg-glints'),defs=svg.querySelector('defs');
  if(!defs||!glints||panels.length!==9)return;
  host.dataset.ncgMediaReady='v8';
  var ns='http://www.w3.org/2000/svg',htmlns='http://www.w3.org/1999/xhtml';
  var style=document.createElement('style');
  style.textContent='#nuvia-curved-gallery .ncg-native-layer{pointer-events:none}'+
    '#nuvia-curved-gallery .ncg-native-foreign{pointer-events:none;overflow:hidden}'+
    '#nuvia-curved-gallery .ncg-native-foreign video{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}'+
    '#nuvia-curved-gallery .ncg-native-outline{fill:none;stroke:rgba(255,255,255,.82);stroke-width:1.25;vector-effect:non-scaling-stroke;pointer-events:none}';
  document.head.appendChild(style);
  var stack=document.createElementNS(ns,'g');
  stack.setAttribute('class','ncg-native-layer');svg.insertBefore(stack,glints);
  var files=['assets/nuvia-restaurant-pingpong.mp4','assets/nuvia-packaging-loop.mp4'];
  var pool=[],assign={};
  function play(video){
    if(!video.paused)return;
    var promise=video.play();
    if(promise&&promise.catch)promise.catch(function(){});
  }
  for(var type=0;type<2;type++)for(var copy=0;copy<2;copy++){
    var clip=document.createElementNS(ns,'clipPath');
    var id='ncg-native-mask-'+type+'-'+copy;
    clip.setAttribute('id',id);clip.setAttribute('clipPathUnits','userSpaceOnUse');
    var mask=document.createElementNS(ns,'path');clip.appendChild(mask);defs.appendChild(clip);
    var group=document.createElementNS(ns,'g');
    group.setAttribute('clip-path','url(#'+id+')');group.style.display='none';
    var foreign=document.createElementNS(ns,'foreignObject');
    foreign.classList.add('ncg-native-foreign');
    var video=document.createElementNS(htmlns,'video');
    video.muted=true;video.defaultMuted=true;video.autoplay=true;
    video.loop=true;video.playsInline=true;video.preload='auto';
    video.setAttribute('playsinline','');video.setAttribute('webkit-playsinline','');
    video.setAttribute('muted','');video.disablePictureInPicture=true;
    video.src=new URL(files[type],document.baseURI).href;
    foreign.appendChild(video);group.appendChild(foreign);stack.appendChild(group);
    var border=document.createElementNS(ns,'path');
    border.classList.add('ncg-native-outline');border.style.display='none';
    stack.appendChild(border);
    pool.push({type:type,copy:copy,video:video,group:group,foreign:foreign,
      border:border,mask:mask,index:-1});
    (function(v,offset){
      var started=false;
      function start(){if(started)return;started=true;play(v)}
      v.addEventListener('loadedmetadata',function(){
        if(offset>0&&isFinite(v.duration)&&v.duration>.5){
          try{v.currentTime=v.duration*offset}catch(e){start()}
        }else start();
      });
      v.addEventListener('seeked',start);
      v.addEventListener('canplay',function(){if(started)play(v)});
      v.addEventListener('error',function(){host.dataset.ncgMediaError='true'});
    })(video,copy?.46:0);
  }
  function release(item){
    if(item.index>=0){delete assign[item.index];item.index=-1}
    item.group.style.display='none';item.border.style.display='none';
  }
  function sync(){
    var needed=[];
    panels.forEach(function(panel,i){
      if(panel.style.display!=='none'&&Number(panel.style.opacity||0)>.002&&panel.getAttribute('d'))needed.push(i);
    });
    pool.forEach(function(item){
      if(item.index>=0&&needed.indexOf(item.index)<0)release(item);
    });
    needed.forEach(function(i){
      if(assign[i])return;
      var type=(i===8?1:i%2);
      var item=pool.find(function(t){return t.type===type&&t.index===-1});
      if(item){item.index=i;assign[i]=item}
    });
    pool.forEach(function(item){
      if(item.index<0)return;
      var panel=panels[item.index],path=panel.getAttribute('d');
      if(!path)return;
      var b;
      try{b=panel.getBBox()}catch(e){return}
      if(b.width<1||b.height<1)return;
      item.mask.setAttribute('d',path);item.border.setAttribute('d',path);
      item.foreign.setAttribute('x',b.x.toFixed(2));
      item.foreign.setAttribute('y',b.y.toFixed(2));
      item.foreign.setAttribute('width',b.width.toFixed(2));
      item.foreign.setAttribute('height',b.height.toFixed(2));
      item.group.style.opacity=panel.style.opacity||'1';
      item.border.style.opacity=panel.style.opacity||'1';
      item.group.style.display='';item.border.style.display='';
    });
    requestAnimationFrame(sync);
  }
  function resume(){pool.forEach(function(item){play(item.video)})}
  host.addEventListener('pointerdown',resume,{passive:true});
  document.addEventListener('visibilitychange',function(){if(!document.hidden)resume()});
  requestAnimationFrame(sync);
})();