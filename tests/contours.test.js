import test from 'node:test';
import assert from 'node:assert/strict';
import {contourInterval,contourLegendLevels} from '../contours.js';
test('contour intervals use readable steps and refine with zoom',()=>{
 assert.ok(contourInterval(3000,.1)<contourInterval(3000,100));
 for(const mpp of [.01,.1,1,10,100,10000]){const interval=contourInterval(12000,mpp),power=10**Math.floor(Math.log10(interval));assert.ok([1,2,5].includes(interval/power));assert.ok(interval>=1);}
});
test('legend contour labels align with actual levels and leave room for endpoints',()=>{
 const levels=contourLegendLevels(-1000,1000,50,254);
 assert.ok(levels.length>0&&levels.length<=9);
 for(const {elevation,position} of levels){assert.equal(Math.abs(elevation%50),0);assert.equal(position,(1000-elevation)/2000);assert.ok(position*254>=20&&(1-position)*254>=20);}
 for(let i=1;i<levels.length;i++)assert.ok(Math.abs(levels[i].position-levels[i-1].position)*254>=28);
 assert.deepEqual(contourLegendLevels(0,0,50,254),[]);
 assert.ok(contourLegendLevels(-12000,9000,1,150).length<=6);
});
