import { describe, expect, it } from "vitest";
import type { AlgorithmDescriptor, ImageAsset } from "@/types/api";
import { editorReducer, initialEditorState } from "./editor-state";
import { ApiError } from "@/services/api-client";

const catalog: AlgorithmDescriptor[] = [
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
];

const asset: ImageAsset = {
  image_id: "image-one",
  filename: "photo.jpg",
  content_type: "image/jpeg",
  size_bytes: 100,
  width: 80,
  height: 60,
  url: "/api/images/image-one",
};

describe("editorReducer", () => {
  it("retains immutable manual result snapshots after edits, undo, reset and failed processing", () => {
    let state = editorReducer(initialEditorState, { type: "API_READY", catalog });
    const steps = [{ algorithm: "adjust_gamma", params: { gamma: 1.2 } }];
    state = editorReducer(state, { type: "PROCESS_STARTED", generation: 0, steps });
    steps[0].params.gamma = 2;
    const result = {
      ...asset, image_id: asset.image_id, result_id: "result-one", url: "/api/results/result-one",
    };
    state = editorReducer(state, { type: "PROCESS_SUCCEEDED", generation: 0, result });
    state = editorReducer(state, { type: "SET_PARAM", algorithmId: "adjust_gamma", key: "gamma", value: 1.5 });
    expect(state.result).toBeNull();
    expect(state.latestResult?.steps[0].params.gamma).toBe(1.2);
    expect(state.chat.at(-1)).toMatchObject({ kind: "processed", source: "manual" });
    state = editorReducer(state, { type: "UNDO_CONFIG" });
    state = editorReducer(state, { type: "RESET_CONFIG" });
    state = editorReducer(state, { type: "PROCESS_STARTED", generation: 0, steps });
    state = editorReducer(state, { type: "PROCESS_FAILED", generation: 0,
      error: new ApiError("failed", { status: 500, code: "INTERNAL_ERROR" }) });
    expect(state.latestResult?.result.result_id).toBe("result-one");
    expect(state.chat).toHaveLength(1);
    state = editorReducer(state, { type: "FILE_SELECTED", file: new File(["new"], "new.png"),
      previewUrl: "blob:new", width: 1, height: 1, generation: 1 });
    state = editorReducer(state, { type: "PROCESS_SUCCEEDED", generation: 0, result });
    expect(state.latestResult).toBeNull();
    expect(state.chat).toEqual([]);
  });

  it("retains earlier proposals and records error only on the failed turn", () => {
    let state = editorReducer(initialEditorState, {
      type: "ADVISE_STARTED", generation: 0, requestId: "one", prompt: "First",
    });
    const proposal = { analysis: "First reply", steps: [] };
    state = editorReducer(state, { type: "ADVISE_SUCCEEDED", generation: 0, proposal });
    state = editorReducer(state, { type: "ADVISE_STARTED", generation: 0, requestId: "two", prompt: "Second" });
    state = editorReducer(state, { type: "ADVISE_FAILED", generation: 0,
      error: new ApiError("offline", { status: null, code: "NETWORK_ERROR" }) });
    expect(state.chat[0]).toMatchObject({ status: "succeeded" });
    expect(state.chat[1]).toMatchObject({ kind: "assistant", proposal });
    expect(state.chat[2]).toMatchObject({ kind: "user", status: "error", error: "offline" });
  });

  it("records config changes, undoes them, and resets to catalog defaults", () => {
    let state = editorReducer(initialEditorState, { type: "API_READY", catalog });
    state = editorReducer(state, {
      type: "SET_PARAM",
      algorithmId: "adjust_gamma",
      key: "gamma",
      value: 1.5,
    });
    expect(state.config.params.adjust_gamma.gamma).toBe(1.5);
    expect(state.history).toHaveLength(2);

    state = editorReducer(state, { type: "UNDO_CONFIG" });
    expect(state.config.params.adjust_gamma.gamma).toBe(1);

    state = editorReducer(state, {
      type: "SET_ENABLED",
      toolId: "brightness",
      enabled: true,
    });
    state = editorReducer(state, { type: "RESET_CONFIG" });
    expect(state.config.enabled.brightness).toBe(false);
    expect(state.config.params.adjust_gamma.gamma).toBe(1);
    expect(state.historyIndex).toBe(2);
  });

  it("clears image-owned state on replacement and ignores late responses from an old generation", () => {
    let state = editorReducer(initialEditorState, { type: "API_READY", catalog });
    const oldFile = new File(["old"], "old.jpg", { type: "image/jpeg" });
    const newFile = new File(["new"], "new.png", { type: "image/png" });
    state = editorReducer(state, {
      type: "FILE_SELECTED",
      file: oldFile,
      previewUrl: "blob:old",
      width: 30,
      height: 20,
      generation: 1,
    });
    state = editorReducer(state, { type: "UPLOAD_SUCCEEDED", generation: 1, asset });
    state = editorReducer(state, {
      type: "SET_ENABLED",
      toolId: "brightness",
      enabled: true,
    });

    state = editorReducer(state, {
      type: "FILE_SELECTED",
      file: newFile,
      previewUrl: "blob:new",
      width: 50,
      height: 40,
      generation: 2,
    });
    state = editorReducer(state, { type: "UPLOAD_SUCCEEDED", generation: 1, asset });

    expect(state.file).toBe(newFile);
    expect(state.previewUrl).toBe("blob:new");
    expect(state.uploaded).toBeNull();
    expect(state.uploadStatus).toBe("uploading");
    expect(state.config.enabled.brightness).toBe(false);
    expect(state.result).toBeNull();
    expect(state.proposal).toBeNull();
  });

  it("caps undo history at fifty snapshots", () => {
    let state = editorReducer(initialEditorState, { type: "API_READY", catalog });
    for (let index = 0; index < 60; index += 1) {
      state = editorReducer(state, {
        type: "SET_PARAM",
        algorithmId: "adjust_gamma",
        key: "gamma",
        value: 0.1 + (index % 29) * 0.1,
      });
    }
    expect(state.history.length).toBeLessThanOrEqual(50);
  });
});
