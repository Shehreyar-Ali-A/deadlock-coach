import test from "node:test";
import assert from "node:assert/strict";
import { heroEffects, counterEdges } from "../dist/effects.js";
import { MatchAdvisor } from "../dist/advisor.js";

const charge = {
  class_name: "charge",
  name: "Shoulder Charge",
  description: { desc: "Pushing a hero into a wall applies stun." },
};
const bash = {
  class_name: "slam",
  name: "Bashdown",
  description: {
    desc: "The slam deals melee damage. Its shockwave deals spirit damage and applies knockup.",
  },
};
const armor = {
  name: "Armor",
  class_name: "armor",
  cost: 800,
  properties: { resist: { label: "Melee Resist", value: 20, postfix: "%", tooltip_section: "innate" } },
};
const db = {
  version: 1,
  heroes: [
    { name: "Abrams", items: { signature1: "charge" } },
    { name: "Billy", items: { signature1: "slam" } },
  ],
  abilities: [charge, bash],
  items: [armor],
};

test("Bashdown damage components retain independent source and coverage", () => {
  const effects = heroEffects(db, "Billy");
  assert.deepEqual(
    effects.map((e) => e.kind),
    ["melee", "spirit", "control"],
  );
  assert.deepEqual(counterEdges([armor], effects, false)[0].targets, [effects[0].id]);
  assert.ok(effects.every((e) => e.version === 1 && e.abilityId === "slam"));
});

test("switching opponents replaces enemy evidence and preserves the purchase in a writer failure", async () => {
  const traces = [];
  const judge = async (state, questions) => {
    if (questions.intent) {
      const billy = state.question.includes("Billy");
      return { intent: billy ? "counter_items" : "strategy", enemy: billy ? "h1" : "h0", threat: "melee" };
    }
    if (questions.item) {
      if (state.enemy === "Billy") {
        assert.deepEqual(state.history, []);
        assert.ok(state.effects.every((e) => e.hero === "Billy"));
        assert.equal(state.reported.enemy.inventory, undefined);
      }
      return { item: "i0", second: "none", ability: "a0" };
    }
    throw Error("Unexpected judge call");
  };
  const advisor = new MatchAdvisor(
    db,
    judge,
    async () => {
      throw Error("offline writer");
    },
    (t) => traces.push(t),
  );
  await advisor.ask("g", "p", "Abrams melee build", { enemy: { hero: "Abrams", inventory: ["Armor"] } });
  const answer = await advisor.ask("g", "p", "Items against Billy melee abilities?");
  assert.match(answer, /Billy.*Bashdown/);
  assert.match(answer, /Armor.*Melee Resist/);
  assert.doesNotMatch(answer, /Abrams/);
  assert.deepEqual(
    traces.map((t) => t.route),
    ["strategy", "counter_items"],
  );
  assert.equal(traces[1].fallback, "writer-unavailable");
});
