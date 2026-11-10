import { MatchAdvisor } from "./advisor.js";
import { loadKnowledge } from "./knowledge.js";

if (!process.env.JEV_AI_API_KEY) throw Error("Configure JEV_AI_API_KEY before running the paid live replay.");
const db = await loadKnowledge();
const advisor = new MatchAdvisor(db, undefined, undefined, (event) => console.log(JSON.stringify(event)));
const abrams = "How should I counter an Abrams melee build?";
const billy = "What items do I get to counter Billies melee abilities?";
for (const [session, question] of [
  ["parry-followup", "What does Rebuttal do?"],
  ["parry-followup", "How does that help against Billy?"],
  ["parry-followup", "But what if I want to parry and stun the melee abilities of a character, is there any item that allows me to do that?"],
  ["solo-abrams", abrams],
  ["solo-billy", billy],
  ["same-player", abrams],
  ["same-player", billy],
  ["lookup", "List out the items that increase fire rate"],
  ["lookup", "What makes my gun shoot faster?"],
]) {
  console.log(question);
  console.log(await advisor.ask("local-replay", session, question));
}

