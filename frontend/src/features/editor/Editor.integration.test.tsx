// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  processReply = async () => Response.json(result);
  vi.stubGlobal("fetch", fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/api/health")) return Response.json({ status: "ok", app: "resim", version: "0.1.0" });
    if (url.endsWith("/api/algorithms")) return Response.json({ items: catalog });
    if (url.endsWith("/api/upload")) return Response.json(asset, { status: 201 });
    if (url.endsWith("/api/process")) return processReply();
    if (url.includes("/api/download/")) return new Response(new Blob(["processed png"], { type: "image/png" }));
    throw new Error(`Unexpected request: ${url}`);
  }));
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function uploadAndConfigure() {
  render(<Editor />);
  await screen.findByText("Đã kết nối");
  fireEvent.change(screen.getByLabelText("Chọn một ảnh JPG hoặc PNG"), { target: { files: [new File(["png"], "photo.png", { type: "image/png" })] } });
  await waitFor(() => expect((screen.getByRole("switch", { name: "Bật Giảm ố vàng" }) as HTMLButtonElement).disabled).toBe(false));
  for (const name of ["Bật Giảm ố vàng", "Bật Tô màu ảnh", "Bật Nâng độ phân giải"]) fireEvent.click(screen.getByRole("switch", { name }));
  fireEvent.click(screen.getByRole("button", { name: /Nâng độ phân giải.*phương pháp/ }));
  fireEvent.change(screen.getByLabelText("Hệ số phóng"), { target: { value: "4" } });
}

describe("restoration editor integration", () => {
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
    expect(screen.getByAltText("Ảnh gốc").getAttribute("src")).toBe("blob:preview");
    expect(screen.getByAltText("Kết quả xử lý").getAttribute("src")).toContain(resultId);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Tải kết quả đã xử lý" }));
    await waitFor(() => expect(anchorClick).toHaveBeenCalled());
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith(`/api/download/${resultId}`))).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Tắt Tô màu ảnh" }));
    expect((screen.getByRole("button", { name: "Tải kết quả đã xử lý" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByAltText("Kết quả xử lý")).toBeNull();
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
});
