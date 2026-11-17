import { ApiError } from "@/services/api-client";
import type {
  AdviceResponse,
  AlgorithmDescriptor,
  ImageAsset,
  ProcessResult,
  ProcessingStep,
  ToolId,
} from "@/types/api";
import {
  cloneConfig,
  configsEqual,
  createDefaultConfig,
  type EditorConfig,
} from "./serialization";

export type ConnectionStatus = "checking" | "ready" | "offline";
export type UploadStatus = "empty" | "uploading" | "uploaded" | "error";
export type RequestStatus =
  | "idle"
  | "loading"
  | "error"
  | "not_implemented"
  | "succeeded";

export type ResultSnapshot = {
  result: ProcessResult;
  steps: ProcessingStep[];
  source: "manual" | "ai";
};

export type ChatEntry =
  | { id: string; kind: "user"; text: string; status: "loading" | "succeeded" | "error"; error: string | null }
  | { id: string; kind: "assistant"; proposal: AdviceResponse }
  | { id: string; kind: "applied"; steps: ProcessingStep[] }
  | ({ id: string; kind: "processed" } & ResultSnapshot);

export type EditorState = {
  connectionStatus: ConnectionStatus;
  connectionError: ApiError | null;
  catalog: AlgorithmDescriptor[] | null;
  file: File | null;
  previewUrl: string | null;
  previewWidth: number | null;
  previewHeight: number | null;
  generation: number;
  uploaded: ImageAsset | null;
  uploadStatus: UploadStatus;
  uploadError: ApiError | null;
  config: EditorConfig;
  history: EditorConfig[];
  historyIndex: number;
  draftSyncVersion: number;
  activeTab: "tools" | "advisor";
  zoom: number;
  processStatus: RequestStatus;
  processError: ApiError | null;
  result: ProcessResult | null;
  adviseStatus: RequestStatus;
  adviseError: ApiError | null;
  proposal: AdviceResponse | null;
  chat: ChatEntry[];
  pendingAdviceId: string | null;
  latestResult: ResultSnapshot | null;
  pendingProcessing: Omit<ResultSnapshot, "result"> | null;
  configSource: "manual" | "ai";
};

export type EditorAction =
  | { type: "API_CHECKING" }
  | { type: "API_READY"; catalog: AlgorithmDescriptor[] }
  | { type: "API_FAILED"; error: ApiError }
  | {
      type: "FILE_SELECTED";
      file: File;
      previewUrl: string;
      width: number;
      height: number;
      generation: number;
    }
  | { type: "UPLOAD_STARTED"; generation: number }
  | { type: "UPLOAD_SUCCEEDED"; generation: number; asset: ImageAsset }
  | { type: "UPLOAD_FAILED"; generation: number; error: ApiError }
  | { type: "SET_TAB"; tab: "tools" | "advisor" }
  | { type: "SET_ZOOM"; zoom: number }
  | { type: "SET_ENABLED"; toolId: ToolId; enabled: boolean }
  | { type: "SELECT_ALGORITHM"; toolId: ToolId; algorithmId: string }
  | { type: "SET_PARAM"; algorithmId: string; key: string; value: number }
  | { type: "RESET_CONFIG" }
  | { type: "UNDO_CONFIG" }
  | { type: "APPLY_CONFIG"; config: EditorConfig; steps: ProcessingStep[]; eventId: string }
  | { type: "PROCESS_STARTED"; generation: number; steps: ProcessingStep[] }
  | { type: "PROCESS_SUCCEEDED"; generation: number; result: ProcessResult }
  | { type: "PROCESS_FAILED"; generation: number; error: ApiError }
  | { type: "ADVISE_STARTED"; generation: number; prompt: string; requestId: string }
  | { type: "ADVISE_SUCCEEDED"; generation: number; proposal: AdviceResponse }
  | { type: "ADVISE_FAILED"; generation: number; error: ApiError };

const initialConfig = createDefaultConfig([]);

