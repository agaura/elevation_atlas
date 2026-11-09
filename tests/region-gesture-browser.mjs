// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/region-gesture-browser.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8152'},stdio:['ignore','pipe','inherit']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});const page=await browser.newPage({viewport:{width:1200,height:850}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://www.googletagmanager.com/**',route=>route.abort());
 await page.route('https://tiles.mapterhorn.com/tilejson.json',route=>route.fulfill({json:{tiles:['https://terrain.invalid/{z}/{x}/{y}'],maxzoom:18,tileSize:512}}));
 await page.route('https://tiles.openwaters.io/seascape/raster.json',route=>route.fulfill({json:{tiles:['https://terrain.invalid/{z}/{x}/{y}'],maxzoom:18,tileSize:512,schema:1}}));
 await page.route('https://terrain.invalid/**',route=>route.abort());
 await page.route('https://www.geoboundaries.org/api/current/gbOpen/USA/**',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},json:{simplifiedGeometryGeoJSON:'https://boundary.fixture/illinois'}}));
 await page.route('https://boundary.fixture/illinois',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},json:{type:'FeatureCollection',features:[{type:'Feature',properties:{shapeName:'Illinois',shapeID:'test-state'},geometry:{type:'Polygon',coordinates:[[[-92,37],[-87,37],[-87,43],[-92,43],[-92,37]]]}}]}}));
 const lon=-87.63,lat=41.88,y=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2;
 await page.goto(`http://localhost:8152/#5.5/${lon/360+.5}/${y}`);await page.waitForFunction(()=>!document.querySelector('#celestial-body').disabled);
 const canvas=await page.locator('#map').boundingBox();await page.mouse.move(canvas.x+canvas.width/2,canvas.y+canvas.height/2);
 assert.equal(await page.locator('#map-mode').isChecked(),false);
 for(const key of ['Control','Meta']){
  await page.keyboard.down(key);await page.waitForFunction(()=>document.querySelector('#region-status').textContent.includes('Illinois'),null,{timeout:20000});
  assert.equal(await page.locator('#map-mode').isChecked(),false);
  await page.keyboard.up(key);await page.waitForFunction(()=>document.querySelector('#region-status').textContent==='');
 }
 await page.keyboard.down('Meta');await page.waitForFunction(()=>document.querySelector('#region-status').textContent.includes('Illinois'));
 await page.mouse.click(canvas.x+canvas.width/2,canvas.y+canvas.height/2);await page.keyboard.up('Meta');
 await page.waitForFunction(()=>!document.querySelector('#region-pin-readout').hidden);assert.ok((await page.locator('#region-pin-name').textContent()).includes('Illinois'));
 // Entering Clear must not remove the cursor row or move the readout.
 await page.waitForFunction(()=>!document.querySelector('#cursor-readout').hidden);
 const clear=page.locator('#region-unpin'),before=await clear.boundingBox();
 await clear.hover();await page.waitForTimeout(100);
 assert.equal(await page.locator('#cursor-readout').isVisible(),true);
 assert.equal((await clear.boundingBox()).y,before.y);
 await page.mouse.move(10,10);await page.waitForTimeout(450);assert.equal(await page.locator('#region-pin-readout').isVisible(),true);
 await page.locator('#region-unpin').click();await page.waitForFunction(()=>document.querySelector('#region-pin-readout').hidden);
 await page.locator('#location-query').focus();await page.keyboard.down('Control');await page.waitForTimeout(200);assert.equal(await page.locator('#region-status').textContent(),'');await page.keyboard.up('Control');
 assert.deepEqual(errors,[]);console.log('PASS Command and Control hover isolation, release, pin/clear, typing exclusion and labels-off operation');
}finally{await browser?.close();server.kill();}
