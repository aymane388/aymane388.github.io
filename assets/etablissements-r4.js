/* NUVIA — sectors R4: native routing, accessible selection, original mega-menu. */
(function(){
"use strict";
const root=document.getElementById("nuvia-react-navigation");
const frost=document.getElementById("nv-nav-frost");
const main=document.getElementById("solutions");
if(!root||!main)return;
const ids=["restaurants","hotellerie","evenementiel","groupes"];
const choices=[...document.querySelectorAll("[data-sector]")];
const scenes=ids.map(id=>document.getElementById(id));
const videos=[...document.querySelectorAll("video")];
const reduced=window.matchMedia("(prefers-reduced-motion: reduce)");
const mobile=window.matchMedia("(max-width:900px)");
let active="restaurants";
const items=[...root.querySelectorAll(".nv-navitem")];
const hover=window.matchMedia("(hover:hover) and (pointer:fine)");
function closeMenu(){
  items.forEach(item=>{
    item.dataset.open="false";
    const button=item.querySelector("button");
    if(button&&item.querySelector(".nv-menu"))button.setAttribute("aria-expanded","false");
  });
}
items.forEach(item=>{
 const menu=item.querySelector(".nv-menu"),button=item.querySelector("button");
 if(!button)return;
 item.addEventListener("pointerenter",e=>{
   if(!hover.matches||e.pointerType==="touch")return;
   closeMenu();
   if(menu){item.dataset.open="true";button.setAttribute("aria-expanded","true");}
 });
 item.addEventListener("pointerleave",e=>{if(hover.matches&&e.pointerType!=="touch")closeMenu();});
 button.addEventListener("click",()=>{
   if(button.dataset.href){location.href=button.dataset.href;return;}
   if(!menu){
     if(button.textContent.includes("Pricing"))location.href="./index.html#nv-contact-sequence";
     if(button.textContent.includes("About"))location.href="./index.html#nv-journey";
     return;
   }
   const open=item.dataset.open==="true";closeMenu();
   if(!open||hover.matches){item.dataset.open="true";button.setAttribute("aria-expanded","true");}
 });
});
document.addEventListener("click",e=>{if(!root.contains(e.target))closeMenu();});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeMenu();});
function updateVideos(){
 videos.forEach(video=>{
   const inHiddenScene=!!video.closest(".nv-scene[hidden]");
   const rect=video.getBoundingClientRect();
   const visible=!inHiddenScene&&rect.bottom>0&&rect.top<window.innerHeight;
   if(reduced.matches||document.hidden||!visible){video.pause();return;}
   const play=video.play();if(play&&play.catch)play.catch(()=>{});
 });
}
function focusScene(id,behavior){
 const target=mobile.matches?document.querySelector(".nv-stage-right"):main;
 if(!target)return;
 const offset=mobile.matches?15:80;
 const top=Math.max(0,window.scrollY+target.getBoundingClientRect().top-offset);
 window.scrollTo({top,behavior:reduced.matches?"instant":behavior||"smooth"});
}
function selectSector(id,opts){
 if(!ids.includes(id))return;
 opts=opts||{};
 active=id;
 scenes.forEach((scene,i)=>{scene.hidden=ids[i]!==id;});
 choices.forEach(choice=>{
   if(choice.dataset.sector===id)choice.setAttribute("aria-current","true");
   else choice.removeAttribute("aria-current");
 });
 main.dataset.active=id;
 if(opts.history&&window.location.hash!=="#"+id)history.pushState({sector:id},"","#"+id);
 updateVideos();
 if(opts.scroll)requestAnimationFrame(()=>focusScene(id,opts.behavior));
}
choices.forEach(link=>{
 link.addEventListener("click",event=>{
   const id=link.dataset.sector;if(!ids.includes(id))return;
   event.preventDefault();selectSector(id,{history:true,scroll:true});closeMenu();
 });
});
root.querySelectorAll('.nv-menu a[href^="#"]').forEach(link=>{
 link.addEventListener("click",event=>{
   const id=link.hash.slice(1);
   if(!ids.includes(id))return;
   event.preventDefault();selectSector(id,{history:true,scroll:true});closeMenu();
 });
});
root.querySelectorAll(".nv-menu a").forEach(link=>link.addEventListener("click",closeMenu));
window.addEventListener("hashchange",()=>{
 const id=decodeURIComponent(window.location.hash.slice(1));
 if(ids.includes(id))selectSector(id,{scroll:true});
});
window.addEventListener("popstate",()=>{
 const id=decodeURIComponent(window.location.hash.slice(1));
 selectSector(ids.includes(id)?id:ids[0],{scroll:true});
});
videos.forEach(video=>{
 video.muted=true;
 if(video.classList.contains("nv-sector-video")){
   const makeVisible=()=>{if(video.videoWidth>0)video.classList.add("is-ready")};
   video.addEventListener("loadeddata",makeVisible);
   video.addEventListener("canplay",makeVisible);
   const failure=()=>{video.style.display="none";video.closest(".nv-scene")?.classList.add("nv-video-failed")};
   video.addEventListener("error",failure);
   video.querySelector("source")?.addEventListener("error",failure);
   if(video.readyState>=2)makeVisible();
 }
});
let raf=0;
function refresh(){
 raf=0;
 const visual=document.querySelector(".nv-stage-right").getBoundingClientRect();
 const ink=!(mobile.matches&&visual.top<72&&visual.bottom>72);
 root.dataset.nvContrast=ink?"ink":"light";
 if(frost)frost.dataset.nvContrast=ink?"ink":"light";
 updateVideos();
}
function schedule(){if(!raf)raf=requestAnimationFrame(refresh);}
window.addEventListener("scroll",schedule,{passive:true});
window.addEventListener("resize",schedule,{passive:true});
document.addEventListener("visibilitychange",schedule);
if(reduced.addEventListener)reduced.addEventListener("change",schedule);
const initial=decodeURIComponent(window.location.hash.slice(1));
selectSector(ids.includes(initial)?initial:ids[0],{scroll:false});
refresh();
if(ids.includes(initial)){
 window.addEventListener("load",()=>focusScene(initial,"instant"),{once:true});
}else{
 window.addEventListener("load",schedule,{once:true});
}
})();
