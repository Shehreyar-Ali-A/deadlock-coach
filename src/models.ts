export type Question = { type: "choice"; instructions: string; criteria: Record<string, string | null> };
export function choice(instructions: string, criteria: Record<string, string | null>): Question {
  return { type: "choice", instructions, criteria };
}
export async function decide(state: unknown, questions: Record<string, Question>, signal?: AbortSignal) {
  const response = await fetch("https://jev-ai.pro/api/v1/systemone", {
    method: "POST",
    signal: deadline(25000, signal),
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.JEV_AI_API_KEY },
    body: JSON.stringify({ model: process.env.JEV_MODEL || "jev-latest", state, questions }),
  });
  if (!response.ok) throw Error("Jev HTTP " + response.status);
  const { answers } = await response.json();
  const result: Record<string, string> = {};
  for (const [id, q] of Object.entries(questions)) {
    const a = answers?.[id];
    if (a?.type !== "choice" || typeof a.choice !== "string" || !Object.hasOwn(q.criteria, a.choice))
      throw Error("Invalid Jev decision");
    // A weak identity guess must not turn into a claimed matchup.
    if (Object.hasOwn(q.criteria, "unknown") && typeof a.confidence === "number" && a.confidence < 0.65) {
      result[id] = "unknown";
    } else {
      result[id] = a.choice;
    }
  }
  return result;
}
function deadline(ms: number, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}
export async function wording(plan: {task?:string}, signal?: AbortSignal): Promise<string> {
  const explain = plan.task === "explain";
  const r = await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    signal: deadline(25000, signal),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.COACH_WRITER_MODEL || "qwen2.5:1.5b",
      stream: false,
      options: { temperature: 0, num_predict: explain ? 280 : 120 },
      messages: [
        {
          role: "system",
          content: explain ? "Answer the specific question in plain English using the supplied evidence. For comparisons cover each named item, its trigger and the tradeoff. For scaling explain the affected stat and supported numbers. Use bullets if clearer. Give enough detail to be useful, up to 135 words. Report missing evidence. Do not give an unsolicited purchase instruction." :
            "Write the reason and one practical tip for a player mid-fight, in at most 30 words of plain English. The player already sees the purchase line. Start directly with the mechanic or tactic. Example style: It shortens the slow. Break line of sight before the next shot. Use only the selected evidence; examples are style only. Never repeat the purchase, infer enemy gear, or invent stats.",
        },
        { role: "user", content: JSON.stringify(plan) },
      ],
    }),
  });
  if (!r.ok) throw Error("Ollama HTTP " + r.status);
  const answer = (await r.json()).message?.content;
  if (typeof answer !== "string" || !answer.trim() || answer.trim().split(/\s+/).length > (explain ? 150 : 36) || answer.length > (explain ? 1400 : 320)) throw Error("Invalid wording");
  return answer.trim();
}



