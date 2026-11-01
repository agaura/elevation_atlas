// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/water-surface-browser.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8134'},stdio:['ignore','pipe','inherit']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 await page.route('**/water-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));
 await page.route('**/gebco-reader.js',r=>r.fulfill({contentType:'application/javascript',body:'export async function gebcoTile(t,size){return {size,factor:1,values:new Float32Array(size*size).fill(-500)};}'}));
 await page.goto('http://localhost:8134/water-fixture');
 const result=await page.evaluate(async()=>{
  async function image(height){
   const canvas=new OffscreenCanvas(4,4),ctx=canvas.getContext('2d'),data=ctx.createImageData(4,4),v=height+32768;
   for(let i=0;i<data.data.length;i+=4){data.data[i]=Math.floor(v/256);data.data[i+1]=Math.floor(v)%256;data.data[i+2]=Math.round((v-Math.floor(v))*256);data.data[i+3]=255;}
   ctx.putImageData(data,0,0);return URL.createObjectURL(await canvas.convertToBlob({type:'image/png'}));
  }
  const results=[];
  for(const [l,s,expected,water,oceanSource] of [[176,-100,76,true],[176,0,176,true],[176,2,176,false],[-100,-200,-200,true],[176,-100,76,true,'gebco'],[-100,-200,-500,true,'gebco']]){
   const land=await image(l),sea=await image(s),worker=new Worker('/terrain.worker.js',{type:'module'});
   const data=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Worker timed out')),10000);
    worker.onerror=event=>{clearTimeout(timer);reject(Error(event.message));};
    worker.onmessage=({data})=>{if(data.progress)return;clearTimeout(timer);data.error?reject(Error(data.error)):resolve(data);};
    worker.postMessage({id:1,oceanSource,t:{z:6,x:16,y:23},metadata:{land:{tiles:[land],tileSize:4},sea:{tiles:[sea],tileSize:4}}});
   });
   worker.terminate();URL.revokeObjectURL(land);URL.revokeObjectURL(sea);
   for(let i=0;i<data.values.length;i+=2){if(data.values[i]!==expected||(data.values[i+1]<0)!==water)throw Error(`Worker result ${l},${s}: ${data.values[i]}, ${data.values[i+1]}`);}
   results.push({land:l,sea:s,elevation:data.values[0],water:data.values[1]<0,source:data.oceanSource});
  }
  return results;
 });
 assert.equal(result.length,6);console.log('PASS actual worker decoding, surface correction, category handling, ocean depths',result);
}finally{await browser?.close();server.kill();}
