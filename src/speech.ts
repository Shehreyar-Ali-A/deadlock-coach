import Opus from "opusscript";
export function speechConfig() {
  const resource = process.env.AZURE_SPEECH_RESOURCE;
  const key = process.env.AZURE_SPEECH_KEY;
  if (!resource || !/^[a-z0-9-]+$/i.test(resource) || !key) return;
  return { host: "https://" + resource + ".cognitiveservices.azure.com", key };
}
type Config = NonNullable<ReturnType<typeof speechConfig>>;
export function wav(pcm: Buffer) {
  const h = Buffer.alloc(44);
  h.write("RIFF"); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
export async function transcribe(c: Config, pcm: Buffer, signal: AbortSignal) {
  const r = await fetch(c.host + "/stt/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=simple", {
    method: "POST", signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    headers: { "Ocp-Apim-Subscription-Key": c.key, "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000" },
    body: new Uint8Array(wav(pcm))
  });
  if (!r.ok) throw Error("Azure transcription returned HTTP " + r.status + ". Check the Speech endpoint and key.");
  const result = await r.json();
  return result.RecognitionStatus === "Success" && typeof result.DisplayText === "string" ? result.DisplayText.trim().slice(0, 1000) : "";
}
export async function synthesize(c: Config, answer: string, signal: AbortSignal) {
  const escaped = answer.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const r = await fetch(c.host + "/tts/cognitiveservices/v1", { method: "POST",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    headers: { "Ocp-Apim-Subscription-Key": c.key, "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "raw-48khz-16bit-mono-pcm", "User-Agent": "DeadlockCoach" },
    body: '<speak version="1.0" xml:lang="en-US"><voice name="en-US-JennyNeural">' + escaped + '</voice></speak>' });
  if (!r.ok) throw Error("Azure playback synthesis returned HTTP " + r.status + ". Check your Speech resource.");
  return Buffer.from(await r.arrayBuffer());
}
export function* packets(pcm: Buffer) {
  const codec = new Opus(48000, 1, Opus.Application.AUDIO);
  try {
    for (let i = 0; i < pcm.length; i += 1920) {
      const frame = Buffer.alloc(1920);
      pcm.copy(frame, 0, i, i + 1920);
      yield Buffer.from(codec.encode(frame, 960));
    }
  } finally { codec.delete(); }
}
