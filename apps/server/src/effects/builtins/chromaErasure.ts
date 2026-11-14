import type { EffectDefinition } from "@obs-effect/shared-types";

export const chromaErasureEffectDefinition: EffectDefinition = {
  id: "chroma-erasure",
  kind: "chroma-erasure",
  name: "Chroma Erasure",
  description: "Green scan lines can consume the screen over time with gift recovery, or advance only when gifts arrive.",
  version: "1.0.0",
  supportsImage: false,
  supportsVideo: false,
  supportsAudio: false,
  supportsText: false,
  defaultDurationMs: 180000,
  defaultOverlayId: 1,
  parameterSchema: {
    fields: [
      { key: "inverted", label: "Invert", type: "boolean", defaultValue: false },
      { key: "chromaColor", label: "Chroma key color", type: "color", defaultValue: "#00ff00" },
      { key: "countdownSeconds", label: "Time to complete (seconds)", type: "number", defaultValue: 180, min: 10, max: 3600, step: 5 },
      { key: "giftRecoverySeconds", label: "Gift recovery (seconds)", type: "number", defaultValue: 15, min: 1, max: 600, step: 1 },
      { key: "giftErasePercent", label: "Gift erasure per trigger (%)", type: "number", defaultValue: 10, min: 0.1, max: 100, step: 0.1 },
      { key: "lineThicknessPx", label: "Line thickness (px)", type: "number", defaultValue: 20, min: 2, max: 120, step: 1 },
      { key: "lineGapPx", label: "Initial line gap (px)", type: "number", defaultValue: 8, min: 0, max: 80, step: 1 },
      { key: "lineJitterPx", label: "Organic jitter (px)", type: "number", defaultValue: 9, min: 0, max: 40, step: 1 },
      { key: "finalFloodPercent", label: "Final sealing phase (%)", type: "number", defaultValue: 18, min: 5, max: 50, step: 1 },
      {
        key: "direction",
        label: "Line direction",
        type: "select",
        defaultValue: "alternating",
        options: [
          { value: "alternating", label: "Alternating left / right" },
          { value: "left-to-right", label: "Left to right" },
          { value: "right-to-left", label: "Right to left" }
        ]
      },
      { key: "recoveryPulseEnabled", label: "Gift recovery pulse", type: "boolean", defaultValue: true }
    ]
  }
};
