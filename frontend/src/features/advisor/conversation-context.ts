import type { ConversationEvent } from "@/types/api";
import type { ChatEntry } from "@/features/editor/editor-state";

function withVersion(text: string, versionId: string | null | undefined): string {
  return (versionId === undefined ? text : `[Ngữ cảnh: ${versionId ?? "ảnh gốc"}] ${text}`).slice(0, 8000);
}

/** Images are referenced separately; only bounded, completed context goes on the wire. */
export function conversationHistory(chat: ChatEntry[]): ConversationEvent[] {
  return chat.flatMap((entry): ConversationEvent[] => {
    switch (entry.kind) {
      case "user":
        return entry.status === "succeeded" && !entry.excludedFromHistory
          ? [{ kind: "user", text: withVersion(entry.text, entry.versionId), steps: [] }] : [];
      case "assistant":
        return [{
          kind: "assistant", text: withVersion(entry.proposal.analysis, entry.versionId),
          steps: entry.proposal.steps.map(({ algorithm, params }) => ({ algorithm, params })),
        }];
      case "notice":
        return entry.decision === "off_topic" ? [] : [{
          kind: "assistant", text: withVersion(entry.text, entry.versionId), steps: [],
        }];
      case "applied":
        return [{ kind: "applied", text: "Đã áp dụng đề xuất vào cấu hình, chưa phải kết quả xử lý.", steps: entry.steps, source: "ai" }];
      case "processed":
        return [{
          kind: "processed",
          text: `Đã xử lý thành công (${entry.result.result_id}): ${entry.result.width} × ${entry.result.height} px.`,
          steps: entry.steps, source: entry.source,
        }];
    }
  }).slice(-20);
}
