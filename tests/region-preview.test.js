import test from 'node:test';
import assert from 'node:assert/strict';
import {RegionMask} from '../region-mask.js';

test('modifier preview restores the pinned region and preserves its caption',()=>{
 const controller=new RegionMask(()=>{},()=>{});
 controller.worker={postMessage(){}};
 controller.active=true;controller.serial=1;
 controller.loaded({id:1,key:'a',name:'First',level:1});
 controller.pin();const pinned=controller.pinned;
 controller.update({x:.4,y:.4},6,true);clearTimeout(controller.timer);controller.timer=0;
 controller.loaded({id:controller.serial,key:'b',name:'Second',level:1});
 assert.equal(controller.mask.name,'Second');
 assert.equal(controller.pinned,pinned);
 assert.equal(controller.pinnedCaption,'First · State / Province');
 assert.equal(controller.update(null,6,false),pinned);
});
