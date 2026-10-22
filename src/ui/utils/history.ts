import type { LLMMessage } from "../../providers/types.js";

/**
 * Removes the last `turns` user turns (prompt plus everything after it) from
 * history. Returns the earliest removed prompt so it can be put back in the
 * input box.
 */
export function popUserTurns(history: LLMMessage[], turns: number): string {
  let prompt = "";
  let popped = 0;
  while (history.length > 0 && popped < turns) {
    const m = history.pop();
    if (m?.role !== "user") continue;
    const text = m.content.find((c) => c.type === "text");
    if (text && text.type === "text") {
      prompt = text.text;
      popped++;
    }
  }
  return prompt;
}
