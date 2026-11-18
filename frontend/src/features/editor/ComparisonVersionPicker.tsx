"use client";

import { Images, X } from "lucide-react";
import { useId, useRef } from "react";
import { versionLabel, type EditorState } from "./editor-state";
import { VersionGallery } from "./VersionGallery";

export function ComparisonVersionPicker({ state, side, onSelect }: {
  state: EditorState;
  side: "left" | "right";
  onSelect: (id: string | null) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const dialogId = useId();
  const sideLabel = side === "left" ? "bên trái" : "bên phải";
  const selectedId = side === "left" ? state.compareLeftId : state.compareRightId;

  return <>
    <button type="button" className="secondary-button comparison-picker-button"
      aria-label={`Ảnh ${sideLabel}`} aria-haspopup="dialog" aria-controls={dialogId}
      onClick={() => dialogRef.current?.showModal()}>
      <Images size={14} />
      <span>{side === "left" ? "Trái" : "Phải"}: {versionLabel(state, selectedId)}</span>
    </button>
    <dialog ref={dialogRef} id={dialogId} className="version-picker-dialog" aria-labelledby={titleId}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
      }}>
      <div className="version-history-heading">
        <h2 id={titleId}>Chọn ảnh {sideLabel}</h2>
        <button type="button" className="icon-button" aria-label="Đóng cửa sổ chọn ảnh"
          onClick={() => dialogRef.current?.close()}><X size={16} /></button>
      </div>
      <p className="version-history-hint">Chọn phiên bản để đối chiếu. Không thay đổi cấu hình đang chỉnh hoặc ngữ cảnh AI.</p>
      <VersionGallery state={state} selectedId={selectedId} onSelect={(id) => {
        onSelect(id);
        dialogRef.current?.close();
      }} />
    </dialog>
  </>;
}
