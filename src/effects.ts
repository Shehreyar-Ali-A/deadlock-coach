import { clean, signature, type Asset, type Knowledge } from "./knowledge.js";

// Keep the actual source clause on each edge. Damage type alone never establishes parry eligibility.
const patterns = {
  melee: /\bmelee (?:damage|hits?|attacks?)\b/i,
  spirit: /\bspirit damage\b/i,
  control: /\b(stuns?|knockup|knockdown|immobiliz\w*)\b/i,
  healing: /\b(healing|heals?|regeneration)\b/i,
};
type Kind = keyof typeof patterns;
export function heroEffects(db: Knowledge, heroName?: string) {
  const hero = db.heroes.find((h) => h.name === heroName);
  if (!hero) return [];
  return signature(hero, db).flatMap((ability) => {
    const description = clean(ability.description?.desc ?? "");
    return description.split(/(?<=[.!?])\s+/).flatMap((clause, index) =>
      (Object.keys(patterns) as Kind[])
        .filter((kind) => patterns[kind].test(clause))
        .map((kind) => ({
          id: ability.class_name + "/" + index + "/" + kind,
          hero: hero.name,
          ability: ability.name,
          abilityId: ability.class_name,
          kind,
          clause,
          positioning:
            /wall/i.test(clause) && /stun/i.test(clause)
              ? "Keep away from walls so the collision cannot stun you."
              : undefined,
          source: "description.desc",
          version: db.version,
        })),
    );
  });
}
export function counterEdges(
  items: Asset[],
  effects: ReturnType<typeof heroEffects>,
  reportedMelee: boolean,
) {
  const targets = effects
    .filter((e) => e.kind !== "control" || /stun/i.test(e.clause))
    .map((e) => ({ id: e.id, kind: e.kind }));
  if (reportedMelee) targets.push({ id: "reported/melee", kind: "melee" });
  return items.flatMap((item) => {
    const proofs: { kind: Kind; fact: string }[] = [];
    for (const p of Object.values(item.properties ?? {})) {
      if (p.tooltip_section !== "innate" || !(Number(p.value) > 0)) continue;
      if (p.label === "Melee Resist" || p.label === "Spirit Resist")
        proofs.push({
          kind: p.label === "Melee Resist" ? "melee" : "spirit",
          fact: p.label + " +" + p.value + (p.postfix ?? ""),
        });
    }
    const desc = clean(item.description?.desc ?? "");
    if (/reduces the duration of all negative effects/i.test(desc))
      proofs.push({ kind: "control", fact: desc });
    if (/reduces .*incoming healing/i.test(desc)) proofs.push({ kind: "healing", fact: desc });
    return proofs
      .map((p) => ({
        itemId: item.class_name,
        mechanic: p.fact,
        targets: targets.filter((t) => t.kind === p.kind).map((t) => t.id),
      }))
      .filter((edge) => edge.targets.length);
  });
}
