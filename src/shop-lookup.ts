import { clean, type Asset } from "./knowledge.js";

const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
const aliases: Record<string, string> = {
  "attack speed": "fire rate",
  "firing speed": "fire rate",
  "rate of fire": "fire rate",
  firerate: "fire rate",
  "bullet resistance": "bullet resist",
  "spirit resistance": "spirit resist",
  "gun damage": "weapon damage",
};

export function shopLookup(question: string, items: Asset[]): string | undefined {
  let q = normalize(question);
  for (const [alias, stat] of Object.entries(aliases)) q = q.replaceAll(alias, stat);
  if (
    !/\b(items|upgrades|list|options|which ones)\b/.test(q) ||
    /\b(compare|versus|vs|recommend|best|should i buy|decrease|reduce|slow|enemy|enemies)\b/.test(q)
  )
    return;
  const labels = statLabels(items);
  // Longest exact stat first: e.g. "spirit power" before "power".
  const stat = [...labels]
    .sort((a, b) => b.length - a.length)
    .find((l) => l.length >= 3 && (" " + q.replace(/[?!.,]/g, " ") + " ").includes(" " + l + " "));
  if (!stat) return;
  return lookupStat(question, items, stat).text;
}

export function statLabels(items: Asset[]) {
  const labels = new Set<string>();
  for (const item of items)
    for (const p of Object.values(item.properties ?? {})) {
      if (p.label && (p.tooltip_section || p.provided_property_type)) labels.add(normalize(p.label));
    }
  return [...labels];
}

export function lookupStat(q: string, items: Asset[], stat: string) {
  q = normalize(q);
  const matches: { name: string; itemId: string; cost: number; bonuses: string[] }[] = [];
  const cap = q.match(
    /\b(under|below|up to|at most|within|budget of|with)\s+([\d,]+(?:\.\d+)?)\s*(k)?(?:\s*souls)?/,
  );
  const budget = cap ? Number(cap[2].replaceAll(",", "")) * (cap[3] ? 1000 : 1) : Infinity;
  const exclusive = cap?.[1] === "under" || cap?.[1] === "below";
  const rows: string[] = [];
  for (const a of [...items].sort((x, y) => x.cost! - y.cost! || x.name.localeCompare(y.name))) {
    if (exclusive ? a.cost! >= budget : a.cost! > budget) continue;
    const bonuses: string[] = [];
    for (const [key, p] of Object.entries(a.properties ?? {})) {
      const label = normalize(p.label ?? "");
      if (label !== stat && label !== stat + " bonus" && !label.startsWith(stat + " per ")) continue;
      if (
        !p.value ||
        Number.parseFloat(String(p.value)) <= 0 ||
        !Number.isFinite(Number.parseFloat(String(p.value)))
      )
        continue;
      if (
        p.usage_flags?.some((f) => /enemy/i.test(f)) ||
        (/slow|penalty|reduction/i.test(key) && stat === "fire rate")
      )
        continue;
      const group = a.tooltip_sections
        ?.flatMap((s) => s.section_attributes ?? [])
        .find((g) =>
          [
            ...(g.properties ?? []),
            ...(g.important_properties ?? []),
            ...(g.elevated_properties ?? []),
          ].includes(key),
        );
      if (!group && !p.tooltip_section) continue;
      const value = String(p.value);
      const amount = "+" + value + (p.postfix && !value.endsWith(p.postfix) ? p.postfix : "");
      const effect =
        p.tooltip_section === "innate"
          ? p.conditional || "always on"
          : (group?.loc_string && clean(group.loc_string)) ||
            (a.description?.desc && clean(a.description.desc)) ||
            p.tooltip_section ||
            "conditional";
      const activation = p.tooltip_section === "active" ? "on activation: " : "";
      bonuses.push(
        amount +
          (label.startsWith(stat + " per ") ? " " + label.slice(stat.length + 1) : "") +
          " — " +
          activation +
          effect,
      );
    }
    if (bonuses.length) matches.push({ name: a.name, itemId: a.class_name, cost: a.cost!, bonuses });
    if (bonuses.length)
      rows.push("• " + a.name + " (" + a.cost!.toLocaleString("en-US") + " souls): " + bonuses.join("; "));
  }
  const within = cap ? " " + cap[1] + " " + budget.toLocaleString("en-US") + " souls" : "";
  const text = rows.length
    ? rows.length +
      " regular shop items with a " +
      stat +
      " bonus" +
      within +
      ", cheapest first:\n" +
      rows.join("\n")
    : "I found no regular shop items with a listed positive " + stat + " bonus" + within + ".";
  return { stat, matches, text };
}

export function messageParts(text: string): string[] {
  const parts: string[] = [];
  let part = "";
  for (const line of text.split("\n")) {
    if (part && part.length + line.length + 1 > 1950) {
      parts.push(part);
      part = "";
    }
    part += (part ? "\n" : "") + line;
    while (part.length > 1950) {
      parts.push(part.slice(0, 1950));
      part = part.slice(1950);
    }
  }
  if (part) parts.push(part);
  return parts;
}
export function spokenAnswer(text: string) {
  if (text.startsWith("**") && text.includes("\n\n")) {
    const [title,body] = text.split("\n\n");
    return title.replaceAll("**","")+". "+body.replaceAll("**","").replace(/[.!?]+$/,"")+". Full details are in chat.";
  }
  const index = text.search(/\n\d+ regular shop items? with a /);
  if (index > 0) return text.slice(0, index) + " The full list is in chat.";
  const [heading, first] = text.split("\n");
  return first?.startsWith("• ")
    ? heading.replace(/, cheapest first:$/, ".") +
        " The cheapest is " +
        first.slice(2).split(": ")[0] +
        ". I've posted the full list with conditions in chat."
    : text;
}


