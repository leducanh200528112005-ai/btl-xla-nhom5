import { describe, expect, it } from "vitest";
import { conversationHistory } from "./conversation-context";
import type { ChatEntry } from "@/features/editor/editor-state";

describe("conversationHistory", () => {
  it("omits pending/failed turns and bounds history to twenty events", () => {
    const chat: ChatEntry[] = Array.from({ length: 25 }, (_, i) => ({
      id: `${i}`, kind: "user", text: `turn ${i}`, status: "succeeded", error: null,
    }));
    chat.push({ id: "failed", kind: "user", text: "failed", status: "error", error: "offline" });
    chat.push({ id: "pending", kind: "user", text: "pending", status: "loading", error: null });
    const history = conversationHistory(chat);
    expect(history).toHaveLength(20);
    expect(history[0].text).toBe("turn 5");
    expect(history.at(-1)?.text).toBe("turn 24");
  });

  it("preserves manual result steps and does not serialize image URLs", () => {
    const history = conversationHistory([{
      id: "version", kind: "processed", source: "manual",
      result: {
        result_id: "result", image_id: "original", url: "/api/results/result", filename: "a.png",
        width: 80, height: 60, size_bytes: 100, content_type: "image/png",
      },
      steps: [{ algorithm: "adjust_gamma", params: { gamma: 1.2 } }],
    }]);
    expect(history[0]).toMatchObject({ kind: "processed", source: "manual", steps: [
      { algorithm: "adjust_gamma", params: { gamma: 1.2 } },
    ] });
    expect(JSON.stringify(history)).not.toContain("/api/results/");
  });
});
