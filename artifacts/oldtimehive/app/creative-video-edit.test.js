import {test} from "node:test";
import assert from "node:assert/strict";
import {initVideoEdit,editedDuration,splitVideoClip,updateVideoClip,videoPoint,adjustPixels,cropDimensions,syncVideoEdit} from "./creative-video-edit.js";

test("split retains actual source intervals and duration",()=>{
  const bg={kind:"video",media:"owned-video"},edit=initVideoEdit(bg,4);
  splitVideoClip(edit,1.5);assert.equal(edit.clips.length,2);assert.equal(editedDuration(edit),4);
  assert.deepEqual(edit.clips.map(({in:a,out:b})=>[a,b]),[[0,1.5],[1.5,4]]);
});
test("trim and speed change the output-to-source clock",()=>{
  const bg={kind:"video",media:"owned-video"},edit=initVideoEdit(bg,4);
  updateVideoClip(edit,0,{in:1,out:3,speed:.5});
  assert.equal(editedDuration(edit),4);assert.equal(videoPoint(bg,2).sourceTime,2);
  assert.equal(videoPoint(bg,2).speed,.5);
});
test("reordered clips map to their own source, not the original order",()=>{
  const bg={kind:"video",media:"owned-video"},edit=initVideoEdit(bg,4);
  splitVideoClip(edit,2);edit.clips.reverse();
  assert.equal(videoPoint(bg,0).sourceTime,2);assert.equal(videoPoint(bg,2.5).sourceTime,.5);
});
test("invalid trims and overlong slow motion leave the clip unchanged",()=>{
  const bg={kind:"video",media:"owned-video"},edit=initVideoEdit(bg,60),before=structuredClone(edit);
  assert.throws(()=>updateVideoClip(edit,0,{speed:.25}),/60 seconds/);
  assert.throws(()=>updateVideoClip(edit,0,{out:80}),/original video/);
  assert.throws(()=>splitVideoClip(edit,0),/inside the clip/);
  assert.deepEqual(edit,before);
});
test("saved edit metadata retains crop, color, split, trim and speed",()=>{
  const bg={kind:"video",media:"owned-video",crop:{x:.1,y:.2,width:.8,height:.6},adjustments:{brightness:120}};
  const edit=initVideoEdit(bg,4);splitVideoClip(edit,2);updateVideoClip(edit,1,{speed:2});
  const saved=JSON.parse(JSON.stringify(bg));assert.equal(editedDuration(saved.videoEdit),3);
  assert.deepEqual(saved.crop,bg.crop);assert.deepEqual(saved.adjustments,bg.adjustments);
});
test("pixel fallback changes actual RGB while preserving alpha",()=>{
  const pixels=new Uint8ClampedArray([100,150,200,180]);
  adjustPixels(pixels,{adjustments:{saturation:0}});
  assert.equal(pixels[0],pixels[1]);assert.equal(pixels[1],pixels[2]);assert.equal(pixels[3],180);
});
test("crop aspect follows the selected portion of the source",()=>{
  const size=cropDimensions({videoWidth:1080,videoHeight:1920},{width:1,height:.5625});
  assert.deepEqual(size,{width:1080,height:1080});
});
test("custom crops always have encoder-safe even dimensions",()=>{
  const size=cropDimensions({videoWidth:270,videoHeight:480},{width:.9478,height:.9706});
  assert.equal(size.width%2,0);assert.equal(size.height%2,0);assert.ok(size.width>64);
});
test("playback uses edited speed and start without looping the raw source",()=>{
  const bg={kind:"video",media:"owned-video"},edit=initVideoEdit(bg,4);updateVideoClip(edit,0,{in:1,out:3,speed:2});
  const video={currentTime:0,playbackRate:1,loop:true,paused:true,play(){this.paused=false;return Promise.resolve();}};
  syncVideoEdit(video,bg,.5,true);assert.equal(video.currentTime,2);assert.equal(video.playbackRate,2);assert.equal(video.loop,false);
});
