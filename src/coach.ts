import type { Catalog, Choice } from "./catalog.js";

type Goal = "healing" | "weapon" | "spirit";
export interface Player { hero?: string; build?: "weapon" | "spirit"; budget?: number; inventory?: string[] }
interface Turn extends Player { goal?: Goal; pending?: "build" | "goal"; question?: string }
const scope = "I only cover enemy healing reduction, close-range weapon damage, and Spirit Power. Which do you need?";

export function recommend(goal: Goal, player: Player, items: Catalog): string {
  if (goal === "healing" && !player.build) return "Do you mainly deal spirit damage or weapon damage?";
  const key: Choice = goal === "healing" ? (player.build === "spirit" ? "healSpirit" : "healWeapon") : goal;
  const item = items[key];
  if (!item) return "I can't verify a shop item for that against the loaded catalog.";
  if (player.inventory?.some(n => n.toLowerCase() === item.name.toLowerCase()))
    return "Use your " + item.name + ". " + item.reason;
  const price = item.cost.toLocaleString("en-US") + " souls";
  if (player.budget !== undefined && player.budget < item.cost)
    return "Save " + (item.cost - player.budget).toLocaleString("en-US") + " more souls for " + item.name + " (" + price + "). " + item.reason;
  return "Buy " + item.name + (player.budget === undefined ? "" : " now") + " (" + price + "). " + item.reason;
}

export class Coach {
  private turns = new Map<string, { at: number; turn: Turn }>();
  constructor(private items: Catalog) {}
  reset(server: string, user: string) { this.turns.delete(server + "/" + user); }
  ask(server: string, user: string, question: string, supplied: Player = {}) {
    const now = Date.now();
    for (const [id, entry] of this.turns) if (now - entry.at > 20 * 60000) this.turns.delete(id);
    const id = server + "/" + user;
    const t: Turn = { ...this.turns.get(id)?.turn, ...supplied };
    const q = question.toLowerCase().replace(/[’‘]/g, "'").trim();
    const money = q.match(/(?:^|[.!?]\s*|\b(?:i have|with|budget(?: is| of)?|i have only|i only have|i've got)\s+)(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*souls?\b/) ?? q.match(/^(?:i have )?(\d[\d,]*(?:\.\d+)?)(k)?[.!]?$/);
    if (money) t.budget = Math.round(Number(money[1].replaceAll(",", "")) * (money[2] ? 1000 : 1));
    const hero = q.match(/\b(?:i'm playing|i am playing|my hero is|i play)\s+([a-z]+(?: [a-z]+)?)/)?.[1];
    if (hero && !/^(a |an |spirit|gun|weapon|bullet)/.test(hero)) t.hero = hero.split(/ and| with| on/)[0];
    const build = q.match(/\b(spirit|gun|bullet|weapon)\s+(?:build|based)\b/)?.[1]
      ?? q.match(/^(?:mostly |mainly |a )?(spirit|gun|weapon|bullet)(?: damage)?[.!]?$/)?.[1];
    if (build) t.build = build === "spirit" ? "spirit" : "weapon";
    let owned = false;
    for (const item of Object.values(this.items)) {
      const possess = [...q.matchAll(/\bi (?:already )?(?:own|have|bought|purchased)\s+(?:an? )?([^.!?]+)/g)];
      if (possess.some(match => (match[1] + " ").startsWith(item.name.toLowerCase() + " "))) {
        t.inventory = [...new Set([...(t.inventory ?? []), item.name])]; owned = true;
      }
    }
    let goal: Goal | undefined;
    const defensive = /\b(survive|resist|taking|dying|defen[ds]|against|mitigate|counter|less|kills? me)\b/.test(q);
    if (/\b(anti[- ]?heal|heal(?:ing)? reduction|keeps? healing|heals? through|reduc\w* (?:enemy |their )?healing|stop .*heal(?:ing)?|counter .*heal(?:ing)?|enemy .*heal(?:ing|s)?|lifesteals? through)\b/.test(q)) goal = "healing";
    else if (!defensive && /\b(?:weapon|gun|bullet) damage\b/.test(q)) goal = "weapon";
    else if (!defensive && /\bspirit (?:damage|power)\b/.test(q)) goal = "spirit";
    const shortBuild = /^(?:(?:i'm|i am|mainly|mostly|a|playing|on) )*(spirit|gun|weapon|bullet)(?: build| damage)?[.!]?$/.test(q);
    if (t.pending === "build" && (shortBuild || /^(?:i (?:mostly |mainly )?(?:deal|use|build)|mostly|mainly) (?:spirit|gun|weapon|bullet)(?: damage)?[.!]?$/.test(q))) {
      t.build = /\bspirit\b/.test(q) ? "spirit" : "weapon";
      goal = "healing";
    }
    else if (!goal && (owned || (money && /^(?:(?:now |i have |only |what (?:about|if i have) )*)[\d,.]+k?(?: souls?)?[?!.]?$/.test(q)))) goal = t.goal;
    if (!goal && t.pending === "goal" && shortBuild) goal = t.build;
    t.question = question;
    t.goal = goal;
    t.pending = goal === "healing" && !t.build ? "build" : goal ? undefined : "goal";
    this.turns.set(id, { turn: t, at: now });
    return goal ? recommend(goal, t, this.items) : scope;
  }
}



