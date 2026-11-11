// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/region-gesture-browser.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8155'},stdio:['ignore','pipe','inherit']});
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
 await page.goto(`http://localhost:8155/#5.5/${lon/360+.5}/${y}`);await page.waitForFunction(()=>!document.querySelector('#celestial-body').disabled);


 assert.equal(await page.locator('#map-mode').isChecked(),false);
 await page.keyboard.press('c');assert.equal(await page.locator('#contours').isChecked(),true);await page.waitForTimeout(200);
 assert.equal(await page.locator('#contour-legend-labels').isVisible(),true);assert.ok(await page.locator('.contour-level').count()>0);
 await page.locator('#contours').uncheck();
 await page.keyboard.press('g');assert.equal(await page.locator('#graticule').isChecked(),true);await page.waitForTimeout(500);
 assert.ok(!(await page.locator('#message').textContent()).includes('Validation'));
 await page.locator('#projection').uncheck();await page.waitForTimeout(250);
 await page.locator('#palette').selectOption('0');await page.waitForTimeout(250);
 await page.locator('#projection').check();await page.waitForTimeout(250);
 await page.locator('#map-mode').check();await page.waitForTimeout(250);
 await page.locator('#graticule').uncheck();await page.waitForTimeout(250);
 assert.equal(await page.locator('#map-mode').isChecked(),true);
 await page.locator('#location-query').focus();await page.keyboard.press('g');assert.equal(await page.locator('#graticule').isChecked(),false);
 for(const body of ['mars','moon','earth']){await page.selectOption('#celestial-body',body);assert.equal(await page.locator('#location-query').getAttribute('placeholder'),'Location');}
 assert.deepEqual(errors,[]);console.log('PASS graticule toggle, labels-off operation, flat/globe, grayscale and coexistence with map labels');
}finally{await browser?.close();server.kill();}
