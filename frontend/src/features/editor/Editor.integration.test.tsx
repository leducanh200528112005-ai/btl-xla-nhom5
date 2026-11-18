// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "./Editor";
import type { AlgorithmDescriptor } from "@/types/api";

vi.mock("@/lib/image-validation", () => ({
  validateAndDecodeImage: async (file: File) => ({ width: 8, height: 6, previewBlob: file }),
}));

const imageId = "84e83523-9630-4de8-921e-daf875724d6d";
const resultId = "94e83523-9630-4de8-921e-daf875724d6d";
const asset = { image_id: imageId, filename: "photo.png", content_type: "image/png", size_bytes: 200, width: 8, height: 6, url: `/api/images/${imageId}` };
const result = { ...asset, result_id: resultId, filename: "photo-ket-qua.png", width: 32, height: 24, url: `/api/results/${resultId}` };
const catalog: AlgorithmDescriptor[] = [
  { id: "remove_yellow_cast", tool_id: "yellowing", name: "Giảm ố vàng", description: "Lab", implementation_status: "implemented",
    params: [{ key: "strength", label: "Cường độ", description: "", kind: "number", default: 0.5, integer: false, min: 0, max: 1, step: 0.05, options: [] }] },
  { id: "colorize_image", tool_id: "colorize", name: "Tô màu", description: "ECCV16", implementation_status: "implemented",
    params: [{ key: "strength", label: "Cường độ", description: "", kind: "number", default: 1, integer: false, min: 0, max: 1, step: 0.05, options: [] }] },
  { id: "upscale_image", tool_id: "upscale", name: "Phóng ảnh", description: "Lanczos", implementation_status: "implemented",
    params: [{ key: "scale", label: "Hệ số phóng", description: "", kind: "select", default: 2, integer: true, min: null, max: null, step: null, options: [{ value: 2, label: "2" }, { value: 4, label: "4" }] }] },
];

// The editor must send all eight groups, including either denoise method.
for (const [id, tool_id, params] of [
  ["denoise_median", "denoise", { kernel_size: 3 }],
  ["denoise_bilateral", "denoise", { diameter: 5, sigma_color: 50, sigma_space: 50 }],
  ["adjust_gamma", "brightness", { gamma: 1 }],
  ["enhance_clahe", "contrast", { clip_limit: 2, tile_grid_size: 8 }],
  ["sharpen_unsharp", "sharpen", { amount: 0.8, sigma: 1 }],
  ["reduce_scratches", "scratches", { sensitivity: 0.5, inpaint_radius: 3 }],
] as const) {
  catalog.push({ id, tool_id, name: id, description: "", implementation_status: "implemented",
    params: Object.entries(params).map(([key, value]) => ({ key, label: key, description: "",
      kind: "number", default: value, integer: Number.isInteger(value), min: 0, max: 150, step: 0.05, options: [] })) });
}

let processReply: () => Promise<Response>;
let adviceReply: () => Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // jsdom has no native dialog implementation; browser tests cover modal focus/Escape.
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) { this.removeAttribute("open"); },
  });
  processReply = async () => Response.json(result);
  adviceReply = async () => Response.json({
    analysis: "Chỉ cần giảm vàng nhẹ.",
    steps: [{ algorithm: "remove_yellow_cast", params: { strength: 0.2 }, reason: "Giữ màu tự nhiên." }],
  });
  vi.stubGlobal("fetch", fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/api/health")) return Response.json({ status: "ok", app: "resim", version: "0.1.0" });
    if (url.endsWith("/api/algorithms")) return Response.json({ items: catalog });
    if (url.endsWith("/api/upload")) return Response.json(asset, { status: 201 });
    if (url.endsWith("/api/process")) return processReply();
    if (url.endsWith("/api/advise")) return adviceReply();
    if (url.includes("/api/download/")) return new Response(new Blob(["processed png"], { type: "image/png" }));
    throw new Error(`Unexpected request: ${url}`);
  }));
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function uploadAndConfigure() {
  render(<Editor />);
  await screen.findByText("Đã kết nối");
  fireEvent.change(screen.getByLabelText("Chọn một ảnh JPG hoặc PNG"), { target: { files: [new File(["png"], "photo.png", { type: "image/png" })] } });
  await waitFor(() => expect((screen.getByRole("switch", { name: "Bật Giảm ố vàng" }) as HTMLButtonElement).disabled).toBe(false));
  for (const name of ["Bật Giảm ố vàng", "Bật Tô màu ảnh", "Bật Nâng độ phân giải"]) fireEvent.click(screen.getByRole("switch", { name }));
  fireEvent.click(screen.getByRole("button", { name: /Nâng độ phân giải.*phương pháp/ }));
  fireEvent.change(screen.getByLabelText("Hệ số phóng"), { target: { value: "4" } });
}

