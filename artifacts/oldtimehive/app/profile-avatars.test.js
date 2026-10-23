import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {AVATAR_CHOICES,automaticAvatarChoice,automaticAvatar,avatarImage,resolveProfileAvatar} from "./profile-avatars.js";

test("automatic assignments stay stable and vary between accounts",()=>{
  assert.equal(automaticAvatar("account-12"),automaticAvatar("account-12"));
  const assigned=new Set(Array.from({length:100},(_,i)=>automaticAvatarChoice(`account-${i}`)));
  assert.equal(assigned.size,AVATAR_CHOICES.length);
});
test("every choice uses stable bundled artwork instead of an uploadable data URL",()=>{
  for(const choice of AVATAR_CHOICES) {
    assert.equal(avatarImage(choice.id), `/brand/avatars/${choice.id}.svg`);
    const svg=readFileSync(new URL(`../public/brand/avatars/${choice.id}.svg`, import.meta.url), "utf8").trim();
    assert.match(svg,/<svg/);assert.match(svg,/<clipPath/);
    assert.doesNotMatch(svg,/<script|<image|<foreignObject|href=/);
    const legacy = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    assert.equal(resolveProfileAvatar({id:"x",avatar:legacy},"legacy.svg"),avatarImage(choice.id));
  }
  assert.throws(()=>avatarImage("unknown"),/Unknown avatar/);
});
test("missing and legacy placeholder pictures receive a stable avatar",()=>{
  assert.equal(resolveProfileAvatar({id:"x",avatar:""},"legacy.svg"),automaticAvatar("x"));
  assert.equal(resolveProfileAvatar({id:"local",cloudAccountId:"remote",avatar:"legacy.svg"},"legacy.svg"),automaticAvatar("remote"));
});
test("uploaded pictures and chosen avatars are never overwritten",()=>{
  for(const image of ["data:image/png;base64,photo","https://example.test/photos/avatar.svg",avatarImage("green")]) {
    assert.equal(resolveProfileAvatar({id:"x",avatar:image},"legacy.svg"),image);
  }
});