export const initialEditorState: EditorState = {
  connectionStatus: "checking",
  connectionError: null,
  catalog: null,
  file: null,
  previewUrl: null,
  previewWidth: null,
  previewHeight: null,
  generation: 0,
  uploaded: null,
  uploadStatus: "empty",
  uploadError: null,
  config: initialConfig,
  history: [initialConfig],
  historyIndex: 0,
  draftSyncVersion: 0,
  activeTab: "tools",
  zoom: 1,
  processStatus: "idle",
  processError: null,
  result: null,
  adviseStatus: "idle",
  adviseError: null,
  proposal: null,
  chat: [],
  pendingAdviceId: null,
  latestResult: null,
  pendingProcessing: null,
  configSource: "manual",
};

function copySteps(steps: ProcessingStep[]): ProcessingStep[] {
  return steps.map((step) => ({ algorithm: step.algorithm, params: { ...step.params } }));
}

function appendChat(chat: ChatEntry[], entry: ChatEntry): ChatEntry[] {
  return [...chat, entry].slice(-100);
}

function appendHistory(state: EditorState, config: EditorConfig): EditorState {
  if (configsEqual(config, state.config)) return state;

  const history = state.history
    .slice(0, state.historyIndex + 1)
    .concat(cloneConfig(config));
  const boundedHistory = history.length > 50 ? history.slice(history.length - 50) : history;

  return {
    ...state,
    config: cloneConfig(config),
    history: boundedHistory,
    historyIndex: boundedHistory.length - 1,
    result: null,
    processStatus: "idle",
    processError: null,
    configSource: "manual",
  };
}

