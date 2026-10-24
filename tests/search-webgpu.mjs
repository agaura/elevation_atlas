import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8097'},stdio:['ignore','pipe','inherit']});await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});const page=await browser.newPage({viewport:{width:1200,height:820}}),errors=[];page.on('pageerror',e=>errors.push(e.message));let geocodes=0;
 await page.route(/https:\/\/tiles\.(mapterhorn\.com|openwaters\.io)\/.*json$/,route=>route.fulfill({json:{tiles:['https://fixture.invalid/{z}/{x}/{y}'],tileSize:512,maxzoom:18,schema:1}}));
 await page.addInitScript(()=>{window.Worker=class{postMessage(message){if(message.cancel)return;const values=new Float32Array(32);for(let i=0;i<32;i+=2){values[i]=600;values[i+1]=1;}setTimeout(()=>this.onmessage({data:{id:message.id,size:4,values,overzoomed:false}}),5);}};});
 const feature=(name,lat,lon,state)=>({geometry:{type:'Point',coordinates:[lon,lat]},properties:{name,state,osm_value:'city'}});
 await page.route('https://photon.komoot.io/api/**',route=>{geocodes++;const q=new URL(route.request().url()).searchParams.get('q');const features=q==='Nothing'?[]:q==='Springfield'?[feature('Springfield',39.8,-89.65,'Illinois'),feature('Springfield',42.1,-72.58,'Massachusetts')]:[feature('Test Address',37.4,-122.1,'California')];return route.fulfill({json:{features},headers:{'access-control-allow-origin':'*'}});});
 await page.goto('http://127.0.0.1:8097');await page.waitForFunction(()=>document.querySelector('#level').textContent!=='—');
 assert.equal(await page.locator('aside').evaluate(e=>e.firstElementChild.id),'location-search');assert.equal(await page.locator('.technical #map-mode').count(),1);assert.equal(await page.locator('.color-controls #map-mode').count(),0);assert.equal(await page.locator('aside #map-status').count(),0);assert.equal(await page.locator('#map-panel #map-status').count(),1);
 async function search(text){await page.locator('#location-query').fill(text);await page.locator('#location-query').press('Enter');}
 const state=()=>page.evaluate(()=>location.hash.slice(1).split('/').map(Number));
 await search('40.7, -74');await page.waitForFunction(()=>location.hash.startsWith('#14.'));let p=await state();assert.ok(Math.abs(p[1]-106/360)<1e-6);assert.equal(geocodes,0);
 await search('91, 0');await page.waitForFunction(()=>document.querySelector('#search-status').textContent.includes('Latitude'));assert.equal(geocodes,0);
 await search('Test Address');await page.waitForFunction(()=>document.querySelector('#search-status').textContent==='Test Address');p=await state();assert.ok(Math.abs(p[1]-57.9/360)<1e-6);assert.equal(geocodes,1);
 const controlsTop=await page.locator('.color-controls').evaluate(e=>e.getBoundingClientRect().top);
 await search('Springfield');await page.waitForFunction(()=>document.querySelectorAll('#search-results button').length===2);assert.equal(await page.locator('.color-controls').evaluate(e=>e.getBoundingClientRect().top),controlsTop);await page.locator('#search-results button').filter({hasText:'Massachusetts'}).click();await page.waitForFunction(()=>Math.abs(Number(location.hash.slice(1).split('/')[1])-107.42/360)<1e-6);assert.equal(await page.locator('#search-results').isVisible(),false);
 await search('Nothing');await page.waitForFunction(()=>document.querySelector('#search-status').textContent==='No locations found.');
 const map=page.locator('#map'),box=await map.boundingBox();await map.dblclick({position:{x:box.width/2,y:box.height/2}});await page.waitForFunction(()=>!document.querySelector('#location-pin').hasAttribute('hidden'));
 const pinBox=await page.locator('#location-pin').boundingBox();assert.equal(pinBox.width,24);assert.equal(pinBox.height,32);
 await page.locator('#palette').selectOption('0');await page.waitForFunction(()=>getComputedStyle(document.querySelector('#location-pin')).stroke==='rgb(234, 242, 250)');
 await page.locator('#palette').selectOption('1');await page.waitForFunction(()=>getComputedStyle(document.querySelector('#location-pin')).stroke==='rgb(143, 197, 255)');
 await page.locator('#probe-unpin').click();await page.waitForFunction(()=>document.querySelector('#location-pin').hasAttribute('hidden'));
 await page.locator('#projection').check();await search('35 N, 139 E');await page.waitForFunction(()=>location.hash.includes('/0.8861111/'));assert.equal(await page.locator('#projection').isChecked(),true);
 await page.locator('#fullscreen').click();await page.waitForFunction(()=>document.querySelector('#fullscreen-exit').hidden===false);await page.locator('#map-status').evaluate(e=>e.textContent='Loading map data…');assert.ok(await page.locator('#map-status').isVisible());await page.locator('#fullscreen-exit').click();
 if(process.env.LIVE_SEARCH){
  await page.unroute('https://photon.komoot.io/api/**');await search('1600 Pennsylvania Avenue Washington');
  await page.waitForFunction(()=>document.querySelector('#search-results button')||document.querySelector('#search-status').textContent==='White House',null,{timeout:15000});
  if(await page.locator('#search-results button').count())await page.locator('#search-results button').first().click();
  await page.waitForFunction(()=>Math.abs(Number(location.hash.slice(1).split('/')[1])-(180-77.03655)/360)<.001);
  console.log('PASS live browser geocoding and navigation through Photon');
 }
 assert.deepEqual(errors,[]);await page.screenshot({path:'/tmp/elevation-search.png'});console.log('PASS coordinate/address search, result selection, validation, local-only coordinates, sphere navigation, sidebar ordering and fullscreen canvas status');
}finally{await browser?.close();server.kill();}
