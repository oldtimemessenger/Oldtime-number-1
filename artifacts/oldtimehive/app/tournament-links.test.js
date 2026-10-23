import test from "node:test";
import assert from "node:assert/strict";
import { tournamentLink } from "./tournament-links.js";

test("tournament shares preserve the app base and never grant private access", () => {
  const base = "https://oldtime.example/app/";
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(tournamentLink(`Join https://oldtime.example/app/?tournament=${id}.`, base), `${base}?tournament=${id}`);
  assert.equal(tournamentLink(`https://attacker.example/app/?tournament=${id}`, base), null);
  assert.equal(tournamentLink(`https://oldtime.example/other/?tournament=${id}`, base), null);
  assert.equal(tournamentLink(`${base}?tournament=not-a-tournament`, base), null);
  assert.equal(tournamentLink(`${base}?tournament=${id}&admin=true`, base), `${base}?tournament=${id}`);
});
