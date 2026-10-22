import React from "react";
import type { SoundboardBoard, SoundboardPad } from "@obs-effect/shared-types";

interface SoundboardPadGridProps {
  board: SoundboardBoard;
  activePadId?: string | null;
  selectedPadId?: string | null;
  onPress: (pad: SoundboardPad) => void;
  onSelect?: (pad: SoundboardPad) => void;
}

export function SoundboardPadGrid({ board, activePadId, selectedPadId, onPress, onSelect }: SoundboardPadGridProps): React.ReactElement {
  return (
    <div className="soundboard-pad-grid" style={{ gridTemplateColumns: `repeat(${board.columns}, minmax(0, 1fr))` }}>
      {board.pads.map((pad) => (
        <button
          className={`soundboard-pad ${activePadId === pad.id ? "playing" : ""} ${selectedPadId === pad.id ? "selected" : ""}`}
          disabled={!pad.enabled}
          key={pad.id}
          onClick={() => onPress(pad)}
          onContextMenu={(event) => {
            if (!onSelect) return;
            event.preventDefault();
            onSelect(pad);
          }}
          style={{ "--pad-color": pad.color } as React.CSSProperties}
          type="button"
        >
          <span>{pad.label}</span>
          <small>
            {pad.visualAssetId ? "映像" : ""}
            {pad.visualAssetId && pad.audioAssetId ? " + " : ""}
            {pad.audioAssetId ? "音声" : ""}
            {!pad.visualAssetId && !pad.audioAssetId ? "未設定" : ""}
          </small>
        </button>
      ))}
    </div>
  );
}
