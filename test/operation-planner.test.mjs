import test from "node:test";
import assert from "node:assert/strict";
import { searchEffects } from "../dist/effect-search.js";
import { MatchAdvisor } from "../dist/advisor.js";

const upgrade = (name, desc, properties = {}) => ({
  name,
  class_name: name,
  type: "upgrade",
  cost: 800,
  description: { desc },
  properties,
});
test("compound support must cite each requirement on the same item and pass the joint-trigger check", async () => {
  const items = [
    upgrade("Combined", "Interrupt a channel and silence its caster on activation."),
    upgrade("Split", "Interrupt on hit. Silence on reload."),
  ];
  const judge = async (_, qs) =>
    qs.best
      ? { first: "p0_1", second: "p2_1", best: "i0", alternative: "i1" }
      : { c0_0: "e0", c0_1: "e0", joint0: "yes", c1_0: "e0", c1_1: "e0", joint1: "no" };
  const result = await searchEffects("interrupt and silence", items, judge);
  assert.deepEqual(result.requirements, ["interrupt", "silence"]);
  assert.deepEqual(
    result.items.map((i) => i.joint),
    [true, false],
  );
  const split = await searchEffects("interrupt and silence", items, async (s, q) =>
    q.best
      ? judge(s, q)
      : { c0_0: "e0", c0_1: "unknown", joint0: "yes", c1_0: "unknown", c1_1: "e0", joint1: "yes" },
  );
  assert.equal(split.jointlySupported, false);
});
test("stat retrieval constrains the following purchase ranking", async () => {
  const p = { label: "Fire Rate", tooltip_section: "innate", value: 9, postfix: "%" };
  const db = {
    version: 7,
    heroes: [],
    abilities: [],
    items: [upgrade("Rounds", "Faster shots", { speed: p }), upgrade("Shield", "Protect the user")],
  };
  const calls = [];
  const c = new MatchAdvisor(
    db,
    async (s, qs) => {
      if (qs.first && qs.enemy) return { first: "stat", next: "rank", order: "one", reference: "fresh" };
      if (qs.item) {
        calls.push(qs.item.criteria);
        return { item: "i0" };
      }
      return { valid: "yes" };
    },
    async (b) => b.verifiedNotes,
  );
  const reply = await c.ask("g", "u", "List fire rate items and pick one.");
  assert.equal(calls.length, 1);
  assert.match(JSON.stringify(calls[0]), /Rounds/);
  assert.doesNotMatch(JSON.stringify(calls[0]), /Shield/);
  assert.match(reply, /Buy Rounds/);
  assert.match(reply, /regular shop items/);
});
