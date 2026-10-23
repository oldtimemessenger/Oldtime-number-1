import test from "node:test";
import {bindCaptureModes} from "./creative-capture-modes.js";
import {renderCreativeEditor} from "./creative-editor-view.js";
test("capture modes initialize without the obsolete gallery button",t=>{
  const previous=globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame=fn=>fn();
  t.after(()=>{if(previous===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=previous;});
  const nodes={
    destination:{value:"post"},
    "capture-picker":{querySelectorAll:()=>[],querySelector:()=>null,addEventListener:()=>{}},
    "carousel-tray":{},
    "carousel-next":{}
  };
  const modes=bindCaptureModes({
    root:{},editor:{classList:{contains:()=>false},dataset:{}},q:name=>nodes[name]||null,
    project:{},assets:{},canEdit:()=>true,alive:()=>true,changed:()=>{}
  });
  assert.equal(modes.mode(),"photo");
  assert.equal(typeof nodes["carousel-next"].onclick,"function");
});
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {captureChoice} from "./creative-capture-modes.js";
test("swipe choices select capture type and audience destination without taking a picture",()=>{
  assert.deepEqual(captureChoice("story"),{capture:"photo",destination:"story"});
  assert.deepEqual(captureChoice("video"),{capture:"video",destination:"post"});
  assert.equal(captureChoice("carousel").capture,"photo");
  assert.throws(()=>captureChoice("quote"),/Unknown capture mode/);
  assert.throws(()=>captureChoice("unsupported"),/Unknown capture mode/);
});

test("Capture modes do not expose Quote",()=>{
  const html=renderCreativeEditor();
  for(const mode of ["photo","video","story","carousel"])assert.match(html,new RegExp(`data-ce-capture-mode="${mode}"`));
  assert.doesNotMatch(html,/data-ce-capture-mode="quote"|ce-quote-photo|Quote designs/);
});
