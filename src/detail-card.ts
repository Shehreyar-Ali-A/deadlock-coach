import { clean, type Asset } from "./knowledge.js";

export function describeAsset(asset: Asset) {
  const title = asset.name + (asset.cost ? " · " + asset.cost.toLocaleString("en-US") + " souls" : "");
  const sections = new Map<string,string[]>();
  const add = (heading:string,line:string) => {
    const lines = sections.get(heading) ?? [];
    if (!lines.includes(line)) lines.push(line);
    sections.set(heading,lines);
  };
  const ability = asset.type === "ability";
  const tooltipKeys = new Set(["AbilityCooldown","AbilityCastRange", ...(asset.tooltip_details?.additional_header_properties ?? [])]);
  for (const section of asset.tooltip_details?.info_sections ?? []) {
    for (const key of section.basic_properties ?? []) tooltipKeys.add(key);
    for (const block of section.properties_block ?? []) for (const entry of block.properties ?? [])
      if (entry.status_effect_value || entry.important_property) tooltipKeys.add((entry.status_effect_value || entry.important_property)!);
  }
  for (const [key,p] of Object.entries(asset.properties ?? {})) {
    if (!p.label || p.value == null || (!p.tooltip_section && !(ability && tooltipKeys.has(key)))) continue;
    const raw = String(p.value);
    if (Number.parseFloat(raw) === 0 || raw === p.disable_value) continue;
    const sign = p.prefix === "-" && !raw.startsWith("-") ? "-" : p.prefix === "{s:sign}" && Number.parseFloat(raw)>0 ? "+" : "";
    const unit = p.postfix && !raw.endsWith(p.postfix) ? p.postfix : "";
    const heading = {innate:"Always on",passive:"Passive effect",active:"Active effect"}[p.tooltip_section ?? ""] ?? "Ability stats";
    add(heading,p.label+" **"+sign+raw+unit+"**"+(p.conditional?" ("+p.conditional+")":""));
  }
  for (const [key,text] of Object.entries(asset.description ?? {})) {
    const tier=/^t(\d+)_desc$/.exec(key);
    if (tier && text) add("Upgrades","Tier "+tier[1]+" · "+clean(text));
  }
  const mechanics=[asset.description?.desc,...(asset.tooltip_sections??[]).flatMap(s=>(s.section_attributes??[]).map(g=>g.loc_string))]
    .filter((s):s is string=>Boolean(s)).map(clean);
  const body=[...new Set(mechanics)].join("\n\n");
  const stats=[...sections].map(([h,rows])=>"**"+h+"**\n"+rows.map(r=>"• "+r).join("\n")).join("\n\n");
  return {title:"**"+title+"**",body,stats};
}
