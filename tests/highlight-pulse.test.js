import test from 'node:test';
import assert from 'node:assert/strict';
import {highlightPulse} from '../highlight-pulse.js';

test('pulse crosses the full range and its half-width margins before delaying',()=>{
 const at=time=>highlightPulse(time,.25,1,100,500,50);
 assert.equal(at(0).elevation,50);assert.equal(at(125).elevation,300);
 assert.equal(at(250).elevation,550);assert.equal(at(250).sweeping,false);
 assert.equal(at(250).waitMs,1000);assert.equal(at(1000).elevation,550);
 assert.equal(at(1250).elevation,50);assert.equal(at(1250).sweeping,true);
});
test('pulse timing uses elapsed time and responds to speed, delay and range settings',()=>{
 for(const fps of [60,120,240]){
  const frame=Math.round(fps*.125),time=frame*1000/fps;
  const state=highlightPulse(time,.5,0,-100,900,100);
  assert.ok(Math.abs(state.elevation-(-200+1200*time/500))<1e-10);
 }
 assert.equal(highlightPulse(500,.5,0,0,100,10).elevation,-10);
 assert.equal(highlightPulse(750,.5,2,0,100,10).waitMs,1750);
});


test('a pulse resumes at the displayed hover elevation and continues upward',async()=>{
 const {pulseElapsedAtElevation}=await import('../highlight-pulse.js');
 for(const elevation of [50,100,275,500,550]){
  const elapsed=pulseElapsedAtElevation(elevation,5,100,500,50);
  assert.ok(Math.abs(highlightPulse(elapsed,5,0,100,500,50).elevation-elevation)<1e-10);
 }
 const elapsed=pulseElapsedAtElevation(275,5,100,500,50);
 assert.equal(highlightPulse(elapsed+100,5,0,100,500,50).elevation,285);
 assert.equal(pulseElapsedAtElevation(-100,5,100,500,50),0);
});
