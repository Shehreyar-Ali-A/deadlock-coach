# Deadlock Coach

Use `/ask` or `/listen` to describe a fight, ask how an ability scales, or compare item effects. With a Jev key the bot uses the matchup advisor. Without one it runs the original three reviewed purchase rules.

## Enable the matchup advisor

1. Install and start [Ollama for Windows](https://ollama.com/download/windows). In PowerShell run `ollama pull qwen2.5:1.5b`. The Discord process calls its local API on port 11434. A different installed model can be selected with `COACH_WRITER_MODEL`.
2. Create a key in your [Jev AI account](https://jev-ai.pro/docs). Set `JEV_AI_API_KEY` in the local `.env` described below. The default decision model is `jev-latest`. Keep the three Discord settings; Azure Speech is only needed for voice.
3. Run `npm.cmd run build`, `npm.cmd test`, `npm.cmd run refresh`, then start the bot. Register once on a new development server. Existing installations can reuse their registered commands.
4. In Discord try “A bruiser keeps charging me into a wall, then I die during the stun. I have 1,600 souls. How do I play the next fight?” Try “How does Shoulder Charge damage scale with Extra Spirit?” and “Do Mystic Shot and Healbane interact?” A playtest should check whether the answer identifies the wall condition, uses the correct scaling property, and acknowledges uncertainty about proc eligibility.

### What the two models do

Jev routes each AI-mode turn to a stat lookup, explanation/comparison, matchup strategy, counter-item selection, purchase, build sequence, or clarification. Lookups append every verified matching shop row. The in-memory graph links hero ability clauses to damage, healing and control effects and to shop mechanics that can address them. Edges carry source ability IDs and version. Jev selects supported options. Qwen writes the complete answer and Jev checks its claims. Rejected or unavailable wording uses the grounded notes. For an optional console decision trace set COACH_TRACE=1 in .env and restart. It records the route, opponent, evidence IDs, selected items, Jev call count and fallback reason. No transcript or credentials are logged by this trace.

After building, run `node --env-file=.env dist/replay.js` from the repository to replay the Abrams/Billy questions separately and back-to-back, plus both fire-rate phrasings. This uses the configured Jev account and local Ollama model and prints answers and traces without contacting Discord.

The Jev service receives the question or transcript, recent turns from that player, supplied match facts, and relevant game data. The local writer receives the decision and its evidence. Context is per user and guild; use `/reset` between matches. `MatchReport` in `src/advisor.ts` accepts player hero, build, budget and inventory, opposing hero and inventory, and a death description. Today the player supplies the observations.

### What the knowledge base covers

The refresh command downloads heroes, abilities and shop upgrades from the same [Deadlock asset client version](https://api.deadlock-api.com/v1/assets/client-versions) into `.cache/knowledge.json`. It records the three source URLs and retrieval time. Client 6860 has 42 selectable standard heroes, 168 signature slots, 437 ability records including auxiliary abilities, and 156 reviewed normal-shop upgrades. The catalog admits enabled tier 1–4 upgrades from the reviewed list in `src/normal-shop.ts`. Its 156 classes were cross-checked against normal ranked and unranked item purchase statistics. Review new shop additions before extending that list. Each hero's signature slots resolve through its own item mapping. The snapshot preserves raw properties, scaling functions, ability upgrades, shop descriptions, passive/active effects and recipe components. Startup checks cache age and can reuse the previous successful snapshot after a network failure.

The advisor connects explicit recipe components and Spirit Power bonuses to abilities with a matching scaling coefficient. It can reason about other pairings from the documented effects. Matching a damage type to a trigger is evidence for a possible synergy. Hidden proc restrictions, stacking order and undocumented exceptions still need in-game verification. The bot does not read a running match.

## Connect a development server

1. In the [Discord Developer Portal](https://discord.com/developers/applications), create an application. Copy its **Application ID** from General Information. In **Bot**, generate a token and store it locally. Leave privileged gateway intents off.
2. In **Installation**, enable **Guild Install**. Select the `bot` and `applications.commands` scopes. Grant **View Channels**, **Send Messages**, **Connect**, and **Speak**. Use the Discord-provided install link and add the bot to your test server with an account that can manage the server.
3. In Discord **User Settings → Advanced**, turn on **Developer Mode**. Right-click the server icon and choose **Copy Server ID**. Check channel overrides for the bot and give testers **Use Application Commands**.
4. Install [64-bit Node.js](https://nodejs.org/en/download) 24.17 or newer with npm. Reopen PowerShell after installation. Tested on Windows x64 with Node 24.22.1. OpusScript supplies the WASM codec and the voice package installs its DAVE dependency. This PCM/Opus path runs without FFmpeg, Python, or Visual Studio Build Tools.

```powershell
Set-Location 'E:\Projects\deadlock-coach'
npm.cmd ci
Copy-Item .env.example .env
notepad .env
```

Set `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`, and `DISCORD_GUILD_ID`. For voice questions, create an Azure Speech resource with a custom subdomain. From **Keys and Endpoint**, take the name before `.cognitiveservices.azure.com` for `AZURE_SPEECH_RESOURCE` and a matching key for `AZURE_SPEECH_KEY`. Text commands work with both speech fields blank. Save and close Notepad.

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run refresh
npm.cmd run register
npm.cmd run dev
```

Registration replaces this application's commands in the configured development guild. Repeat it after changing command definitions. For development, leave `npm.cmd run dev` running. Saving an imported TypeScript file or the root `.env` restarts the bot automatically. A reload disconnects voice and clears in-memory match context. Stop the watcher with Ctrl+C. Use `npm.cmd run build` to typecheck and generate the compiled files for registration, tests, or the one-shot `npm.cmd start` command.

## First match in local rules mode

Try `/ping`, then `/ask question:I'm playing a spirit build and Abrams keeps healing through fights. I have 1,600 souls. What should I buy?` On client 6860, expect **Buy Healbane now (1,600 souls). Hit the target with spirit damage to reduce the healing they receive.** Try “I need more weapon damage”, “I need more Spirit Power”, or “Abrams keeps healing” after `/reset`. Reply to a clarification with another `/ask` or `/listen`. Each player has separate context per server, expiring after 20 minutes of inactivity. Update your funds with “900 souls”, report “I own Healbane”, or start a new match with `/reset`.

## Two-player voice smoke test (local rules mode)

1. A and B enter the same regular voice channel. Run `/join` in a text channel where both can see replies. A uses `/listen`. After “Speak now”, B speaks first and A asks the Abrams question above. Only A's utterance should appear in the transcript. Check the purchase in text and listen for it in voice.
2. While A's request is active, B uses `/listen`. Expect a busy reply. After playback, B tries again and says “Weapon build. Abrams keeps healing. I have 900 souls.” On client 6860 expect **save 2,300 more for Toxic Bullets**. A can now ask “1,600 souls” and still get Healbane.
3. Arm a turn and stay silent for 15 seconds. Expect a retry prompt. Arm again and have the other player use `/leave` mid-question. Expect cancellation, then verify `/join` and `/listen` work again. Try `/join` from outside voice and with Connect denied to check diagnostics.
4. Check the displayed transcript for hero or budget mistakes. Repeat the **full corrected question** with `/ask` or re-arm `/listen`. To clear a mistaken persistent fact, use `/reset`. Audio stays in process memory until sent to Azure for transcription. The bot posts the transcript and answer in the invoking text channel. Synthesis sends the answer to Azure.

## Local purchase rules and maintenance

The [Deadlock API project](https://github.com/deadlock-api) publishes both endpoints in its [OpenAPI specification](https://api.deadlock-api.com/openapi.json). The loader takes the highest [asset client version](https://api.deadlock-api.com/v1/assets/client-versions) and requests English upgrades pinned to that version. It checks `type`, `shopable`, `cost`, `class_name`, optional disable/component flags and effect text in `description.desc` or Spirit Power in `properties.TechPower`. The reviewed items on [client 6860](https://api.deadlock-api.com/v1/assets/items/by-type/upgrade?language=english&client_version=6860) were Healbane (1,600), Toxic Bullets (3,200), Close Quarters (800) and Extra Spirit (800).

Edit the four evidence checks and reasons in `src/catalog.ts`. The local cache includes the source URL, client version, retrieval time and matching asset records. Startup refreshes after 24 hours. Failed refreshes preserve the last snapshot. A changed mechanic disables its rule. With no usable catalog the bot reports that it cannot verify a purchase. Questions use in-memory data. To update a running bot, run `npm.cmd run refresh` and restart it. The pure `recommend(goal, player, items)` function accepts hero, build, budget and inventory explicitly for future integrations.

Voice uses [Discord voice](https://discord.js.org/docs/packages/voice/stable), [Azure short-audio transcription](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text-short) and [Azure speech synthesis](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech). If voice connection times out, check voice-channel capacity, Connect/Speak overrides, server mute and outbound UDP. For Azure errors, verify that the custom subdomain and key belong to the same active Speech resource.
