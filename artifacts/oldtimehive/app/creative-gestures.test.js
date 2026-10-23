import test from "node:test";
import assert from "node:assert/strict";
import { createProject, createLayer, transformGesture, ProjectHistory } from "./creative-project.js";
import { wrapLines } from "./creative-renderer.js";
import { bindCreativeGestures } from "./creative-gestures.js";

test("text pinch resizes type and reflows to one line without narrowing the box", () => {
  const project=createProject(), layer=createLayer("text",{text:"Good things take time",fontSize:96,width:760});
  const context={measureText:value=>({width:value.length*layer.fontSize/2})};
  assert.ok(wrapLines(context,layer.text,700).length>1);
  transformGesture(layer,{...layer},[{x:100,y:100},{x:300,y:100}],[{x:150,y:150},{x:250,y:150}],project);
  assert.equal(layer.fontSize,48); assert.equal(layer.width,760); assert.equal(layer.scale,1);
  assert.equal(wrapLines(context,layer.text,700).length,1);
  assert.equal(layer.y,.5+50/project.height);
});
test("text size is bounded and non-text layers keep normal scaling", () => {
  const project=createProject(), before=[{x:0,y:0},{x:100,y:0}], after=[{x:0,y:0},{x:2000,y:0}];
  const text=createLayer("text"), image=createLayer("image");
  transformGesture(text,{...text},before,after,project);
  assert.equal(text.fontSize,180);
  transformGesture(image,{...image},before,after,project);
  assert.equal(image.scale,3);
  transformGesture(text,{...text},before,[{x:0,y:0},{x:1,y:0}],project);
  assert.equal(text.fontSize,16);
});
test("font and width edits survive undo/redo and serialized draft data", () => {
  const project=createProject(); project.layers=[createLayer("text",{fontSize:96,width:760})];
  const history=new ProjectHistory(project); history.record();
  transformGesture(project.layers[0],{...project.layers[0]},[{x:0,y:0},{x:100,y:0}],[{x:0,y:0},{x:50,y:0}],project);
  project.layers[0].width=1040;
  history.undo(); assert.equal(project.layers[0].fontSize,96); assert.equal(project.layers[0].width,760);
  history.redo(); const restored=JSON.parse(JSON.stringify(project));
  assert.equal(restored.layers[0].fontSize,48); assert.equal(restored.layers[0].width,1040);
});
test("two-pointer text gestures checkpoint once, suppress click-to-type and never delete", () => {
  const handlers={},captured=new Set(),project=createProject(),layer=createLayer("text");
  project.layers=[layer];let selection=layer.id,checkpoints=0,removed=0,edited=0;
  const canvas={style:{},addEventListener:(name,fn)=>{handlers[name]=fn;},removeEventListener:()=>{},
    getBoundingClientRect:()=>({left:0,top:0,width:1080,height:1920}),
    setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id)};
  const trash={classList:{contains:()=>true,add(){},remove(){},toggle(){}},getBoundingClientRect:()=>({left:0,right:1080,top:0,bottom:1920})};
  const original=globalThis.getComputedStyle;globalThis.getComputedStyle=()=>({objectFit:"fill"});
  const dispose=bindCreativeGestures(canvas,{project,measurements:()=>new Map([[layer.id,{width:760,height:120}]]),
    time:()=>0,selected:()=>selection,select:id=>selection=id,changed(){},trash,remove:()=>removed++,
    options(){},drawing:()=>false,preview:()=>false,checkpoint:()=>checkpoints++,editText:()=>edited++});
  const pointer=(type,id,x,y)=>handlers[type]({type,pointerId:id,pointerType:"touch",clientX:x,clientY:y,preventDefault(){}});
  try {
    // First finger is outside the selected text, but the two-finger gesture
    // must still manipulate that selection rather than open a keyboard.
    pointer("pointerdown",1,40,100);pointer("pointerdown",2,240,100);
    pointer("pointermove",2,140,100);pointer("pointermove",1,60,100);
    pointer("pointerup",2,140,100);pointer("pointerup",1,60,100);
    let stopped=false;handlers.click({preventDefault(){},stopImmediatePropagation(){stopped=true;}});
    assert.ok(layer.fontSize<64);assert.equal(checkpoints,1);assert.equal(removed,0);assert.equal(edited,0);assert.equal(stopped,true);
  } finally {dispose();globalThis.getComputedStyle=original;}
});
