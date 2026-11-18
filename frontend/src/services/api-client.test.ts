import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiClient } from "./api-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiClient errors", () => {
  it("preserves a contract 501 error code and message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "NOT_IMPLEMENTED",
              message: "Chức năng xử lý ảnh chưa được triển khai.",
              details: null,
            },
          },
          { status: 501 },
        ),
      ),
    );

    await expect(apiClient.process({ image_id: "id", steps: [] })).rejects.toMatchObject({
      name: "ApiError",
      status: 501,
      code: "NOT_IMPLEMENTED",
      message: "Chức năng xử lý ảnh chưa được triển khai.",
    });
  });

  it("distinguishes a network failure from a backend not-implemented response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    try {
      await apiClient.catalog();
      throw new Error("Expected the catalog request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        status: null,
        code: "NETWORK_ERROR",
        message: "Không thể kết nối máy chủ. Hãy kiểm tra backend rồi thử lại.",
      });
    }
  });

  it("joins server image paths against the configured backend base", () => {
    expect(apiClient.imageUrl("/api/images/id")).toBe("http://127.0.0.1:8000/api/images/id");
  });
});

describe("apiClient advise contract", () => {
  const request = { image_id: "id", prompt: "Ảnh này bị gì?", steps: [], current_result_id: null };

  it("accepts image answers and off-topic notices with empty steps", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({ decision: "answer", analysis: "Ảnh hơi mờ.", steps: [] }),
    ));
    await expect(apiClient.advise(request)).resolves.toMatchObject({ decision: "answer" });
  });

  it("rejects notices that try to include processing steps", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({
        decision: "off_topic",
        analysis: "Ngoài phạm vi.",
        steps: [{ algorithm: "adjust_gamma", params: { gamma: 1.2 }, reason: "x" }],
      }),
    ));
    await expect(apiClient.advise(request)).rejects.toMatchObject({
      name: "ApiError",
      code: "INVALID_RESPONSE",
    });
  });

  it("rejects unknown decisions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({ decision: "chat", analysis: "x", steps: [] }),
    ));
    await expect(apiClient.advise(request)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
