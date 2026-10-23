import test from "node:test";
import assert from "node:assert/strict";
import { createProject, createLayer, duplicateLayer, moveLayer, layerVisible, hitLayer, transformGesture, keepLayerInFrame, serializeProject, setProjectDuration, setProjectAspect, ProjectHistory, projectSources } from "./creative-project.js";
import { wrapLines } from "./creative-renderer.js";
import { videoMime } from "./creative-export.js";
const source = { postId: "original", commentId: "comment", commentAuthorId: "commenter", remixAuthorId: "me" };

test("comment cards retain references and transforms, not copied comment pixels or text", () => {
  const project = createProject(source), saved = serializeProject(project), item = saved.layers[0];
  assert.equal(item.kind, "comment"); assert.deepEqual(item.source, source);
  assert.deepEqual(item.position, { x: .5, y: .27 });
  assert.equal(item.scale, 1); assert.equal(item.rotation, 0);
  assert.equal(item.startTime, 0); assert.equal(item.endTime, 5);
});
test("two-finger pinch, rotation and translation are applied together without snapping", () => {
  const project = createProject(source), layer = project.layers[0], before = [{ x: 100, y: 100 }, { x: 200, y: 100 }];
  transformGesture(layer, { ...layer }, before, [{ x: 170, y: 180 }, { x: 170, y: 380 }], project);
  assert.equal(layer.scale, 2); assert.equal(layer.rotation, 90);
  assert.ok(Math.abs(layer.x - (.5 + 20 / 1080)) < 1e-8);
  assert.ok(Math.abs(layer.y - (.27 + 180 / 1920)) < 1e-8);
});
test("placed sticker layers remain draggable, pinch-resizable and rotatable", () => {
  const project=createProject(),sticker=createLayer("sticker",{sticker:"custom-text",text:"My words",width:560,height:180});
  project.layers.push(sticker);
  const initial={...sticker};
  transformGesture(sticker,initial,[{x:100,y:100},{x:200,y:100}],[{x:140,y:125},{x:140,y:325}],project);
  assert.equal(sticker.scale,2);
  assert.equal(sticker.rotation,90);
  assert.ok(Math.abs(sticker.x-(.5-10/1080))<1e-8);
  assert.ok(Math.abs(sticker.y-(.5+125/1920))<1e-8);
});
test("crossing the rotation angle boundary does not cause a full-circle jump", () => {
  const project = createProject(source), item = project.layers[0];
  transformGesture(item, { ...item }, [{ x: 0, y: 0 }, { x: -100, y: 1 }], [{ x: 0, y: 0 }, { x: -100, y: -1 }], project);
  assert.ok(Math.abs(item.rotation) < 2);
});
test("large rotated cards stay within the safe frame with no layout stretching", () => {
  const project = createProject(source), item = project.layers[0];
  item.x = 0; item.y = 0; item.scale = 3; item.rotation = 45;
  assert.equal(keepLayerInFrame(item, { width: 880, height: 500 }, project), true);
  assert.ok(item.scale < 1.2); assert.ok(item.x > .4); assert.ok(item.y > .2);
  assert.equal(item.width, 880);
});
test("duplicate transforms/timing are independent while source identity stays the same", () => {
  const project = createProject(source), original = project.layers[0], duplicate = duplicateLayer(project, original.id);
  assert.notEqual(duplicate.id, original.id); duplicate.rotation = 36; duplicate.source.commentId = "different";
  assert.equal(original.rotation, 0); assert.equal(original.source.commentId, "comment");
});
test("hit testing respects stacking, rotation, scale and individual visibility", () => {
  const project = createProject(source), text = createLayer("text", { x: .5, y: .27, rotation: 45 });
  project.layers.push(text);
  const sizes = new Map([[project.layers[0].id, { width: 880, height: 500 }], [text.id, { width: 200, height: 100 }]]);
  assert.equal(hitLayer(project, { x: 540, y: 518.4 }, sizes, 0).id, text.id);
  moveLayer(project, text.id, -1);
  assert.equal(hitLayer(project, { x: 540, y: 518.4 }, sizes, 0).kind, "comment");
  project.layers.find(item => item.kind === "comment").startTime = 2;
  assert.equal(hitLayer(project, { x: 540, y: 518.4 }, sizes, 0).id, text.id);
  assert.equal(hitLayer(project, { x: 0, y: 0 }, sizes, 0), null);
});
test("timeline length adapts to recordings without overwriting custom layer timing", () => {
  const project = createProject(source), text = createLayer("text", { startTime: 1, endTime: 3 }); project.layers.push(text);
  setProjectDuration(project, 12); assert.equal(project.layers[0].endTime, 12); assert.equal(text.endTime, 3);
  setProjectDuration(project, 2); assert.equal(text.endTime, 2); assert.ok(text.startTime < text.endTime);
  assert.equal(layerVisible(text, .5), false); assert.equal(layerVisible(text, 1.5), true);
});
test("text wraps long words and newlines without splitting multi-codepoint emoji", () => {
  const ctx = { measureText: value => ({ width: [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].length * 10 }) };
  assert.deepEqual(wrapLines(ctx, "hello world\n❤️❤️❤️", 50), ["hello", "world", "❤️❤️❤️"]);
  assert.deepEqual(wrapLines(ctx, "abcdefgh", 30), ["abc", "def", "gh"]);
});
test("all supported aspect ratios retain normalized object coordinates",()=>{
  const project=createProject(source),item=project.layers[0];
  for(const [ratio,width,height] of [["1:1",1080,1080],["4:5",1080,1350],["16:9",1920,1080],["9:16",1080,1920]]){
    setProjectAspect(project,ratio);assert.equal(project.width,width);assert.equal(project.height,height);assert.equal(item.x,.5);assert.equal(item.y,.27);
  }
});
test("undo and redo retain independent vector handwriting and erase operations",()=>{
  const project=createProject(),history=new ProjectHistory(project);
  history.record();const ink=createLayer("drawing",{strokes:[{points:[{x:0,y:0},{x:20,y:30}],width:10,color:"#f00"}]});project.layers.push(ink);
  history.record();ink.strokes.push({points:[{x:10,y:15}],width:25,erase:true});
  assert.equal(history.undo(),true);assert.equal(project.layers[0].strokes.length,1);
  assert.equal(history.redo(),true);assert.equal(project.layers[0].strokes[1].erase,true);
  assert.equal(history.undo(),true);assert.equal(history.undo(),true);assert.equal(project.layers.length,0);
});
test("hidden and locked layers cannot be selected by manipulation gestures",()=>{
  const project=createProject(source),item=project.layers[0],sizes=new Map([[item.id,{width:880,height:500}]]);
  item.locked=true;assert.equal(hitLayer(project,{x:540,y:518.4},sizes,0),null);
  assert.equal(hitLayer(project,{x:540,y:518.4},sizes,0,true).id,item.id);
  item.hidden=true;assert.equal(layerVisible(item,0),false);
});
test("multi-page serialization uses the first scene as poster and protects every source",()=>{
  const first=createProject(source),second=createProject({...source,commentId:"second"}),project=structuredClone(second);
  project.pages=[first,second];project.activePage=1;
  const saved=serializeProject(project);
  assert.equal(saved.layers[0].source.commentId,"comment");assert.equal(saved.pages.length,2);
  assert.equal(projectSources(saved).length,2);assert.equal(saved.pages[1].layers[0].zIndex,0);
});
test("recording prefers a supported WebM codec and falls back to MP4 when needed",()=>{
  const recorder=globalThis.MediaRecorder;
  try{
    globalThis.MediaRecorder={isTypeSupported:type=>["video/mp4","video/webm;codecs=vp9,opus"].includes(type)};
    assert.equal(videoMime(),"video/webm;codecs=vp9,opus");
    globalThis.MediaRecorder={isTypeSupported:type=>type==="video/mp4"};assert.equal(videoMime(),"video/mp4");
    globalThis.MediaRecorder={isTypeSupported:()=>false};assert.throws(videoMime,/unavailable/);
  }finally{if(recorder)globalThis.MediaRecorder=recorder;else delete globalThis.MediaRecorder;}
});
test("text starts without a background and an explicit background choice survives saving",()=>{
  const project=createProject(),text=createLayer("text",{text:"No automatic box"});
  assert.equal(text.backgroundOn,false);
  project.layers.push(text);assert.equal(serializeProject(project).layers[0].backgroundOn,false);
  text.backgroundOn=true;assert.equal(serializeProject(project).layers[0].backgroundOn,true);
});
