import test from 'node:test';
import assert from 'node:assert/strict';
import {Graticule,gridStep,degreeLabel} from '../graticule.js';
import {sphereCamera} from '../sphere.js';
test('grid spacing refines with zoom and labels wrap longitude',()=>{
 assert.ok(gridStep(1000)<gridStep(10));assert.equal(degreeLabel(0,'latitude',10),'0°');
 assert.equal(degreeLabel(245,'longitude',10),'115°W');assert.equal(degreeLabel(-.005,'latitude',.005),'0.005°S');
});
test('graticule scenes are bounded, cached and retain map content',()=>{
 const grid=new Graticule(),view={x:.5,y:.5,zoom:3},options={view,width:800,height:600,dpr:2,camera:null};
 const scene=grid.draw(null,options);assert.ok(scene.tiles[0].entry.geometry.segments.length>0);assert.ok(scene.labels.length>0);
 assert.equal(grid.draw(null,options),scene);assert.ok(scene.labels.every(l=>l.point[0]>=35&&l.point[1]>=22));
 const base={...scene,revision:50};const combined=grid.draw(base,options);assert.equal(combined.tiles.length,2);assert.ok(combined.entries.has(scene.tiles[0].entry));
});
test('globe graticules remain finite across dateline and close polar views',()=>{
 const grid=new Graticule();
 for(const view of [{x:.999,y:.5,zoom:2},{x:.001,y:.02,zoom:17}]){
  const camera=sphereCamera(view,800,600,2,view.zoom===17?12:0);
  const scene=grid.draw(null,{view,width:800,height:600,dpr:2,camera});
  const data=scene.tiles.at(-1).entry.geometry.segments;assert.ok(data.length<1000000);assert.ok([...data].every(Number.isFinite));
 }
});

test('coordinate labels meet fixed viewport insets without tessellation jumps',()=>{
 const grid=new Graticule(),view={x:.2864699,y:.3733996,zoom:6.9691};
 const draw=zoom=>grid.draw(null,{view:{...view,zoom},width:1000,height:700,dpr:1,camera:null});
 const first=draw(view.zoom),second=draw(view.zoom+.001);
 const longitudes=first.labels.filter(l=>/[EW]$/.test(l.text));
 assert.ok(longitudes.length>0);assert.ok(longitudes.every(l=>Math.abs(l.point[1]-28)<.001));
 const latitudes=first.labels.filter(l=>/[NS]$/.test(l.text));
 assert.ok(latitudes.some(l=>Math.abs(l.point[0]-42)<.001));
 for(const label of longitudes){const next=second.labels.find(l=>l.text===label.text);if(next)assert.ok(Math.hypot(next.point[0]-label.point[0],next.point[1]-label.point[1])<2);}
});
