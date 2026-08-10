import type { EffectDefinition } from "@obs-effect/shared-types";

export const flashEffectDefinition: EffectDefinition = {
  id: "flash",
  kind: "flash",
  name: "Flash",
  description: "Flash the target overlay with a solid color.",
  version: "1.0.0",
  supportsImage: false,
  supportsVideo: false,
  supportsAudio: false,
  supportsText: false,
  defaultDurationMs: 650,
  defaultOverlayId: 1,
  parameterSchema: {
    fields: [
      { key: "color", label: "Color", type: "color", defaultValue: "#ffffff" },
      { key: "durationMs", label: "Duration", type: "number", defaultValue: 650, min: 100, max: 3000, step: 50 }
    ]
  }
};
