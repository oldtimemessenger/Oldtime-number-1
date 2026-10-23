import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {inflateSync} from "node:zlib";

test("the latest supplied intro image is used unchanged, not a generated cutout",()=>{
  const hash=path=>createHash("sha256").update(readFileSync(new URL(path,import.meta.url))).digest("hex");
  assert.equal(hash("../public/brand/oldtime-opening-red.jpeg"),hash("../../../attached_assets/IMG_0093_1791612555722.jpeg"));
});

test("the login logo has real transparency instead of a blue rectangular background",()=>{
  const png=readFileSync(new URL("../public/brand/oldtime-login-red.png",import.meta.url));
  assert.equal(png.subarray(1,4).toString(),"PNG");
  assert.equal(png[25],6,"RGBA pixels");
  assert.equal(png[28],0,"non-interlaced PNG");
  const chunks=[];
  for(let offset=8;offset+12<=png.length;){
    const length=png.readUInt32BE(offset);
    if(png.subarray(offset+4,offset+8).toString()==="IDAT") chunks.push(png.subarray(offset+8,offset+8+length));
    offset+=length+12;
  }
  // For the first pixel, all PNG filter predictors are zero.
  assert.equal(inflateSync(Buffer.concat(chunks))[4],0,"top-left background is fully transparent");
});
