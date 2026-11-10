import { clean, type Asset } from "./knowledge.js";
import { choice, decide, type Question } from "./models.js";

function passages(item: Asset) {
  return [
    ...new Set(
      [
        item.description?.desc,
        ...(item.tooltip_sections ?? []).flatMap((s) =>
          (s.section_attributes ?? []).map((p) => p.loc_string),
        ),
      ]
        .filter((x): x is string => Boolean(x))
        .map(clean),
    ),
  ];
}

// Jev's wire format returns choices. Anchor requirements in the player's own words.
function phrases(text: string) {
  const words = text.match(/[\p{L}\p{N}'-]+/gu) ?? [];
  const options: Record<string, string> = { whole: text, none: "No separate requirement" };
  for (let size = 1; size <= 4; size++)
    for (let i = 0; i + size <= words.length && Object.keys(options).length < 254; i++)
      options["p" + i + "_" + size] = words.slice(i, i + size).join(" ");
  return options;
}

export async function searchEffects(
  question: string,
  items: Asset[],
  judge: typeof decide,
  signal?: AbortSignal,
) {
  const available = items.filter((a) => passages(a).length);
  const options = Object.fromEntries(
    available.map((a, i) => ["i" + i, a.name + " — " + passages(a).join(" ").slice(0, 460)]),
  );
  const spans = phrases(question);
  const pick = await judge(
    { question },
    {
      first: choice("Select the phrase that names the main requested action.", spans),
      second: choice("Select a separate requested outcome, if any.", spans),
      best: choice("Locate the most relevant source for the requested action. Partial matches are useful.", {
        none: "No relevant source",
        ...options,
      }),
      alternative: choice("Locate a distinct second source if relevant.", {
        none: "No other source",
        ...options,
      }),
    },
    signal,
  );
  const requirements = [
    ...new Set(
      [pick.first, pick.second]
        .filter((x) => x && x !== "none")
        .map((x) => spans[x])
        .filter(Boolean)
        .flatMap((span) =>
          span
            .split(/\s+(?:and then|and)\s+/i)
            .map((part) => part.trim())
            .filter(Boolean),
        ),
    ),
  ];
  if (!requirements.length || requirements.length > 4) requirements.splice(0, requirements.length, question);
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{3,}/g) ?? []);
  const vocabulary = available.map((a) => words(passages(a).join(" ")));
  const terms = [...words(requirements.join(" "))];
  const counts = terms.map((term) => vocabulary.filter((doc) => doc.has(term)).length);
  const lexical = available
    .map((a, i) => ({
      a,
      score: terms.reduce(
        (sum, t, k) => sum + (counts[k] > 0 && counts[k] <= 8 && vocabulary[i].has(t) ? 1 / counts[k] : 0),
        0,
      ),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((x) => x.a);
  const candidates = [
    ...new Set([...available.filter((_, i) => [pick.best, pick.alternative].includes("i" + i)), ...lexical]),
  ];
  if (!candidates.length) return { requirements, items: [], jointlySupported: false };
  const checks: Record<string, Question> = {};
  const sources = candidates.map((a, i) => {
    const clauses = passages(a);
    const refs = Object.fromEntries(clauses.map((t, n) => ["e" + n, t]));
    for (const [j, requirement] of requirements.entries())
      checks["c" + i + "_" + j] = choice(
        "For " +
          a.name +
          ", which source supports '" +
          requirement +
          "' in the sense of the original question? Rewarding an existing action is different from enabling it.",
        { unknown: "Unsupported", ...refs },
      );
    checks["joint" + i] = choice(
      "Does the evidence explicitly establish the FULL request for " +
        a.name +
        " with the same actor, trigger and target?",
      {
        yes: "All requested conditions established together",
        no: "Partial, different trigger/target, or unverified",
      },
    );
    return { id: a.class_name, name: a.name, cost: a.cost, clauses };
  });
  const answers = await judge({ question, requirements, sources }, checks, signal);
  const evaluated = sources.map((source, i) => {
    const claims = requirements.map((requirement, j) => ({
      requirement,
      source: source.clauses.find((_, n) => answers["c" + i + "_" + j] === "e" + n) ?? null,
    }));
    return {
      ...source,
      claims,
      joint: claims.every((c) => c.source !== null) && answers["joint" + i] === "yes",
    };
  });
  const relevant = evaluated.filter(
    (item) =>
      item.joint ||
      item.claims.some((c) => c.source) ||
      (words(requirements[0]).size === 1 &&
        counts[terms.indexOf(requirements[0].toLowerCase())] <= 8 &&
        words(item.clauses.join(" ")).has(requirements[0].toLowerCase())) ||
      [pick.best, pick.alternative].some(
        (id) => available.find((_, i) => id === "i" + i)?.class_name === item.id,
      ),
  );
  return { requirements, items: relevant, jointlySupported: evaluated.some((item) => item.joint) };
}
