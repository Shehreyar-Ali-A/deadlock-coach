import { messageParts, spokenAnswer } from "./shop-lookup.js";
import { Readable } from "node:stream";
import { addAbortSignal } from "node:stream";
import { ChannelType, PermissionFlagsBits as P, type ChatInputCommandInteraction } from "discord.js";
import { AudioPlayerStatus, createAudioPlayer, createAudioResource, EndBehaviorType, entersState, getVoiceConnection,
  joinVoiceChannel, StreamType, VoiceConnectionStatus as State, type VoiceConnection } from "@discordjs/voice";
import Opus from "opusscript";
import type { Advisor } from "./advisor.js";
import { packets, speechConfig, synthesize, transcribe } from "./speech.js";

const jobs = new Map<string, { user: string; abort: AbortController }>();
export function cancel(guild: string, user?: string) {
  const job = jobs.get(guild);
  if (job && (!user || job.user === user)) job.abort.abort();
}

async function capture(conn: VoiceConnection, user: string, signal: AbortSignal) {
  const stream = conn.receiver.subscribe(user, { end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 } });
  addAbortSignal(signal, stream);
  const codec = new Opus(16000, 1, Opus.Application.VOIP);
  const chunks: Buffer[] = [];
  let bytes = 0;
  // Also stop if a client stops sending packets without a silence frame.
  let silence: NodeJS.Timeout | undefined;
  const finish = () => stream.push(null);
  const deadline = setTimeout(finish, 15000);
  try {
    for await (const packet of stream) {
      clearTimeout(silence);
      silence = setTimeout(finish, 1100);
      const pcm = Buffer.from(codec.decode(packet));
      chunks.push(pcm); bytes += pcm.length;
      if (bytes >= 16000 * 2 * 15) break;
    }
    return Buffer.concat(chunks);
  } finally { clearTimeout(deadline); clearTimeout(silence); stream.destroy(); codec.delete(); }
}
export async function voice(i: ChatInputCommandInteraction<"cached">, coach: Advisor) {
  const guild = i.guildId, user = i.user.id;
  const channel = i.member.voice.channel;
  const existing = getVoiceConnection(guild);
  if (!channel || channel.type !== ChannelType.GuildVoice) return i.editReply("Enter a regular voice channel first.");
  if (existing && existing.joinConfig.channelId !== channel.id) return i.editReply("I'm in another channel. Have a player there use /leave first.");
  if (i.commandName === "leave") {
    cancel(guild); existing?.destroy();
    return i.editReply(existing ? "Left voice." : "I'm already disconnected.");
  }
  if (i.commandName === "join") {
    const me = i.guild.members.me;
    if (!me || !channel.permissionsFor(me).has([P.ViewChannel, P.Connect, P.Speak]))
      return i.editReply("Grant me View Channel, Connect and Speak in this voice channel.");
    const conn = existing ?? joinVoiceChannel({ guildId: guild, channelId: channel.id, adapterCreator: i.guild.voiceAdapterCreator, selfDeaf: false });
    if (!existing) {
      conn.on("error", () => { cancel(guild); if (conn.state.status !== State.Destroyed) conn.destroy(); });
      conn.once(State.Disconnected, () => { cancel(guild); if (conn.state.status !== State.Destroyed) conn.destroy(); });
    }
    try { await entersState(conn, State.Ready, 15000); }
    catch { if (conn.state.status !== State.Destroyed) conn.destroy(); return i.editReply("Voice connection failed. Check permissions, channel capacity and UDP connectivity."); }
    return i.editReply("Connected. Use /listen for one question.");
  }
  if (existing?.state.status !== State.Ready) return i.editReply("Use /join in this channel first.");
  const config = speechConfig();
  if (!config) return i.editReply("Configure AZURE_SPEECH_RESOURCE and AZURE_SPEECH_KEY for /listen. You can use /ask now.");
  if (jobs.has(guild)) return i.editReply("I'm handling another question. Try /listen again after playback.");
  const abort = new AbortController();
  jobs.set(guild, { user, abort });
  const player = createAudioPlayer();
  let posted = false;
  try {
    await i.editReply("Speak now. I'll send your next utterance to Azure Speech.");
    abort.signal.throwIfAborted();
    const pcm = await capture(existing, user, abort.signal);
    if (!pcm.length) return await i.followUp("I didn't hear you. Check your mic and try /listen again.");
    const transcript = await transcribe(config, pcm, abort.signal);
    abort.signal.throwIfAborted();
    if (!transcript) return await i.followUp("I couldn't make that out. Try /listen again or type /ask.");
    const answer = await coach.ask(guild, user, transcript, undefined, abort.signal);
    abort.signal.throwIfAborted();
    for (const part of messageParts("Heard “" + transcript + "”\n" + answer + "\nMisheard? Repeat the corrected question with /listen or /ask.")) {
      await i.followUp({content:part,allowedMentions:{parse:[]}});
    }
    posted = true;
    const audio = await synthesize(config, spokenAnswer(answer), abort.signal);
    abort.signal.throwIfAborted();
    const subscription = existing.subscribe(player);
    if (!subscription) throw Error("Voice connection unavailable.");
    try {
      player.on("error", () => abort.abort());
      player.play(createAudioResource(Readable.from(packets(audio)), { inputType: StreamType.Opus }));
      const timeout = AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]);
      await entersState(player, AudioPlayerStatus.Playing, timeout);
      await entersState(player, AudioPlayerStatus.Idle, timeout);
    } finally { subscription.unsubscribe(); }
  } catch (err) {
    const details = err instanceof Error && err.message.startsWith("Azure ") ? err.message : "Check voice connectivity and try /listen again.";
    await i.followUp(abort.signal.aborted ? "Voice question canceled." : (posted ? "Couldn't play the answer. " : "") + details);
  } finally { player.stop(true); jobs.delete(guild); }
}


