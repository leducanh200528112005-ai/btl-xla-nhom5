import type {
  AdviceRequest,
  AdviceResponse,
  AlgorithmDescriptor,
  CatalogResponse,
  HealthResponse,
  ImageAsset,
  ProcessRequest,
  ProcessResult,
} from "@/types/api";

const DEFAULT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";
const VALID_TOOL_IDS = new Set([
  "denoise",
  "brightness",
  "contrast",
  "sharpen",
  "scratches",
  "yellowing",
  "colorize",
  "upscale",
]);

export class ApiError extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly details: unknown;

  constructor(
    message: string,
    options: { status: number | null; code: string; details?: unknown },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details ?? null;
  }
}

function apiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL;
  const base = (configured === undefined ? DEFAULT_API_BASE_URL : configured).trim();

  if (!base) {
    throw new ApiError(
      "Thiếu cấu hình máy chủ API. Hãy thiết lập NEXT_PUBLIC_API_BASE_URL.",
      { status: null, code: "CONFIGURATION_ERROR" },
    );
  }

  try {
    return new URL(base).toString().replace(/\/$/, "");
  } catch {
    throw new ApiError("Địa chỉ máy chủ API không hợp lệ.", {
      status: null,
      code: "CONFIGURATION_ERROR",
    });
  }
}

function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${apiBaseUrl()}${normalizedPath}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseError(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (isRecord(body) && isRecord(body.error)) {
    const error = body.error;
    if (typeof error.code === "string" && typeof error.message === "string") {
      return new ApiError(error.message, {
        status: response.status,
        code: error.code,
        details: error.details ?? null,
      });
    }
  }

  return new ApiError(`Máy chủ trả về lỗi HTTP ${response.status}.`, {
    status: response.status,
    code: "HTTP_ERROR",
  });
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), init);
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      "Không thể kết nối máy chủ. Hãy kiểm tra backend rồi thử lại.",
      { status: null, code: "NETWORK_ERROR" },
    );
  }

  if (!response.ok) throw await parseError(response);

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError("Phản hồi từ máy chủ không đúng định dạng JSON.", {
      status: response.status,
      code: "INVALID_RESPONSE",
    });
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function assertHealth(value: unknown): asserts value is HealthResponse {
  if (
    !isRecord(value) ||
    value.status !== "ok" ||
    typeof value.app !== "string" ||
    typeof value.version !== "string"
  ) {
    throw new ApiError("Phản hồi trạng thái máy chủ không hợp lệ.", {
      status: null,
      code: "INVALID_RESPONSE",
    });
  }
}

function assertCatalog(value: unknown): asserts value is CatalogResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new ApiError("Danh mục thuật toán từ máy chủ không hợp lệ.", {
      status: null,
      code: "INVALID_RESPONSE",
    });
  }

  for (const item of value.items) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.tool_id !== "string" ||
      !VALID_TOOL_IDS.has(item.tool_id) ||
      typeof item.name !== "string" ||
      typeof item.description !== "string" ||
      (item.implementation_status !== "not_implemented" && item.implementation_status !== "implemented") ||
      !Array.isArray(item.params)
    ) {
      throw new ApiError("Danh mục thuật toán từ máy chủ không hợp lệ.", {
        status: null,
        code: "INVALID_RESPONSE",
      });
    }

    for (const param of item.params) {
      if (
        !isRecord(param) ||
        typeof param.key !== "string" ||
        typeof param.label !== "string" ||
        typeof param.description !== "string" ||
        (param.kind !== "number" && param.kind !== "select") ||
        !isFiniteNumber(param.default) ||
        typeof param.integer !== "boolean" ||
        !(param.min === null || isFiniteNumber(param.min)) ||
        !(param.max === null || isFiniteNumber(param.max)) ||
        !(param.step === null || isFiniteNumber(param.step)) ||
        !Array.isArray(param.options) ||
        !param.options.every(
          (option) =>
            isRecord(option) &&
            isFiniteNumber(option.value) &&
            typeof option.label === "string",
        )
      ) {
        throw new ApiError("Tham số trong danh mục từ máy chủ không hợp lệ.", {
          status: null,
          code: "INVALID_RESPONSE",
        });
      }

      if (
        (param.kind === "number" &&
          (!isFiniteNumber(param.min) || !isFiniteNumber(param.max) || !isFiniteNumber(param.step) || param.options.length !== 0)) ||
        (param.kind === "select" &&
          (param.min !== null || param.max !== null || param.step !== null || param.options.length === 0))
      ) {
        throw new ApiError("Định nghĩa kiểu tham số trong danh mục không hợp lệ.", {
          status: null,
          code: "INVALID_RESPONSE",
        });
      }

      if (
        (param.integer && !Number.isInteger(param.default)) ||
        (param.min !== null && param.default < param.min) ||
        (param.max !== null && param.default > param.max) ||
        (param.kind === "select" && !param.options.some((option) => option.value === param.default))
      ) {
        throw new ApiError("Giá trị mặc định trong danh mục không hợp lệ.", {
          status: null,
          code: "INVALID_RESPONSE",
        });
      }
    }
  }
}

