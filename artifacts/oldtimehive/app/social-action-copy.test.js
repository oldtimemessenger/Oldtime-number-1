import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

const app=readFileSync(new URL("./app.js",import.meta.url),"utf8");
const handler=app.match(/async function follow\(id\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(handler,"The actual follow handler must be present.");

async function run({privateAccount=false,following=false,requested=false}={}) {
  const state={
    users:[{id:"self",following:following?["person"]:[],followers:[]},
      {id:"person",private:privateAccount,following:[],followers:following?["self"]:[]}],
    requests:requested?[{from:"self",to:"person"}]:[],
  };
  const messages=[];
  await new Script(`${handler}\nfollow("person");`).runInNewContext({
    api:{me:()=>state.users[0],user:id=>state.users.find(u=>u.id===id),db:()=>state,blocked:()=>false,authMode:()=>"local"},
    mutate:fn=>fn(state),notify:()=>{},render:()=>{},recordActivity:()=>{},
    toast:message=>messages.push(message),
  });
  return {state,message:messages.at(-1)};
}
test("a public follow confirms Following and maintains the relationship",async()=>{
  const {state,message}=await run();
  assert.equal(message,"Following");
  assert.deepEqual(state.users[0].following,["person"]);
  assert.deepEqual(state.users[1].followers,["self"]);
});
test("a public unfollow confirms Unfollowed",async()=>{
  const {state,message}=await run({following:true});
  assert.equal(message,"Unfollowed");
  assert.deepEqual(state.users[0].following,[]);
  assert.deepEqual(state.users[1].followers,[]);
});
test("private follow requests distinguish sending and canceling",async()=>{
  const added=await run({privateAccount:true});
  assert.equal(added.message,"Requested");
  assert.equal(added.state.requests.length,1);
  assert.equal(added.state.users[0].following.length,0);
  const canceled=await run({privateAccount:true,requested:true});
  assert.equal(canceled.message,"Follow request canceled");
  assert.equal(canceled.state.requests.length,0);
});
test("unfollowing an approved private account is not a request cancellation",async()=>{
  const {state,message}=await run({privateAccount:true,following:true});
  assert.equal(message,"Unfollowed");
  assert.equal(state.users[0].following.length,0);
});
