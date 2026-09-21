import React from "react";
import type { EffectPlayMessage } from "@obs-effect/shared-types";
import { alphaCollisionProfile, GiftPileEngine, GIFT_FADE_MS } from "./giftPileEngine";
import fallbackGiftUrl from "./assets/gift-present.svg";

export interface GiftPileHandle {
  receive(message: EffectPlayMessage): void;
  clear(): void;
}

export const GiftPileLayer = React.forwardRef<GiftPileHandle>(function GiftPileLayer(_props, ref) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const engine = React.useRef(new GiftPileEngine());
  const images = React.useRef(new Map<string, HTMLImageElement>());
  const measuredImages = React.useRef(new Set<string>());
  const seen = React.useRef(new Set<string>());

  React.useImperativeHandle(
    ref,
    () => ({
      clear: () => engine.current.clear(),
      receive: (message) => {
        if (seen.current.has(message.instanceId)) return;
        seen.current.add(message.instanceId);
        if (seen.current.size > 4096) seen.current.delete(seen.current.values().next().value!);
        if (message.parameters?.action === "clear") {
          engine.current.clear();
          return;
        }
        const params = message.parameters ?? {};
        engine.current.add(
          number(params.quantity, 1),
          message.media?.imageUrl || fallbackGiftUrl,
          number(params.objectSizePx, 44),
          number(params.maxObjects, 1000),
          Date.now(),
          message.visual?.opacity ?? 1
        );
        if (canvasRef.current)
          canvasRef.current.style.zIndex = String(message.visual?.zIndex ?? 10);
      }
    }),
    []
  );

  React.useEffect(() => {
    const canvas = canvasRef.current!;
    const context = canvas.getContext("2d");
    if (!context) return;
    let frame = 0,
      last = performance.now();
    function getImage(url: string): HTMLImageElement {
      let image = images.current.get(url);
      if (!image) {
        image = new Image();
        image.onload = () => {
          if (measuredImages.current.has(url)) return;
          measuredImages.current.add(url);
          try {
            const sampleSize = 128;
            const scale = Math.min(1, sampleSize / Math.max(image!.naturalWidth, image!.naturalHeight));
            const width = Math.max(1, Math.round(image!.naturalWidth * scale));
            const height = Math.max(1, Math.round(image!.naturalHeight * scale));
            const sample = document.createElement("canvas");
            sample.width = width;
            sample.height = height;
            const sampleContext = sample.getContext("2d", { willReadFrequently: true });
            if (!sampleContext) return;
            sampleContext.drawImage(image!, 0, 0, width, height);
            engine.current.setImageCollisionProfile(
              url,
              alphaCollisionProfile(sampleContext.getImageData(0, 0, width, height).data, width, height)
            );
          } catch {
            // Some external image hosts disallow pixel reads. Keep the safe circular fallback.
          }
        };
        image.onerror = () => {
          if (image!.src !== new URL(fallbackGiftUrl, location.href).href)
            image!.src = fallbackGiftUrl;
        };
        image.src = url;
        images.current.set(url, image);
        if (images.current.size > 2048) images.current.delete(images.current.keys().next().value!);
      }
      return image;
    }
    getImage(fallbackGiftUrl);
    function tick(time: number): void {
      const width = window.innerWidth,
        height = window.innerHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const now = Date.now();
      engine.current.step((time - last) / 1000, width, height, now);
      last = time;
      context!.clearRect(0, 0, width, height);
      for (const body of engine.current.bodies) {
        const loaded = getImage(body.imageUrl);
        const image = loaded.complete && loaded.naturalWidth ? loaded : getImage(fallbackGiftUrl);
        if (!image.complete || !image.naturalWidth) continue;
        const scale = Math.min(
          (body.radius * 2) / image.naturalWidth,
          (body.radius * 2) / image.naturalHeight
        );
        context!.save();
        context!.globalAlpha =
          body.opacity *
          Math.max(0, Math.min(1, (body.expiresAt + GIFT_FADE_MS - now) / GIFT_FADE_MS));
        context!.translate(body.x, body.y);
        context!.rotate(body.angle);
        context!.drawImage(
          image,
          (-image.naturalWidth * scale) / 2,
          (-image.naturalHeight * scale) / 2,
          image.naturalWidth * scale,
          image.naturalHeight * scale
        );
        context!.restore();
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <canvas ref={canvasRef} className="gift-pile-canvas" aria-hidden="true" />;
});

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
