import test from "node:test";
import assert from "node:assert/strict";
import {drawProject} from "./creative-renderer.js";
import {createProject,createLayer} from "./creative-project.js";
test("photo looks apply equally to the background and its editable subject cutout",()=>{
  const project=createProject(),image={naturalWidth:360,naturalHeight:640},filters=[],stack=[];
  project.background={kind:"photo",media:"owned-photo",adjustments:{saturation:0,brightness:100,contrast:100}};
  project.layers=[createLayer("image",{media:"owned-cutout",subjectCutout:true,width:1080,height:1920})];
  const ctx={filter:"none",clearRect(){},save(){stack.push(this.filter);},restore(){this.filter=stack.pop();},scale(){},fillRect(){},translate(){},rotate(){},drawImage(){filters.push(this.filter);}};
  drawProject({width:1080,height:1920,getContext:()=>ctx},project,{get:()=>image},()=>null);
  assert.equal(filters.length,2);assert.equal(filters[0],filters[1]);assert.match(filters[1],/saturate\(0%\)/);
});
