import { describe, expect, it } from "vitest";
import type { AlgorithmDescriptor } from "@/types/api";
import {
  createDefaultConfig,
  configMatchesProposal,
  SerializationError,
  serializeSteps,
} from "./serialization";

const catalog: AlgorithmDescriptor[] = [
  {
    id: "denoise_median",
    tool_id: "denoise",
    name: "Median",
    description: "Lọc nhiễu median.",
    implementation_status: "not_implemented",
    params: [
      {
        key: "kernel_size",
        label: "Kích thước kernel",
        description: "",
        kind: "select",
        default: 3,
        integer: true,
        min: null,
        max: null,
        step: null,
        options: [
          { value: 3, label: "3" },
          { value: 5, label: "5" },
          { value: 7, label: "7" },
        ],
      },
    ],
  },
  {
    id: "denoise_bilateral",
    tool_id: "denoise",
    name: "Bilateral",
    description: "Lọc nhiễu bilateral.",
    implementation_status: "not_implemented",
    params: [
      {
        key: "diameter",
        label: "Đường kính",
        description: "",
        kind: "select",
        default: 5,
        integer: true,
        min: null,
        max: null,
        step: null,
        options: [
          { value: 5, label: "5" },
          { value: 7, label: "7" },
          { value: 9, label: "9" },
        ],
      },
      {
        key: "sigma_color",
        label: "Sigma màu",
        description: "",
        kind: "number",
        default: 50,
        integer: true,
        min: 1,
        max: 150,
        step: 1,
        options: [],
      },
    ],
  },
  {
    id: "reduce_scratches",
    tool_id: "scratches",
    name: "Giảm vết xước",
    description: "",
    implementation_status: "not_implemented",
    params: [],
  },
  {
    id: "adjust_gamma",
    tool_id: "brightness",
    name: "Điều chỉnh gamma",
    description: "",
    implementation_status: "not_implemented",
    params: [
      {
        key: "gamma",
        label: "Gamma",
        description: "",
        kind: "number",
        default: 1,
        integer: false,
        min: 0.1,
        max: 3,
        step: 0.05,
        options: [],
      },
    ],
  },
  {
    id: "upscale_image",
    tool_id: "upscale",
    name: "Nâng độ phân giải",
    description: "",
    implementation_status: "not_implemented",
    params: [],
  },
];

describe("serializeSteps", () => {
  it("omits disabled groups and serializes enabled groups in contract order", () => {
    const config = createDefaultConfig(catalog);
    config.enabled.brightness = true;
    config.enabled.scratches = true;
    config.params.adjust_gamma.gamma = 1.25;

    expect(serializeSteps(config, catalog)).toEqual([
      { algorithm: "reduce_scratches", params: {} },
      { algorithm: "adjust_gamma", params: { gamma: 1.25 } },
    ]);
  });

  it("serializes only the currently selected denoise method", () => {
    const config = createDefaultConfig(catalog);
    config.enabled.denoise = true;
    config.selectedAlgorithms.denoise = "denoise_bilateral";
    config.params.denoise_bilateral = { diameter: 7, sigma_color: 81 };

    expect(serializeSteps(config, catalog)).toEqual([
      {
        algorithm: "denoise_bilateral",
        params: { diameter: 7, sigma_color: 81 },
      },
    ]);
  });

  it("matches only effective configuration and detects edits and extra enabled tools", () => {
    const config = createDefaultConfig(catalog);
    config.enabled.brightness = true;
    const proposal = {
      decision: "advise" as const,
      analysis: "Nâng sáng",
      steps: [{ algorithm: "adjust_gamma", params: { gamma: 1 }, reason: "Nhẹ" }],
    };
    config.params.denoise_median.kernel_size = 7;
    expect(configMatchesProposal(config, catalog, proposal)).toBe(true);
    config.params.adjust_gamma.gamma = 1.2;
    expect(configMatchesProposal(config, catalog, proposal)).toBe(false);
    config.params.adjust_gamma.gamma = 1;
    expect(configMatchesProposal(config, catalog, proposal)).toBe(true);
    config.enabled.denoise = true;
    expect(configMatchesProposal(config, catalog, proposal)).toBe(false);
  });

  it("matches empty proposals only when all tools are off", () => {
    const config = createDefaultConfig(catalog);
    const proposal = { decision: "advise" as const, analysis: "Giữ nguyên", steps: [] };
    expect(configMatchesProposal(config, catalog, proposal)).toBe(true);
    config.enabled.brightness = true;
    expect(configMatchesProposal(config, catalog, proposal)).toBe(false);
  });

  it("ignores parameter key ordering but not the selected denoise method", () => {
    const config = createDefaultConfig(catalog);
    config.enabled.denoise = true;
    config.selectedAlgorithms.denoise = "denoise_bilateral";
    const proposal = {
      decision: "advise" as const,
      analysis: "Giảm nhiễu",
      steps: [{
        algorithm: "denoise_bilateral",
        params: { sigma_color: 50, diameter: 5 },
        reason: "Giữ biên",
      }],
    };
    expect(configMatchesProposal(config, catalog, proposal)).toBe(true);
    config.selectedAlgorithms.denoise = "denoise_median";
    expect(configMatchesProposal(config, catalog, proposal)).toBe(false);
  });

  it("rejects invalid values instead of placing them in an API payload", () => {
    const config = createDefaultConfig(catalog);
    config.enabled.brightness = true;
    config.params.adjust_gamma.gamma = Number.NaN;

    expect(() => serializeSteps(config, catalog)).toThrow(SerializationError);
  });

  it("keeps upscale as the final serialized step", () => {
    const config = createDefaultConfig(catalog);
    config.enabled.brightness = true;
    config.enabled.upscale = true;

    expect(serializeSteps(config, catalog).map((step) => step.algorithm)).toEqual([
      "adjust_gamma",
      "upscale_image",
    ]);
  });
});
