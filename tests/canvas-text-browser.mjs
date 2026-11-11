// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/region-gesture-browser.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8158'},stdio:['ignore','pipe','inherit']});
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
 await page.goto(`http://localhost:8158/#5.5/${lon/360+.5}/${y}`);await page.waitForFunction(()=>!document.querySelector('#celestial-body').disabled);



 await page.context().grantPermissions(['clipboard-read','clipboard-write']);
 await page.locator('#highlight').check();
 const map=await page.locator('#map').boundingBox();await page.mouse.move(map.x+map.width*.6,map.y+map.height*.5);
 await page.waitForFunction(()=>!document.querySelector('#cursor-readout').hidden);
 const coordinates=await page.locator('#position').textContent();
 await page.locator('#position').dblclick();
 const selected=await page.evaluate(()=>getSelection().toString());assert.ok(selected.length>0);
 await page.waitForTimeout(400);
 assert.equal(await page.locator('#position').textContent(),coordinates);
 assert.equal(await page.evaluate(()=>getSelection().toString()),selected);
 await page.keyboard.press(process.platform==='darwin'?'Meta+c':'Control+c');assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),selected);
 await page.mouse.click(map.x+map.width*.55,map.y+map.height*.45,{button:'right'});
 await page.waitForFunction(()=>!document.querySelector('#pinned-readout').hidden);
 const pinned=await page.locator('#pinned-position').textContent(),rowBefore=await page.locator('#pinned-readout').boundingBox();
 await page.locator('#pinned-copy').click();
 await page.waitForFunction(async text=>(await navigator.clipboard.readText())===text,pinned);
 await page.waitForFunction(()=>document.querySelector('#pinned-copy').hasAttribute('data-copied'));
 assert.equal((await page.locator('#pinned-readout').boundingBox()).height,rowBefore.height);
 assert.equal(await page.locator('#cursor-readout #pinned-copy').count(),0);
 await page.mouse.click(map.x+map.width*.65,map.y+map.height*.45,{button:'right'});
 const nextPinned=await page.locator('#pinned-position').textContent();assert.notEqual(nextPinned,pinned);
 await page.locator('#pinned-copy').click();await page.waitForFunction(async text=>(await navigator.clipboard.readText())===text,nextPinned);
 await page.locator('#legend-min').dblclick();assert.ok((await page.evaluate(()=>getSelection().toString())).length>0);
 await page.locator('#graticule').check();await page.waitForFunction(()=>document.querySelectorAll('#map-label-text>span').length>0);
 await page.locator('#map-label-text>span').first().dblclick();assert.ok((await page.evaluate(()=>getSelection().toString())).length>0);
 const css=await page.locator('#position').evaluate(e=>({select:getComputedStyle(e).userSelect,callout:getComputedStyle(e.closest('.canvas-probe')).getPropertyValue('-webkit-touch-callout')}));assert.equal(css.select,'text');
 await page.evaluate(()=>getSelection().removeAllRanges());await page.mouse.move(map.x+map.width*.6,map.y+map.height*.5);
 const before=page.url();await page.mouse.down();await page.mouse.move(map.x+map.width*.6+60,map.y+map.height*.5+20,{steps:8});await page.mouse.up();await page.waitForTimeout(300);assert.notEqual(page.url(),before);
 assert.deepEqual(errors,[]);console.log('PASS selectable/copyable readouts, stable selection during animation, selectable legend and GPU labels, and map dragging');
}finally{await browser?.close();server.kill();}
