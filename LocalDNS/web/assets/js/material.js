(() => {
  'use strict';
  const init=()=>{
    const wall=document.querySelector('#wallpaper-layer');if(!wall)return;
    const canvas=document.createElement('canvas');canvas.id='ambient-orbit';canvas.setAttribute('aria-hidden','true');wall.append(canvas);
    const ctx=canvas.getContext('2d');if(!ctx)return;
    let scheduled=false;
    function draw(){
      scheduled=false;
      const w=innerWidth,h=innerHeight,dpr=Math.min(devicePixelRatio||1,1.5);
      canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
      const light=document.documentElement.dataset.theme==='light-glass';
      const cx=w*.54,cy=h*1.10,r=Math.max(h*.88,w*.45);
      let seed=91353;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      const atmosphere=ctx.createRadialGradient(cx-r*.34,cy-r*.72,r*.08,cx,cy,r*1.13);
      atmosphere.addColorStop(0,light?'rgba(154,119,72,.12)':'rgba(173,132,80,.14)');atmosphere.addColorStop(.65,light?'rgba(148,112,69,.04)':'rgba(139,102,57,.06)');atmosphere.addColorStop(1,'rgba(100,74,42,0)');
      ctx.fillStyle=atmosphere;ctx.fillRect(0,0,w,h);
      ctx.save();ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.clip();
      const body=ctx.createRadialGradient(cx-r*.43,cy-r*.85,r*.03,cx+r*.15,cy+r*.15,r*1.3);
      body.addColorStop(0,light?'rgba(124,96,60,.13)':'rgba(166,126,73,.24)');body.addColorStop(.28,light?'rgba(155,137,112,.06)':'rgba(83,65,42,.11)');body.addColorStop(.7,light?'rgba(230,235,244,.02)':'rgba(8,10,12,.05)');body.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=body;ctx.fillRect(0,0,w,h);ctx.restore();
      for(let i=0;i<7200;i++){
        const angle=-Math.PI+rand()*Math.PI,spread=(rand()-.5)*r*.105;
        const radius=r+spread,x=cx+Math.cos(angle)*radius,y=cy+Math.sin(angle)*radius;
        if(x<0||x>w||y<0||y>h)continue;
        const rim=Math.exp(-Math.abs(spread)/(r*.023)),upper=Math.max(.05,(-Math.sin(angle))*.85-Math.cos(angle)*.24);
        const a=(.025+rim*upper*.34)*(light?.4:1),size=.35+rand()*1.10;
        ctx.fillStyle=light?`rgba(112,83,45,${a})`:`rgba(209,172,111,${a})`;ctx.fillRect(x,y,size,size);
      }
      for(let i=0;i<2600;i++){
        const x=(rand()*2-1)*r,y=-rand()*r,dist=(x*x+y*y)/(r*r);if(dist>1)continue;
        const px=cx+x,py=cy+y;if(px<0||px>w||py<0||py>h)continue;
        const edge=Math.pow(dist,4),bright=Math.max(.01,-y/r-x/r*.28);
        ctx.fillStyle=light?`rgba(126,93,51,${edge*bright*.055})`:`rgba(170,135,81,${edge*bright*.13})`;ctx.fillRect(px,py,.5+rand()*.7,.5+rand()*.7);
      }
    }
    const schedule=()=>{if(!scheduled){scheduled=true;requestAnimationFrame(draw);}};
    window.addEventListener('resize',schedule,{passive:true});new MutationObserver(schedule).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});draw();
    let saved={};try{saved=JSON.parse(localStorage.getItem('localdns-material-v2')||'{}');}catch{}
    const defaults={blur:14,alpha:48,dimmer:22},units={blur:'px',alpha:'%',dimmer:'%'};
    for(const name of ['blur','alpha','dimmer']){
      const input=document.querySelector('#slider-'+name),label=document.querySelector('#val-'+name);if(!input)continue;
      const value=Math.min(+input.max,Math.max(+input.min,Number.isFinite(+saved[name])?+saved[name]:defaults[name]));input.value=value;
      document.documentElement.style.setProperty(name==='dimmer'?'--bg-dimmer':'--glass-'+name,name==='blur'?value+'px':(value/100).toFixed(2));if(label)label.textContent=value+units[name];
      input.addEventListener('input',()=>{const values=Object.fromEntries(['blur','alpha','dimmer'].map(k=>[k,+document.querySelector('#slider-'+k).value]));try{localStorage.setItem('localdns-material-v2',JSON.stringify(values));}catch{}});
    }
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
