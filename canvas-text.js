// Preserve selection across animation frames that repeat or update readouts.
export function setCanvasText(element,text){
 const value=String(text),selection=window.getSelection();
 if(element.textContent===value||selection?.type==='Range'&&selection.containsNode(element,true))return;
 element.textContent=value;
}
// Map glyphs remain GPU-rendered. Transparent, matching text hit areas provide
// ordinary browser selection, copy, context menus and mobile text interaction.
export class MapLabelText{
 constructor(container){this.container=container;}
 update(scene){
  if(scene===this.scene)return;
  const selection=window.getSelection();
  if(selection?.type==='Range'&&selection.containsNode(this.container,true))return;
  this.scene=scene;
  this.container.replaceChildren(...(scene?.labels??[]).map(label=>{
   const span=document.createElement('span');span.textContent=label.text??label.name;
   span.style.left=`${label.point[0]}px`;span.style.top=`${label.point[1]}px`;
   span.style.font=label.font??`${label.weight??400} ${label.size}px ${label.family??'monospace'}`;
   span.style.letterSpacing=label.spacing??'0px';
   span.style.transform=`translate(-50%,-50%) rotate(${label.angle??0}rad)`;
   return span;
  }));
 }
}
