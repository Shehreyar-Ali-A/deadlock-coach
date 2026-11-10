import { test } from "node:test";
import assert from "node:assert/strict";
import { MatchAdvisor } from "../dist/advisor.js";
import { interactions } from "../dist/interactions.js";
import { choice, decide } from "../dist/models.js";
const ability = {
  name: "Shoulder Charge",
  class_name: "charge",
  description: { desc: "Hitting a wall stuns." },
  properties: {
    Damage: {
      label: "Damage",
      value: 30,
      scale_function: { specific_stat_scale_type: "ETechPower", stat_scale: 1.4 },
    },
  },
};
const item = {
  class_name: "reducer",
  name: "Debuff Reducer",
  cost: 1600,
  description: { desc: "Reduces the duration of negative effects." },
};
const spirit = {
  class_name: "extra",
  name: "Extra Spirit",
  cost: 800,
  properties: { TechPower: { value: 10, label: "Spirit Power", tooltip_section: "innate" } },
};
const db = {
  version: 1,
  heroes: [{ name: "Abrams", items: { signature2: "charge" } }],
  abilities: [ability],
  items: [item, spirit],
};

test("description-only matchup flows through Jev decisions and wording; independent budgets and reset", async () => {
  const seen = [];
  const judge = async (state, qs) => {
    if (qs.enemy)
      return {
        enemy: "h0",
        ally: "unknown",
        candidate: "s0",
        threat: "control",
        first: "matchup",
        next: "rank",
        order: "one",
      };
    if (qs.item) {
      assert.equal(state.abilities[0].stats[0].scale.stat_scale, 1.4);
      return {
        item: Object.keys(qs.item.criteria).find((k) => qs.item.criteria[k]?.startsWith("Debuff Reducer")),
        tactic: "wall",
      };
    }
    return { valid: "yes" };
  };
  const coach = new MatchAdvisor(db, judge, async (plan) => {
    seen.push(plan);
    return plan.verifiedNotes;
  });
  const q = "I have 700 souls. A bruiser keeps pinning me against a wall.";
  assert.match(await coach.ask("g", "a", q), /Save 900 more souls for Debuff Reducer/);
  assert.match(
    await coach.ask("g", "b", "Same wall stun", { player: { budget: 1800 } }),
    /Buy Debuff Reducer/,
  );
  assert.match(await coach.ask("g", "a", "That wall stun again"), /Save 900/);
  assert.match(seen.at(-1).verifiedNotes, /Save 900/);
  coach.reset("g", "a");
  assert.match(await coach.ask("g", "a", "That wall stun again"), /Buy Debuff Reducer/);
  assert.doesNotMatch(seen.at(-1).verifiedNotes, /Save 900/);
});
test("ability scaling and component links require explicit data", () => {
  const improved = { class_name: "improved", name: "Improved Spirit", component_items: ["extra"] };
  const links = interactions([spirit], [ability, improved, item]);
  assert.deepEqual(
    links.map((x) => x.to),
    ["Shoulder Charge", "Improved Spirit"],
  );
  assert.match(links[0].basis, /1.4/);
});
test("ambiguous threat asks a follow-up; rejected embellishment never reaches Discord", async () => {
  let first = true;
  const judge = async (state, qs) => {
    if (qs.enemy) {
      const intent = first ? "clarify" : "purchase";
      first = false;
      return { first: intent === "clarify" ? "clarify" : "rank", missing: "source", enemy: "unknown" };
    }
    if (qs.item) return { item: "i0", tactic: "wall" };
    return { valid: "no" };
  };
  const c = new MatchAdvisor(db, judge, async () => "It makes you immune for 30 seconds.");
  assert.match(await c.ask("g", "u", "Some hero killed me"), /What hit you/);
  const a = await c.ask("g", "u", "A charge into a wall");
  assert.match(a, /Debuff Reducer/);
  assert.doesNotMatch(a, /immune/);
});
test("Jev adapter checks the selected option against submitted criteria", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://jev-ai.pro/api/v1/systemone");
    assert.equal(JSON.parse(init.body).questions.action.type, "choice");
    return Response.json({ answers: { action: { type: "choice", choice: "made_up" } } });
  });
  await assert.rejects(
    decide({ question: "x" }, { action: choice("Decide", { buy: null, save: null }) }),
    /Invalid Jev decision/,
  );
});
