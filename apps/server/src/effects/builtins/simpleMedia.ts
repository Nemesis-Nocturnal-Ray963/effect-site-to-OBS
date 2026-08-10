import type { EffectDefinition } from "@obs-effect/shared-types";

export const simpleMediaEffectDefinition: EffectDefinition = {
  id: "simple-media",
  kind: "simple-media",
  name: "Simple Media Effect",
  description: "Combine image, video, audio, text, and background layers without adding source code.",
  version: "1.0.0",
  supportsImage: true,
  supportsVideo: true,
  supportsAudio: true,
  supportsText: true,
  defaultDurationMs: 3000,
  defaultOverlayId: 1,
  parameterSchema: {
    fields: [
      { key: "imageEnabled", label: "Image enabled", type: "boolean", defaultValue: true },
      {
        key: "imageFit",
        label: "Image fit",
        type: "select",
        defaultValue: "contain",
        options: [
          { value: "contain", label: "Contain" },
          { value: "cover", label: "Cover" },
          { value: "fill", label: "Fill" },
          { value: "none", label: "None" }
        ]
      },
      { key: "imageOpacity", label: "Image opacity", type: "number", defaultValue: 1, min: 0, max: 1, step: 0.05 },
      { key: "videoEnabled", label: "Video enabled", type: "boolean", defaultValue: false },
      { key: "videoLoop", label: "Video loop", type: "boolean", defaultValue: false },
      { key: "videoVolume", label: "Video volume", type: "number", defaultValue: 0.8, min: 0, max: 1, step: 0.05 },
      { key: "videoMuted", label: "Video muted", type: "boolean", defaultValue: false },
      { key: "audioEnabled", label: "Audio enabled", type: "boolean", defaultValue: false },
      { key: "audioVolume", label: "Audio volume", type: "number", defaultValue: 0.8, min: 0, max: 1, step: 0.05 },
      { key: "audioStartDelayMs", label: "Audio delay", type: "number", defaultValue: 0, min: 0, max: 60000, step: 50 },
      { key: "textEnabled", label: "Text enabled", type: "boolean", defaultValue: false },
      { key: "fixedText", label: "Text", type: "string", defaultValue: "New Effect" },
      { key: "fontFamily", label: "Font family", type: "string", defaultValue: "system-ui, sans-serif" },
      { key: "fontSize", label: "Font size", type: "number", defaultValue: 48, min: 8, max: 240, step: 1 },
      { key: "fontWeight", label: "Font weight", type: "number", defaultValue: 800, min: 100, max: 900, step: 100 },
      { key: "textColor", label: "Text color", type: "color", defaultValue: "#ffffff" },
      { key: "backgroundEnabled", label: "Background enabled", type: "boolean", defaultValue: false },
      { key: "backgroundColor", label: "Background color", type: "color", defaultValue: "#000000" },
      { key: "backgroundOpacity", label: "Background opacity", type: "number", defaultValue: 0.4, min: 0, max: 1, step: 0.05 },
      { key: "backgroundBorderRadius", label: "Background radius", type: "number", defaultValue: 18, min: 0, max: 240, step: 1 },
      { key: "backgroundPadding", label: "Background padding", type: "number", defaultValue: 24, min: 0, max: 240, step: 1 },
      {
        key: "enterTransition",
        label: "Enter",
        type: "select",
        defaultValue: "fade",
        options: transitionOptions()
      },
      { key: "enterDurationMs", label: "Enter duration", type: "number", defaultValue: 250, min: 0, max: 10000, step: 50 },
      {
        key: "exitTransition",
        label: "Exit",
        type: "select",
        defaultValue: "fade",
        options: transitionOptions()
      },
      { key: "exitDurationMs", label: "Exit duration", type: "number", defaultValue: 250, min: 0, max: 10000, step: 50 }
    ]
  }
};

function transitionOptions(): Array<{ value: string; label: string }> {
  return [
    { value: "none", label: "None" },
    { value: "fade", label: "Fade" },
    { value: "scale", label: "Scale" },
    { value: "slide-up", label: "Slide up" },
    { value: "slide-down", label: "Slide down" },
    { value: "slide-left", label: "Slide left" },
    { value: "slide-right", label: "Slide right" }
  ];
}
