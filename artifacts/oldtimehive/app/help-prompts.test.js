import test from "node:test";
import assert from "node:assert/strict";
import {readHelpState,canShowHelp,pickHelpPrompt,recordHelpChoice} from "./help-prompts.js";
import {mockCloudAccountState} from "./test-cloud-state.js";
const DAY=86400000,NOW=10*DAY;
const prefs={features:true,communities:true};
test("completed tasks are not suggested and disabled categories stay disabled",()=>{
  const state={lastShownAt:0,items:{}};
  assert.equal(pickHelpPrompt({hasCover:true,friendCount:4,hasNote:true},state,prefs,NOW),null);
  assert.equal(pickHelpPrompt({hasCover:false,friendCount:0},state,{features:false,communities:false},NOW),null);
  assert.equal(pickHelpPrompt({hasCover:true,friendCount:0,hasNote:true},state,prefs,NOW).primaryRoute,"help-friends");
  assert.equal(pickHelpPrompt({hasCover:true,friendCount:2,hasNote:true},state,prefs,NOW).primaryRoute,"help-blast-invite");
  assert.equal(pickHelpPrompt({hasCover:true,friendCount:4,hasNote:false},state,prefs,NOW).primaryRoute,"help-note");
});
test("one prompt at most every 72 hours, with permanent per-prompt dismissal and account isolation",async()=>{
  const cloud=mockCloudAccountState("a");
  await recordHelpChoice("a","help-cover","shown",NOW);
  assert.equal(canShowHelp(readHelpState("a"),NOW+DAY),false);
  assert.equal(canShowHelp(readHelpState("a"),NOW+3*DAY),true);
  await recordHelpChoice("a","help-cover","never",NOW);
  const a=pickHelpPrompt({hasCover:false,friendCount:0},readHelpState("a"),prefs,NOW+4*DAY);
  assert.notEqual(a.id,"help-cover");
  cloud.switchAccount("b");
  assert.equal(pickHelpPrompt({hasCover:false,friendCount:0},readHelpState("b"),prefs,NOW+4*DAY).id,"help-cover");
  cloud.restore();
});
test("repeated dismissals and action choices reduce repeat ranking",async()=>{
  const cloud=mockCloudAccountState("a");
  await recordHelpChoice("a","help-cover","not-now",NOW);
  await recordHelpChoice("a","help-cover","not-now",NOW);
  assert.equal(pickHelpPrompt({hasCover:false,friendCount:0},readHelpState("a"),prefs,NOW).id,"help-friends");
  cloud.switchAccount("b");
  await recordHelpChoice("b","help-cover","action",NOW);
  assert.equal(pickHelpPrompt({hasCover:false,friendCount:0},readHelpState("b"),prefs,NOW).id,"help-friends");
  cloud.restore();
});
test("unavailable or malformed cloud state does not cause repeat prompts",async()=>{
  const cloud=mockCloudAccountState("a");
  cloud.setLoaded(false);
  assert.equal(readHelpState("a"),null);
  assert.equal(canShowHelp(null,NOW),false);
  cloud.setLoaded(true);
  cloud.setState("a",{helpPreferences:{items:[],lastShownAt:0}});
  assert.equal(readHelpState("a"),null);
  cloud.setState("a",{helpPreferences:{items:{},lastShownAt:0}});
  cloud.failUpdates(new Error("offline"));
  await assert.rejects(recordHelpChoice("a","help-cover","never",NOW),/offline/);
  cloud.restore();
});
test("prompts never interrupt composition and interest prompt needs explicit empty interests",()=>{
  const state={lastShownAt:0,items:{}},p={features:true};
  const ctx={page:"home",hasCover:true,friendCount:5,hasNote:true,interestsSet:false};
  assert.equal(pickHelpPrompt({...ctx,composing:true},state,p,NOW),null);
  assert.equal(pickHelpPrompt({...ctx,interestsSet:true},state,p,NOW)?.id!=="help-interests",true);
});
