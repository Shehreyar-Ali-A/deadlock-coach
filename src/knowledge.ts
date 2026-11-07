import { regularShop } from "./normal-shop.js";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { base } from "./catalog.js";

type Scale = {
  class_name?: string;
  specific_stat_scale_type?: string;
  stat_scale?: number;
  scaling_stats?: string[];
};
type Property = {
  value?: string | number;
  label?: string;
  postfix?: string;
  tooltip_section?: string;
  disable_value?: string;
  conditional?: string;
  provided_property_type?: string;
  usage_flags?: string[];
  scale_function?: Scale;
};
export interface Asset {
  class_name: string;
  name: string;
  type: string;
  description?: Record<string, string>;
  activation?: string;
  upgrades?: unknown[];
  properties?: Record<string, Property>;
  cost?: number;
  item_tier?: number;
  component_items?: string[];
  shopable?: boolean;
  disabled?: boolean;
  tooltip_sections?: { section_attributes?: { loc_string?: string; properties?: string[]; important_properties?: string[]; elevated_properties?: string[] }[] }[];
}
interface Hero {
  name: string;
  items: Record<string, string>;
  description: { role?: string; playstyle?: string };
  player_selectable: boolean;
  disabled?: boolean;
  in_development?: boolean;
}
export interface Knowledge {
  version: number;
  retrieved: string;
  sources: string[];
  heroes: Hero[];
  abilities: Asset[];
  items: Asset[];
}
export function clean(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;!?])/g, "$1")
    .trim();
}
export function details(a: Asset) {
  const text = [
    ...Object.values(a.description ?? {}),
    ...(a.tooltip_sections ?? []).flatMap((s) => (s.section_attributes ?? []).map((p) => p.loc_string ?? "")),
  ];
  const stats = Object.entries(a.properties ?? {})
    .filter(
      ([, p]) =>
        p.tooltip_section ||
        p.scale_function?.stat_scale !== undefined ||
        (p.value !== undefined &&
          Number.parseFloat(String(p.value)) !== 0 &&
          String(p.value) !== p.disable_value),
    )
    .map(([id, p]) => ({
      id,
      label: p.label,
      value: p.value,
      unit: p.postfix,
      section: p.tooltip_section,
      condition: p.conditional,
      usage: p.usage_flags,
      modifier: p.provided_property_type,
      scale: p.scale_function,
    }));
  return {
    name: a.name,
    cost: a.cost,
    activation: a.activation,
    tiers: a.upgrades,
    text: [
      ...new Set(
        text
          .filter((t) => typeof t === "string")
          .map(clean)
          .filter(Boolean),
      ),
    ],
    stats,
    components: a.component_items,
  };
}
export function signature(hero: Hero, db: Knowledge) {
  const ids = Object.entries(hero.items)
    .filter(([slot]) => slot.startsWith("signature"))
    .map(([, id]) => id);
  return ids.flatMap((id) => db.abilities.find((a) => a.class_name === id) ?? []);
}
function validate(db: Knowledge) {
  if (Array.isArray(db.items)) db.items = db.items.filter(regularShop);
  if (
    !Number.isSafeInteger(db.version) ||
    !Number.isFinite(Date.parse(db.retrieved)) ||
    !db.heroes?.length ||
    !db.abilities?.length ||
    !db.items?.length ||
    !db.heroes.every(
      (h) =>
        h.name &&
        h.items &&
        signature(h, db).length > 0 &&
        signature(h, db).length === Object.keys(h.items).filter((k) => k.startsWith("signature")).length,
    ) ||
    !db.items.every(
      (a) =>
        a.name && a.class_name && a.shopable && !a.disabled && Number.isSafeInteger(a.cost) && a.cost! > 0,
    )
  )
    throw Error("Incomplete Deadlock knowledge snapshot");
  return db;
}
const cache = ".cache/knowledge.json";
async function get(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error("Asset service HTTP " + response.status);
  return response.json();
}
export async function refreshKnowledge() {
  const versions = await get(base + "/client-versions");
  if (!Array.isArray(versions) || !versions.length || !versions.every(Number.isSafeInteger))
    throw Error("Invalid asset versions");
  const version = Math.max(...versions);
  const sources = ["heroes", "items/by-type/ability", "items/by-type/upgrade"].map(
    (path) => base + "/" + path + "?language=english&client_version=" + version,
  );
  const [heroes, abilities, upgrades] = await Promise.all(sources.map(get));
  const db = validate({
    version,
    retrieved: new Date().toISOString(),
    sources,
    heroes: heroes.filter((h: Hero) => h.player_selectable && !h.disabled && !h.in_development),
    abilities,
    items: upgrades,
  });
  await mkdir(".cache", { recursive: true });
  const temp = cache + "." + randomUUID();
  try {
    await writeFile(temp, JSON.stringify(db));
    await rename(temp, cache);
  } finally {
    await rm(temp, { force: true });
  }
  return db;
}
export async function loadKnowledge() {
  let saved: Knowledge | undefined;
  try {
    saved = validate(JSON.parse(await readFile(cache, "utf8")));
  } catch {
    /* First run. */
  }
  if (saved && Date.now() - Date.parse(saved.retrieved) < 86400000) return saved;
  try {
    return await refreshKnowledge();
  } catch (e) {
    if (!saved) throw e;
    console.warn("Using previous Deadlock knowledge snapshot.");
    return saved;
  }
}


