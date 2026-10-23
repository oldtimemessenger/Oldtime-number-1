import test from "node:test";
import assert from "node:assert/strict";
import {defaultRemixState,layerBounds,applyLayout,remixTextLines} from "./remix-compositor.js";
import {hitRemixLayer} from "./remix-workspace.js";
import {waitForVideoFrame} from "./remix-video.js";
test("direct canvas selection picks the top visible layer",()=>{
  const state=defaultRemixState();
  assert.equal(hitRemixLayer(state,378,672,540,960),"me");
  assert.equal(hitRemixLayer(state,100,100,540,960),"original");
  state.text="My thought";state.layers.text.x=70;state.layers.text.y=70;
  assert.equal(hitRemixLayer(state,378,672,540,960),"text");
});
test("split layers have independent selectable screen regions",()=>{
  const state=defaultRemixState();applyLayout(state,"split");
  assert.equal(hitRemixLayer(state,60,500,540,960),"original");
  assert.equal(hitRemixLayer(state,500,500,540,960),"me");
});
test("text and stickers have movable bounds rather than fixed positions",()=>{
  const state=defaultRemixState();state.text="Text";state.layers.text.x=30;
  const b=layerBounds(state,"text",540,960);
  assert.equal(b.x+b.width/2,162);
  state.sticker="star";state.layers.sticker.y=40;
  const s=layerBounds(state,"sticker",540,960);
  assert.equal(s.y+s.height/2,384);
});
test("camera readiness needs actual dimensions, not just a play promise",async()=>{
  const video=new EventTarget();Object.assign(video,{readyState:0,videoWidth:0,videoHeight:0});
  let done=false;const ready=waitForVideoFrame(video,1000).then(()=>done=true);
  video.dispatchEvent(new Event("playing"));await Promise.resolve();assert.equal(done,false);
  Object.assign(video,{readyState:2,videoWidth:720,videoHeight:1280});
  video.dispatchEvent(new Event("loadeddata"));await ready;assert.equal(done,true);
});
test("on-screen text preserves blank lines and complete emoji graphemes",()=>{
  assert.deepEqual(remixTextLines("One\n\nTwo"),["One","","Two"]);
  assert.deepEqual(remixTextLines("x".repeat(19)+"🇺🇸"+"y"),["x".repeat(19)+"🇺🇸","y"]);
});
