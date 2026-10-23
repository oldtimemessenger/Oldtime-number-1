import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { HELP_GUIDES,helpGuide,readHelpState,pickHelpPrompt,recordHelpChoice,setHelpPaused,canShowHelp } from "./help-prompts.js";
import { mockCloudAccountState } from "./test-cloud-state.js";

const NOW=1800000000000;
const preferences={features:true,communities:true,membership:true,creator:true};
const context={hasCover:false,friendCount:0,hasNote:false};
function storage() {
  const values=new Map();
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
}
test("illustrated guides are context-specific and include working secondary routes",()=>{
  const fresh={lastShownAt:0,items:{}};
  const blast=pickHelpPrompt({...context,page:"blast"},fresh,preferences,NOW);
  assert.equal(blast.id,"help-blast");
  assert.equal(blast.primaryRoute,"help-blast-invite");
  assert.equal(blast.secondaryRoute,"help-article-blast");
  assert.equal(pickHelpPrompt({...context,page:"messages"},fresh,preferences,NOW).id,"help-chat-privacy");
  assert.equal(pickHelpPrompt({...context,page:"settings"},fresh,preferences,NOW).id,"help-privacy");
  assert.equal(pickHelpPrompt({...context,page:"home"},fresh,preferences,NOW).id,"help-welcome");
  assert.equal(pickHelpPrompt({...context,page:"camera"},fresh,preferences,NOW),null);
  assert.equal(pickHelpPrompt({...context,page:"home"},fresh,{features:false,communities:false},NOW),null);
});
test("shown and manually viewed guides never automatically repeat, even after cooldown",async()=>{
  const cloud=mockCloudAccountState("a");
  await recordHelpChoice("a","help-welcome","shown",NOW);
  await recordHelpChoice("a","help-cover","viewed",NOW+1);
  const reloaded=readHelpState("a");
  assert.equal(canShowHelp(reloaded,NOW+1000),false);
  const next=pickHelpPrompt({...context,page:"home"},reloaded,preferences,NOW+100*86400000);
  assert.ok(next);
  assert.notEqual(next.id,"help-welcome");
  assert.notEqual(next.id,"help-cover");
  cloud.switchAccount("b");
  assert.equal(pickHelpPrompt({...context,page:"home"},readHelpState("b"),preferences,NOW).id,"help-welcome");
  assert.equal(helpGuide("help-welcome").id,"help-welcome"); // Explicit replay remains possible.
  cloud.restore();
});
test("pause and never choices persist without suppressing manual learning",async()=>{
  const cloud=mockCloudAccountState("a");
  await recordHelpChoice("a","help-privacy","never",NOW);
  await setHelpPaused("a",true);
  assert.equal(canShowHelp(readHelpState("a"),NOW+100*86400000),false);
  assert.ok(helpGuide("help-privacy"));
  await setHelpPaused("a",false);
  assert.equal(pickHelpPrompt({...context,page:"settings"},readHelpState("a"),preferences,NOW+100*86400000).id,"help-chat-privacy");
  cloud.setState("a",{helpPreferences:{items:[],lastShownAt:0}});
  assert.equal(readHelpState("a"),null);
  assert.equal(canShowHelp(readHelpState("a"),NOW),false);
  cloud.restore();
});
test("each guide uses real optimized uploaded artwork, including membership",()=>{
  for(const image of [...HELP_GUIDES.map(guide=>guide.image),"membership.webp"]) {
    const bytes=readFileSync(new URL(`../public/guide/${image}`,import.meta.url));
    assert.equal(bytes.subarray(0,4).toString(),"RIFF");
    assert.equal(bytes.subarray(8,12).toString(),"WEBP");
    assert.ok(bytes.length<100000);
  }
  assert.equal(new Set(HELP_GUIDES.map(guide=>guide.id)).size,HELP_GUIDES.length);
});
test("existing identity badge remains unchanged, while new artwork is explanatory",()=>{
  const source=readFileSync(new URL("./creator-center.js",import.meta.url),"utf8");
  const css=readFileSync(new URL("./creator-center.css",import.meta.url),"utf8");
  assert.match(source,/M5 12\.5l4\.5 4\.5L19 7\.5/);
  assert.match(css,/\.ct-bb\{[^}]*border-radius:50%/);
  assert.match(source,/guide\/membership\.webp/);
  assert.doesNotMatch(source,/blueBadgeIcon/);
});
test("About Community and saving articles resolve before legacy help fallback",()=>{
  const source=readFileSync(new URL("./help-center.js",import.meta.url),"utf8")
    .replace(/^import .*;\n/gm,"").replace(/^export /gm,"");
  const factory=runInNewContext(`${source}; helpScreen;`,{
    esc:value=>String(value),illustration:()=>"",artImg:()=>"",document:{}
  });
  const blast=factory("help-article-blast",{});
  assert.equal(blast.title,"About Community");
  assert.match(blast.content,/server accepts them/);
  assert.match(blast.content,/data-exp-nav="help-blast"/);
  assert.equal(factory("help-article-saved",{}).title,"Saved messages");
  assert.equal(factory("help-article-unknown",{}),null);
});
