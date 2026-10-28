// Live integration: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/gebco-browser.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8120'},stdio:['ignore','pipe','inherit']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});
let browser;
try {
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage();
  const seaRequests=[],ranges=[];
  page.on('request',request=>{
    if(request.url().includes('tiles.openwaters.io/seascape/'))seaRequests.push(request.url());
    if(request.url().includes('data.source.coop/'))ranges.push(request.headers().range);
  });
  await page.goto('http://127.0.0.1:8120/gebco.js');
  const result=await page.evaluate(async()=>{
    const canvas=new OffscreenCanvas(512,512),ctx=canvas.getContext('2d');
    ctx.fillStyle='rgb(128,100,0)';ctx.fillRect(0,0,512,512);
    const land=URL.createObjectURL(await canvas.convertToBlob());
    const worker=new Worker('/terrain.worker.js',{type:'module'});
    const metadata={land:{tileSize:512,tiles:[land]},sea:{tileSize:512,tiles:['https://tiles.openwaters.io/seascape/{z}/{x}/{y}.webp']}};
    async function request(t,id){
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('Live terrain timeout')),120000);
        worker.onmessage=({data})=>{
          if(data.progress)return;
          clearTimeout(timer);
          if(data.error)reject(Error(data.error));
          else resolve({size:data.size,depth:data.values[0],classification:data.values[1],finite:data.values.every(Number.isFinite)});
        };
        worker.onerror=event=>{clearTimeout(timer);reject(Error(event.message));};
        worker.postMessage({id,t,metadata,oceanSource:'gebco'});
      });
    }
    try {
      const gebco=await request({z:7,x:0,y:64},1);
      const beforeSwitch=performance.getEntriesByType('resource').filter(e=>e.name.includes('tiles.openwaters.io')).length;
      const seascape=await request({z:8,x:0,y:128},2);
      return {gebco,seascape,beforeSwitch};
    } finally {worker.terminate();URL.revokeObjectURL(land);}
  });
  assert.equal(result.gebco.size,512);assert.equal(result.gebco.finite,true);
  assert.ok(result.gebco.depth < -5000,'GEBCO must not contain the equatorial Seascape ridge');
  assert.equal(result.gebco.classification,-1);
  assert.equal(result.seascape.finite,true);
  assert.equal(seaRequests.length,1,'Only the finer tile may request Seascape');
  assert.match(seaRequests[0],/\/8\/0\/128.webp$/);
  assert.ok(ranges.length>0);assert.ok(ranges.every(range=>range?.startsWith('bytes=')));
  console.log('PASS real terrain worker: GEBCO at native device LOD, Seascape only beyond native limit',result);
} finally {await browser?.close();server.kill();}