function assertImageAsset(value: unknown): asserts value is ImageAsset {
  if (
    !isRecord(value) ||
    typeof value.image_id !== "string" ||
    typeof value.filename !== "string" ||
    (value.content_type !== "image/jpeg" && value.content_type !== "image/png") ||
    !isFiniteNumber(value.size_bytes) ||
    value.size_bytes <= 0 ||
    !isFiniteNumber(value.width) ||
    value.width < 1 ||
    !isFiniteNumber(value.height) ||
    value.height < 1 ||
    typeof value.url !== "string"
  ) {
    throw new ApiError("Thông tin ảnh tải lên từ máy chủ không hợp lệ.", {
      status: null,
      code: "INVALID_RESPONSE",
    });
  }
}

function assertProcessResult(value: unknown): asserts value is ProcessResult {
  if (
    !isRecord(value) ||
    typeof value.result_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.result_id) ||
    typeof value.image_id !== "string" ||
    typeof value.filename !== "string" ||
    (value.content_type !== "image/jpeg" && value.content_type !== "image/png") ||
    !isFiniteNumber(value.size_bytes) ||
    value.size_bytes <= 0 ||
    !Number.isInteger(value.size_bytes) ||
    !isFiniteNumber(value.width) ||
    value.width < 1 ||
    !Number.isInteger(value.width) ||
    !isFiniteNumber(value.height) ||
    value.height < 1 ||
    !Number.isInteger(value.height) ||
    typeof value.url !== "string" ||
    !value.url.startsWith("/api/results/")
  ) {
    throw new ApiError("Kết quả xử lý từ máy chủ không hợp lệ.", {
      status: null,
      code: "INVALID_RESPONSE",
    });
  }
}

function assertAdviceResponse(value: unknown): asserts value is AdviceResponse {
  if (
    !isRecord(value) ||
    typeof value.analysis !== "string" ||
    !Array.isArray(value.steps) ||
    !value.steps.every(
      (step) =>
        isRecord(step) &&
        typeof step.algorithm === "string" &&
        typeof step.reason === "string" &&
        isRecord(step.params) &&
        Object.values(step.params).every(isFiniteNumber),
    )
  ) {
    throw new ApiError("Phản hồi tư vấn từ máy chủ không hợp lệ.", {
      status: null,
      code: "INVALID_RESPONSE",
    });
  }
}

export const apiClient = {
  async health(signal?: AbortSignal): Promise<HealthResponse> {
    const response = await requestJson<unknown>("/api/health", { signal });
    assertHealth(response);
    return response;
  },

  async catalog(signal?: AbortSignal): Promise<AlgorithmDescriptor[]> {
    const response = await requestJson<unknown>("/api/algorithms", { signal });
    assertCatalog(response);
    return response.items;
  },

  async upload(file: File, signal?: AbortSignal): Promise<ImageAsset> {
    const formData = new FormData();
    formData.append("file", file, file.name);
    const response = await requestJson<unknown>("/api/upload", {
      method: "POST",
      body: formData,
      signal,
    });
    assertImageAsset(response);
    return response;
  },

  async process(payload: ProcessRequest, signal?: AbortSignal): Promise<ProcessResult> {
    const response = await requestJson<unknown>("/api/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    assertProcessResult(response);
    return response;
  },

  async advise(payload: AdviceRequest, signal?: AbortSignal): Promise<AdviceResponse> {
    const response = await requestJson<unknown>("/api/advise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    assertAdviceResponse(response);
    return response;
  },

  async download(resultId: string, signal?: AbortSignal): Promise<Blob> {
    let response: Response;
    try {
      response = await fetch(apiUrl(`/api/download/${encodeURIComponent(resultId)}`), {
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        "Không thể kết nối máy chủ. Hãy kiểm tra backend rồi thử lại.",
        { status: null, code: "NETWORK_ERROR" },
      );
    }
    if (!response.ok) throw await parseError(response);
    return response.blob();
  },

  imageUrl(path: string): string {
    return apiUrl(path);
  },
};
