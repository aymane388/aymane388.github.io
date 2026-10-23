/* NUVIA R7 — navigation, chapter navigation and resilient motion. */
(()=>{"use strict";
const root=document.getElementById("nuvia-react-navigation");
if(!root)return;
const frost=document.getElementById("nv-nav-frost");
const navItems=[...root.querySelectorAll(".nv-navitem")];
const hover=matchMedia("(hover:hover) and (pointer:fine)");
function closeMenu(){
 navItems.forEach(item=>{
  item.dataset.open="false";
  const button=item.querySelector("button");
  if(button&&item.querySelector(".nv-menu"))button.setAttribute("aria-expanded","false");
 });
}
navItems.forEach(item=>{
 const menu=item.querySelector(".nv-menu"),button=item.querySelector("button");
 if(!button)return;
 item.addEventListener("pointerenter",event=>{
  if(!hover.matches||event.pointerType==="touch")return;
  closeMenu();
  if(menu){item.dataset.open="true";button.setAttribute("aria-expanded","true");}
 });
 item.addEventListener("pointerleave",event=>{if(hover.matches&&event.pointerType!=="touch")closeMenu();});
 button.addEventListener("click",()=>{
  if(button.dataset.href){location.href=button.dataset.href;return;}
  if(!menu){
   if(button.textContent.includes("About"))location.href="./index.html#nv-journey";
   else if(button.textContent.includes("Pricing"))location.href="./index.html#nv-contact-sequence";
   return;
  }
  const isOpen=item.dataset.open==="true";
  closeMenu();
  if(hover.matches||!isOpen){item.dataset.open="true";button.setAttribute("aria-expanded","true");}
 });
});
root.querySelectorAll(".nv-menu a").forEach(link=>link.addEventListener("click",closeMenu));
document.addEventListener("keydown",event=>{if(event.key==="Escape")closeMenu();});
document.addEventListener("click",event=>{if(!root.contains(event.target))closeMenu();});
/* This page keeps the navigation on light surfaces at all scroll positions. */
root.dataset.nvContrast="ink";
if(frost)frost.dataset.nvContrast="ink";
const reduced=matchMedia("(prefers-reduced-motion:reduce)");
/* Visible by default. Only progressively reveal if IntersectionObserver can run. */
if(!reduced.matches&&"IntersectionObserver" in window){
 document.documentElement.classList.add("js-motion");
 const targets=[...document.querySelectorAll("[data-in]")];
 const enter=new IntersectionObserver(entries=>{
  entries.forEach(entry=>{
   if(entry.isIntersecting){entry.target.classList.add("nv-visible");enter.unobserve(entry.target);}
  });
 },{threshold:.04,rootMargin:"0px 0px 60px 0px"});
 targets.forEach(element=>enter.observe(element));
}
/* All links remain valid HTML anchors even without JS. */
const chapterIds=["restaurants","hotellerie","evenementiel","groupes"];
const chapters=chapterIds.map(id=>document.getElementById(id));
let raf=0;
const progress=()=>{
 raf=0;const edge=innerHeight*.35;let last=-1;
 chapters.forEach((section,index)=>{
  if(section&&section.getBoundingClientRect().top<edge&&section.getBoundingClientRect().bottom>0)last=index;
 });
 root.dataset.activeSector=last>=0?chapterIds[last]:"";
};
const requestProgress=()=>{if(!raf)raf=requestAnimationFrame(progress);};
addEventListener("scroll",requestProgress,{passive:true});
addEventListener("resize",requestProgress);
addEventListener("hashchange",()=>{requestProgress();closeMenu();});
requestProgress();
/* Video playback follows viewport and foreground; broken video falls back to the underlying stage. */
const films=[...document.querySelectorAll("video")];
films.forEach(video=>{
 video.muted=true;
 const onError=()=>{video.pause();video.style.display="none";};
 video.addEventListener("error",onError);
 const source=video.querySelector("source");
 if(source)source.addEventListener("error",onError);
});
const play=(video)=>{
 if(document.hidden||reduced.matches){video.pause();return;}
 const rect=video.getBoundingClientRect();
 if(rect.bottom>0&&rect.top<innerHeight){
  const result=video.play();
  if(result&&typeof result.catch==="function")result.catch(()=>{});
 }else video.pause();
};
if("IntersectionObserver" in window){
 const visibility=new IntersectionObserver(entries=>entries.forEach(entry=>{
  if(!entry.isIntersecting){entry.target.pause();return;}
  play(entry.target);
 }),{threshold:.02});
 films.forEach(video=>visibility.observe(video));
}else films.forEach(play);
document.addEventListener("visibilitychange",()=>films.forEach(play));
if(reduced.addEventListener)reduced.addEventListener("change",()=>films.forEach(play));
addEventListener("pageshow",()=>films.forEach(play));
})();