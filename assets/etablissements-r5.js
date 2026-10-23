/* NUVIA establishments R5 — use natural anchors, gentle progress, accessible menu. */
(function(){
"use strict";
const root=document.getElementById("nuvia-react-navigation"),frost=document.getElementById("nv-nav-frost");
const items=root?[...root.querySelectorAll(".nv-navitem")]:[];
const hover=matchMedia("(hover: hover) and (pointer: fine)");
function closeMenu(){
 items.forEach(it=>{it.dataset.open="false";const b=it.querySelector("button");if(b&&it.querySelector(".nv-menu"))b.setAttribute("aria-expanded","false")});
}
items.forEach(it=>{
 const menu=it.querySelector(".nv-menu"),button=it.querySelector("button");if(!button)return;
 it.addEventListener("pointerenter",e=>{if(!hover.matches||e.pointerType==="touch")return;closeMenu();if(menu){it.dataset.open="true";button.setAttribute("aria-expanded","true")}});
 it.addEventListener("pointerleave",e=>{if(hover.matches&&e.pointerType!=="touch")closeMenu()});
 button.addEventListener("click",()=>{
  if(button.dataset.href){location.href=button.dataset.href;return}
  if(!menu){
    if(button.textContent.includes("About"))location.href="./index.html#nv-journey";
    else if(button.textContent.includes("Pricing"))location.href="./index.html#nv-contact-sequence";
    return;
  }
  const was=it.dataset.open==="true";closeMenu();
  if(hover.matches||!was){it.dataset.open="true";button.setAttribute("aria-expanded","true")}
 });
});
if(root){
 root.querySelectorAll(".nv-menu a").forEach(a=>a.addEventListener("click",closeMenu));
 document.addEventListener("click",e=>{if(!root.contains(e.target))closeMenu()});
 document.addEventListener("keydown",e=>{if(e.key==="Escape")closeMenu()});
 root.dataset.nvContrast="ink";
 if(frost)frost.dataset.nvContrast="ink";
}
const anchors=[...document.querySelectorAll(".nv-section-link")];
const sections=anchors.map(link=>document.getElementById(link.getAttribute("href").slice(1)));
let queued=false;
function refreshActive(){
 queued=false;
 const threshold=innerHeight*.29+75;
 let selected=-1;
 sections.forEach((section,i)=>{if(section&&section.getBoundingClientRect().top<=threshold)selected=i});
 anchors.forEach((link,i)=>{if(selected===i)link.setAttribute("aria-current","location");else link.removeAttribute("aria-current")});
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(refreshActive)}
addEventListener("scroll",schedule,{passive:true});
addEventListener("resize",schedule,{passive:true});
addEventListener("hashchange",schedule);
schedule();
const reduced=matchMedia("(prefers-reduced-motion: reduce)");
if(!reduced.matches&&"IntersectionObserver" in window){
 document.documentElement.classList.add("js-reveal");
 const observer=new IntersectionObserver(entries=>{
  entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add("is-revealed");observer.unobserve(e.target)}});
 },{rootMargin:"0px 0px 40px 0px",threshold:.06});
 document.querySelectorAll("[data-reveal]").forEach(el=>observer.observe(el));
}
const films=[...document.querySelectorAll("video")];
films.forEach(video=>{
 video.muted=true;
 const source=video.querySelector("source");
 const error=()=>{video.pause();video.style.display="none"};
 video.addEventListener("error",error);
 if(source)source.addEventListener("error",error);
});
let mediaObserver=null;
function playIfVisible(video){
 const bounds=video.getBoundingClientRect();
 const vis=bounds.top<innerHeight&&bounds.bottom>0;
 if(document.hidden||reduced.matches||!vis){video.pause();return}
 const promise=video.play();if(promise&&promise.catch)promise.catch(()=>{});
}
if("IntersectionObserver" in window){
 mediaObserver=new IntersectionObserver(entries=>{
  entries.forEach(e=>{if(e.isIntersecting&&!document.hidden&&!reduced.matches)playIfVisible(e.target);else e.target.pause()});
 },{threshold:.03});
 films.forEach(v=>mediaObserver.observe(v));
}else films.forEach(playIfVisible);
document.addEventListener("visibilitychange",()=>films.forEach(playIfVisible));
if(reduced.addEventListener)reduced.addEventListener("change",()=>films.forEach(playIfVisible));
addEventListener("pageshow",()=>{schedule();films.forEach(playIfVisible)});
})();
