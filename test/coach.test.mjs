import test from "node:test";
import assert from "node:assert/strict";
import { Coach, recommend } from "../dist/coach.js";
import { review, base } from "../dist/catalog.js";
import { packets, wav } from "../dist/speech.js";
import Opus from "opusscript";

// Local fixtures. Production never loads test data.
const items = Object.fromEntries([
  ["healSpirit", "Healbane", 1600], ["healWeapon", "Toxic Bullets", 3200],
  ["weapon", "Close Quarters", 800], ["spirit", "Extra Spirit", 800]
].map(([key, name, cost]) => [key, { name, cost, reason: "Fixture effect." }]));

test("Abrams, exact funds, and changing funds on the next turn", () => {
  const c = new Coach(items);
  assert.match(c.ask("g","a","I'm playing a spirit build and Abrams keeps healing through fights. I have 1,600 souls. What should I buy?"), /^Buy Healbane now \(1,600 souls\)/);
  assert.match(c.ask("g","a","500 souls"), /^Save 1,100 more souls for Healbane/);
  assert.match(c.ask("g","a","I already own Healbane"), /^Use your Healbane/);
});
test("interleaved players, same user in another guild, and reset", () => {
  const c = new Coach(items);
  assert.match(c.ask("g","a","Abrams keeps healing. I have 1600 souls"), /spirit damage or weapon damage\?/);
  assert.match(c.ask("g","b","Weapon build. Need anti-heal with 900 souls"), /^Save 2,300 more souls for Toxic Bullets/);
  assert.match(c.ask("g","a","I mainly deal spirit damage"), /^Buy Healbane now/);
  assert.match(c.ask("g","b","3.2k souls"), /^Buy Toxic Bullets now/);
  assert.match(c.ask("other","a","Need anti-heal"), /weapon damage\?/);
  c.reset("g","a");
  assert.match(c.ask("g","a","Need anti-heal"), /weapon damage\?/);
});
test("damage purchases and unrelated new questions", () => {
  const c = new Coach(items);
  assert.match(c.ask("g","a","I need more weapon damage"), /^Buy Close Quarters/);
  assert.match(c.ask("g","a","I need more spirit damage"), /^Buy Extra Spirit/);
  assert.match(c.ask("g","a","Which lane should I push?"), /^I only cover/);
  assert.match(c.ask("g","a","I'm dying to spirit damage"), /^I only cover/);
  assert.match(recommend("spirit",{inventory:["Extra Spirit"]},items), /^Use your Extra Spirit/);
});
test("changed mechanic or unavailable item cannot pass review", () => {
  const row = { class_name:"upgrade_healbane", type:"upgrade", item_tier:1,shopable:true, cost:1234, name:"Healbane",
    description:{desc:"Your spirit damage reduces the enemy's Incoming Healing."} };
  const snapshot = { version:1, retrieved:new Date().toISOString(), source:base+"/items/by-type/upgrade?language=english&client_version=1", assets:[row] };
  assert.equal(review(snapshot).healSpirit.cost,1234);
  for (const change of [{description:{}},{shopable:false},{cost:null},{disabled:true}]) {
    assert.deepEqual(review({...snapshot, assets:[{...row,...change}]}), {});
  }
});
test("20 ms playback packet decodes to a 16 kHz mono transcription frame", () => {
  const decoder = new Opus(16000,1,Opus.Application.VOIP);
  try {
    const frames = [...packets(Buffer.alloc(1921))];
    assert.equal(frames.length,2);
    const file = wav(decoder.decode(frames[0]));
    assert.equal(file.toString("ascii",0,4),"RIFF");
    assert.equal(file.readUInt32LE(24),16000);
    assert.equal(file.readUInt32LE(40),640);
  } finally { decoder.delete(); }
});

