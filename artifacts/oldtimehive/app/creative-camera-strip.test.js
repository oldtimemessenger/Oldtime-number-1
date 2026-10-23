import test from "node:test";
import assert from "node:assert/strict";
import { createCameraStrip } from "./creative-camera-strip.js";

test("real photo strip deduplicates, limits and selects photos without inventing gallery access", () => {
  const make=()=>({children:[],remove(){this.removed=true;},dataset:{},attributes:{},setAttribute(name,value){this.attributes[name]=value;},
    append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},
    scrollTo(){},querySelectorAll(){return this.children.flatMap(node=>node.children?.length?node.children:[node]).filter(node=>node.type==="button");}});
  const original=globalThis.document;globalThis.document={createElement:make};
  try {
    const host=make(),slot=make();let picked=null,upload=0;
    const strip=createCameraStrip({host,uploadHost:slot,max:2,onPick:url=>picked=url,onUpload:()=>upload++});
    assert.equal(host.dataset.count,0);assert.deepEqual(strip.items(),[]);
    slot.children[0].onclick();assert.equal(upload,1);assert.equal(host.children.length,2);assert.match(slot.children[0].children[0].src,/gallery-glyph\.png$/);
    strip.add("blob:first");strip.add("blob:second");strip.add("blob:second");strip.add("blob:third");
    assert.deepEqual(strip.items(),["blob:third","blob:second"]);assert.deepEqual(strip.thumbnails(),["blob:third","blob:second"]);
    host.children[1].children[0].onclick();assert.equal(picked,"blob:third");
    strip.add("blob:fourth","blob:thumb4");assert.deepEqual(strip.thumbnails(),["blob:thumb4","blob:third"]);
    host.children[1].children[0].onclick();assert.equal(picked,"blob:fourth");assert.equal(host.children[1].children[0].children[0].src,"blob:thumb4");
    const handle=host.children[0];assert.equal(handle.attributes["aria-label"],"Hide recent photos");handle.onclick();
    assert.equal(host.dataset.collapsed,"true");assert.equal(handle.attributes["aria-expanded"],"false");assert.equal(handle.attributes["aria-label"],"Show recent photos");strip.toggle(true);assert.equal(strip.collapsed(),false);
    strip.setDisabled(true);assert.ok(host.querySelectorAll().every(button=>button.disabled));assert.equal(slot.children[0].disabled,true);
    strip.dispose();assert.equal(host.children.length,0);assert.equal(slot.children[0].removed,true);assert.deepEqual(strip.items(),[]);
  } finally {globalThis.document=original;}
});
