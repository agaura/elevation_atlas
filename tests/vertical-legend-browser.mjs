// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/region-gesture-browser.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8154'},stdio:['ignore','pipe','inherit']});
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
 await page.goto(`http://localhost:8154/#5.5/${lon/360+.5}/${y}`);await page.waitForFunction(()=>!document.querySelector('#celestial-body').disabled);

 const legend=page.locator('#legend'),bar=await legend.boundingBox(),map=await page.locator('#map').boundingBox();
 assert.ok(bar.height>bar.width*5);assert.ok(bar.x>=map.x&&bar.y>=map.y);
 assert.equal(await legend.getAttribute('aria-orientation'),'vertical');
 assert.equal(await legend.evaluate(e=>e.closest('aside')),null);
 await page.mouse.move(bar.x+bar.width/2,bar.y+bar.height*.1);await page.waitForTimeout(100);
 const high=Number(await legend.getAttribute('aria-valuenow'));
 await page.mouse.move(bar.x+bar.width/2,bar.y+bar.height*.9);await page.waitForTimeout(100);
 const low=Number(await legend.getAttribute('aria-valuenow'));assert.ok(high>low);
 await page.mouse.click(bar.x+bar.width/2,bar.y+bar.height*.3);
 assert.equal(await page.locator('#highlight').isChecked(),true);
 const max=await page.locator('#legend-max').boundingBox(),min=await page.locator('#legend-min').boundingBox();
 assert.ok(max.x>bar.x+bar.width&&min.x>bar.x+bar.width&&max.y<min.y);
 await page.mouse.move(10,10);await page.locator('#fullscreen').click();await page.waitForTimeout(200);
 assert.equal(await legend.isVisible(),true);await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);
 const mobileBar=await legend.boundingBox(),mobileMap=await page.locator('#map').boundingBox();assert.ok(mobileBar.y+mobileBar.height<=mobileMap.y+mobileMap.height);
 assert.deepEqual(errors,[]);console.log('PASS vertical legend placement, hover direction, selection, labels, fullscreen and mobile sizing');
}finally{await browser?.close();server.kill();}
