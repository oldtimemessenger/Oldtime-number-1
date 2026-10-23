import test from "node:test";
import assert from "node:assert/strict";
import {canvasGeometry} from "./creative-canvas-geometry.js";
test("fullscreen camera geometry accounts for horizontal cropping without stretching",()=>{
  const g=canvasGeometry({width:402,height:874},{width:1080,height:1920},"cover");
  assert.equal(g.scaleX,g.scaleY);assert.equal(g.offsetY,0);assert.ok(g.offsetX<0);
  const x=(201-g.offsetX)/g.scaleX,y=(437-g.offsetY)/g.scaleY;
  assert.ok(Math.abs(x-540)<.001);assert.ok(Math.abs(y-960)<.001);
});
test("studio geometry retains unboxed canvas coordinates",()=>{
  const g=canvasGeometry({width:360,height:640},{width:1080,height:1920});
  assert.equal(g.scaleX,1/3);assert.equal(g.scaleY,1/3);assert.equal(g.offsetX,0);
});
