import test from 'node:test';
import assert from 'node:assert/strict';
import {HoverHighlightFilter} from '../hover-highlight.js';

test('brief excursions are rejected and stationary hover settles exactly',()=>{
 const f=new HoverHighlightFilter();f.reset(100,0);
 f.advance(1000,8);f.advance(100,16);assert.equal(f.value,100);
 for(let t=24;t<=600;t+=8)f.advance(123.456789,t);
 assert.equal(f.value,123.456789);assert.equal(f.velocity,0);assert.equal(f.active,false);
});
test('small consecutive ridges are damped while sustained slopes remain responsive',()=>{
 const ridge=new HoverHighlightFilter(),slope=new HoverHighlightFilter();ridge.reset(100,0);slope.reset(100,0);const values=[];
 for(let time=8;time<=1600;time+=8){
  ridge.advance(100+30*Math.sin(2*Math.PI*time/120),time);slope.advance(100+time*.1,time);
  if(time>500)values.push(ridge.value);
  assert.ok(ridge.value>=70&&ridge.value<=130);
 }
 assert.ok(Math.max(...values)-Math.min(...values)<12);
 assert.ok(260-slope.value<20);assert.ok(ridge.coherence<slope.coherence);
});
test('settling is exact at multiple display refresh rates',()=>{
 for(const fps of [60,120,240]){
  const f=new HoverHighlightFilter();f.reset(0,0);
  for(let i=1;i<=fps;i++)f.advance(500,i*1000/fps);
  assert.equal(f.value,500);assert.equal(f.velocity,0);assert.equal(f.active,false);
 }
});
