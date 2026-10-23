/* NUVIA / Establishment R6 — progressive enhancements only; native anchors work without JS. */
(function(){
"use strict";
const root=document.getElementById("nuvia-react-navigation"),frost=document.getElementById("nv-nav-frost");
if(!root)return;
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
 item.addEventListener("pointerleave",event=>{
  if(hover.matches&&event.pointerType!=="touch")closeMenu();
 });
 button.addEventListener("click",()=>{
  if(button.dataset.href){location.href=button.dataset.href;return;}
  if(!menu){
   if(button.textContent.includes("About"))location.href="./index.html#nv-journey";
   else if(button.textContent.includes("Pricing"))location.href="./index.html#nv-contact-sequence";
   return;
  }
  const wasOpen=item.dataset.open==="true";closeMenu();
  if(hover.matches||!wasOpen){item.dataset.open="true";button.setAttribute("aria-expanded","true");}
 });
});
document.addEventListener("keydown",event=>{if(event.key==="Escape")closeMenu();});
document.addEventListener("click",event=>{if(!root.contains(event.target))closeMenu();});
root.querySelectorAll(".nv-menu a").forEach(link=>link.addEventListener("click",closeMenu));
/* Keep header contrast legible on the single dark chapter. */
const dark=document.getElementById("restaurants"),tabs=[...document.querySelectorAll('a[href^="#"][data-sector]')];
const sectors=tabs.map(a=>document.getElementById(a.dataset.sector));
let ticking=false;
function refresh(){
 ticking=false;
 const r=dark?.getBoundingClientRect();
 const isDark=!!r&&r.top<=86&&r.bottom>86;
 const contrast=isDark?"light":"ink";
 root.dataset.nvContrast=contrast;
 if(frost)frost.dataset.nvContrast=contrast;
 const line=innerHeight*.32;
 let active=-1;
 sectors.forEach((section,i)=>{if(section&&section.getBoundingClientRect().top<line)active=i});
 if(sectors.length&&sectors[sectors.length-1]?.getBoundingClientRect().bottom<line)active=-1;
 tabs.forEach((a,i)=>{
   if(i===active)a.setAttribute("aria-current","location");else a.removeAttribute("aria-current");
 });
}
function schedule(){if(!ticking){ticking=true;requestAnimationFrame(refresh);}}
addEventListener("scroll",schedule,{passive:true});addEventListener("resize",schedule,{passive:true});
addEventListener("hashchange",schedule);addEventListener("pageshow",schedule);
schedule();
/* Reveal content once, with an accessible no-JS baseline and reduced-motion support. */
const reduced=matchMedia("(prefers-reduced-motion: reduce)");
if(!reduced.matches&&"IntersectionObserver" in window){
 document.documentElement.classList.add("js-reveals");
 const observer=new IntersectionObserver(entries=>{
  entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add("revealed");observer.unobserve(entry.target)}});
 },{threshold:.03,rootMargin:"0px 0px 60px 0px"});
 document.querySelectorAll("[data-reveal]").forEach(el=>observer.observe(el));
}
/* Pause offscreen product films. Handle failures without covering the visual with errors. */
const media=[...document.querySelectorAll("video")];
media.forEach(video=>{
 video.muted=true;
 function fail(){video.pause();video.style.display="none";}
 video.addEventListener("error",fail);
 video.querySelector("source")?.addEventListener("error",fail);
});
function play(video){
 if(document.hidden||reduced.matches){video.pause();return;}
 const rect=video.getBoundingClientRect();
 if(rect.top<innerHeight&&rect.bottom>0){
  const p=video.play();if(p&&p.catch)p.catch(()=>{});
 }else video.pause();
}
if("IntersectionObserver" in window){
 const obs=new IntersectionObserver(entries=>{
  entries.forEach(entry=>entry.isIntersecting?play(entry.target):entry.target.pause());
 },{threshold:.02});
 media.forEach(video=>obs.observe(video));
}else media.forEach(play);
document.addEventListener("visibilitychange",()=>media.forEach(play));
if(reduced.addEventListener)reduced.addEventListener("change",()=>media.forEach(play));
addEventListener("pageshow",()=>media.forEach(play),{passive:true});
})();