function requestStatus(error: ApiError): RequestStatus {
  return error.status === 501 && error.code === "NOT_IMPLEMENTED" ? "not_implemented" : "error";
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "API_CHECKING":
      return { ...state, connectionStatus: "checking", connectionError: null };
    case "API_READY": {
      const config = state.catalog ? state.config : createDefaultConfig(action.catalog);
      return {
        ...state,
        connectionStatus: "ready",
        connectionError: null,
        catalog: action.catalog,
        config,
        history: state.catalog ? state.history : [cloneConfig(config)],
        historyIndex: state.catalog ? state.historyIndex : 0,
        draftSyncVersion: state.draftSyncVersion + 1,
      };
    }
    case "API_FAILED":
      return {
        ...state,
        connectionStatus: "offline",
        connectionError: action.error,
      };
    case "FILE_SELECTED": {
      const config = createDefaultConfig(state.catalog ?? []);
      return {
        ...state,
        file: action.file,
        previewUrl: action.previewUrl,
        previewWidth: action.width,
        previewHeight: action.height,
        generation: action.generation,
        uploaded: null,
        uploadStatus: "uploading",
        uploadError: null,
        config,
        history: [cloneConfig(config)],
        historyIndex: 0,
        draftSyncVersion: state.draftSyncVersion + 1,
        zoom: 1,
        processStatus: "idle",
        processError: null,
        result: null,
        adviseStatus: "idle",
        adviseError: null,
        proposal: null,
        chat: [],
        pendingAdviceId: null,
        latestResult: null,
        pendingProcessing: null,
        configSource: "manual",
      };
    }
    case "UPLOAD_STARTED":
      return action.generation !== state.generation
        ? state
        : { ...state, uploadStatus: "uploading", uploadError: null };
    case "UPLOAD_SUCCEEDED":
      return action.generation !== state.generation
        ? state
        : {
            ...state,
            uploaded: action.asset,
            uploadStatus: "uploaded",
            uploadError: null,
          };
    case "UPLOAD_FAILED":
      return action.generation !== state.generation
        ? state
        : { ...state, uploaded: null, uploadStatus: "error", uploadError: action.error };
    case "SET_TAB":
      return { ...state, activeTab: action.tab };
    case "SET_ZOOM":
      return { ...state, zoom: Math.max(0.25, Math.min(3, action.zoom)) };
    case "SET_ENABLED": {
      const config = cloneConfig(state.config);
      config.enabled[action.toolId] = action.enabled;
      return appendHistory(state, config);
    }
    case "SELECT_ALGORITHM": {
      const config = cloneConfig(state.config);
      config.selectedAlgorithms[action.toolId] = action.algorithmId;
      return appendHistory(state, config);
    }
    case "SET_PARAM": {
      const config = cloneConfig(state.config);
      if (!config.params[action.algorithmId]) return state;
      config.params[action.algorithmId][action.key] = action.value;
      return appendHistory(state, config);
    }
    case "RESET_CONFIG": {
      const config = createDefaultConfig(state.catalog ?? []);
      return {
        ...appendHistory(state, config),
        draftSyncVersion: state.draftSyncVersion + 1,
        configSource: "manual",
      };
    }
    case "UNDO_CONFIG": {
      if (state.historyIndex <= 0) return state;
      const historyIndex = state.historyIndex - 1;
      return {
        ...state,
        config: cloneConfig(state.history[historyIndex]),
        historyIndex,
        result: null,
        processStatus: "idle",
        processError: null,
        draftSyncVersion: state.draftSyncVersion + 1,
        configSource: "manual",
      };
    }
    case "APPLY_CONFIG":
      return {
        ...appendHistory(state, action.config),
        draftSyncVersion: state.draftSyncVersion + 1,
        configSource: "ai",
        chat: appendChat(state.chat, { id: action.eventId, kind: "applied", steps: copySteps(action.steps) }),
      };
    case "PROCESS_STARTED":
      return action.generation !== state.generation
        ? state
        : {
            ...state, processStatus: "loading", processError: null, result: null,
            pendingProcessing: { steps: copySteps(action.steps), source: state.configSource },
          };
    case "PROCESS_SUCCEEDED":
      return action.generation !== state.generation
        ? state
        : {
            ...state,
            processStatus: "succeeded",
            processError: null,
            result: action.result,
            latestResult: state.pendingProcessing
              ? { result: action.result, ...state.pendingProcessing } : state.latestResult,
            chat: state.pendingProcessing
              ? appendChat(state.chat, {
                  id: action.result.result_id, kind: "processed",
                  result: action.result, ...state.pendingProcessing,
                }) : state.chat,
            pendingProcessing: null,
          };
    case "PROCESS_FAILED":
      return action.generation !== state.generation
        ? state
        : {
            ...state,
            processStatus: requestStatus(action.error),
            processError: action.error,
            result: null,
            pendingProcessing: null,
          };
    case "ADVISE_STARTED":
      return action.generation !== state.generation
        ? state
        : {
            ...state, adviseStatus: "loading", adviseError: null,
            pendingAdviceId: action.requestId,
            chat: appendChat(state.chat, {
              id: action.requestId, kind: "user", text: action.prompt, status: "loading", error: null,
            }),
          };
    case "ADVISE_SUCCEEDED":
      return action.generation !== state.generation
        ? state
        : {
            ...state,
            adviseStatus: "succeeded",
            adviseError: null,
            proposal: action.proposal,
            chat: appendChat(state.chat.map((entry) =>
              entry.kind === "user" && entry.id === state.pendingAdviceId
                ? { ...entry, status: "succeeded" as const } : entry), {
              id: `${state.pendingAdviceId}-reply`, kind: "assistant", proposal: action.proposal,
            }),
            pendingAdviceId: null,
          };
    case "ADVISE_FAILED":
      return action.generation !== state.generation
        ? state
        : {
            ...state,
            adviseStatus: requestStatus(action.error),
            adviseError: action.error,
            proposal: null,
            chat: state.chat.map((entry) =>
              entry.kind === "user" && entry.id === state.pendingAdviceId
                ? { ...entry, status: "error" as const, error: action.error.message } : entry),
            pendingAdviceId: null,
          };
  }
}
