import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

test("real Blast saved/search store isolates accounts, respects blocks and expiry",async()=>{
  let viewer="a",blocked=false,stored="";
  const friends={a:["b"],b:["a"]};
  const people={a:{id:"a",name:"A"},b:{id:"b",name:"B"}};
  globalThis.__blastSavedFixture={
    api:{me:()=>people[viewer],user:id=>people[id],blocked:()=>blocked,canSee:()=>true},
    friends:id=>friends[id]||[]
  };
  globalThis.localStorage={getItem:()=>stored,setItem:(_,value)=>{stored=value;}};
  globalThis.window=new EventTarget();
  const {resetBlastCloudState}=await import("./blast-cloud-state.js");
  resetBlastCloudState();
  const source=(await readFile(new URL("./blast-video-note-store.js",import.meta.url),"utf8"))
    .replace('import { api } from "./store.js";',"const {api}=globalThis.__blastSavedFixture;")
    .replace('"./inbox-helpers.js"',JSON.stringify(new URL("./inbox-helpers.js",import.meta.url).href))
    .replace('import { listBlastFriends, listBlastGroups } from "./blast-store.js";',"const listBlastFriends=globalThis.__blastSavedFixture.friends;const listBlastGroups=()=>[];")
    .replace('"./blast-cloud-state.js"',JSON.stringify(new URL("./blast-cloud-state.js",import.meta.url).href));
  const store=await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  stored=JSON.stringify({version:1,notes:[{id:"expired",channel:"chat",authorId:"b",recipientId:"a",caption:"expired secret",expiresAt:1}],chats:[{users:["a","b"],messages:[
    {id:"m",kind:"text",authorId:"b",body:"the matching message",createdAt:2},
    {id:"n",kind:"video-note",noteId:"expired",createdAt:3}
  ]}],saved:[]});
  try{
    assert.equal(store.toggleBlastSavedMessage("b","m"),true);
    assert.equal(store.listBlastSavedMessages()[0].message.id,"m");
    assert.equal(store.searchBlastChats("matching")[0].match.message.id,"m");
    assert.equal(store.searchBlastChats("expired").length,0);
    assert.throws(()=>store.toggleBlastSavedMessage("b","n"),/can't be saved/);
    viewer="b";
    assert.deepEqual(store.listBlastSavedMessages(),[]);
    viewer="a";blocked=true;
    assert.deepEqual(store.listBlastSavedMessages(),[]);
    assert.throws(()=>store.toggleBlastSavedMessage("b","m"),/friends/i);
    blocked=false;friends.a=[];
    assert.deepEqual(store.listBlastSavedMessages(),[]);
    friends.a=["b"];
    assert.equal(store.toggleBlastSavedMessage("b","m"),false);
    assert.deepEqual(store.listBlastSavedMessages(),[]);
  }finally{
    resetBlastCloudState();
    delete globalThis.__blastSavedFixture;delete globalThis.localStorage;delete globalThis.window;
  }
});
