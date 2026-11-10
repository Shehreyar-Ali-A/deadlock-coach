import {clean,type Knowledge} from "./knowledge.js";

// Search what an item does. Innate resist stats are not evidence that it grants an action.
export const mechanics = {
  parry:"Parry or deflect an incoming attack or spell",
  stun:"Stun a target", silence:"Silence abilities", disarm:"Disarm weapons",
  interrupt:"Interrupt a channel", cleanse:"Remove debuffs", slow:"Slow movement",
  heal:"Heal or restore health", other:"A different mechanic"
};
const triggers:Record<string,RegExp> = {
  parry:/\bparr(?:y|ies|ied|ying)\b/i, stun:/\bstun(?:ned|s|ning)?\b/i,
  silence:/\bsilenc(?:e|es|ing|ed)\b/i, disarm:/\bdisarm\w*\b/i,
  interrupt:/\binterrupt\w*\b/i, cleanse:/\b(?:dispel|cleanse|remov\w* (?:all )?(?:debuffs|negative effects))\b/i,
  slow:/\bslow(?:s|ed|ing)?\b/i, heal:/\bheal(?:s|ing)?\b/i
};
export function capabilityEvidence(db:Knowledge, mechanic:string) {
  const pattern=triggers[mechanic];
  const items=db.items.flatMap(a=>{
    const text=[...new Set([a.description?.desc,...(a.tooltip_sections??[]).flatMap(s=>(s.section_attributes??[]).map(g=>g.loc_string))].filter((s):s is string=>Boolean(s)).map(clean))];
    const effects=text.filter(t=>pattern?.test(t));
    return effects.length?[{id:a.class_name,name:a.name,cost:a.cost,effects}]:[];
  });
  const base=db.abilities.find(a=>a.class_name==="citadel_ability_melee_parry");
  const innate=mechanic==="parry" && base && db.heroes.some(h=>Object.entries(h.items).some(([slot,id])=>slot.startsWith("ability_innate")&&id===base.class_name));
  return {items,base:innate?{id:base.class_name,name:base.name,hasStun:Number(base.properties?.ParriedStunTime?.value)>0}:undefined};
}
