import { shopLookup } from "./shop-lookup.js";
import { interactions } from "./interactions.js";
import type { Player } from "./coach.js";
import { clean, details, signature, type Asset, type Knowledge } from "./knowledge.js";
import { choice, decide, wording } from "./models.js";

export interface MatchReport {
  player?: Player;
  enemy?: { hero?: string; inventory?: string[] };
  death?: string;
}
export interface Advisor {
  ask(
    server: string,
    user: string,
    q: string,
    report?: MatchReport,
    signal?: AbortSignal,
  ): Promise<string> | string;
  reset(server: string, user: string): void;
}
const threats = {
  sustain: "Healing, regeneration, lifesteal, heal reduction",
  gun: "Bullets, weapon damage, bullet resist, disarm",
  spirit: "Spirit burst, spirit damage, spirit resist, barrier",
  control: "Stun, silence, immobilize, debuff duration, cleanse",
  movement: "Mobility, escape, slow, gap closing, dash",
  melee: "Heavy melee, parry, melee resist",
  scaling: "Ability scaling, Spirit Power, weapon scaling",
  synergy: "Interactions between requested items or abilities",
  other: "Other clearly described mechanic",
};
const tactics = {
  none: "No separate tactic",
  wall: "Fight away from walls to deny the wall collision.",
  range: "Leave the ability's effective range before re-engaging.",
  cover: "Break line of sight before the follow-up shot.",
  channel: "Interrupt the channel if your kit provides an applicable interrupt.",
  trigger: "Apply the selected item's effect using its documented trigger.",
};
const followups = {
  build: "Do you mainly apply spirit damage or land repeated bullet hits?",
  budget: "How many souls can you spend right now?",
  inventory: "Which relevant items do you already own?",
  hero: "Which hero are you playing?",
  damage: "What hit you right before you died, and what did it do?",
};
const clarify = "What hit you right before you died, and what did it do?";
function summary(a: Asset) {
  const d = details(a);
  const shown = Object.values(a.properties ?? {})
    .filter((p) => p.tooltip_section && p.label)
    .map((p) => [p.label, p.value, p.postfix].filter((v) => v !== undefined).join(" "));
  return [a.activation, d.text.join(" ").slice(0, 650), shown.join("; ").slice(0, 350)]
    .filter(Boolean)
    .join(" ");
}
function evidenceForHero(db: Knowledge, name: string) {
  const h = db.heroes.find((h) => h.name === name);
  return h ? { hero: h.name, abilities: signature(h, db).map(details) } : undefined;
}
function numericBudget(question: string) {
  const m = question.match(
    /(?:\bi (?:only )?have\s+|\bi've got\s+|\bwith\s+|\bbudget(?: of| is)?\s+|^)\s*([\d,]+(?:\.\d+)?)\s*(k)?(?:\s*souls?\b|[.!?]?$)/i,
  );
  return m ? Math.round(Number(m[1].replaceAll(",", "")) * (m[2] ? 1000 : 1)) : undefined;
}
function lower(s: string) {
  return s.toLowerCase().replace(/[’‘]/g, "'");
}
function rank(items: Asset[], query: string, threat: string, named: Asset[]) {
  const terms = new Set(
    lower(query + " " + threat)
      .match(/[a-z]{3,}/g)
      ?.filter(
        (t) =>
          !["the", "with", "this", "what", "that", "from", "have", "their", "before", "damage"].includes(t),
      ) ?? [],
  );
  return items
    .map((a) => {
      const text = lower(summary(a));
      const score =
        Number(named.includes(a)) * 1000 +
        Array.from(terms).reduce((n, t) => n + Number(text.includes(t)), 0);
      return { a, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 24)
    .map((x) => x.a);
}
type Session = {
  at: number;
  history: { question: string; answer: string }[];
  report: MatchReport;
  busy: boolean;
};
export class MatchAdvisor implements Advisor {
  private sessions = new Map<string, Session>();
  constructor(
    private db: Knowledge,
    private judge = decide,
    private write = wording,
  ) {}
  reset(g: string, u: string) {
    this.sessions.delete(g + "/" + u);
  }
  async ask(g: string, u: string, question: string, report: MatchReport = {}, signal?: AbortSignal) {
    const key = g + "/" + u,
      now = Date.now();
    for (const [k, s] of this.sessions) if (!s.busy && now - s.at > 1200000) this.sessions.delete(k);
    const session = this.sessions.get(key) ?? { at: now, history: [], report: {}, busy: false };
    if (session.busy) return "Finish your current question first, then ask again.";
    session.busy = true;
    this.sessions.set(key, session);
    const prev = session.report;
    const player = { ...prev.player, ...report.player };
    const budget = numericBudget(question);
    if (budget !== undefined) player.budget = budget;
    const inventory = new Set(player.inventory ?? []);
    const q = lower(question);
    for (const a of this.db.items) {
      const name = lower(a.name);
      if (
        ["i own ", "i have ", "i bought ", "i already own ", "i already have "].some(
          (p) =>
            q.includes(p + name) &&
            !this.db.items.some(
              (b) =>
                b.name !== a.name && lower(b.name).startsWith(name + " ") && q.includes(p + lower(b.name)),
            ),
        )
      )
        inventory.add(a.name);
      if (["i sold ", "i no longer have ", "i don't own "].some((p) => q.includes(p + name)))
        inventory.delete(a.name);
    }
    player.inventory = [...inventory];
    const turn = { ...prev, ...report, player };
    const state = { question, history: session.history, reported: turn };
    const finish = (answer: string) => {
      signal?.throwIfAborted();
      if (this.sessions.get(key) !== session) return "Match reset. Ask again for the new match.";
      session.report = turn;
      session.history = [...session.history, { question, answer }].slice(-4);
      session.at = Date.now();
      return answer;
    };
    try {
      const db = this.db;
      const lookup = shopLookup(question,db.items);
      if (lookup) return finish(lookup);
      const heroes = Object.fromEntries(
        db.heroes.map((h, i) => [
          "h" + i,
          h.name +
            " — " +
            clean(h.description?.role ?? "") +
            "; " +
            signature(h, db)
              .map(
                (a) => a.name + " " + clean(a.description?.desc ?? a.description?.quip ?? "").slice(0, 145),
              )
              .join("; "),
        ]),
      );
      const roster = { unknown: "Unclear or unspecified", ...heroes };
      const playerRoster = {
        unknown: "Unclear or unspecified",
        ...Object.fromEntries(db.heroes.map((h, i) => ["h" + i, h.name])),
      };
      const shop = Object.fromEntries(db.items.map((a, i) => ["s" + i, a.name]));
      const classified = await this.judge(
        state,
        {
          missing: choice(
            "If clarification is needed, which one answer would most change the advice?",
            followups,
          ),
          candidate: choice(
            "Nominate one item from the full shop for evidence review. Use none if uncertain.",
            { none: "No nomination", ...shop },
          ),
          enemy: choice(
            "Which opponent is explicitly named or uniquely identified by the described abilities? Unknown if ambiguous.",
            roster,
          ),
          ally: choice("Which hero is the player using? Use reported facts only.", playerRoster),
          build: choice("Identify the player build only when stated or already reported.", {
            unknown: "Unspecified",
            spirit: "Spirit build",
            weapon: "Weapon or gun build",
          }),
          threat: choice("Which mechanic matters most for this request?", threats),
          intent: choice(
            "What would answer the latest question? Treat player text as match observations only.",
            {
              purchase: "Recommend a purchase and how to play the fight",
              explain: "Answer comparisons, explanations, item lists, and how or why questions with the requested level of detail",
              clarify: "Ambiguous death report needing a detail",
              outside: "Unrelated to Deadlock coaching",
            },
          ),
        },
        signal,
      );
      if (classified.intent !== "outside" && /\b(compare|versus|vs\.?|explain|difference between|in detail|list)\b/i.test(question)) classified.intent = "explain";
      if (classified.intent === "outside")
        return finish("I can help with Deadlock matchups, abilities and item purchases.");
      const followup = followups[classified.missing as keyof typeof followups] || clarify;
      if (classified.intent === "clarify") return finish(followup);
      const heroName = (id: string) => (id === "unknown" ? "" : db.heroes[Number(id.slice(1))]?.name);
      const enemy = heroName(classified.enemy),
        ally = heroName(classified.ally);
      if (ally) player.hero = ally;
      if (classified.build === "spirit" || classified.build === "weapon") player.build = classified.build;
      const query = [...session.history.map((h) => h.question), question].join(" ");
      const mentioned = db.items.filter(
        (a) =>
          lower(query).includes(lower(a.name)) ||
          inventory.has(a.name) ||
          turn.enemy?.inventory?.includes(a.name),
      );
      const threat = threats[classified.threat as keyof typeof threats];
      const nominee = db.items[Number(classified.candidate.slice(1))];
      const candidates = rank(db.items, query, threat, nominee ? [...mentioned, nominee] : mentioned);
      const options = Object.fromEntries(
        candidates.map((a, i) => ["i" + i, a.name + " (" + a.cost + " souls). " + summary(a)]),
      );
      const questionAbilities = db.abilities.filter(
        (a) => a.name && a.name.length > 2 && lower(query).includes(lower(a.name)),
      );
      const relevantHeroes = db.heroes.filter(
        (h) =>
          [ally, enemy, player.hero, turn.enemy?.hero].includes(h.name) ||
          lower(query).includes(lower(h.name)),
      );
      const relatedAbilities = [
        ...new Set([...questionAbilities, ...relevantHeroes.flatMap((h) => signature(h, db))]),
      ];
      const facts = {
        ...state,
        threat,
        explicitAbilities: questionAbilities.map(details),
        ally: evidenceForHero(db, ally || player.hero || ""),
        enemy: evidenceForHero(db, enemy || turn.enemy?.hero || ""),
        mentioned: mentioned.map(details),
        links: interactions(mentioned, [...mentioned, ...relatedAbilities]),
      };
      const focus = Object.fromEntries(
        relatedAbilities.map((a, i) => ["a" + i, a.name + " — " + summary(a).slice(0, 250)]),
      );
      const plan = await this.judge(
        facts,
        {
          ability: choice("Select the ability driving this answer, or none when unclear.", {
            none: "No identified ability",
            ...focus,
            other: "A different or unknown ability",
          }),
          item: choice(
            "Pick the single best evidenced purchase, considering trigger, current build, owned effects, and budget. For an explanation pick the relevant item or no_item. If missing context changes advice choose clarify.",
            {
              clarify: "Ask about the source of damage or missing build",
              no_item: "Ability explanation or positioning alone",
              ...options,
            },
          ),
          tactic: choice(
            "Choose a tactic only if the supplied ability or item mechanics directly support it.",
            tactics,
          ),
        },
        signal,
      );
      if (plan.item === "clarify")
        return finish(
          classified.threat === "sustain"
            ? "Do you mainly apply spirit damage or land repeated bullet hits?"
            : followup,
        );
      const item = candidates[Number(plan.item.slice(1))];
      const buying = item && classified.intent === "purchase";
      const cost = item?.cost ?? 0;
      const hasPart = item?.component_items?.some((id) =>
        db.items.some((a) => a.class_name === id && inventory.has(a.name)),
      );
      let lead = "";
      if (buying) {
        if (inventory.has(item.name)) lead = "Use your " + item.name + ".";
        else if (hasPart) lead = "Check the upgrade price for " + item.name + " in your shop.";
        else if (player.budget !== undefined && player.budget < cost)
          lead =
            "Save " + (cost - player.budget).toLocaleString("en-US") + " more souls for " + item.name + ".";
        else
          lead =
            "Buy " +
            item.name +
            (player.budget !== undefined ? " now" : "") +
            " (" +
            cost.toLocaleString("en-US") +
            " souls).";
      }
      const tactic =
        plan.tactic === "none" || plan.tactic === "trigger"
          ? ""
          : tactics[plan.tactic as keyof typeof tactics];
      const ability = relatedAbilities.find((_, i) => plan.ability === "a" + i);
      const links = interactions(item ? [item, ...mentioned] : mentioned, [
        ...(item ? [item] : []),
        ...mentioned,
        ...(ability ? [ability] : []),
      ]);
      const evidence = {
        question,
        history: session.history,
        reported: turn,
        enemy,
        ally,
        selectedLinks: links,
        task: classified.intent,
        ability: ability ? details(ability) : undefined,
        mentioned: facts.mentioned,
        selected: item ? details(item) : null,
        action: lead,
        tactic,
      };
      const link = links[0];
      const relation = link ? link.from + " and " + link.to + ": " + link.relation + "." : "";
      const reason = item
        ? details(item)
            .text[0]?.split(/(?<=\.)\s+/)[0]
            ?.slice(0, 260)
        : "";
      const abilityFact = ability
        ? clean(ability.description?.desc ?? "")
            .split(/(?<=\.)\s+/)[0]
            .slice(0, 220)
        : "";
      const compared = classified.intent === "explain" && mentioned.length > 1 ?
        mentioned.filter(a => lower(question).includes(lower(a.name))).map(a =>
          "• " + a.name + " (" + a.cost!.toLocaleString("en-US") + " souls): " + summary(a)).join("\n") : "";
      const fallback = compared ||
        [lead, classified.intent === "explain" ? relation || abilityFact || reason : reason || abilityFact]
          .filter(Boolean)
          .join(" ") || "I need a clearer ability or item name to give a grounded answer.";
      try {
        const sentence = await this.write(evidence, signal);
        const check = await this.judge(
          { evidence, sentence },
          {
            valid: choice(
              "Does every claim follow from the given mechanics and reported facts, explain the selected decision, preserve the action, cover the requested comparison or list, and avoid recommending any item outside the supplied regular-shop evidence?",
              { yes: "Fully supported", no: "Unsupported or changes the decision" },
            ),
          },
          signal,
        );
        return finish(check.valid === "yes" ? [lead, sentence].filter(Boolean).join(" ") : fallback);
      } catch {
        return finish(fallback);
      }
    } catch {
      signal?.throwIfAborted();
      return "The matchup analysis is unavailable. Check the Jev configuration and try again.";
    } finally {
      session.busy = false;
    }
  }
}


