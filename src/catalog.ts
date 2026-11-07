import { regularShop } from "./normal-shop.js";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export const base = "https://api.deadlock-api.com/v1/assets";
const file = ".cache/items.json";
export interface Item { name: string; cost: number; reason: string }
type Asset = { item_tier?: number; class_name: string; type: string; shopable: boolean; disabled?: boolean;
  name: string; cost: number; description?: { desc?: string }; component_items?: string[];
  properties?: Record<string, { value: string; label?: string }> };

// Each rule requires evidence in the selected client version before it can speak.
const rules = {
  healSpirit: ["upgrade_healbane", /your spirit damage reduces the enemy's incoming healing/i,
    "Hit the target with spirit damage to reduce the healing they receive."],
  healWeapon: ["upgrade_toxic_bullets", /bullets build up a bleed.*reduces incoming healing on the bleeding target/i,
    "Keep landing bullets to build bleed. The bleeding target receives less healing."],
  weapon: ["upgrade_close_range", /additional weapon damage when in close range/i,
    "Fight close to your target to trigger the extra weapon damage."],
  spirit: ["upgrade_improved_spirit", null, "It adds Spirit Power for abilities with spirit scaling."]
} as const;
export type Choice = keyof typeof rules;
export type Catalog = Partial<Record<Choice, Item>>;
interface Snapshot { source: string; version: number; retrieved: string; assets: Asset[] }

export function review(snapshot: Snapshot): Catalog {
  if (!Number.isInteger(snapshot.version) || snapshot.source !== source(snapshot.version)
    || !Number.isFinite(Date.parse(snapshot.retrieved)) || !Array.isArray(snapshot.assets)) throw Error("Invalid catalog");
  const items: Catalog = {};
  for (const key of Object.keys(rules) as Choice[]) {
    const [id, pattern, reason] = rules[key];
    const row = snapshot.assets.find(a => a.class_name === id && regularShop(a));
    if (!row || !row.name || !Number.isSafeInteger(row.cost) || row.cost <= 0 || row.component_items?.length) continue;
    const desc = (row.description?.desc ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
    const stat = row.properties?.TechPower;
    if (pattern ? pattern.test(desc) : stat?.label === "Spirit Power" && Number(stat.value) > 0)
      items[key] = { name: row.name, cost: row.cost, reason };
  }
  return items;
}
function source(version: number) { return base + "/items/by-type/upgrade?language=english&client_version=" + version; }
async function json(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw Error("Asset service HTTP " + r.status);
  return r.json();
}
export async function refresh() {
  const versions = await json(base + "/client-versions");
  if (!Array.isArray(versions) || !versions.length || !versions.every(Number.isSafeInteger)) throw Error("Invalid versions");
  const version = Math.max(...versions);
  const url = source(version);
  const rows = await json(url);
  if (!Array.isArray(rows) || !rows.length) throw Error("Invalid upgrades");
  const ids: Set<string> = new Set(Object.values(rules).map(rule => rule[0]));
  const snapshot: Snapshot = { version, source: url, retrieved: new Date().toISOString(),
    assets: rows.filter((a: Asset) => ids.has(a.class_name)) };
  // Reject truncated responses. A present but changed/disabled upgrade fails closed in review().
  if (new Set(snapshot.assets.map(a => a.class_name)).size !== ids.size) throw Error("Incomplete reviewed catalog");
  const items = review(snapshot);
  const temp = file + "." + randomUUID();
  await mkdir(".cache", { recursive: true });
  try { await writeFile(temp, JSON.stringify(snapshot)); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
  console.log("Loaded Deadlock client", version, "from", url);
  return items;
}
export async function load(): Promise<Catalog> {
  let saved: Catalog = {};
  try {
    const snapshot = JSON.parse(await readFile(file, "utf8")) as Snapshot;
    saved = review(snapshot);
    if (Date.now() - Date.parse(snapshot.retrieved) < 86400000) return saved;
  } catch { /* First start or invalid cache. */ }
  try { return await refresh(); }
  catch { console.warn("Catalog refresh failed. Using available cached rules. Retry with npm run refresh."); return saved; }
}

