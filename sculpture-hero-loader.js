/* Loader only; the supplied SculptureHero source and defaults are unmodified. */
const mount = document.getElementById("nuvia-sculpture-host");

if (mount) {
  let started = false;
  async function mountSculpture() {
    if (started) return;
    started = true;
    try {
      const [reactModule, domModule, sculptureModule] = await Promise.all([
        import("react"),
        import("react-dom/client"),
        import("./sculpture-hero.js")
      ]);
      const React = reactModule.default || reactModule;
      const { createRoot } = domModule;
      const SculptureHero = sculptureModule.default;
      // Only the original animated sculpture and its large, faint backdrop word.
      // NUVIA's own navigation and every other existing site section stay intact.
      createRoot(mount).render(React.createElement(SculptureHero, {
        showNav: false,
        eyebrow: "",
        headline: "",
        body: "",
        primaryCta: null,
        secondaryCta: null,
        hint: "",
        hintTouch: "",
        showCredit: false,
        themeToggle: false,
        theme: "light",
        background: "#FFFFFF",
        backdropText: "Nuvia"
      }));
    } catch (error) {
      console.error("[NUVIA] Sculpture Hero failed to load:", error);
      const image = document.createElement("img");
      image.src = "https://cdn.21st.dev/assets/mirror/ae/ae8c3de9003460e59182e950ccd345f68f27f9d0e4808b64c92c962a4eca7120.webp";
      image.alt = "Abstract sculpture of interwoven metallic filaments and particles";
      image.style.cssText = "position:absolute;left:50%;top:50%;width:min(100%,1400px);transform:translate(-50%,-50%);height:auto;";
      mount.appendChild(image);
    }
  }
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      mountSculpture();
    }, { rootMargin: "1100px 0px" });
    observer.observe(mount);
  } else {
    mountSculpture();
  }
}


/* Footer BRAND GLYPH: render the particle artwork itself into the logo's
   original 132 x 54 px position. No scaled/full-width SculptureHero section. */
(function(){
  const mount=document.getElementById("nv-footer-logo3d");
  if(!mount)return;
  let started=false;
  async function start(){
    if(started)return;
    started=true;
    try{
      const [reactModule,domModule,sculptureModule]=await Promise.all([
        import("react"),import("react-dom/client"),import("./sculpture-hero.js")
      ]);
      const React=reactModule.default||reactModule;
      const SculptureHero=sculptureModule.default;
      domModule.createRoot(mount).render(React.createElement(SculptureHero,{
        artOnly:true,
        showNav:false,eyebrow:"",headline:"",body:"",
        primaryCta:null,secondaryCta:null,hint:"",hintTouch:"",
        showCredit:false,themeToggle:false,
        theme:"light",background:"#FFFFFF",backdropText:"Nuvia",
        height:"100%",
        particleDensity:.32,
        interactive:true,strength:.65,radius:55,
        particleSpread:.55,turbulence:.6,liquid:.65,
        ambient:true,ambientIntensity:.24,speed:.65,
        restStyle:"image"
      }));
    }catch(error){
      console.error("[NUVIA] Compact footer sculpture failed to render:",error);
      // No giant poster or visible rectangular fallback if GL/import fails.
      const fallback=document.createElement("img");
      fallback.src="https://cdn.21st.dev/assets/mirror/ae/ae8c3de9003460e59182e950ccd345f68f27f9d0e4808b64c92c962a4eca7120.webp";
      fallback.alt="";
      fallback.style.cssText="position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:contain;object-position:center;pointer-events:none;mix-blend-mode:multiply;-webkit-mask-image:radial-gradient(ellipse 72% 80% at center,#000 58%,transparent 100%);mask-image:radial-gradient(ellipse 72% 80% at center,#000 58%,transparent 100%)";
      mount.appendChild(fallback);
    }
  }
  if("IntersectionObserver" in window){
    const observer=new IntersectionObserver(entries=>{
      if(!entries.some(entry=>entry.isIntersecting))return;
      observer.disconnect();
      start();
    },{rootMargin:"160px 0px"});
    observer.observe(mount);
  }else{
    start();
  }
})();
