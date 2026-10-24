const utf8=new TextEncoder();
export function uint(n){const a=[];do{let b=n%128;n=Math.floor(n/128);if(n)b|=128;a.push(b);}while(n);return a;}
const field=(id,wire,bytes)=>[...uint(id*8+wire),...(wire===2?[...uint(bytes.length),...bytes]:bytes)];
const text=(id,s)=>field(id,2,[...utf8.encode(s)]);
const number=(id,n)=>field(id,0,uint(n));
const packed=(id,values)=>field(id,2,values.flatMap(uint));
export const zigzag=n=>n<0?-n*2-1:n*2;
export function encodeTile(layers){
 return Uint8Array.from(layers.flatMap(layer=>{
  const keys=[],values=[];
  const features=layer.features.map(feature=>{
   const tags=[];for(const [key,value] of Object.entries(feature.properties||{})){let ki=keys.indexOf(key);if(ki<0){ki=keys.length;keys.push(key);}const vi=values.length;values.push(typeof value==='string'?text(1,value):number(5,value));tags.push(ki,vi);}
   return field(2,2,[...number(1,feature.id??1),...packed(2,tags),...number(3,feature.type),...packed(4,feature.commands)]);
  }).flat();
  return field(3,2,[...number(15,2),...text(1,layer.name),...features,...keys.flatMap(k=>text(3,k)),...values.flatMap(v=>field(4,2,v)),...number(5,layer.extent??4096)]);
 }));
}
export const mapFixture=()=>encodeTile([
 {name:'transportation',features:[{type:2,properties:{class:'motorway'},commands:[9,1024,4096,10,6144,0]}]},
 {name:'boundary',features:[{type:2,properties:{admin_level:2,maritime:0},commands:[9,4096,1024,10,0,6144]}]},
 {name:'place',features:[{type:1,properties:{class:'city',name:'Atlas City',rank:1},commands:[9,5600,4096]}]},
 {name:'building',features:[{type:1,properties:{name:'Ignored'},commands:[9,0,0]}]}
]);
