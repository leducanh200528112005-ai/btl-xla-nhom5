import type {
  AdviceResponse,
  AlgorithmDescriptor,
  ProcessingStep,
  ToolId,
} from "@/types/api";

export const TOOL_ORDER: ToolId[] = [
  "scratches",
  "denoise",
  "yellowing",
  "brightness",
  "contrast",
  "colorize",
  "sharpen",
  "upscale",
];

export const TOOL_DISPLAY_ORDER: ToolId[] = [
  "denoise",
  "brightness",
  "contrast",
  "sharpen",
  "scratches",
  "yellowing",
  "colorize",
  "upscale",
];

export const TOOL_PRESENTATION: Record<ToolId, { label: string }> = {
  denoise: { label: "Khử nhiễu" },
  brightness: { label: "Điều chỉnh độ sáng" },
  contrast: { label: "Tăng tương phản" },
  sharpen: { label: "Làm sắc nét" },
  scratches: { label: "Giảm vết xước" },
  yellowing: { label: "Giảm ố vàng" },
  colorize: { label: "Tô màu ảnh" },
  upscale: { label: "Nâng độ phân giải" },
};

export type EditorConfig = {
  enabled: Record<ToolId, boolean>;
  selectedAlgorithms: Record<ToolId, string>;
  params: Record<string, Record<string, number>>;
};

export class SerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SerializationError";
  }
}

const EMPTY_CONFIG: EditorConfig = {
  enabled: {
    denoise: false,
    brightness: false,
    contrast: false,
    sharpen: false,
    scratches: false,
    yellowing: false,
    colorize: false,
    upscale: false,
  },
  selectedAlgorithms: {
    denoise: "",
    brightness: "",
    contrast: "",
    sharpen: "",
    scratches: "",
    yellowing: "",
    colorize: "",
    upscale: "",
  },
  params: {},
};

export function createDefaultConfig(catalog: AlgorithmDescriptor[]): EditorConfig {
  const config: EditorConfig = {
    enabled: { ...EMPTY_CONFIG.enabled },
    selectedAlgorithms: { ...EMPTY_CONFIG.selectedAlgorithms },
    params: {},
  };

  for (const algorithm of catalog) {
    config.selectedAlgorithms[algorithm.tool_id] ||= algorithm.id;
    config.params[algorithm.id] = Object.fromEntries(
      algorithm.params.map((param) => [param.key, param.default]),
    );
  }

  return config;
}

export function cloneConfig(config: EditorConfig): EditorConfig {
  return {
    enabled: { ...config.enabled },
    selectedAlgorithms: { ...config.selectedAlgorithms },
    params: Object.fromEntries(
      Object.entries(config.params).map(([algorithm, params]) => [algorithm, { ...params }]),
    ),
  };
}

export function configsEqual(left: EditorConfig, right: EditorConfig): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Compare effective processing steps, not inactive parameter drafts or reasons. */
export function configMatchesProposal(
  config: EditorConfig,
  catalog: AlgorithmDescriptor[],
  proposal: AdviceResponse,
): boolean {
  try {
    const current = serializeSteps(config, catalog);
    return current.length === proposal.steps.length && current.every((step, index) => {
      const proposed = proposal.steps[index];
      return step.algorithm === proposed.algorithm &&
        Object.keys(step.params).length === Object.keys(proposed.params).length &&
        Object.entries(step.params).every(([key, value]) => proposed.params[key] === value);
    });
  } catch {
    return false;
  }
}

export function serializeSteps(
  config: EditorConfig,
  catalog: AlgorithmDescriptor[],
): ProcessingStep[] {
  const steps: ProcessingStep[] = [];

  for (const toolId of TOOL_ORDER) {
    if (!config.enabled[toolId]) continue;

    const algorithmId = config.selectedAlgorithms[toolId];
    const algorithm = catalog.find(
      (item) => item.id === algorithmId && item.tool_id === toolId,
    );
    if (!algorithm) {
      throw new SerializationError(`Không tìm thấy thuật toán đã chọn cho ${TOOL_PRESENTATION[toolId].label}.`);
    }

    const values = config.params[algorithm.id];
    if (!values) {
      throw new SerializationError(`Thiếu tham số cho thuật toán ${algorithm.name}.`);
    }

    const params: Record<string, number> = {};
    for (const descriptor of algorithm.params) {
      const value = values[descriptor.key];
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        (descriptor.integer && !Number.isInteger(value)) ||
        (descriptor.min !== null && value < descriptor.min) ||
        (descriptor.max !== null && value > descriptor.max)
      ) {
        throw new SerializationError(`Giá trị “${descriptor.label}” không hợp lệ.`);
      }

      if (
        descriptor.kind === "select" &&
        !descriptor.options.some((option) => option.value === value)
      ) {
        throw new SerializationError(`Giá trị “${descriptor.label}” không có trong danh mục.`);
      }

      params[descriptor.key] = value;
    }

    steps.push({ algorithm: algorithm.id, params });
  }

  if (steps.length > 8) {
    throw new SerializationError("Chỉ có thể gửi tối đa tám bước xử lý.");
  }
  if (steps.length > 0 && steps.at(-1)?.algorithm !== config.selectedAlgorithms.upscale) {
    const upscaleStepIndex = steps.findIndex((step) => {
      const descriptor = catalog.find((item) => item.id === step.algorithm);
      return descriptor?.tool_id === "upscale";
    });
    if (upscaleStepIndex !== -1 && upscaleStepIndex !== steps.length - 1) {
      throw new SerializationError("Bước nâng độ phân giải phải đứng cuối.");
    }
  }

  return steps;
}
