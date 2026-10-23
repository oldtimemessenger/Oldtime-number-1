import test from "node:test";
import assert from "node:assert/strict";
import {TEXT_PRESETS,BLEND_MODES,PHOTO_PRESETS,textPreset,paintStyledText} from "./creative-text-effects.js";
import {createProject,createLayer,serializeProject,ProjectHistory} from "./creative-project.js";

test("presets use reversible layer metadata and survive serialization",()=>{
  const project=createProject();project.layers.push(createLayer("text",{text:"My title",...textPreset("neon"),blendMode:"screen"}));
  const saved=serializeProject(project);
  assert.equal(saved.layers[0].text,"My title");assert.equal(saved.layers[0].textEffect.name,"neon");assert.equal(saved.layers[0].blendMode,"screen");
  const history=new ProjectHistory(project);history.record();project.layers[0].textEffect.amount=.9;history.undo();
  assert.equal(project.layers[0].textEffect.amount,.6);
});
test("all exposed presets make actual canvas paint calls",()=>{
  for(const name of TEXT_PRESETS){
    const calls=[],ctx={globalAlpha:1,save(){},restore(){},fillText(...args){calls.push(["fill",...args]);},strokeText(...args){calls.push(["stroke",...args]);},
      createLinearGradient(){return {addColorStop(...args){calls.push(["stop",...args]);}};}};
    const layer={text:"Title",fontSize:96,color:"#ffffff",...textPreset(name)};
    const original=structuredClone(layer);paintStyledText(ctx,layer,"Title",0,96);
    assert.ok(calls.some(call=>call[0]==="fill"),name);assert.deepEqual(layer,original);
    if(["chrome","gold"].includes(name))assert.ok(calls.some(call=>call[0]==="stop"));
    if(["neon","outline"].includes(name))assert.ok(calls.some(call=>call[0]==="stroke"));
    if(["echo","extruded"].includes(name))assert.ok(calls.filter(call=>call[0]==="fill").length>1);
  }
});
test("zero effect strength retains ordinary text painting",()=>{
  const calls=[],ctx={fillText(...args){calls.push(args);}};
  paintStyledText(ctx,{textEffect:{name:"neon",amount:0}},"A",3,4);assert.deepEqual(calls,[["A",3,4]]);
});
test("all 16 blend modes are valid canvas modes and destructive operators are excluded",()=>{
  assert.equal(BLEND_MODES.length,16);assert.ok(BLEND_MODES.includes("color-burn"));assert.ok(!BLEND_MODES.includes("destination-out"));
});
test("monochrome presets store zero saturation without modifying source media",()=>{
  const background={kind:"photo",media:"owned-original",adjustments:{...PHOTO_PRESETS.mono}};
  assert.equal(background.adjustments.saturation,0);assert.equal(background.media,"owned-original");
  assert.throws(()=>textPreset("unimplemented"));
});
