import type { EffectDefinition } from "@obs-effect/shared-types";

export const ballRevealEffectDefinition: EffectDefinition = {
  id: "ball-reveal",
  kind: "ball-reveal",
  name: "Ball Reveal",
  description: "Throw a ball from the left, reveal a shuffled image or video, and queue consecutive gifts.",
  version: "1.0.0",
  supportsImage: true,
  supportsVideo: true,
  supportsAudio: false,
  supportsText: true,
  defaultDurationMs: 6000,
  defaultOverlayId: 1,
  parameterSchema: {
    fields: [
      { key: "ballAssetId", label: "Ball asset", type: "string", defaultValue: "" },
      { key: "mediaAssetIdsCsv", label: "Reveal media", type: "string", defaultValue: "" },
      { key: "targetXPercent", label: "Target X %", type: "number", defaultValue: 50, min: 0, max: 100, step: 1 },
      { key: "targetYPercent", label: "Target Y %", type: "number", defaultValue: 50, min: 0, max: 100, step: 1 },
      { key: "startYPercent", label: "Start Y %", type: "number", defaultValue: 72, min: -50, max: 150, step: 1 },
      { key: "travelDurationMs", label: "Travel duration ms", type: "number", defaultValue: 900, min: 100, max: 10000, step: 50 },
      { key: "arcHeightPercent", label: "Arc height %", type: "number", defaultValue: 38, min: 0, max: 150, step: 1 },
      { key: "ballSizePx", label: "Ball size px", type: "number", defaultValue: 180, min: 16, max: 1000, step: 1 },
      { key: "ballRotationDeg", label: "Ball rotation deg", type: "number", defaultValue: 900, min: -3600, max: 3600, step: 15 },
      { key: "ballFadeDurationMs", label: "Ball fade duration ms", type: "number", defaultValue: 450, min: 0, max: 5000, step: 50 },
      { key: "glowColor", label: "Glow color", type: "color", defaultValue: "#fff7b0" },
      { key: "glowDurationMs", label: "Glow duration ms", type: "number", defaultValue: 650, min: 50, max: 5000, step: 50 },
      { key: "glowSizePx", label: "Glow size px", type: "number", defaultValue: 360, min: 20, max: 1600, step: 10 },
      { key: "sparkleCount", label: "Sparkle count", type: "number", defaultValue: 18, min: 0, max: 80, step: 1 },
      { key: "revealDurationMs", label: "Reveal scale duration ms", type: "number", defaultValue: 520, min: 50, max: 5000, step: 50 },
      { key: "mediaWidthPx", label: "Media max width px", type: "number", defaultValue: 760, min: 32, max: 3840, step: 10 },
      { key: "mediaHeightPx", label: "Media max height px", type: "number", defaultValue: 760, min: 32, max: 3840, step: 10 },
      {
        key: "mediaFit",
        label: "Media fit",
        type: "select",
        defaultValue: "contain",
        options: [
          { value: "contain", label: "Contain" },
          { value: "cover", label: "Cover" },
          { value: "fill", label: "Fill" }
        ]
      },
      { key: "imageDisplayDurationMs", label: "Image display duration ms", type: "number", defaultValue: 4000, min: 250, max: 600000, step: 100 },
      { key: "imageFadeStartMs", label: "Image fade start ms", type: "number", defaultValue: 3000, min: 0, max: 600000, step: 100 },
      { key: "videoFadeLeadMs", label: "Video fade lead ms", type: "number", defaultValue: 1000, min: 0, max: 30000, step: 100 },
      { key: "videoVolume", label: "Video volume", type: "number", defaultValue: 1, min: 0, max: 1, step: 0.05 },
      { key: "videoPlaybackRate", label: "Video playback rate", type: "number", defaultValue: 1, min: 0.25, max: 4, step: 0.05 },
      { key: "senderNameEnabled", label: "Show sender name", type: "boolean", defaultValue: true },
      { key: "senderNameFontSizePx", label: "Sender name size px", type: "number", defaultValue: 42, min: 10, max: 160, step: 1 },
      { key: "senderNameColor", label: "Sender name color", type: "color", defaultValue: "#ffffff" },
      { key: "queueLimit", label: "Queue limit", type: "number", defaultValue: 20, min: 1, max: 200, step: 1 }
    ]
  }
};
