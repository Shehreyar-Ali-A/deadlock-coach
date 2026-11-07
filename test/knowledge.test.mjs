import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshKnowledge, loadKnowledge, details } from "../dist/knowledge.js";

test("a version-pinned refresh joins hero slots, preserves scaling, and rejects a broken refresh", async t => {
  const dir = await mkdtemp(join(tmpdir(), "deadlock-knowledge-"));
  const original = process.cwd();
  const requests = [];
  let broken = false;
  const ability = {type:"ability",name:"Charge",class_name:"charge",properties:{
    Damage:{value:0,scale_function:{specific_stat_scale_type:"ETechPower",stat_scale:1.4}}
  }};
  const hero = {name:"Test hero",items:{signature1:"charge"},player_selectable:true};
  const shop = {type:"upgrade",name:"Shop item",class_name:"upgrade_healbane",item_tier:1,shopable:true,cost:800};
  try {
    process.chdir(dir);
    t.mock.method(globalThis, "fetch", async url => {
      requests.push(url);
      if (url.endsWith("/client-versions")) return Response.json([7,3]);
      assert.match(url, /client_version=7$/);
      if (url.includes("/heroes?")) return Response.json([hero,{...hero,disabled:true}]);
      if (url.includes("/ability?")) return Response.json(broken ? [{...ability,class_name:"wrong"}] : [ability]);
      return Response.json([shop,{...shop,shopable:false},{...shop,item_tier:5},{...shop,class_name:"dev_only"}]);
    });
    const db = await refreshKnowledge();
    assert.equal(db.version,7);
    assert.equal(db.heroes.length,1);
    assert.equal(db.items.length,1);
    assert.equal(details(db.abilities[0]).stats[0].scale.stat_scale,1.4);
    const saved = await readFile(".cache/knowledge.json","utf8");
    await loadKnowledge();
    assert.equal(requests.length,4);
    broken = true;
    await assert.rejects(refreshKnowledge(),/Incomplete/);
    assert.equal(await readFile(".cache/knowledge.json","utf8"),saved);
  } finally {
    process.chdir(original);
    await rm(dir,{recursive:true,force:true});
  }
});

