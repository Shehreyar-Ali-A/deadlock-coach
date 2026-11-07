import { clean, details, type Asset } from "./knowledge.js";

// Emit links only when both endpoints have the required asset evidence.
// Tooltip trigger matches are conditional. The feed does not encode every proc exception.
export function interactions(sources: Asset[], targets: Asset[]) {
  const links: { from: string; to: string; relation: string; basis: string }[] = [];
  for (const a of new Set(sources)) {
    const text = details(a).text.join(" ");
    const power = a.properties?.TechPower;
    for (const b of new Set(targets)) {
      if (a.class_name === b.class_name) continue;
      if (b.component_items?.includes(a.class_name))
        links.push({ from: a.name, to: b.name, relation: "Recipe component", basis: a.class_name });
      if (power?.label === "Spirit Power" && power.tooltip_section === "innate" && Number(power.value) > 0) {
        for (const [stat, p] of Object.entries(b.properties ?? {})) {
          const f = p.scale_function;
          if (
            f?.specific_stat_scale_type === "ETechPower" &&
            typeof f.stat_scale === "number" &&
            f.stat_scale !== 0
          )
            links.push({
              from: a.name,
              to: b.name,
              relation: "Spirit Power modifies " + (p.label || stat),
              basis: stat + " uses ETechPower, coefficient " + f.stat_scale,
            });
        }
      }
      if (a.type === "upgrade" && b.type === "upgrade" && a.class_name < b.class_name) {
        const innate = Object.values(a.properties ?? {}).filter(
          (p) => p.tooltip_section === "innate" && p.provided_property_type && Number(p.value) > 0,
        );
        for (const stat of innate) {
          const matching = Object.values(b.properties ?? {}).find(
            (p) =>
              p.tooltip_section === "innate" &&
              p.provided_property_type === stat.provided_property_type &&
              Number(p.value) > 0,
          );
          if (matching)
            links.push({
              from: a.name,
              to: b.name,
              relation: "Both grant " + stat.label + ". Stacking formula unverified.",
              basis: stat.provided_property_type!,
            });
        }
      }
      const trigger = clean(b.description?.desc ?? "");
      if (
        /deals? (?:bonus )?spirit damage/i.test(text) &&
        /(?:your spirit damage reduces|when an enemy takes spirit damage)/i.test(trigger)
      )
        links.push({
          from: a.name,
          to: b.name,
          relation: "Possible spirit-damage trigger. Proc eligibility is unverified.",
          basis: trigger,
        });
    }
  }
  return links;
}
