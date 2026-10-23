/* NUVIA V14 — Two persistent native HTML videos, synchronized to existing SVG panels. */
(function(){
  'use strict';
  var host=document.getElementById('nuvia-curved-gallery');
  var viewport=host&&host.querySelector('.ncg-viewport');
  var svg=viewport&&viewport.querySelector('.ncg-svg');
  if(!svg||host.dataset.nuviaVideos==='native-v2')return;
  var images=Array.from(svg.querySelectorAll('.ncg-artimage'));
  var panels=Array.from(svg.querySelectorAll('.ncg-panel'));
  if(images.length!==9||panels.length!==9)return;
  if(!window.CSS||!CSS.supports('clip-path','path("M 0 0 L 10 0 L 10 10 Z")'))return;
  host.dataset.nuviaVideos='native-v2';

  var styles=document.createElement('style');
  styles.textContent=[
    '#nuvia-curved-gallery .ncg-viewport>.ncg-svg{position:relative;z-index:2}',
    '#nuvia-curved-gallery .ncg-video-deck{position:absolute;inset:0;z-index:1;pointer-events:none;overflow:hidden}',
    '#nuvia-curved-gallery .ncg-video-window{position:absolute;inset:0;pointer-events:none;overflow:hidden}',
    '#nuvia-curved-gallery .ncg-video-window video{position:absolute;display:block;object-fit:cover;max-width:none;pointer-events:none;background:transparent}',
    '#nuvia-curved-gallery .ncg-artimage[data-nuvia-video-active="1"]{visibility:hidden!important}'
  ].join('');
  document.head.appendChild(styles);
  var deck=document.createElement('div');
  deck.className='ncg-video-deck';
  deck.setAttribute('aria-hidden','true');
  viewport.insertBefore(deck,svg);
  var specs=[
    {slot:0,file:'assets/nuvia-restaurant-pingpong.mp4'},
    {slot:1,file:'assets/nuvia-packaging-loop.mp4'}
  ];
  var media=specs.map(function(spec){
    var mask=document.createElement('div');
    mask.className='ncg-video-window';
    mask.style.clipPath='inset(100%)';
    var video=document.createElement('video');
    video.autoplay=true;video.loop=true;video.muted=true;
    video.defaultMuted=true;video.playsInline=true;video.preload='auto';
    video.disablePictureInPicture=true;
    ['autoplay','loop','muted','playsinline','webkit-playsinline'].forEach(function(key){video.setAttribute(key,'')});
    video.src=new URL(spec.file,document.baseURI).href;
    mask.appendChild(video);deck.appendChild(mask);
    var item={slot:spec.slot,mask:mask,video:video,ready:false};
    function play(){
      if(!video.paused)return;
      var p=video.play();
      if(p&&p.catch)p.catch(function(err){host.dataset.nuviaVideoWarning=String(err.name||err)});
    }
    item.play=play;
    video.addEventListener('loadeddata',function(){item.ready=true;images[spec.slot].setAttribute('data-nuvia-video-active','1');play()});
    video.addEventListener('playing',function(){item.ready=true;images[spec.slot].setAttribute('data-nuvia-video-active','1')});
    video.addEventListener('canplay',play);
    video.addEventListener('error',function(){
      item.ready=false;images[spec.slot].removeAttribute('data-nuvia-video-active');
      host.dataset.nuviaVideoError=spec.file;mask.style.clipPath='inset(100%)';
    });
    play();
    return item;
  });
  function follow(){
    media.forEach(function(item){
      var image=images[item.slot],path=panels[item.slot].getAttribute('d');
      if(!item.ready||image.style.display==='none'||!path){
        item.mask.style.clipPath='inset(100%)';return;
      }
      item.mask.style.clipPath='path("'+path+'")';
      [['x','left'],['y','top'],['width','width'],['height','height']].forEach(function(pair){
        var value=image.getAttribute(pair[0]);
        if(value!==null)item.video.style[pair[1]]=value+'px';
      });
      item.mask.style.opacity=image.style.opacity||'1';
    });
    requestAnimationFrame(follow);
  }
  requestAnimationFrame(follow);
  host.addEventListener('pointerdown',function(){media.forEach(function(item){item.play()})},{passive:true});
  document.addEventListener('visibilitychange',function(){
    if(!document.hidden)media.forEach(function(item){item.play()});
  });
})();