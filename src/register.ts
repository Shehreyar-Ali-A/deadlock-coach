import { REST, Routes, SlashCommandBuilder } from "discord.js";
const { DISCORD_TOKEN: token, DISCORD_APPLICATION_ID: app, DISCORD_GUILD_ID: guild } = process.env;
if (!token || !app || !guild) throw Error("Set the three DISCORD_ variables in .env.");
const commands = Object.entries({ ping: "Check the bot", ask: "Ask for a shop purchase", reset: "Clear your match context",
  join: "Join your voice channel", leave: "Disconnect the coach", listen: "Send one spoken question to Azure Speech" })
  .map(([name, description]) => {
    const cmd = new SlashCommandBuilder().setName(name).setDescription(description);
    if (name === "ask") cmd.addStringOption(o => o.setName("question").setDescription("Question or follow-up").setRequired(true).setMaxLength(1000));
    return cmd.toJSON();
  });
await new REST().setToken(token).put(Routes.applicationGuildCommands(app, guild), { body: commands });
console.log("Registered six guild commands.");
