// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/region-gesture-browser.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8160'},stdio:['ignore','pipe','inherit']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});const page=await browser.newPage({viewport:{width:1200,height:850}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://www.googletagmanager.com/**',route=>route.abort());
 await page.route('https://tiles.mapterhorn.com/tilejson.json',route=>route.fulfill({json:{tiles:['https://terrain.invalid/{z}/{x}/{y}'],maxzoom:18,tileSize:512}}));
 await page.route('https://tiles.openwaters.io/seascape/raster.json',route=>route.fulfill({json:{tiles:['https://terrain.invalid/{z}/{x}/{y}'],maxzoom:18,tileSize:512,schema:1}}));
 await page.route('https://terrain.invalid/**',route=>route.abort());
 await page.route('https://www.geoboundaries.org/api/current/gbOpen/USA/**',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},json:{simplifiedGeometryGeoJSON:'https://boundary.fixture/illinois'}}));
 await page.route('https://boundary.fixture/illinois',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},json:{type:'FeatureCollection',features:[{type:'Feature',properties:{shapeName:'Illinois',shapeID:'test-state'},geometry:{type:'Polygon',coordinates:[[[-92,37],[-87,37],[-87,43],[-92,43],[-92,37]]]}}]}}));

 const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=16;const ctx=c.getContext('2d');ctx.fillStyle='rgb(51,102,153)';ctx.fillRect(0,0,16,16);return c.toDataURL('image/png').split(',')[1];}),'base64');
 let imageryRequests=0;
 for(const pattern of ['https://services.arcgisonline.com/**/World_Imagery/**','https://astro.arcgis.com/**/CTX1/**','https://trek.nasa.gov/tiles/Moon/EQ/Kaguya_TCortho_Mosaic_Global_4096ppd/**'])await page.route(pattern,route=>{imageryRequests++;return route.fulfill({body:png,contentType:'image/png',headers:{'access-control-allow-origin':'*'}});});
 const lon=-87.63,lat=41.88,y=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2;
 await page.goto(`http://localhost:8160/#5.5/${lon/360+.5}/${y}`);await page.waitForFunction(()=>!document.querySelector('#celestial-body').disabled);



 assert.equal(imageryRequests,0);assert.equal(await page.locator('#satellite').getAttribute('aria-pressed'),'false');
 await page.locator('#satellite').click();await page.waitForFunction(()=>document.querySelector('#imagery-status').textContent==='');
 assert.equal(await page.locator('#terrain-section').getAttribute('data-open'),'false');
 assert.ok(imageryRequests>0);assert.equal(await page.locator('#satellite .terrain-symbol').isVisible(),true);assert.equal(await page.locator('#legend').isVisible(),false);
 assert.ok((await page.locator('#imagery-credit').textContent()).includes('Esri'));
 for(const body of ['mars','moon','earth']){await page.selectOption('#celestial-body',body);await page.waitForTimeout(250);await page.waitForFunction(()=>document.querySelector('#imagery-status').textContent==='');assert.equal(await page.locator('#satellite').getAttribute('aria-pressed'),'true');assert.ok((await page.locator('#imagery-credit').textContent()).length>0);assert.equal(await page.locator('#google-maps').isVisible(),body==='earth');}
 await page.keyboard.press('t');assert.equal(await page.locator('#satellite').getAttribute('aria-pressed'),'false');
 await page.keyboard.press('t');assert.equal(await page.locator('#satellite').getAttribute('aria-pressed'),'true');
 await page.locator('#location-query').fill('t');await page.keyboard.press('t');assert.equal(await page.locator('#satellite').getAttribute('aria-pressed'),'true');await page.locator('#location-query').evaluate(el=>el.blur());
 await page.locator('#fullscreen').click();await page.waitForTimeout(250);assert.equal(await page.locator('#fullscreen-satellite').isVisible(),true);
 assert.equal(await page.locator('#fullscreen-google-maps').isVisible(),true);
 const boxes=await Promise.all(['fullscreen-satellite','fullscreen-google-maps','fullscreen-download','fullscreen-exit'].map(id=>page.locator('#'+id).boundingBox()));
 for(let i=1;i<boxes.length;i++){assert.equal(boxes[i].y,boxes[0].y);assert.equal(boxes[i].width,32);assert.equal(boxes[i].x-boxes[i-1].x-boxes[i-1].width,8);}

 await page.locator('#fullscreen-satellite').click();assert.equal(await page.locator('#satellite').getAttribute('aria-pressed'),'false');assert.equal(await page.locator('#legend').isVisible(),true);assert.equal(await page.locator('#terrain-section').getAttribute('data-open'),'true');
 await page.keyboard.press('Escape');await page.setViewportSize({width:320,height:700});await page.waitForTimeout(200);
 const header=await page.locator('header').boundingBox(),button=await page.locator('#fullscreen').boundingBox();assert.ok(button.x+button.width<=320&&button.y+button.height<=header.y+header.height);
 assert.deepEqual(errors,[]);console.log('PASS imagery toggle, disabled-network behavior, body selection, icon swap, attribution, fullscreen toggle and narrow header',imageryRequests);
}finally{await browser?.close();server.kill();}
