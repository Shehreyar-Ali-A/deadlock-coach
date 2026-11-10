import {capabilityEvidence,mechanics} from "./capabilities.js";
import { describeAsset } from "./detail-card.js";
import { heroEffects, counterEdges } from "./effects.js";
import { lookupStat, statLabels } from "./shop-lookup.js";
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
    private trace = (event: object) => {
      if (process.env.COACH_TRACE === "1") console.info(JSON.stringify(event));
    },
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
      session.history = [...state.history, { question, answer }].slice(-4);
      session.at = Date.now();
      return answer;
    };
    const trace = {
      version: this.db.version,
      route: "routing",
      enemy: "",
      effects: [] as string[],
      items: [] as string[],
      fallback: "",
      calls: 0,
    };
    const judge: typeof decide = (...args) => {
      trace.calls++;
      return this.judge(...args);
    };
    let safeAnswer = "I couldn't resolve that question. Which hero, item, or ability should I look at?";
    try {
      const db = this.db;
      const heroes = Object.fromEntries(
        db.heroes.map((h, i) => [
          "h" + i,
          h.name +
            " — " +
            signature(h, db)
              .map((a) => a.name + " " + clean(a.description?.desc ?? "").slice(0, 120))
              .join("; "),
        ]),
      );
      const roster = { unknown: "Unspecified", ...heroes };
      const route = await judge(
        state,
        {
          intent: choice(
            "Choose the deliverable for the latest turn. Resolve pronouns from recent turns. Distinguish a request for strategy from a request for counter-items.",
            {
              capability:"Whether a shop item enables an action (including parrying abilities) or a combination such as parry plus stun. Use this even after a matchup discussion.",
              lookup:
                "Find items that grant a stat, including colloquial descriptions such as making a gun shoot faster.",
              detail: "Explain what a specific item or ability does, its stats or upgrades. Explicit names in the current turn take priority over older matchups.",
              compare: "Compare alternatives, explain scaling or a relationship between named subjects.",
              strategy:
                "How to play against a hero/build: explain the decisive mechanic and a practical response.",
              counter_items:
                "Which purchases counter an opponent or specific ability? Explain each option's coverage.",
              purchase: "One immediate purchase for the player's build, with budget if supplied.",
              plan: "Order multiple purchases and explain synergy, upgrade dependencies and tradeoffs.",
              clarify: "A necessary detail is missing and useful conditional advice is impossible.",
              outside: "Unrelated to gameplay.",
            },
          ),
          mechanic:choice("For a capability question choose the enabling action. If the player wants a result after a parry, the enabling action is parry.",mechanics),
          scope:choice("Does the latest request refer to a particular opponent, explicitly or via a pronoun? A character or any hero in general is generic, even if a hero was discussed previously.",{generic:"Independent of a particular opponent",matchup:"Named or referenced opponent"}),
          enemy: choice(
            "Identify the current opponent from the latest question. A newly named opponent replaces the previous one.",
            roster,
          ),
          ally: choice("Which hero is the player using? Do not confuse them with the enemy.", {
            unknown: "Unspecified",
            ...Object.fromEntries(db.heroes.map((h, i) => ["h" + i, h.name])),
          }),
          threat: choice("Which mechanic is central to this turn?", threats),
          build: choice("What build did the player report for themselves?", {
            unknown: "Unspecified",
            weapon: "Gun build",
            spirit: "Spirit build",
          }),
          missing: choice("If clarification is essential, what information is missing?", followups),
        },
        signal,
      );
      const task = (trace.route = route.intent);
      const enemy = route.scope === "generic" ? undefined : (db.heroes.find((_, i) => route.enemy === "h" + i)?.name ?? report.enemy?.hero);
      const ally = db.heroes.find((_, i) => route.ally === "h" + i)?.name;
      if (ally) player.hero = ally;
      if (route.build === "spirit" || route.build === "weapon") player.build = route.build;
      const switched = Boolean(enemy && prev.enemy?.hero && enemy !== prev.enemy.hero);
      if (enemy) turn.enemy = { ...(switched ? {} : prev.enemy), ...report.enemy, hero: enemy };
      if (switched) {
        state.history = [];
        if (!report.death) delete turn.death;
      }
      trace.enemy = enemy ?? "";
      const focus = followups[route.missing as keyof typeof followups] || clarify;
      let evidence: Record<string, unknown> = {
        question,
        task,
        reported: turn,
        enemy,
        history: state.history,
      };
      let table = "";
      let card: ReturnType<typeof describeAsset> | undefined;
      let coachingNotes = false;
      let requiredNames: string[] = [];
      if (task === "capability") {
        const result=capabilityEvidence(db,route.mechanic);
        trace.items=result.items.map(i=>i.id);
        trace.effects=result.base?[result.base.id]:[];
        const baseFact=result.base ? "Melee parry is innate. A successful normal melee parry"+(result.base.hasStun?" can stun the attacker.": " requires no purchase.") : "";
        const requestsStun=/\bstun(?:ning|s|ned)?\b/i.test(question);
        const limit=route.mechanic==="parry" && requestsStun && !result.items.some(i=>i.effects.some(t=>/\bstun\w*/i.test(t)))
          ? "The shop text does not establish that parrying an ability stuns its caster." : "";
        const rows=result.items.map(i=>"• **"+i.name+"** ("+i.cost!.toLocaleString("en-US")+" souls) — "+i.effects.join(" "));
        safeAnswer=[limit,baseFact,rows.join("\n")].filter(Boolean).join("\n\n") || "I cannot verify a shop item that enables that action.";
        evidence={task,question,opponent:enemy,baseFact,limit,items:result.items,
          instruction:"Answer the entire requested combination. Distinguish an item enabling an action from one rewarding an already successful action. Protection is not a stun. Explicitly state any supplied limitation. Do not infer parry eligibility from melee damage."};
        if (!result.items.length && !baseFact) return finish(safeAnswer);
        if (limit) evidence.requiredLimitation=limit;
      } else if (task === "lookup") {
        const labels = statLabels(db.items);
        // Prefer the generic stat over per-kill/conditional variants; the lookup includes those variants.
        const choices = Object.fromEntries(
          labels
            .filter((l) => !l.includes(" per "))
            .slice(0, 254)
            .map((l, i) => ["s" + i, l]),
        );
        const exact = labels
          .filter((l) => (" " + lower(question).replace(/[^a-z0-9 ]/g, " ") + " ").includes(" " + l + " "))
          .sort((a, b) => b.length - a.length)[0];
        const picked = exact
          ? { stat: "" }
          : await judge(
              { question, history: state.history },
              {
                stat: choice(
                  "Resolve the player's meaning to the general positive shop stat. For shooting frequency use Fire Rate.",
                  { unknown: "No matching stat", ...choices },
                ),
              },
              signal,
            );
        const stat = exact ?? choices[picked.stat];
        if (!stat) {
          safeAnswer = "Which shop stat are you looking for?";
          evidence = { ...evidence, missing: "shop stat" };
        } else {
          const found = lookupStat(question, db.items, stat);
          trace.items = found.matches.map((m) => m.itemId);
          safeAnswer = found.text;
          table = found.text;
          evidence = {
            question,
            task,
            stat,
            count: found.matches.length,
            examples: found.matches.slice(0, 2),
            delivery:
              "In one sentence introduce the list with the cheapest item and its bonus. The verified table follows.",
          };
        }
      } else if (task === "outside" || task === "clarify") {
        safeAnswer = task === "outside" ? "I can help with Deadlock gameplay questions." : focus;
        evidence = { ...evidence, missing: route.missing };
      } else {
        const effects = heroEffects(db, enemy);
        const edges = counterEdges(db.items, effects, route.threat === "melee");
        trace.effects = effects.map((e) => e.id);
        const history = state.history.map((h) => h.question).join(" ");
        const named = (source: string) => db.items.filter((a) => lower(source).includes(lower(a.name)));
        const current = named(question);
        const referenced = current.length
          ? current
          : named([history, state.history.at(-1)?.answer ?? ""].join(" "));
        const mentioned = [
          ...new Set([
            ...referenced,
            ...db.items.filter((a) => inventory.has(a.name) || turn.enemy?.inventory?.includes(a.name)),
          ]),
        ];
        const subject = db.abilities.filter(
          (a) => a.name && a.name.length > 2 && lower(question).includes(lower(a.name)),
        );
        const kit = db.heroes
          .filter((h) => [ally, enemy, player.hero].includes(h.name))
          .flatMap((h) => signature(h, db));
        const abilities = [...new Set([...subject, ...kit])];
        const facts = {
          ...evidence,
          effects,
          mentioned: mentioned.map(details),
          abilities: abilities.map(details),
          relationships: interactions(mentioned, [...mentioned, ...abilities]),
          uncertainty:
            "Melee damage alone does not establish a parryable hit. Treat a reported build as a description; unknown enemy inventory stays unknown.",
        };
        if (task === "detail" || task === "compare") {
          const explicit = [...current, ...subject];
          const namedHeroes = db.heroes.filter(h => lower(question).includes(lower(h.name)));
          const namedKit = namedHeroes.flatMap(h => signature(h,db));
          let targets = [...new Set(explicit.length ? explicit : namedKit)];
          if (!targets.length) {
            const last = state.history.at(-1);
            const previous = last?.answer ?? "";
            targets = [...named(previous), ...db.abilities.filter(a => a.name && a.name.length>2 && lower(previous).includes(lower(a.name)))];
            if (task === "detail" && targets.length !== 1) targets = [];
          }
          trace.enemy = namedHeroes.map(h=>h.name).join(", ");
          trace.effects = [];
          trace.items = targets.filter(a=>db.items.includes(a)).map(a=>a.class_name);
          const cards = targets.map(describeAsset);
          const fullCard = (c:ReturnType<typeof describeAsset>) => [c.title,c.body,c.stats].filter(Boolean).join("\n\n");
          safeAnswer = cards.length ? cards.map(fullCard).join("\n\n") : "Which item or ability would you like me to explain?";
          evidence = {question, task, subjects:targets.map(details), matchupEvidence:namedKit.filter(a=>!targets.includes(a)).map(details), relationships:interactions(targets,[...targets,...namedKit]),
            delivery:"Explain the requested subjects only. Use short paragraphs and bullets for comparisons. The app displays the stat sections for a single subject, so summarize its mechanics without repeating the stat list."};
          if (!targets.length || (task === "detail" && cards.length === 1 && !namedHeroes.length)) return finish(safeAnswer);
          if (cards.length===1) card=cards[0];
          else table=cards.map(c=>[c.title,c.stats].filter(Boolean).join("\n\n")).join("\n\n");
        } else {
          const linked = db.items.filter((a) => edges.some((e) => e.itemId === a.class_name));
          const candidates = rank(
            db.items,
            question,
            threats[route.threat as keyof typeof threats] ?? "",
            mentioned,
          );
          const pool = [...new Set([...mentioned, ...linked, ...candidates])];
          const options = {
            none: "No supported purchase",
            ...Object.fromEntries(
              pool.map((a, i) => ["i" + i, a.name + " (" + a.cost + " souls) " + summary(a)]),
            ),
          };
          const abilityOptions = {
            none: "No single identified ability",
            ...Object.fromEntries(abilities.map((a, i) => ["a" + i, a.name])),
          };
          const supported = edges.length
            ? pool.filter((a) => edges.some((e) => e.itemId === a.class_name))
            : pool;
          const secondaryOptions =
            task === "counter_items"
              ? {
                  none: "No further supported option",
                  ...Object.fromEntries(
                    supported.map((a) => [
                      "i" + pool.indexOf(a),
                      a.name +
                        " (" +
                        a.cost +
                        " souls) " +
                        edges
                          .filter((e) => e.itemId === a.class_name)
                          .map((e) => e.mechanic + " covers " + e.targets.join(","))
                          .join("; "),
                    ]),
                  ),
                }
              : options;
          const questions: Parameters<typeof decide>[1] = {
            ability: choice(
              "Which ability best explains the latest question? For a melee build select the ability enabling close-range attacks, especially a charge or stun; for melee abilities select the source of melee damage.",
              { ...abilityOptions, other: "Unknown" },
            ),
            item: choice(
              "Prioritize the damage or setup the player reported over unrelated parts of the enemy kit. For a reported melee build prioritize melee resistance or denying the melee setup unless healing is explicitly the problem. Choose the best supported first purchase or an owned response. Consider actual price, threat and trigger. A strategy may require positioning alone.",
              options,
            ),
          };
          if (task === "counter_items" || task === "plan")
            questions.second = choice(
              task === "plan"
                ? "Which distinct purchase comes next and complements the first? Choose none if unsupported."
                : "Which alternative most cost-effectively addresses a DIFFERENT damage component? Prefer substantial resistance over an expensive incidental stat. Choose none if redundant.",
              secondaryOptions,
            );
          const decision = await judge({ ...facts, edges }, questions, signal);
          const ability = abilities.find((_, i) => decision.ability === "a" + i);
          const selected = [...new Set([decision.item, decision.second])].flatMap((id) =>
            pool.filter((_, i) => id === "i" + i),
          );
          coachingNotes = true;
          let remainingBudget = player.budget;
          const actions = selected.map((a) => {
            const owned = inventory.has(a.name);
            const component = a.component_items?.some((id) =>
              db.items.some((b) => b.class_name === id && inventory.has(b.name)),
            );
            const upgradesPrior =
              task === "plan" &&
              a.component_items?.some((id) =>
                selected.slice(0, selected.indexOf(a)).some((prior) => prior.class_name === id),
              );
            const checkPrice = Boolean(component || upgradesPrior);
            const shortfall =
              owned || checkPrice || remainingBudget === undefined
                ? undefined
                : Math.max(0, a.cost! - remainingBudget);
            if (task === "plan" && !owned && remainingBudget !== undefined)
              remainingBudget = checkPrice ? undefined : Math.max(0, remainingBudget - a.cost!);
            return {
              name: a.name,
              cost: a.cost,
              owned,
              component: checkPrice,
              shortfall,
              effect: clean(a.description?.desc ?? ""),
              stats: summary(a).slice(0, 430),
              coverage: edges.filter((e) => e.itemId === a.class_name),
            };
          });
          requiredNames = selected.map((a) => a.name);
          trace.items = selected.map((a) => a.class_name);
          const selectedEffects = effects.filter((e) => e.abilityId === ability?.class_name);
          evidence = {
            ...evidence,
            focusAbility: ability
              ? { name: ability.name, description: clean(ability.description?.desc ?? "") }
              : undefined,
            effects: selectedEffects.length ? selectedEffects : effects,
            actions,
            uncertainty: facts.uncertainty,
            relationships: interactions([...mentioned, ...selected], [...selected, ...abilities]),
            sequenceTotal:
              task === "plan" &&
              actions.every((a) => !a.component && !a.owned) &&
              !selected.some((a) => selected.some((b) => a.component_items?.includes(b.class_name)))
                ? selected.reduce((n, a) => n + a.cost!, 0)
                : undefined,
          };
          const threatFact = selectedEffects[0] ?? effects[0];
          const positioning = effects.find((e) => e.positioning)?.positioning;
          if (task === "strategy" && positioning) evidence.positioning = positioning;
          const subjectLine = threatFact
            ? enemy +
              " — " +
              threatFact.ability +
              ": " +
              (ability ? clean(ability.description?.desc ?? "") : threatFact.clause)
            : enemy;
          safeAnswer =
            [
              subjectLine,
              task === "strategy" ? positioning : "",
              ...actions.map((a, index) => {
                const action = a.owned
                  ? "Use your "
                  : a.component
                    ? "Check the upgrade cost of "
                    : a.shortfall
                      ? "Save " + a.shortfall.toLocaleString("en-US") + " more souls for "
                      : "Buy ";
                const coverage = a.coverage.map((e) => {
                  const component = selectedEffects.find((f) => e.targets.includes(f.id));
                  return component
                    ? e.mechanic + " against the " + component.kind + " component of " + component.ability
                    : e.mechanic;
                });
                return (
                  (index && task === "counter_items"
                    ? "Alternative: "
                    : index && task === "plan"
                      ? "Then: "
                      : "") +
                  action +
                  a.name +
                  " (" +
                  a.cost!.toLocaleString("en-US") +
                  " souls). " +
                  (coverage.length ? coverage.join("; ") : a.effect || a.stats)
                );
              }),
              task.startsWith("counter") && actions.some((a) => /parry/i.test(a.effect))
                ? "The parry effect requires a successful parry; the ability's damage type alone doesn't confirm one."
                : "",
            ]
              .filter(Boolean)
              .join("\n") || focus;
        }
      }
      try {
        trace.fallback = "writer-unavailable";
        const brief = coachingNotes
          ? {
              task,
              question,
              verifiedNotes: safeAnswer,
              ...(task === "plan"
                ? { synergies: evidence.relationships, sequenceTotal: evidence.sequenceTotal }
                : {}),
            }
          : { ...evidence, history: undefined, task };
        const draft = await this.write(brief, signal);
        if (requiredNames.some((n) => !lower(draft).includes(lower(n)))) throw Error("missing-item");
        trace.fallback = "verifier-unavailable";
        const check = await judge(
          { source: brief, draft },
          {
            valid: choice(
              "Is the draft accurate and responsive to the source brief? Reject invented effects, reversed targets, wrong prices, missing essential choices, or failure to answer a requested second effect. If a requiredLimitation is supplied it must be conveyed. A lookup summary need not enumerate the table that the app appends.",
              { yes: "Grounded and responsive", no: "Incomplete or unsupported" },
            ),
          },
          signal,
        );
        if (check.valid !== "yes") throw Error("verification");
        trace.fallback = "";
        if (card) return finish([card.title,draft,card.stats].filter(Boolean).join("\n\n"));
        return finish(table ? draft + "\n\n" + table : draft);
      } catch (e) {
        signal?.throwIfAborted();
        trace.fallback =
          e instanceof Error &&
          ["missing-item", "verification", "writer-truncated", "Invalid wording"].includes(e.message)
            ? e.message
            : trace.fallback;
        return finish(safeAnswer);
      }
    } catch {
      signal?.throwIfAborted();
      trace.fallback = "decision-unavailable";
      return "The matchup analysis is unavailable. Check the Jev configuration and try again.";
    } finally {
      session.busy = false;
      this.trace(trace);
    }
  }
}




