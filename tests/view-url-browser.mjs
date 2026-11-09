// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/view-url-browser.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8150'},stdio:['ignore','pipe','inherit']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});const page=await browser.newPage({viewport:{width:1200,height:850}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://www.googletagmanager.com/**',route=>route.abort());
 await page.route('https://tiles.mapterhorn.com/tilejson.json',route=>route.fulfill({json:{tiles:['https://terrain.invalid/{z}/{x}/{y}'],maxzoom:18,tileSize:512}}));
 await page.route('https://tiles.openwaters.io/seascape/raster.json',route=>route.fulfill({json:{tiles:['https://terrain.invalid/{z}/{x}/{y}'],maxzoom:18,tileSize:512,schema:1}}));
 await page.route('https://terrain.invalid/**',route=>route.abort());
 async function ready(){await page.waitForFunction(()=>!document.querySelector('#celestial-body').disabled&&document.querySelector('#level').textContent!=='—');await page.waitForTimeout(650);}
 async function scale(){return Number.parseFloat(await page.locator('#scale').textContent());}
 await page.goto('http://localhost:8150/');await ready();const initial=await scale(),hash=new URL(page.url()).hash;
 assert.notEqual(hash.split('/')[0],'#2.0000');
 await page.reload();await ready();assert.ok(Math.abs(await scale()-initial)/initial<.0001,'fresh globe changed scale after reload');
 const canvas=await page.locator('#map').boundingBox();await page.mouse.move(canvas.x+canvas.width/2,canvas.y+canvas.height/2);await page.mouse.wheel(0,-180);await page.waitForTimeout(750);
 const zoomed=await scale();assert.ok(zoomed<initial);await page.reload();await ready();assert.ok(Math.abs(await scale()-zoomed)/zoomed<.0001,'zoomed globe changed scale after reload');
 assert.deepEqual(errors,[]);console.log('PASS initial and zoomed globe scale survive URL reload', {initial,zoomed,hash});
}finally{await browser?.close();server.kill();}
