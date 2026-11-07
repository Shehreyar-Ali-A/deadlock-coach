import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load, base } from "../dist/catalog.js";

test("failed refresh preserves stale cache, fresh cache avoids the network", async t => {
  const cwd = process.cwd();
  const dir = await mkdtemp(join(tmpdir(), "deadlock-coach-"));
  try {
    process.chdir(dir);
    await mkdir(".cache");
    const row = { type:"upgrade", class_name:"upgrade_improved_spirit", item_tier:1,shopable:true,
      cost:800, name:"Extra Spirit", properties:{ TechPower:{ value:"10", label:"Spirit Power" } } };
    const snapshot = { version:1, source:base+"/items/by-type/upgrade?language=english&client_version=1",
      assets:[row], retrieved:"2000-01-01T00:00:00Z" };
    const serialized = JSON.stringify(snapshot);
    await writeFile(".cache/items.json",serialized);
    const network = t.mock.method(globalThis, "fetch", async () => { throw Error("Simulated outage"); });
    assert.equal((await load()).spirit.cost,800);
    assert.equal(network.mock.callCount(),1);
    assert.equal(await readFile(".cache/items.json","utf8"),serialized);
    await writeFile(".cache/items.json",JSON.stringify({...snapshot,retrieved:new Date().toISOString()}));
    assert.equal((await load()).spirit.name,"Extra Spirit");
    assert.equal(network.mock.callCount(),1);
  } finally { process.chdir(cwd); await rm(dir,{recursive:true,force:true}); }
});

