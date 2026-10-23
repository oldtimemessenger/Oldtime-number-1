import test from "node:test";
import assert from "node:assert/strict";
import {renderPostLikesRow} from "./post-likes-row.js";
test("no invented engagement or people, singular labels and overlapping true identities",()=>{
  assert.equal(renderPostLikesRow({count:0}),"");
  assert.match(renderPostLikesRow({count:3,people:[]}),/3<\/b> likes/);
  const row=renderPostLikesRow({id:"p",count:2,viewerId:"me",people:[{id:"me",displayName:"Real person",avatarUrl:"/photo.jpg"},{id:"other",displayName:"Other person"}]});
  assert.match(row,/Liked by/);assert.match(row,/>You<\/button>/);assert.match(row,/1<\/b> other</);
  assert.equal((row.match(/class="plr-face"/g)||[]).length,2);
  assert.match(renderPostLikesRow({count:1,people:[{id:"a",displayName:"Alice"}]}),/Liked by/);
  assert.doesNotMatch(renderPostLikesRow({count:1,people:[{id:"a",displayName:"Alice"}]}),/others/);
});
test("preview is capped and supplied text is escaped",()=>{
  const people=Array.from({length:5},(_,i)=>({id:`${i}`,displayName:i===0?"<unsafe>":`Person ${i}`}));
  const row=renderPostLikesRow({count:10,people});
  assert.equal((row.match(/class="plr-face"/g)||[]).length,3);assert.match(row,/&lt;unsafe&gt;/);
  assert.doesNotMatch(row,/<unsafe>/);
});
