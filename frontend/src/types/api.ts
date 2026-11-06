export type ToolId =
  | "denoise"
  | "brightness"
  | "contrast"
  | "sharpen"
  | "scratches"
  | "yellowing"
  | "colorize"
  | "upscale";

export type ParameterDescriptor = {
  key: string;
  label: string;
  description: string;
  kind: "number" | "select";
  default: number;
  integer: boolean;
  min: number | null;
  max: number | null;
  step: number | null;
  options: { value: number; label: string }[];
};

export type AlgorithmDescriptor = {
  id: string;
  tool_id: ToolId;
  name: string;
  description: string;
  implementation_status: "not_implemented" | "implemented";
  params: ParameterDescriptor[];
};

export type HealthResponse = {
  status: "ok";
  app: string;
  version: string;
};

export type CatalogResponse = {
  items: AlgorithmDescriptor[];
};

export type ImageAsset = {
  image_id: string;
  filename: string;
  content_type: "image/jpeg" | "image/png";
  size_bytes: number;
  width: number;
  height: number;
  url: string;
};

export type ProcessingStep = {
  algorithm: string;
  params: Record<string, number>;
};

export type ProcessRequest = {
  image_id: string;
  steps: ProcessingStep[];
};

export type ProcessResult = {
  result_id: string;
  image_id: string;
  filename: string;
  content_type: "image/jpeg" | "image/png";
  size_bytes: number;
  width: number;
  height: number;
  url: string;
};

export type AdviceRequest = {
  image_id: string;
  prompt: string;
  steps: ProcessingStep[];
  current_result_id: string | null;
};

export type AdviceStep = ProcessingStep & { reason: string };

export type AdviceResponse = {
  analysis: string;
  steps: AdviceStep[];
};

export type ApiErrorDetails = { field: string; message: string }[] | null;

export type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    details: ApiErrorDetails;
  };
};
