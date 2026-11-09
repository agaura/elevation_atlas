// Optional live range/refinement check; requires PLAYWRIGHT_MODULE.
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8145'},stdio:['ignore','pipe','inherit']});await new Promise(r=>server.stdout.once('data',r));let browser;
try{browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();page.on('console',m=>console.log(m.type(),m.text().slice(0,300)));await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto('http://localhost:8145/fixture');console.log(await page.evaluate(async()=>{
 const {BODIES,mercatorY}=await import('/planetary.js'),{planetaryTile}=await import('/planetary-reader.js'),{fromUrl}=await import('/vendor/geotiff/geotiff.js');const results=[];
 for(const body of ['mars','moon']){
  const settings=BODIES[body],item=(await fetch(`https://stac.astrogeology.usgs.gov/api/collections/${settings.collection}/items?limit=1`).then(r=>r.json())).features[0];
  const tiff=await fromUrl(item.assets[settings.asset].href,{allowFullFile:false}),image=await tiff.getImage(),[ox,oy]=image.getOrigin(),[rx,ry]=image.getResolution(),keys=image.getGeoKeys();
  const lat=(oy+image.getHeight()/2*ry)/keys.GeogSemiMajorAxisGeoKey*180/Math.PI,lon=((ox+image.getWidth()/2*rx)/(keys.GeogSemiMajorAxisGeoKey*Math.cos((keys.ProjStdParallel1GeoKey??0)*Math.PI/180))*180/Math.PI+(keys.ProjCenterLongGeoKey??0)+540)%360-180;
  const z=10,n=2**z,tile={z,x:Math.floor((lon+180)/360*n),y:Math.floor(mercatorY(lat)*n)},controller=new AbortController();setTimeout(()=>controller.abort(),90000);
  const start=performance.now(),data=await planetaryTile(tile,512,body,controller.signal,()=>{},true);if(!data.refinedSamples)throw Error(body+' refinement had no valid samples');
  results.push({body,lon,lat,refined:data.refinedSamples,ms:performance.now()-start});
 }
 return results;
}));}finally{await browser?.close();server.kill();}
