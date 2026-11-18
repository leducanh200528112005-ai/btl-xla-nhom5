import { describe, expect, it } from "vitest";
import { conversationHistory } from "./conversation-context";
import type { ChatEntry } from "@/features/editor/editor-state";

describe("conversationHistory", () => {
  it("labels completed AI turns with their source version without adding image URLs", () => {
    const history = conversationHistory([
      { id: "user", kind: "user", text: "Giảm vàng", status: "succeeded", error: null, versionId: "older-result" },
      { id: "reply", kind: "assistant", proposal: { analysis: "Giảm nhẹ", steps: [] }, versionId: "older-result" },
      { id: "original", kind: "user", text: "Bắt đầu lại", status: "succeeded", error: null, versionId: null },
    ]);
    expect(history[0].text).toBe("[Ngữ cảnh: older-result] Giảm vàng");
    expect(history[1].text).toBe("[Ngữ cảnh: older-result] Giảm nhẹ");
    expect(history[2].text).toBe("[Ngữ cảnh: ảnh gốc] Bắt đầu lại");
  });

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
