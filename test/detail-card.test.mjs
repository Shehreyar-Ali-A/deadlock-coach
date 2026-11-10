import test from "node:test";
import assert from "node:assert/strict";
import {MatchAdvisor} from "../dist/advisor.js";
import {spokenAnswer} from "../dist/shop-lookup.js";
const item={type:"upgrade",name:"Rebuttal",class_name:"rebuttal",cost:800,description:{desc:"On a successful parry, heal yourself."},properties:{
 cooldown:{label:"Parry Cooldown",prefix:"-",value:"1.25",postfix:"s",tooltip_section:"innate"},
 duration:{label:"Buff Duration",value:6,postfix:"s",tooltip_section:"passive"}
}};
const bash={type:"ability",class_name:"bash",name:"Bashdown",properties:{AbilityCastRange:{label:"Cast Range",value:"4m",postfix:"m"}},description:{desc:"The shockwave deals spirit damage.",t1_desc:"-10s Cooldown"}};
const db={version:1,items:[item],abilities:[bash],heroes:[{name:"Billy",items:{signature1:"bash"}}]};
for(const route of ["detail","compare"]) test("named item excludes remembered Billy kit in "+route,async()=>{
 const judge=async(_,qs)=>qs.intent?{intent:route,enemy:"h0",threat:"melee"}:{valid:"no"};
 const briefs=[]; const writer=async brief=>{briefs.push(brief);return "unverified";};
 const coach=new MatchAdvisor(db,judge,writer);
 const text=await coach.ask("guild","player","What does Rebuttal do?",{enemy:{hero:"Billy"}});
 assert.match(text,/\*\*Rebuttal · 800 souls\*\*\n\nOn a successful parry/);
 assert.match(text,/\*\*Always on\*\*\n• Parry Cooldown \*\*-1.25s\*\*/);
 assert.match(text,/\n\n\*\*Passive effect\*\*\n• Buff Duration/);
 assert.doesNotMatch(text,/Bashdown|Billy|unverified/);
 if(route==="compare"){assert.deepEqual(briefs[0].subjects.map(a=>a.name),["Rebuttal"]);assert.doesNotMatch(JSON.stringify(briefs[0]),/Bashdown|Billy/);}
 assert.doesNotMatch(spokenAnswer(text),/Buff Duration|\*\*/);
 const ability=await coach.ask("guild","player","What does Bashdown do?");
 assert.match(ability,/\*\*Upgrades\*\*\n• Tier 1/);
 assert.match(ability,/Cast Range \*\*4m\*\*/);
 assert.doesNotMatch(ability,/Rebuttal/);
});

