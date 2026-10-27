// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/tile-loading-webgpu.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8105'},stdio:['ignore','pipe','inherit']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});
 const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:2}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/gtag/**',route=>route.abort());
 await page.route(/https:\/\/tiles\.(mapterhorn\.com|openwaters\.io)\/.*json$/,route=>route.fulfill({json:{tiles:['https://fixture.invalid/{z}/{x}/{y}'],tileSize:512,maxzoom:0,schema:1}}));
 await page.addInitScript(()=>{
  window.attemptTimes=[];window.cancelledRequests=0;
  window.Worker=class{
   constructor(){this.timers=new Map();}
   postMessage(message){
    if(message.cancel){window.cancelledRequests++;clearTimeout(this.timers.get(message.id));return;}
    window.attemptTimes.push(performance.now());
    if(window.attemptTimes.length===1)return; // A genuinely stuck initial request.
    const timer=setTimeout(()=>{
     const values=new Float32Array(32);for(let i=0;i<values.length;i+=2){values[i]=600.125;values[i+1]=1;}
     this.onmessage({data:{id:message.id,size:4,values,overzoomed:false}});
    },1500); // Healthy retry takes longer than the original one-second deadline.
    this.timers.set(message.id,timer);
   }
  };
 });
 await page.goto('http://127.0.0.1:8105/#13.7913/0.2497310/0.4127813',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>/^([1-9]\d*) \/ \1$/.test(document.querySelector('#coverage').textContent),null,{timeout:15000});
 const attempts=await page.evaluate(()=>attemptTimes),cancelled=await page.evaluate(()=>cancelledRequests);
 assert.equal(attempts.length,2,'The slow retry must complete without being restarted');
 assert.equal(cancelled,1);
 assert.ok(attempts[1]-attempts[0]>=950&&attempts[1]-attempts[0]<1800,'First retry must still start after one second');
 assert.equal(await page.locator('#message').textContent(),'');
 assert.deepEqual(errors,[]);
 console.log('PASS one-second initial retry, slower retry completion and float terrain upload at the reported view');
}finally{await browser?.close();server.kill();}
