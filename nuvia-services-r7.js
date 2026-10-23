(function(){
"use strict";
/* NUVIA Services: enhancement only. The navigation is the original homepage DOM, CSS and script. */
const root=document.documentElement;
const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
if("IntersectionObserver"in window&&!reduced)root.classList.add("sn-js-motion");
const tabs=[...document.querySelectorAll(".sn-design-tabs [role=tab]")];
const panels=[
 {title:"Le Studio, votre terrain de création.",text:"Choisissez vos paramètres de personnalisation pour construire un sachet à l'image de votre établissement.",src:"./assets/nuvia-process/step-2.png",alt:"Sachets NUVIA : formats, palettes de couleurs et personnalisation",label:"01 / STUDIO",cta:"Explorer le Studio",href:"./index.html#usage"},
 {title:"Votre design, prêt à prendre forme.",text:"Vous possédez déjà vos fichiers graphiques ? Transmettez-nous votre univers pour préparer un sachet qui vous ressemble.",src:"./assets/nuvia-process/step-3.png",alt:"Sachet NUVIA personnalisé avec design validé",label:"02 / VOTRE DESIGN",cta:"Envoyer mon design",href:"./index.html#nv-contact-sequence"},
 {title:"Un regard créatif à vos côtés.",text:"Nos graphistes vous accompagnent pour concevoir un visuel cohérent avec votre identité, du premier concept à sa validation.",src:"./assets/nuvia-process/step-1.png",alt:"Lingette humide NUVIA et illustration de matières et senteurs",label:"03 / ACCOMPAGNEMENT",cta:"Parler de mon projet",href:"./index.html#nv-contact-sequence"}
];
const panel=document.getElementById("sn-demo-panel"),img=document.getElementById("sn-demo-photo"),title=document.getElementById("sn-demo-title"),description=document.getElementById("sn-demo-text"),label=document.getElementById("sn-demo-label"),cta=document.getElementById("sn-demo-cta");
let imageSwitchId=0;
function selectTab(i,focus){
 const d=panels[i],btn=tabs[i];if(!d||!btn)return;
 tabs.forEach((b,j)=>{b.setAttribute("aria-selected",String(i===j));b.tabIndex=i===j?0:-1;});
 if(panel)panel.setAttribute("aria-labelledby",btn.id);
 if(img){
  const requestId=++imageSwitchId;
  if(img.getAttribute("src")!==d.src&&!reduced){
   img.classList.add("sn-swapping");
   const preload=new Image();
   const change=()=>{
    if(requestId!==imageSwitchId)return;
    img.src=d.src;img.alt=d.alt;
    requestAnimationFrame(()=>img.classList.remove("sn-swapping"));
   };
   preload.onload=change;
   preload.onerror=change;
   preload.src=d.src;
  }else{
   img.src=d.src;img.alt=d.alt;img.classList.remove("sn-swapping");
  }
 }
 if(title)title.textContent=d.title;
 if(description)description.textContent=d.text;
 if(label)label.textContent=d.label;
 if(cta){cta.href=d.href;const arrow=cta.querySelector("span");cta.textContent=d.cta+" ";if(arrow)cta.appendChild(arrow);}
 if(focus)btn.focus();
}
tabs.forEach((button,i)=>{
 button.addEventListener("click",()=>selectTab(i,false));
 button.addEventListener("keydown",e=>{
  let target=i;
  if(e.key==="ArrowLeft")target=(i+tabs.length-1)%tabs.length;
  else if(e.key==="ArrowRight")target=(i+1)%tabs.length;
  else if(e.key==="Home")target=0;
  else if(e.key==="End")target=tabs.length-1;
  else return;
  e.preventDefault();selectTab(target,true);
 });
});
/* Product and hospitality films degrade gracefully to actual NUVIA project imagery. */
for(const section of document.querySelectorAll(".sn-has-video")){
 const video=section.querySelector("video");
 if(!video)continue;
 const fallback=()=>section.classList.add("is-fallback");
 video.addEventListener("error",fallback);
 video.querySelectorAll("source").forEach(source=>source.addEventListener("error",fallback));
 if(reduced){video.pause();video.removeAttribute("autoplay");}
}
const sections=["design","production","stockage","livraison"].map(id=>document.getElementById(id)).filter(Boolean);
const rail=[...document.querySelectorAll(".sn-side a[data-target]")];
const activate=id=>rail.forEach(a=>{
 if(a.dataset.target===id)a.setAttribute("aria-current","location");
 else a.removeAttribute("aria-current");
});
const hash=location.hash.slice(1);
if(sections.some(section=>section.id===hash))activate(hash);
if("IntersectionObserver"in window){
 const progress=new IntersectionObserver(entries=>{
  const current=entries.filter(e=>e.isIntersecting).sort((a,b)=>Math.abs(a.boundingClientRect.top-innerHeight*.36)-Math.abs(b.boundingClientRect.top-innerHeight*.36))[0];
  if(current)activate(current.target.id);
 },{rootMargin:"-21% 0px -43% 0px",threshold:0});
 sections.forEach(el=>progress.observe(el));
 if(!reduced){
  const reveal=new IntersectionObserver(entries=>entries.forEach(e=>{
   if(e.isIntersecting){e.target.classList.add("sn-visible");reveal.unobserve(e.target);}
  }),{rootMargin:"0px 0px -7% 0px",threshold:.05});
  document.querySelectorAll(".sn-reveal").forEach(el=>reveal.observe(el));
 }
}
window.addEventListener("hashchange",()=>{const id=location.hash.slice(1);if(sections.some(s=>s.id===id))activate(id);});
})();