// Pointer-based taps work independently of synthesized mobile dblclick events.
export function setupCanvasGestures(canvas,{zoom,pin,stop}){
 let press=null,hold=0,lastTap=null,lastTouch=-Infinity;
 function cancel(){clearTimeout(hold);hold=0;press=null;}
 canvas.addEventListener('pointerdown',e=>{
  if(e.pointerType==='mouse'&&e.button!==0)return;
  if(e.pointerType!=='mouse')lastTouch=performance.now();
  if(press){cancel();lastTap=null;return;}
  press={id:e.pointerId,x:e.clientX,y:e.clientY,time:performance.now(),type:e.pointerType,held:false};
  hold=setTimeout(()=>{hold=0;if(!press)return;press.held=true;lastTap=null;pin(press.x,press.y);},550);
 });
 canvas.addEventListener('pointermove',e=>{if(press?.id===e.pointerId&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>8){cancel();lastTap=null;}});
 canvas.addEventListener('pointerup',e=>{
  if(press?.id!==e.pointerId)return;
  const p=press;cancel();
  if(p.held){stop();return;}
  if(p.type==='mouse')return;
  const now=performance.now();if(now-p.time>300){lastTap=null;return;}
  if(lastTap&&now-lastTap.time<=350&&Math.hypot(e.clientX-lastTap.x,e.clientY-lastTap.y)<=24){lastTap=null;zoom(e.clientX,e.clientY);}
  else lastTap={time:now,x:e.clientX,y:e.clientY};
 });
 for(const type of ['pointercancel','lostpointercapture'])canvas.addEventListener(type,()=>{cancel();});
 canvas.addEventListener('dblclick',e=>{e.preventDefault();if(performance.now()-lastTouch>1000)zoom(e.clientX,e.clientY);});
 canvas.addEventListener('contextmenu',e=>e.preventDefault());
 window.addEventListener('blur',()=>{cancel();lastTap=null;});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){cancel();lastTap=null;}});
}
