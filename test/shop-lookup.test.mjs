import test from "node:test";
import assert from "node:assert/strict";
import { MatchAdvisor } from "../dist/advisor.js";
import { shopLookup, messageParts, spokenAnswer } from "../dist/shop-lookup.js";
import { regularShop } from "../dist/normal-shop.js";

const stat = { label: "Fire Rate", value: "9", postfix: "%", tooltip_section: "innate" };
const rapid = {
  type: "upgrade",
  class_name: "upgrade_rapid_rounds",
  name: "Rapid Rounds",
  cost: 800,
  item_tier: 1,
  shopable: true,
  properties: { BonusFireRate: stat },
};
const dash = {
  ...rapid,
  name: "Kinetic Dash",
  cost: 1600,
  properties: {
    BonusFireRate: { ...stat, value: "25", tooltip_section: "passive" },
  },
  description: { desc: "Dash-Jump for the bonus." },
};
const slow = {
  ...rapid,
  name: "Enemy Slow",
  properties: { FireRateSlow: { ...stat, usage_flags: ["ConditionallyEnemyApplied"] } },
};
test("Jev routes a paraphrase to the complete normal shop lookup", async () => {
  const db = { items: [dash, slow, rapid], heroes: [], abilities: [] };
  const c = new MatchAdvisor(
    db,
    async (_, qs) => (qs.intent ? { intent: "lookup" } : qs.stat ? { stat: "s0" } : { valid: "yes" }),
    async () => "There are two options.",
  );
  const answer = await c.ask("g", "u", "What makes my gun shoot faster?");
  assert.match(answer, /2 regular shop items/);
  assert.match(answer, /Rapid Rounds.*800 souls.*\+9%/);
  assert.match(answer, /Kinetic Dash.*\+25%.*Dash-Jump/);
  assert.doesNotMatch(answer, /Buy|Enemy Slow/);
  assert.match(spokenAnswer(answer), /full list/);
  assert.doesNotMatch(
    shopLookup("Which attack speed items are under 1,600 souls?", db.items),
    /Kinetic Dash/,
  );
  assert.equal(shopLookup("Which fire rate items should I buy?", db.items), undefined);
});
test("regular membership requires reviewed class, availability and standard tier", () => {
  const regular = { ...rapid, class_name: "upgrade_healbane" };
  assert.equal(regularShop(regular), true);
  for (const change of [
    { class_name: "developer_test" },
    { item_tier: 5 },
    { shopable: false },
    { disabled: true },
  ])
    assert.equal(regularShop({ ...regular, ...change }), false);
});
test("long lists fit Discord and preserve the item lines", () => {
  const text = Array.from(
    { length: 100 },
    (_, i) => "• " + i + " regular shop test item with a trigger",
  ).join("\n");
  const pages = messageParts(text);
  assert.ok(pages.length > 1 && pages.every((p) => p.length <= 2000));
  assert.equal(pages.join("\n"), text);
});
