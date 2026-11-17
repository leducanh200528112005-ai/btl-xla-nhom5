import type { ConversationEvent } from "@/types/api";
import type { ChatEntry } from "@/features/editor/editor-state";

/** Images are referenced separately; only bounded, completed context goes on the wire. */
export function conversationHistory(chat: ChatEntry[]): ConversationEvent[] {
  return chat.flatMap((entry): ConversationEvent[] => {
    switch (entry.kind) {
      case "user":
        return entry.status === "succeeded"
          ? [{ kind: "user", text: entry.text, steps: [] }] : [];
      case "assistant":
        return [{
          kind: "assistant", text: entry.proposal.analysis,
          steps: entry.proposal.steps.map(({ algorithm, params }) => ({ algorithm, params })),
        }];
      case "applied":
        return [{ kind: "applied", text: "Đã áp dụng đề xuất vào cấu hình, chưa phải kết quả xử lý.", steps: entry.steps, source: "ai" }];
      case "processed":
        return [{
          kind: "processed",
          text: `Đã xử lý thành công: ${entry.result.width} × ${entry.result.height} px.`,
          steps: entry.steps, source: entry.source,
        }];
    }
  }).slice(-20);
}
