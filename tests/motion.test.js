import {test} from 'node:test';import assert from 'node:assert/strict';import {coastStep} from '../motion.js';
test('momentum matches SST damping at 60 Hz',()=>{const s=coastStep(1,-2,1000/60);assert.ok(Math.abs(s.vx-.966)<1e-12);assert.ok(Math.abs(s.vy+1.932)<1e-12);});
test('momentum distance and decay are frame-rate independent',()=>{let vx=1,vy=-.5,x=0,y=0;for(let i=0;i<120;i++){const s=coastStep(vx,vy,1000/120);x+=s.dx;y+=s.dy;vx=s.vx;vy=s.vy;}const whole=coastStep(1,-.5,1000);for(const [a,b] of [[vx,whole.vx],[vy,whole.vy],[x,whole.dx],[y,whole.dy]])assert.ok(Math.abs(a-b)<1e-9);});
