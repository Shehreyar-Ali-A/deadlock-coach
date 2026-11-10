import { planTurn } from "./planner.js";
import { searchEffects } from "./effect-search.js";
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
      operations: [] as string[],
      enemy: "",
      items: [] as string[],
      effects: [] as string[],
      fallback: "",
      calls: 0,
    };
    const judge: typeof decide = (...args) => {
      trace.calls++;
      return this.judge(...args);
    };
    try {
      const db = this.db;
      const plan = await planTurn(db, state, judge, signal);
      trace.operations = plan.steps;
      if (plan.readiness === "outside")
        return finish("I can help with Deadlock abilities, matchups and purchases.");
      if (plan.readiness === "clarify" || !plan.steps.length) {
        const prompts: Record<string, string> = {
          budget: "How many souls do you have?",
          source: "What hit you before you died?",
          build: "What build are you playing?",
        };
        return finish(prompts[plan.missing] ?? "Which item, ability or outcome are you asking about?");
      }
      const use = (op: (typeof plan.steps)[number]) => plan.steps.includes(op);
      const enemy =
        db.heroes.find((_, i) => plan.enemy === "h" + i)?.name ??
        (use("matchup")
          ? (report.enemy?.hero ?? (plan.reference === "previous" ? prev.enemy?.hero : undefined))
          : undefined);
      trace.enemy = use("matchup") ? (enemy ?? "") : "";
      if (use("matchup") && enemy) {
        if (prev.enemy?.hero && prev.enemy.hero !== enemy) {
          state.history = [];
          if (!report.death) delete turn.death;
        }
        turn.enemy = { ...(prev.enemy?.hero === enemy ? prev.enemy : {}), ...report.enemy, hero: enemy };
      }
      if (plan.build === "spirit" || plan.build === "weapon") player.build = plan.build;
      const ally = db.heroes.find((_, i) => plan.ally === "h" + i)?.name;
      if (ally) player.hero = ally;
      const history = plan.reference === "previous" ? state.history.slice(-1) : [];
      const reference = history.map((t) => t.question + " " + t.answer).join(" ");
      const signatureIds = new Set(
        db.heroes.flatMap((h) =>
          Object.entries(h.items)
            .filter(([slot]) => slot.startsWith("signature"))
            .map(([, id]) => id),
        ),
      );
      const findNamed = (text: string) =>
        [...db.items, ...db.abilities.filter((a) => signatureIds.has(a.class_name))].filter(
          (a) => a.name?.length > 2 && lower(text).includes(lower(a.name)),
        );
      const explicit = findNamed(question);
      const subjects = explicit.length ? explicit : findNamed(reference);
      const notes: string[] = [];
      let selectedNames: string[] = [];
      const attachments: string[] = [];
      const evidence: Record<string, unknown> = { question, operations: plan.steps };
      const candidates = new Set<Asset>();
      const searchSets: Set<Asset>[] = [];
      const record = (a: Asset) => {
        candidates.add(a);
        if (!trace.items.includes(a.class_name)) trace.items.push(a.class_name);
      };
      const effects = use("matchup") ? heroEffects(db, enemy) : [];
      const abilities = use("matchup")
        ? db.heroes.filter((h) => h.name === enemy || h.name === player.hero).flatMap((h) => signature(h, db))
        : [];
      if (use("entity") || use("compare")) {
        const targets = subjects.length
          ? subjects
          : db.heroes.filter((h) => lower(question).includes(lower(h.name))).flatMap((h) => signature(h, db));
        evidence.subjects = targets.map(details);
        for (const a of targets) {
          if (db.items.includes(a)) record(a);
          if (!use("entity")) continue;
          const c = describeAsset(a);
          attachments.push([c.title, c.body, c.stats].filter(Boolean).join("\n\n"));
        }
        if (use("compare")) evidence.relationships = interactions(targets, [...targets, ...abilities]);
        if (!targets.length) notes.push("Which items or abilities should I examine?");
      }
      if (use("stat")) {
        const labels = statLabels(db.items);
        const exact = labels
          .filter((l) => (" " + lower(question).replace(/[?!.,]/g, " ") + " ").includes(" " + l + " "))
          .sort((a, b) => b.length - a.length)[0];
        const opts = Object.fromEntries(labels.slice(0, 254).map((l, i) => ["s" + i, l]));
        const stat =
          exact ??
          plan.listStat ??
          opts[
            (
              await judge(
                { question, history },
                {
                  stat: choice("Resolve the requested player stat using its shop label.", {
                    unknown: "Unclear",
                    ...opts,
                  }),
                },
                signal,
              )
            ).stat
          ];
        if (stat) {
          const result = lookupStat(question, db.items, stat);
          evidence.stat = { label: stat, count: result.matches.length, examples: result.matches.slice(0, 4) };
          attachments.push(result.text);
          const matches = db.items.filter((item) => result.matches.some((m) => m.itemId === item.class_name));
          searchSets.push(new Set(matches));
          matches.forEach(record);
        } else {
          searchSets.push(new Set());
          notes.push("Which shop stat should I look up?");
        }
      }
      let limited = false;
      let limitation = "";
      if (use("effects")) {
        const result = await searchEffects(question, db.items, judge, signal);
        evidence.requestedEffects = result;
        searchSets.push(
          new Set(
            db.items.filter((item) => result.items.some((row) => row.id === item.class_name && row.joint)),
          ),
        );
        for (const row of result.items) {
          const item = db.items.find((a) => a.class_name === row.id)!;
          record(item);
          notes.push(
            "• **" +
              row.name +
              "** (" +
              row.cost?.toLocaleString("en-US") +
              " souls) — " +
              row.clauses.join(" "),
          );
        }
        if (!result.jointlySupported) {
          limited = true;
          limitation =
            "I couldn't verify the full requested effect" +
            (result.requirements.length > 1 ? " (“" + result.requirements.join("” and “") + "”)" : "") +
            " on the same trigger and target in the reviewed item descriptions.";
          notes.unshift(limitation);
        }
      }
      if (use("matchup")) {
        trace.effects = effects.map((e) => e.id);
        evidence.enemy = enemy;
        evidence.effects = effects;
        evidence.abilities = abilities.map(details);
        if (history.length && subjects.length) {
          evidence.referenced = subjects.map(details);
          notes.push(...subjects.filter((a) => db.items.includes(a)).map((a) => a.name + " — " + summary(a)));
        }
      }
      if (use("rank") || use("matchup")) {
        const edges = counterEdges(db.items, effects, /\bmelee\b/i.test(question));
        const owned = db.items.filter((a) => inventory.has(a.name));
        const related = db.items.filter((a) => edges.some((e) => e.itemId === a.class_name));
        const pool = searchSets.length
          ? db.items.filter((a) => searchSets.every((set) => set.has(a)))
          : [
              ...new Set([
                ...candidates,
                ...related,
                ...rank(db.items, question, "", [...owned, ...subjects]),
              ]),
            ];
        const options = {
          none: "No supported purchase",
          ...Object.fromEntries(
            pool.map((a, i) => ["i" + i, a.name + " (" + a.cost + " souls) " + summary(a)]),
          ),
        };
        const questions: Parameters<typeof decide>[1] = {};
        if (use("matchup") && abilities.length)
          questions.ability = choice(
            "Which ability creates the situation described? Consider the setup for the stated attack and describe uncertain setups conditionally.",
            { none: "Unknown", ...Object.fromEntries(abilities.map((a, i) => ["a" + i, a.name])) },
          );
        if (use("rank") && pool.length) {
          questions.item = choice(
            "Select an affordable first purchase for the specific attack or property stated in the latest message. Avoid assuming a different threat from the hero name alone.",
            options,
          );
          if (plan.order !== "one")
            questions.second = choice(
              "Select a distinct supported alternative or next purchase only if useful.",
              options,
            );
        }
        const decision = Object.keys(questions).length
          ? await judge({ ...evidence, player, enemy, history, edges }, questions, signal)
          : {};
        const ability = abilities.find((_, i) => decision.ability === "a" + i);
        if (ability) notes.push(enemy + " — " + ability.name + ": " + clean(ability.description?.desc ?? ""));
        const positioning = effects.find(
          (e) => e.positioning && (!ability || ability.class_name === e.abilityId),
        )?.positioning;
        if (positioning) notes.push(positioning);
        let remaining = player.budget;
        const selected = [...new Set([decision.item, decision.second])].flatMap((id) =>
          pool.filter((_, i) => id === "i" + i),
        );
        for (const [index, item] of selected.entries()) {
          record(item);
          const cost = item.cost!;
          const part = item.component_items?.some(
            (id) =>
              owned.some((a) => a.class_name === id) ||
              (plan.order === "sequence" && selected.slice(0, index).some((a) => a.class_name === id)),
          );
          const action = inventory.has(item.name)
            ? "Use your "
            : part
              ? "Check the upgrade cost of "
              : remaining !== undefined && remaining < cost
                ? "Save " + (cost - remaining).toLocaleString("en-US") + " more souls for "
                : "Buy ";
          notes.push(
            (index ? (plan.order === "sequence" ? "Next: " : "Alternative: ") : "") +
              action +
              item.name +
              " (" +
              cost.toLocaleString("en-US") +
              " souls). " +
              (edges
                .filter((e) => e.itemId === item.class_name)
                .map((e) => e.mechanic)
                .join("; ") || summary(item)),
          );
          if (plan.order === "sequence" && !inventory.has(item.name) && remaining !== undefined)
            remaining = part ? undefined : Math.max(0, remaining - cost);
        }
        selectedNames = selected.map((a) => a.name);
        evidence.selected = selected.map(details);
        evidence.links = interactions([...owned, ...selected], [...selected, ...abilities]);
      }
      if (plan.steps.length === 1 && use("entity") && attachments.length === 1) return finish(attachments[0]);
      const verifiedNotes = notes.join("\n\n");
      const fallback =
        [verifiedNotes, ...attachments].filter(Boolean).join("\n\n") ||
        "Which ability or item should I focus on?";
      try {
        trace.fallback = "writer-unavailable";
        const brief = {
          ...evidence,
          verifiedNotes,
          task: "answer",
          delivery:
            "Compose the complete answer. Any attached cards or stat list follow automatically. Respect item-specific evidence and uncertainty.",
        };
        const draft = await this.write(brief, signal);
        if (selectedNames.some((name) => !lower(draft).includes(lower(name)))) {
          trace.fallback = "missing-item";
          return finish(fallback);
        }
        trace.fallback = "verifier-unavailable";
        const check = await judge(
          { source: brief, draft },
          {
            valid: choice(
              "Is every claim supported for the correct item, subject, trigger and target? Reject inaccurate prices, omitted qualifications and unsupported combinations.",
              { yes: "Supported", no: "Reject" },
            ),
          },
          signal,
        );
        if (check.valid !== "yes") {
          trace.fallback = "verification";
          return finish(fallback);
        }
        trace.fallback = "";
        return finish([draft, ...(limited ? [limitation] : []), ...attachments].join("\n\n"));
      } catch {
        signal?.throwIfAborted();
        return finish(fallback);
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
