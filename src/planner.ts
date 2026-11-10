import { choice, decide } from "./models.js";
import { statLabels } from "./shop-lookup.js";
import { clean, signature, type Knowledge } from "./knowledge.js";

export const operations = {
  entity:
    "Read the description, stats or scaling of a KNOWN named or referenced game entity. Requires an identifiable subject.",
  stat: "Find all items that improve a player attribute, including a plain-language description of an attribute.",
  effects: "Discover WHICH items can enable one or more requested actions. The item is unknown.",
  matchup: "Retrieve the relevant opponent kit and the mechanics behind a fight.",
  compare: "Compare documented effects, tradeoffs or synergy.",
  rank: "Decide what item(s) the player should get or buy, including counters and purchase orders.",
} as const;
export type Operation = keyof typeof operations;
export async function planTurn(
  db: Knowledge,
  state: { question: string; history: unknown[]; reported: unknown },
  judge: typeof decide,
  signal?: AbortSignal,
) {
  const roster = Object.fromEntries(
    db.heroes.map((h, i) => [
      "h" + i,
      h.name +
        " — " +
        signature(h, db)
          .map((a) => a.name + " " + clean(a.description?.quip ?? ""))
          .join("; "),
    ]),
  );
  const normalize = (s: string) => s.toLowerCase().replace(/['’]/g, "").replace(/ies\b/g, "y");
  const currentTokens = normalize(state.question).split(/[^a-z0-9]+/);
  const identified = db.heroes.filter((h) =>
    currentTokens.some((t) => t === normalize(h.name) || t === normalize(h.name) + "s"),
  );
  const opponentOptions = identified.length
    ? Object.fromEntries(db.heroes.flatMap((h, i) => (identified.includes(h) ? [["h" + i, h.name]] : [])))
    : roster;
  const names = db.items
    .filter((a) => state.question.toLowerCase().includes(a.name.toLowerCase()))
    .map((a) => a.name);
  const result = await judge(
    {
      ...state,
      explicitShopNames: names,
      heroesNamedInLatestTurn: identified.map((h) => h.name),
      availableStats: statLabels(db.items).sort().join(", "),
    },
    {
      listStat: choice(
        "If the player explicitly wants the set of items granting a stat, which catalog field must be enumerated? Choose none for ordinary purchase advice or action descriptions.",
        {
          none: "No requested stat result set",
          ...Object.fromEntries(
            statLabels(db.items)
              .slice(0, 254)
              .map((label, i) => ["s" + i, label]),
          ),
        },
      ),
      first: choice("What is the PRIMARY evidence or action explicitly requested in the latest message?", {
        ...operations,
        clarify: "Impossible to answer without clarification",
        outside: "Unrelated to gameplay",
      }),
      next: choice(
        "Choose a DISTINCT additional operation only if required for a separate part of the request. Default to done for a simple question.",
        { done: "No additional operation required", ...operations },
      ),
      last: choice("Is a third distinct operation explicitly needed? Usually done.", {
        done: "No third operation",
        ...operations,
      }),
      reference: choice("Which references from earlier messages does this request depend on?", {
        fresh: "Self-contained; ignore previous subject",
        previous: "Resolve pronouns or omitted subject from the last exchange",
      }),
      enemy: choice("Identify a specific opponent only if the current request refers to that opponent.", {
        unknown: "No specific opponent",
        ...opponentOptions,
      }),
      ally: choice("Identify the player's own stated hero.", { unknown: "Unknown", ...roster }),
      build: choice("Player's stated damage build?", {
        unknown: "Unspecified",
        spirit: "Spirit",
        weapon: "Weapon",
      }),
      order: choice(
        "Does the question ask for purchase advice? Distinguish shopping advice from a factual database query.",
        {
          none: "No purchase decision; explanation or factual search",
          one: "Explicitly recommend one item",
          alternatives: "Recommend alternatives for this player",
          sequence: "Recommend an ordered build",
        },
      ),
      missing: choice("If clarification is required what detail is needed?", {
        goal: "Desired outcome",
        source: "Threat or attack",
        budget: "Available souls",
        build: "Player build",
      }),
    },
    signal,
  );
  const steps = [...new Set([result.first, result.next, result.last])].filter((k): k is Operation =>
    Object.hasOwn(operations, k),
  );
  const listStat = statLabels(db.items)[Number(result.listStat?.slice(1))];
  if (listStat && steps.includes("rank") && !steps.includes("stat")) steps.push("stat");
  const { reference, enemy, ally, build, order, missing } = result;
  // A purchase decision against an identified opponent needs opponent evidence.
  if (steps.includes("rank") && enemy && enemy !== "unknown" && !steps.includes("matchup"))
    steps.push("matchup");
  if (
    steps.includes("matchup") &&
    ["one", "alternatives", "sequence"].includes(order) &&
    !steps.includes("rank")
  )
    steps.push("rank");
  return { listStat, readiness: result.first, reference, enemy, ally, build, order, missing, steps };
}
