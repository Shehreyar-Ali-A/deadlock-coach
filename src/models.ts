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
    if (
      ["ally", "enemy", "build"].includes(id) &&
      Object.hasOwn(q.criteria, "unknown") &&
      typeof a.confidence === "number" &&
      a.confidence < 0.65
    ) {
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
export async function wording(
  plan: Record<string, unknown> & { task?: string },
  signal?: AbortSignal,
): Promise<string> {
  const explain = ["compare", "strategy", "counter_items", "plan"].includes(plan.task ?? "");
  const r = await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    signal: deadline(25000, signal),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.COACH_WRITER_MODEL || "qwen2.5:1.5b",
      stream: false,
      options: { temperature: 0, num_predict: explain ? 400 : 220 },
      messages: [
        {
          role: "system",
          content:
            "Turn the supplied notes into a direct answer in conversational English. Include named choices and their specific conditions. Use only these notes. Two to four sentences are usually sufficient. Stop immediately after the answer. Do not add a conclusion, invented mechanics or advice from memory.",
        },
        { role: "user", content: JSON.stringify(plan) },
      ],
    }),
  });
  if (!r.ok) throw Error("Ollama HTTP " + r.status);
  const response = await r.json();
  const answer = response.message?.content;
  if (response.done_reason === "length") throw Error("writer-truncated");
  if (typeof answer !== "string" || !answer.trim() || answer.length > 1850) throw Error("Invalid wording");
  return answer.trim();
}
