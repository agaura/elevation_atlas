// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/planetary-search-browser.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8149'},stdio:['ignore','pipe','inherit']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),external=[];
 page.on('request',request=>{if(!request.url().startsWith('http://localhost:8149'))external.push(request.url());});
 await page.route('**/search-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><form id="location-search"><input id="location-query"><ul id="search-results" hidden></ul><div id="search-status"></div></form>'}));
 await page.goto('http://localhost:8149/search-fixture');
 await page.evaluate(async()=>{const {setupSearch}=await import('/search.js');window.body='mars';window.selected=[];setupSearch(location=>window.selected.push(location),{getBody:()=>window.body,canGeocode:()=>false});});
 async function submit(query){await page.locator('#location-query').fill(query);await page.locator('#location-search').evaluate(form=>form.requestSubmit());await page.waitForFunction(()=>document.querySelector('#search-status').textContent!=='Searching…');}
 await submit('Olympus Mons');let selected=await page.evaluate(()=>window.selected.at(-1));assert.equal(selected.name,'Olympus Mons');assert.ok(Math.abs(selected.longitude+133.8025)<1e-5);assert.equal(await page.locator('#search-results').isVisible(),false);
 await page.evaluate(()=>window.body='moon');await submit('Tycho');assert.equal(await page.evaluate(()=>window.selected.at(-1).name),'Tycho');
 await submit('mare');assert.ok(await page.locator('#search-results button').count()>1);assert.ok((await page.locator('#search-results small').first().textContent()).includes('Moon'));
 const choice=await page.locator('#search-results button span').first().textContent();await page.locator('#search-results button').first().click();assert.equal(await page.locator('#location-query').inputValue(),choice);assert.equal(await page.locator('#search-results').isVisible(),false);
 await submit('10, 20');selected=await page.evaluate(()=>window.selected.at(-1));assert.equal(selected.latitude,10);assert.equal(selected.longitude,20);
 await submit('zzzz-no-such-feature');assert.equal(await page.locator('#search-status').textContent(),'No locations found.');
 assert.deepEqual(external,[]);console.log('PASS Mars/Moon name search, partial results, selecting a result, coordinates and no external geocoder requests');
}finally{await browser?.close();server.kill();}
