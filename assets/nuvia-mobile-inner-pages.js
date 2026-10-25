(function(){
  'use strict';
  var root=document.getElementById('nuvia-react-navigation');
  if(!root||root.querySelector('.nv-mobile-toggle'))return;
  var nav=root.querySelector('.nv-nav');
  if(!nav)return;
  var toggle=document.createElement('button');
  toggle.type='button';
  toggle.className='nv-mobile-toggle';
  toggle.setAttribute('aria-label','Ouvrir le menu NUVIA');
  toggle.setAttribute('aria-controls','nv-mobile-nav-content');
  toggle.setAttribute('aria-expanded','false');
  toggle.innerHTML='<span>NUVIA</span><span class="nv-mobile-toggle-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></span>';
  nav.id='nv-mobile-nav-content';
  root.insertBefore(toggle,nav);
  function close(){
    root.dataset.mobileOpen='false';
    toggle.setAttribute('aria-expanded','false');
    toggle.setAttribute('aria-label','Ouvrir le menu NUVIA');
    toggle.querySelector('.nv-mobile-toggle-icon').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
    root.querySelectorAll('.nv-navitem').forEach(function(item){
      item.dataset.open='false';
      var b=item.querySelector('button');
      if(b&&item.querySelector('.nv-menu'))b.setAttribute('aria-expanded','false');
    });
  }
  function open(){
    root.dataset.mobileOpen='true';
    toggle.setAttribute('aria-expanded','true');
    toggle.setAttribute('aria-label','Fermer le menu NUVIA');
    toggle.querySelector('.nv-mobile-toggle-icon').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="m5 5 14 14M19 5 5 19"/></svg>';
  }
  toggle.addEventListener('click',function(){root.dataset.mobileOpen==='true'?close():open();});
  root.querySelectorAll('.nv-menu a').forEach(function(link){link.addEventListener('click',close);});
  document.addEventListener('pointerdown',function(e){if(root.dataset.mobileOpen==='true'&&!root.contains(e.target))close();});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&root.dataset.mobileOpen==='true'){close();toggle.focus();}});
  window.addEventListener('resize',function(){if(window.innerWidth>820&&root.dataset.mobileOpen==='true')close();},{passive:true});
  close();
})();
