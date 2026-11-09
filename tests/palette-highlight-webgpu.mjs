// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/palette-highlight-webgpu.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8141'},stdio:['ignore','pipe','inherit']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});
 const page=await browser.newPage();await page.route('**/palette-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto('http://localhost:8141/palette-fixture');
 const result=await page.evaluate(async()=>{
  const {COLOR_WGSL,COLOR_MAPS,HIGHLIGHT_HDR_TARGET}=await import('/colors.js');
  const maps=COLOR_MAPS.filter(m=>m.shader),adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice(),errors=[];
  device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const shader=device.createShaderModule({code:COLOR_WGSL+`
   @group(0) @binding(0) var<storage,read_write> output:array<vec4f>;
   @compute @workgroup_size(64) fn verify(@builtin(global_invocation_id) id:vec3u){
    let index=id.x/64u;let t=f32(id.x%64u)/63.;var lab:vec3f;
    switch index {${maps.map((m,i)=>`case ${i}u: {lab=${m.shader}(t,0.,1.,${HIGHLIGHT_HDR_TARGET}.,true);}`).join('\n')} default: {return;}}
    output[id.x]=vec4f(oklabToLinearP3(lab),1.);
   }`});
  const info=await shader.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.map(m=>m.message).join('\n'));
  const pipeline=device.createComputePipeline({layout:'auto',compute:{module:shader,entryPoint:'verify'}});
  const size=maps.length*64*16,buffer=device.createBuffer({size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer}}]}));pass.dispatchWorkgroups(maps.length);pass.end();encoder.copyBufferToBuffer(buffer,0,read,0,size);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
  const values=new Float32Array(read.getMappedRange());
  for(let i=0;i<values.length;i+=4){const rgb=values.slice(i,i+3);if(rgb.some(v=>!Number.isFinite(v)||v< -1e-5)||Math.abs(Math.max(...rgb)-4)>1e-4)throw Error(`Invalid HDR highlight for ${maps[Math.floor(i/256)].label} at sample ${i/4%64}: ${rgb}`);}
  read.unmap();buffer.destroy();read.destroy();await device.queue.onSubmittedWorkDone();return {errors,palettes:maps.map(m=>m.label),hdrTarget:HIGHLIGHT_HDR_TARGET};
 });
 assert.deepEqual(result.errors,[]);assert.equal(result.hdrTarget,4);assert.ok(result.palettes.includes('Styx'));assert.ok(result.palettes.includes('Phantom'));console.log('PASS palette HDR highlight endpoints',result);
}finally{await browser?.close();server.kill();}
