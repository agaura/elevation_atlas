import test from 'node:test';
import assert from 'node:assert/strict';
import {RegionTransition} from '../region-transition.js';
test('region masking fades in and out without losing the outgoing mask',()=>{
 const transition=new RegionTransition(),mask={revision:1,key:'one'};
 assert.equal(transition.update(mask,0).strength,0);
 assert.ok(Math.abs(transition.update(mask,100).strength-.5)<1e-8);
 assert.equal(transition.update(mask,200).strength,1);
 assert.equal(transition.update(null,210).strength,1);
 assert.ok(Math.abs(transition.update(null,310).strength-.5)<1e-8);
 assert.equal(transition.update(null,410),null);
});
test('changing regions fades through the full map and reduced motion applies immediately',()=>{
 const transition=new RegionTransition(),a={revision:1},b={revision:2};
 transition.update(a,0);transition.update(a,200);
 assert.equal(transition.update(b,210).revision,1);
 assert.equal(transition.update(b,410).revision,2);
 assert.equal(transition.update(b,610).strength,1);
 assert.equal(transition.update(a,620,true).revision,1);
 assert.equal(transition.update(a,620,true).strength,1);
 assert.equal(transition.update(null,630,true),null);
});
