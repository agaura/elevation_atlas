// Match SST's steppers: one immediate step, then repeat after 300 ms at 80 ms.
export function setupRepeatButton(button,step){
 let delay=0,repeat=0,held=false,suppressClick=false;
 function stop(){clearTimeout(delay);clearInterval(repeat);delay=repeat=0;held=false;}
 function advance(){if(button.matches(':disabled')){stop();return;}step();}
 function start(){stop();held=true;advance();if(!held)return;delay=setTimeout(()=>{repeat=setInterval(advance,80);},300);}
 button.addEventListener('pointerdown',event=>{if(event.button!==0||button.matches(':disabled'))return;event.preventDefault();button.focus({preventScroll:true});button.setPointerCapture(event.pointerId);suppressClick=true;start();});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,stop);
 button.addEventListener('click',event=>{if(suppressClick&&event.detail>0){suppressClick=false;return;}advance();});
 button.addEventListener('keydown',event=>{if(![' ','Enter'].includes(event.key))return;event.preventDefault();if(!event.repeat)start();});
 button.addEventListener('keyup',event=>{if([' ','Enter'].includes(event.key)){event.preventDefault();stop();}});
 button.addEventListener('blur',stop);button.addEventListener('contextmenu',event=>event.preventDefault());
 window.addEventListener('blur',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
}
