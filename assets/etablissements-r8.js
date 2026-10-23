/* NUVIA / Établissements R8 — reusable original navigation, native anchors, media. */
(()=>{"use strict";
const nav=document.getElementById("nuvia-react-navigation");
const frost=document.getElementById("nv-nav-frost");
if(!nav)return;
const items=[...nav.querySelectorAll(".nv-navitem")];
const hover=matchMedia("(hover:hover) and (pointer:fine)");
const reduced=matchMedia("(prefers-reduced-motion: reduce)");
const darkRegions=[document.getElementById("restaurants"),document.getElementById("contact")].filter(Boolean);
const close=()=>items.forEach(item=>{
 item.dataset.open="false";
 const btn=item.querySelector("button");
 if(btn&&item.querySelector(".nv-menu"))btn.setAttribute("aria-expanded","false");
});
items.forEach(item=>{
 const btn=item.querySelector("button"),menu=item.querySelector(".nv-menu");
 if(!btn)return;
 item.addEventListener("pointerenter",e=>{
  if(!hover.matches||e.pointerType==="touch")return;
  close();
  if(menu){item.dataset.open="true";btn.setAttribute("aria-expanded","true");}
 });
 item.addEventListener("pointerleave",e=>{if(hover.matches&&e.pointerType!=="touch")close()});
 btn.addEventListener("click",()=>{
  if(btn.dataset.href){location.href=btn.dataset.href;return;}
  if(!menu){
   if(btn.textContent.includes("About"))location.href="./index.html#nv-journey";
   else if(btn.textContent.includes("Pricing"))location.href="./index.html#nv-contact-sequence";
   return;
  }
  const open=item.dataset.open==="true";
  close();
  if(!open||hover.matches){item.dataset.open="true";btn.setAttribute("aria-expanded","true");}
 });
});
nav.querySelectorAll(".nv-menu a").forEach(a=>a.addEventListener("click",close));
document.addEventListener("click",e=>{if(!nav.contains(e.target))close();});
document.addEventListener("keydown",e=>{if(e.key==="Escape")close();});
/* Nav contrast is based on the real viewport, never a guessed color. */
let ticking=false;
function update(){
 ticking=false;
 const line=76;
 const isDark=darkRegions.some(region=>{
  const rect=region.getBoundingClientRect();
  return rect.top<=line&&rect.bottom>line;
 });
 const contrast=isDark?"light":"ink";
 nav.dataset.nvContrast=contrast;
 if(frost)frost.dataset.nvContrast=contrast;
}
function requestUpdate(){if(!ticking){ticking=true;requestAnimationFrame(update)}}
addEventListener("scroll",requestUpdate,{passive:true});
addEventListener("resize",requestUpdate,{passive:true});
addEventListener("pageshow",requestUpdate);
addEventListener("hashchange",requestUpdate);
update();
/* Video decoding is bounded by viewport. All scenes have static image/gradient fallbacks. */
const videos=[...document.querySelectorAll("video")];
videos.forEach(video=>{
 video.muted=true;
 const failed=()=>{video.pause();video.style.display="none";};
 video.addEventListener("error",failed);
 video.querySelector("source")?.addEventListener("error",failed);
});
const visible=video=>{
 const rect=video.getBoundingClientRect();
 return rect.bottom>0&&rect.top<innerHeight;
};
function evaluate(video){
 if(document.hidden||reduced.matches||!visible(video)){video.pause();return;}
 const play=video.play();
 if(play&&typeof play.catch==="function")play.catch(()=>{});
}
if("IntersectionObserver" in window){
 const observer=new IntersectionObserver(entries=>{
  entries.forEach(entry=>{
   if(entry.isIntersecting)evaluate(entry.target);
   else entry.target.pause();
  });
 },{threshold:.03});
 videos.forEach(video=>observer.observe(video));
}else videos.forEach(evaluate);
document.addEventListener("visibilitychange",()=>videos.forEach(evaluate));
if(reduced.addEventListener)reduced.addEventListener("change",()=>videos.forEach(evaluate));
addEventListener("pageshow",()=>videos.forEach(evaluate));
})();