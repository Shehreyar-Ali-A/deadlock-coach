import { refresh } from "./catalog.js";
await refresh();
const { refreshKnowledge } = await import("./knowledge.js");
const db = await refreshKnowledge();
console.log("Knowledge client", db.version, "heroes", db.heroes.length, "shop items", db.items.length);
