import { messageParts, shopLookup } from "./shop-lookup.js";
import { Client, Events, GatewayIntentBits as Intent } from "discord.js";
import { Coach } from "./coach.js";
import { MatchAdvisor, type Advisor } from "./advisor.js";
import { loadKnowledge } from "./knowledge.js";
import { load } from "./catalog.js";

if (!process.env.DISCORD_TOKEN) throw Error("Set DISCORD_TOKEN in .env.");
const client = new Client({ intents: [Intent.Guilds, Intent.GuildVoiceStates], allowedMentions: { parse: [] } });
async function createAdvisor(): Promise<Advisor> {
  if (process.env.JEV_AI_API_KEY) {
    try { return new MatchAdvisor(await loadKnowledge()); }
    catch {
      console.warn("Could not load matchup knowledge. Run npm run refresh, then restart.");
      return {ask: () => "My knowledge base is unavailable. Run npm run refresh and restart the bot.", reset: () => {}};
    }
  }
  const local = new Coach(await load());
  const db = await loadKnowledge().catch(() => undefined);
  return { ask: (g,u,q,report) => (db && shopLookup(q,db.items)) ?? local.ask(g,u,q,report?.player), reset: (g,u) => local.reset(g,u) };
}
const coach = await createAdvisor();
client.once(Events.ClientReady, () => console.log("Deadlock Coach is online."));
client.on(Events.VoiceStateUpdate, async (before, after) => {
  if (before.channelId && before.channelId !== after.channelId) {
    (await import("./voice.js")).cancel(before.guild.id, before.id === client.user?.id ? undefined : before.id);
  }
});
client.on(Events.InteractionCreate, async i => {
  if (!i.isChatInputCommand() || !i.inCachedGuild()) return;
  try {
    if (i.commandName === "ping") { await i.reply("Pong."); return; }
    if (i.commandName === "ask") { await i.deferReply(); const [first,...rest] = messageParts(await coach.ask(i.guildId, i.user.id, i.options.getString("question", true)));
      await i.editReply(first);
      for (const part of rest) await i.followUp(part); return; }
    if (i.commandName === "reset") { coach.reset(i.guildId, i.user.id); await i.reply("Your match context is clear."); return; }
    await i.deferReply();
    await (await import("./voice.js")).voice(i, coach);
  } catch {
    console.warn("A Discord command failed:", i.commandName);
    const message = "Command failed. Check my channel permissions and try again.";
    if (i.deferred || i.replied) await i.followUp(message).catch(() => {});
    else await i.reply(message).catch(() => {});
  }
});
await client.login(process.env.DISCORD_TOKEN);




