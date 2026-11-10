import test from "node:test";
import assert from "node:assert/strict";
import { MatchAdvisor } from "../dist/advisor.js";
const item=(name,desc)=>({type:"upgrade",class_name:name,name,cost:800,description:{desc}});
const db={version:1,heroes:[{name:"Billy",items:{ability_innate3:"citadel_ability_melee_parry"}}],
  abilities:[{name:"Parry",class_name:"citadel_ability_melee_parry",properties:{ParriedStunTime:{value:"2.75"}}}],
  items:[item("Rebuttal","On a successful parry heal yourself."),item("Counterspell","Your next parry protects you from enemy abilities."),item("Armor","Gain melee resistance.")]};
test("generic parry-and-stun question drops opponent evidence and preserves the limitation on fallback",async()=>{
  const traces=[],briefs=[];
  const judge=async(_,qs)=>qs.intent?{intent:"capability",enemy:"h0",scope:"generic",mechanic:"parry"}:{valid:"no"};
  const c=new MatchAdvisor(db,judge,async brief=>{briefs.push(brief);return "Counterspell always stuns Billy.";},t=>traces.push(t));
  const answer=await c.ask("g","u","Can I parry and stun a character's melee abilities?",{enemy:{hero:"Billy"}});
  assert.match(answer,/Counterspell/);assert.match(answer,/does not establish.*stuns its caster/);
  assert.doesNotMatch(answer,/Billy|Armor/);
  assert.doesNotMatch(JSON.stringify(briefs[0]),/Billy|Armor/);
  assert.deepEqual(traces[0].items.sort(),["Counterspell","Rebuttal"]);
  assert.equal(traces[0].enemy,"");
});
