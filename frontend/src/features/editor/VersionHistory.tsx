"use client";

import type { EditorState } from "./editor-state";
import { VersionGallery } from "./VersionGallery";
import { useEffect, useId, useRef, useState } from "react";
import { History, X } from "lucide-react";

export function VersionHistory({ state, onSelect }: {
  state: EditorState;
  onSelect: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [panelTop, setPanelTop] = useState(66);
  const containerRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function select(id: string | null) {
    onSelect(id);
    setOpen(false);
    toggleRef.current?.focus();
  }

  return <div className="version-history-control" ref={containerRef}>
    <button type="button" className={`secondary-button version-history-toggle${open ? " is-selected" : ""}`}
      ref={toggleRef} aria-expanded={open} aria-controls={panelId} disabled={!state.previewUrl}
      onClick={() => {
        const panel = containerRef.current?.closest(".canvas-panel");
        const button = toggleRef.current;
        if (panel && button) {
          setPanelTop(button.getBoundingClientRect().bottom - panel.getBoundingClientRect().top + panel.scrollTop + 8);
        }
        setOpen(!open);
      }}>
      <History size={14} /> Phiên bản{state.versions.length > 0 && <span className="version-count">{state.versions.length}</span>}
    </button>
    {open && <section id={panelId} className="version-history" aria-label="Các phiên bản" style={{ top: panelTop }}>
    <div className="version-history-heading">
      <strong>Các phiên bản</strong>
      <button type="button" className="icon-button" aria-label="Đóng danh sách phiên bản" ref={closeRef}
        onClick={() => { setOpen(false); toggleRef.current?.focus(); }}><X size={14} /></button>
    </div>
    <p className="version-history-hint">Chọn để xem ảnh và nạp cấu hình · Chỉ lưu trong phiên này</p>
    <VersionGallery state={state} selectedId={state.activeVersionId} onSelect={select}
      editing disabled={state.processStatus === "loading"} />
    </section>}
  </div>;
}
