import React from "react";
import type { EffectPlayMessage } from "@obs-effect/shared-types";
import fallbackGiftUrl from "./assets/gift-present.svg";
import { TetheredGiftEngine } from "./tetheredGiftEngine";

export interface TetheredGiftHandle {
  receive(message: EffectPlayMessage): void;
  clear(): void;
}

export const TetheredGiftLayer = React.forwardRef<TetheredGiftHandle>(function TetheredGiftLayer(_props, ref) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const engine = React.useRef(new TetheredGiftEngine());
  const images = React.useRef(new Map<string, HTMLImageElement>());
  const seen = React.useRef(new Set<string>());

  React.useImperativeHandle(ref, () => ({
    clear: () => engine.current.clear(),
    receive: (message) => {
      if (seen.current.has(message.instanceId)) return;
      seen.current.add(message.instanceId);
      if (seen.current.size > 4096) seen.current.delete(seen.current.values().next().value!);
      const parameters = message.parameters ?? {};
      engine.current.add(
        number(parameters.quantity, 1),
        message.media?.imageUrl || fallbackGiftUrl,
        number(parameters.objectSizePx, 88),
        number(parameters.ropeLengthPx, 420),
        message.playback?.durationMs ?? 8000,
        message.visual?.opacity ?? 1
      );
      if (canvasRef.current) canvasRef.current.style.zIndex = String(message.visual?.zIndex ?? 10);
    }
  }), []);

  React.useEffect(() => {
    const canvas = canvasRef.current!;
    const context = canvas.getContext("2d");
    if (!context) return;
    let frame = 0;
    let last = performance.now();

    function getImage(url: string): HTMLImageElement {
      let image = images.current.get(url);
      if (!image) {
        image = new Image();
        image.onerror = () => {
          if (image!.src !== new URL(fallbackGiftUrl, location.href).href) image!.src = fallbackGiftUrl;
        };
        image.src = url;
        images.current.set(url, image);
      }
      return image;
    }

    function tick(time: number): void {
      const width = window.innerWidth;
      const height = window.innerHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      engine.current.step((time - last) / 1000, width, height, Date.now());
      last = time;
      context.clearRect(0, 0, width, height);

      context.lineWidth = 2;
      context.strokeStyle = "rgba(235, 238, 226, 0.82)";
      for (const body of engine.current.bodies) {
        context.beginPath();
        context.moveTo(body.anchorX, -2);
        context.lineTo(body.x, body.y - body.radius * 0.72);
        context.stroke();
      }
      for (const body of engine.current.bodies) {
        const loaded = getImage(body.imageUrl);
        const image = loaded.complete && loaded.naturalWidth ? loaded : getImage(fallbackGiftUrl);
        if (!image.complete || !image.naturalWidth) continue;
        const scale = Math.min((body.radius * 2) / image.naturalWidth, (body.radius * 2) / image.naturalHeight);
        context.save();
        context.globalAlpha = body.opacity;
        context.translate(body.x, body.y);
        context.rotate(body.angle);
        context.drawImage(
          image,
          (-image.naturalWidth * scale) / 2,
          (-image.naturalHeight * scale) / 2,
          image.naturalWidth * scale,
          image.naturalHeight * scale
        );
        context.restore();
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