function openVersionHistory() {
  const toggle = screen.getByRole("button", { name: /^Phiên bản/ });
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
}

async function selectVersion(name: string) {
  openVersionHistory();
  fireEvent.click(await screen.findByRole("button", { name }));
}

function selectComparisonVersion(side: "trái" | "phải", name: string) {
  fireEvent.click(screen.getByRole("button", { name: `Ảnh bên ${side}` }));
  const dialog = screen.getByRole("dialog", { name: `Chọn ảnh bên ${side}` });
  fireEvent.click(within(dialog).getByRole("button", { name }));
  expect(screen.queryByRole("dialog")).toBeNull();
}

describe("restoration editor integration", () => {
  it("opens a visual comparison picker and cancels without changing either side or the editing version", async () => {
    await uploadAndConfigure();
    fireEvent.click(screen.getByRole("button", { name: "Xử lý ảnh" }));
    await screen.findByText("Máy chủ đã trả về kết quả.");
    fireEvent.click(screen.getByRole("button", { name: "So sánh" }));
    expect(screen.queryByText("Đối chiếu hai phiên bản")).toBeNull();
    expect(screen.getByLabelText("Phiên bản bên trái").textContent).toBe("Ảnh gốc");
    expect(screen.getByLabelText("Phiên bản bên phải").textContent).toBe("Phiên bản 1");
    expect(screen.queryByRole("combobox", { name: "Ảnh bên trái" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ảnh bên trái" }));
    const dialog = screen.getByRole("dialog", { name: "Chọn ảnh bên trái" });
    expect(dialog.querySelectorAll("img")).toHaveLength(2);
    expect(within(dialog).getByRole("button", { name: "Chọn ảnh gốc" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(dialog).getByRole("button", { name: "Đóng cửa sổ chọn ảnh" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Phiên bản bên trái").textContent).toBe("Ảnh gốc");
    selectComparisonVersion("trái", "Chọn Phiên bản 1");
    expect(screen.getByLabelText("Phiên bản bên trái").textContent).toBe("Phiên bản 1");
    expect(screen.getByRole("switch", { name: "Tắt Tô màu ảnh" })).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/api/process"))).toHaveLength(1);
  });

  it("keeps history collapsed, toggles it without processing, and closes it with Escape", async () => {
    await uploadAndConfigure();
    expect(screen.queryByRole("contentinfo")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Công cụ phục hồi" })).toBeNull();
    expect(screen.queryByText("Thay đổi thông số không làm biến đổi ảnh xem trước.")).toBeNull();
    expect(screen.queryByRole("region", { name: "Các phiên bản" })).toBeNull();
    openVersionHistory();
    expect(screen.getByRole("region", { name: "Các phiên bản" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    const toggle = screen.getByRole("button", { name: /^Phiên bản/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
    openVersionHistory();
    fireEvent.pointerDown(screen.getByRole("tab", { name: /AI tư vấn/ }));
    expect(screen.queryByRole("region", { name: "Các phiên bản" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/api/process"))).toHaveLength(0);
    fireEvent.click(screen.getByRole("tab", { name: /AI tư vấn/ }));
    expect(screen.queryByRole("heading", { name: "AI tư vấn" })).toBeNull();
    expect(screen.getByLabelText("Bạn muốn cải thiện điều gì?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Gửi yêu cầu" }).closest(".chat-input-box")).toBeTruthy();
  });

  it("restores versions, compares arbitrary results, and sends AI the editing version rather than either comparison side", async () => {
    await uploadAndConfigure();
    fireEvent.click(screen.getByRole("button", { name: "Xử lý ảnh" }));
    await screen.findByText("Máy chủ đã trả về kết quả.");
    fireEvent.click(screen.getByRole("switch", { name: "Tắt Tô màu ảnh" }));
    const secondId = "a4e83523-9630-4de8-921e-daf875724d6d";
    processReply = async () => Response.json({ ...result, result_id: secondId, url: `/api/results/${secondId}` });
    fireEvent.click(screen.getByRole("button", { name: "Xử lý ảnh" }));
    await screen.findByText("Máy chủ đã trả về kết quả.");
    await selectVersion("Chỉnh tiếp Phiên bản 1");
    expect(screen.getByRole("switch", { name: "Tắt Tô màu ảnh" })).toBeTruthy();
    expect(screen.getByAltText("Kết quả xử lý của photo.png").getAttribute("src")).toContain(resultId);
    fireEvent.click(screen.getByRole("button", { name: "So sánh" }));
    selectComparisonVersion("trái", "Chọn Phiên bản 2");
    selectComparisonVersion("phải", "Chọn Phiên bản 1");
    expect(screen.getByAltText("Bên trái: Phiên bản 2").getAttribute("src")).toContain(secondId);
    expect(screen.getByAltText("Bên phải: Phiên bản 1").getAttribute("src")).toContain(resultId);
    fireEvent.click(screen.getByRole("button", { name: "Đổi hai bên" }));
    expect(screen.getByAltText("Bên trái: Phiên bản 1").getAttribute("src")).toContain(resultId);
    expect(screen.getByAltText("Bên phải: Phiên bản 2").getAttribute("src")).toContain(secondId);
    const divider = screen.getByRole("slider", { name: "Thanh phân chia ảnh" });
    fireEvent.keyDown(divider, { key: "End" });
    expect(divider.getAttribute("aria-valuenow")).toBe("100");
    fireEvent.keyDown(divider, { key: "Home" });
    expect(divider.getAttribute("aria-valuenow")).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Phóng to" }));
    expect(screen.getByAltText("Bên trái: Phiên bản 1").style.transform)
      .toBe(screen.getByAltText("Bên phải: Phiên bản 2").style.transform);

    let resolveAdvice!: (response: Response) => void;
    adviceReply = () => new Promise<Response>((resolve) => { resolveAdvice = resolve; });
    fireEvent.click(screen.getByRole("tab", { name: /AI tư vấn/ }));
    fireEvent.change(screen.getByLabelText("Bạn muốn cải thiện điều gì?"), { target: { value: "Giảm vàng" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi yêu cầu" }));
    await screen.findByText("AI đang phân tích…");
    const adviceCall = fetchMock.mock.calls.find(([url]) => url.endsWith("/api/advise"));
    expect(JSON.parse(adviceCall![1].body)).toMatchObject({ current_result_id: resultId,
      steps: expect.arrayContaining([{ algorithm: "colorize_image", params: { strength: 1 } }]) });
    await selectVersion("Chỉnh tiếp Phiên bản 2");
    await act(async () => resolveAdvice(Response.json({
      analysis: "Giảm vàng cho phiên bản 1.",
      steps: [{ algorithm: "remove_yellow_cast", params: { strength: 0.2 }, reason: "Giữ màu." }],
    })));
    expect((screen.getByRole("button", { name: "Áp dụng cấu hình" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Chọn Phiên bản 1 trong danh sách để áp dụng đề xuất này.")).toBeTruthy();
    await selectVersion("Chỉnh tiếp Phiên bản 1");
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng cấu hình" }));
    expect(screen.getByText("Cấu hình đã thay đổi, chưa xử lý lại. Ảnh đang xem chưa phản ánh thay đổi này.")).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/api/process"))).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Chọn một ảnh JPG hoặc PNG"), {
      target: { files: [new File(["new"], "new.png", { type: "image/png" })] },
    });
    await screen.findByAltText("Ảnh gốc new.png");
    openVersionHistory();
    expect(screen.queryByRole("button", { name: "Chỉnh tiếp Phiên bản 1" })).toBeNull();
  }, 15000);

  it("can compare saved results while editing the original and sends AI no selected result", async () => {
    await uploadAndConfigure();
    fireEvent.click(screen.getByRole("button", { name: "Xử lý ảnh" }));
    await screen.findByText("Máy chủ đã trả về kết quả.");
    await selectVersion("Chỉnh từ ảnh gốc");
    expect(screen.getByRole("switch", { name: "Bật Tô màu ảnh" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "So sánh" }));
    expect(screen.getByAltText("Bên phải: Phiên bản 1").getAttribute("src")).toContain(resultId);
    fireEvent.click(screen.getByRole("tab", { name: /AI tư vấn/ }));
    fireEvent.change(screen.getByLabelText("Bạn muốn cải thiện điều gì?"), { target: { value: "Bắt đầu lại" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi yêu cầu" }));
    await screen.findByText("Chỉ cần giảm vàng nhẹ.");
    const adviceCall = fetchMock.mock.calls.find(([url]) => url.endsWith("/api/advise"));
    expect(JSON.parse(adviceCall![1].body)).toMatchObject({ current_result_id: null, steps: [] });
  });

  it("handles aborted connection requests during Strict Mode cleanup and unmount", async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const signal = init.signal!;
      signals.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });

    const { unmount } = render(<StrictMode><Editor /></StrictMode>);
    await act(async () => {});
    expect(signals).toHaveLength(4);
    expect(signals.slice(0, 2).every((signal) => signal.aborted)).toBe(true);
    expect(signals.slice(2).every((signal) => !signal.aborted)).toBe(true);
    unmount();
    await act(async () => {});
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(screen.queryByText("Không thể kết nối máy chủ.")).toBeNull();
  });

  it("continues a chat with manual and AI result snapshots even after changing the draft", async () => {
    await uploadAndConfigure();
    fireEvent.click(screen.getByRole("button", { name: "Xử lý ảnh" }));
    await screen.findByText("Máy chủ đã trả về kết quả.");
    fireEvent.click(screen.getByRole("switch", { name: "Tắt Tô màu ảnh" }));
    fireEvent.click(screen.getByRole("tab", { name: /AI tư vấn/ }));
    await screen.findByText(/Bạn đã tự điều chỉnh và xử lý ảnh - Phiên bản 1/);
    fireEvent.change(screen.getByLabelText("Bạn muốn cải thiện điều gì?"), { target: { value: "Màu chưa tự nhiên" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi yêu cầu" }));
    await screen.findByText("Chỉ cần giảm vàng nhẹ.");
    let calls = fetchMock.mock.calls.filter(([url]) => url.endsWith("/api/advise"));
    const first = JSON.parse(calls[0][1].body);
    expect(first.current_result_id).toBe(resultId);
    expect(first.steps.some((step: { algorithm: string }) => step.algorithm === "colorize_image")).toBe(false);
    expect(first.history[0]).toMatchObject({
      kind: "processed", source: "manual", steps: [
        { algorithm: "remove_yellow_cast", params: { strength: 0.5 } },
        { algorithm: "colorize_image", params: { strength: 1 } },
        { algorithm: "upscale_image", params: { scale: 4 } },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng cấu hình" }));
    fireEvent.click(screen.getByRole("tab", { name: /Công cụ/ }));
    const secondResultId = "a4e83523-9630-4de8-921e-daf875724d6d";
    processReply = async () => Response.json({ ...result, result_id: secondResultId, url: `/api/results/${secondResultId}` });
    fireEvent.click(screen.getByRole("button", { name: "Xử lý ảnh" }));
    await screen.findByText("Máy chủ đã trả về kết quả.");
    fireEvent.click(screen.getByRole("tab", { name: /AI tư vấn/ }));
    await screen.findByText(/Đã xử lý theo đề xuất AI - Phiên bản 2/);
    expect(screen.getAllByAltText("Phiên bản đã xử lý photo-ket-qua.png")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Bạn muốn cải thiện điều gì?"), { target: { value: "Giảm thêm một chút" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi yêu cầu" }));
    await screen.findByText("Giảm thêm một chút");
    await waitFor(() => expect(screen.getAllByText("Chỉ cần giảm vàng nhẹ.")).toHaveLength(2));
    calls = fetchMock.mock.calls.filter(([url]) => url.endsWith("/api/advise"));
    const followup = JSON.parse(calls[1][1].body);
    expect(followup.current_result_id).toBe(secondResultId);
    expect(followup.history.map((event: { kind: string }) => event.kind)).toEqual([
      "processed", "user", "assistant", "applied", "processed",
    ]);
    expect(followup.history.at(-1)).toMatchObject({
      source: "ai", steps: [{ algorithm: "remove_yellow_cast", params: { strength: 0.2 } }],
    });
    fireEvent.change(screen.getByLabelText("Chọn một ảnh JPG hoặc PNG"), { target: { files: [new File(["new"], "new.png", { type: "image/png" })] } });
    await screen.findByAltText("Ảnh gốc new.png");
    expect(screen.queryByText("Màu chưa tự nhiên")).toBeNull();
    expect(screen.queryByText("Chỉ cần giảm vàng nhẹ.")).toBeNull();
  }, 15000);

  it("applies real advice as configuration and processes from the proposal without switching tabs", async () => {
    await uploadAndConfigure();
    fireEvent.click(screen.getByRole("tab", { name: /AI tư vấn/ }));
    fireEvent.change(screen.getByLabelText("Bạn muốn cải thiện điều gì?"), { target: { value: "Giữ tự nhiên" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi yêu cầu" }));
    await screen.findByText("Chỉ cần giảm vàng nhẹ.");
    expect(screen.getByText("strength: 0.2")).toBeTruthy();
    const adviceCall = fetchMock.mock.calls.find(([url]) => url.endsWith("/api/advise"));
    expect(JSON.parse(adviceCall![1].body)).toMatchObject({
      image_id: imageId, prompt: "Giữ tự nhiên", current_result_id: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng cấu hình" }));
    expect((screen.getByRole("button", { name: "Đã khớp đề xuất · Xử lý ảnh" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Hoàn tác" }));
    expect((screen.getByRole("button", { name: "Áp dụng cấu hình" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng cấu hình" }));
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/api/process"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Đã khớp đề xuất · Xử lý ảnh" }));
    await screen.findByText(/Đã xử lý theo đề xuất AI - Phiên bản 1/);
    expect(screen.getByRole("tab", { name: /AI tư vấn/ }).getAttribute("aria-selected")).toBe("true");
    const processedButton = screen.getByRole("button", { name: "Đã xử lý · Phiên bản 1" }) as HTMLButtonElement;
    expect(processedButton.disabled).toBe(true);
    fireEvent.click(processedButton);
    const call = fetchMock.mock.calls.find(([url]) => url.endsWith("/api/process"));
    expect(JSON.parse(call![1].body).steps).toEqual([
      { algorithm: "remove_yellow_cast", params: { strength: 0.2 } },
    ]);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/api/process"))).toHaveLength(1);
  });

  it("displays AI failure without fabricating a proposal", async () => {
    adviceReply = async () => Response.json({
      error: { code: "AI_NOT_CONFIGURED", message: "Chưa cấu hình AI.", details: null },
    }, { status: 503 });
    await uploadAndConfigure();
    fireEvent.click(screen.getByRole("tab", { name: /AI tư vấn/ }));
    fireEvent.change(screen.getByLabelText("Bạn muốn cải thiện điều gì?"), { target: { value: "Giữ tự nhiên" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi yêu cầu" }));
    await screen.findByText("Chưa cấu hình AI.");
    expect(screen.queryByRole("button", { name: "Áp dụng cấu hình" })).toBeNull();
  });

  it("sends ordered numeric parameters, displays real result metadata, compares and downloads", async () => {
    await uploadAndConfigure();
    expect((screen.getByRole("button", { name: "So sánh" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Xử lý ảnh" }));
    await screen.findByText("Máy chủ đã trả về kết quả.");
    const processCall = fetchMock.mock.calls.find(([url]) => url.endsWith("/api/process"));
    expect(JSON.parse(processCall![1].body)).toEqual({
      image_id: imageId,
      steps: [
        { algorithm: "remove_yellow_cast", params: { strength: 0.5 } },
        { algorithm: "colorize_image", params: { strength: 1 } },
        { algorithm: "upscale_image", params: { scale: 4 } },
      ],
    });
    expect(screen.getByAltText("Kết quả xử lý của photo.png").getAttribute("src")).toContain(result.url);
    expect(screen.getAllByText(/32 × 24 px/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "So sánh" }));
    expect(screen.getByAltText("Bên trái: Ảnh gốc").getAttribute("src")).toBe("blob:preview");
    expect(screen.getByAltText("Bên phải: Phiên bản 1").getAttribute("src")).toContain(resultId);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Tải kết quả đã xử lý" }));
    await waitFor(() => expect(anchorClick).toHaveBeenCalled());
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith(`/api/download/${resultId}`))).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Tắt Tô màu ảnh" }));
    expect((screen.getByRole("button", { name: "Tải kết quả đã xử lý" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByAltText("Bên phải: Phiên bản 1").getAttribute("src")).toContain(resultId);
  });

  it.each(["denoise_median", "denoise_bilateral"])("processes all eight tools with %s in API order", async (denoise) => {
    await uploadAndConfigure();
    for (const label of ["Khử nhiễu", "Điều chỉnh độ sáng", "Tăng tương phản", "Làm sắc nét", "Giảm vết xước"]) {
      fireEvent.click(screen.getByRole("switch", { name: `Bật ${label}` }));
    }
    fireEvent.click(screen.getByRole("button", { name: /Khử nhiễu.*phương pháp/ }));
    fireEvent.change(screen.getByLabelText("Phương pháp"), { target: { value: denoise } });
    fireEvent.click(screen.getByRole("button", { name: "Xử lý ảnh" }));
    await screen.findByText("Máy chủ đã trả về kết quả.");
    const processCall = fetchMock.mock.calls.find(([url]) => url.endsWith("/api/process"));
    const payload = JSON.parse(processCall![1].body);
    expect(payload.steps.map((step: { algorithm: string }) => step.algorithm)).toEqual([
      "reduce_scratches", denoise, "remove_yellow_cast", "adjust_gamma", "enhance_clahe", "colorize_image", "sharpen_unsharp", "upscale_image",
    ]);
    for (const step of payload.steps) {
      for (const value of Object.values(step.params)) expect(typeof value).toBe("number");
    }
    expect((screen.getByRole("button", { name: "Tải kết quả đã xử lý" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows model failures without enabling comparison or download", async () => {
    processReply = async () => Response.json({ error: { code: "MODEL_UNAVAILABLE", message: "Mô hình tô màu chưa sẵn sàng.", details: null } }, { status: 503 });
    await uploadAndConfigure();
    fireEvent.click(screen.getByRole("button", { name: "Xử lý ảnh" }));
    await screen.findByText("Mô hình tô màu chưa sẵn sàng.");
    expect((screen.getByRole("button", { name: "So sánh" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Tải kết quả đã xử lý" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("ignores a late processing result after replacing the image", async () => {
    let resolve!: (response: Response) => void;
    processReply = () => new Promise<Response>((done) => { resolve = done; });
    await uploadAndConfigure();
    fireEvent.click(screen.getByRole("button", { name: "Xử lý ảnh" }));
    await screen.findByText("Đang gửi yêu cầu xử lý…");
    expect((screen.getByRole("switch", { name: "Tắt Tô màu ảnh" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Chọn một ảnh JPG hoặc PNG"), { target: { files: [new File(["new"], "new.png", { type: "image/png" })] } });
    await screen.findByAltText("Ảnh gốc new.png");
    await act(async () => resolve(Response.json(result)));
    expect(screen.queryByText("Máy chủ đã trả về kết quả.")).toBeNull();
    expect((screen.getByRole("button", { name: "Tải kết quả đã xử lý" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("handles a fetch rejection when replacing an image aborts processing", async () => {
    let processSignal: AbortSignal | undefined;
    const defaultFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      if (!url.endsWith("/api/process")) return defaultFetch(url, init);
      processSignal = init.signal!;
      return new Promise<Response>((_resolve, reject) => {
        processSignal!.addEventListener("abort", () => reject(processSignal!.reason), { once: true });
      });
    });

    await uploadAndConfigure();
    fireEvent.click(screen.getByRole("button", { name: "Xử lý ảnh" }));
    await screen.findByText("Đang gửi yêu cầu xử lý…");
    fireEvent.change(screen.getByLabelText("Chọn một ảnh JPG hoặc PNG"), {
      target: { files: [new File(["new"], "new.png", { type: "image/png" })] },
    });
    await screen.findByAltText("Ảnh gốc new.png");
    expect(processSignal?.aborted).toBe(true);
    await waitFor(() => expect((screen.getByRole("switch", { name: "Bật Giảm ố vàng" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText("Máy chủ đã trả về kết quả.")).toBeNull();
    expect(screen.queryByText("signal is aborted without reason")).toBeNull();
  });
});
