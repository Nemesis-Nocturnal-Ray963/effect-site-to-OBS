import React from "react";
import { useI18n } from "../i18n/I18nProvider";

export interface CoordinatePickerOverlay {
  overlayId: number;
  width?: number;
  height?: number;
}

interface CoordinatePickerProps {
  label: string;
  xPercent: number;
  yPercent: number;
  overlay?: CoordinatePickerOverlay;
  onChange: (point: { xPercent: number; yPercent: number }) => Promise<void> | void;
}

export function CoordinatePicker(props: CoordinatePickerProps): React.ReactElement {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const width = overlayWidth(props.overlay);
  const height = overlayHeight(props.overlay);

  return (
    <section className="coordinate-field">
      <div>
        <span>{props.label}</span>
        <strong>
          X {formatPixel(percentToPixel(props.xPercent, width))} / Y {formatPixel(percentToPixel(props.yPercent, height))}
        </strong>
        <small>
          {t("Overlay")} {props.overlay?.overlayId ?? "-"} / {width} x {height}
        </small>
      </div>
      <button type="button" onClick={() => setOpen(true)}>
        {t("Set coordinates")}
      </button>
      {open ? (
        <CoordinatePickerDialog
          {...props}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}

function CoordinatePickerDialog(props: CoordinatePickerProps & { onClose: () => void }): React.ReactElement {
  const { t } = useI18n();
  const frameRef = React.useRef<HTMLDivElement | null>(null);
  const width = overlayWidth(props.overlay);
  const height = overlayHeight(props.overlay);
  const aspectRatio = `${width} / ${height}`;
  const stageMaxWidth = `min(100%, ${roundOne((width / height) * 62)}vh)`;
  const [draft, setDraft] = React.useState({
    xPercent: clampPercent(props.xPercent),
    yPercent: clampPercent(props.yPercent)
  });
  const draftX = percentToPixel(draft.xPercent, width);
  const draftY = percentToPixel(draft.yPercent, height);

  React.useEffect(() => {
    setDraft({ xPercent: clampPercent(props.xPercent), yPercent: clampPercent(props.yPercent) });
  }, [props.xPercent, props.yPercent]);

  function setFromPointer(event: React.PointerEvent<HTMLDivElement>): void {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    const xPx = clampPixel(((event.clientX - rect.left) / rect.width) * width, width);
    const yPx = clampPixel(((event.clientY - rect.top) / rect.height) * height, height);
    const next = {
      xPercent: pixelToPercent(xPx, width),
      yPercent: pixelToPercent(yPx, height)
    };
    setDraft(next);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    setFromPointer(event);
  }

  return (
    <div className="coordinate-picker-backdrop" role="dialog" aria-modal="true" aria-label={props.label}>
      <section className="panel coordinate-picker-dialog">
        <div className="drawer-header">
          <div>
            <p className="eyebrow">{t("Coordinates")}</p>
            <h3>{props.label}</h3>
            <p className="empty-text">
              {t("Overlay")} {props.overlay?.overlayId ?? "-"} / {width} x {height}
            </p>
          </div>
          <button type="button" onClick={props.onClose}>
            {t("Close")}
          </button>
        </div>

        <div
          ref={frameRef}
          className="coordinate-picker-stage"
          style={{ aspectRatio, maxWidth: stageMaxWidth }}
          onPointerDown={handlePointerDown}
          onPointerMove={(event) => {
            if (event.buttons === 1) setFromPointer(event);
          }}
        >
          <div className="coordinate-picker-grid" />
          <div
            className="coordinate-picker-target"
            style={{ left: `${draft.xPercent}%`, top: `${draft.yPercent}%` }}
          />
        </div>

        <div className="coordinate-picker-form">
          <label>
            {t("Target X px")}
            <input
              type="number"
              min="0"
              max={width}
              step="1"
              value={Math.round(draftX)}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  xPercent: pixelToPercent(clampPixel(Number(event.target.value), width), width)
                }))
              }
            />
          </label>
          <label>
            {t("Target Y px")}
            <input
              type="number"
              min="0"
              max={height}
              step="1"
              value={Math.round(draftY)}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  yPercent: pixelToPercent(clampPixel(Number(event.target.value), height), height)
                }))
              }
            />
          </label>
          <button
            type="button"
            onClick={() => {
              void props.onChange(draft);
              props.onClose();
            }}
          >
            {t("Apply")}
          </button>
        </div>
      </section>
    </div>
  );
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function clampPixel(value: number, max: number): number {
  return Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));
}

function overlayWidth(overlay: CoordinatePickerOverlay | undefined): number {
  return validDimension(overlay?.width, 1920);
}

function overlayHeight(overlay: CoordinatePickerOverlay | undefined): number {
  return validDimension(overlay?.height, 1080);
}

function validDimension(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function percentToPixel(percent: number, size: number): number {
  return clampPixel((clampPercent(percent) / 100) * size, size);
}

function pixelToPercent(pixel: number, size: number): number {
  return clampPercent((clampPixel(pixel, size) / size) * 100);
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatPixel(value: number): string {
  return `${Math.round(value)} px`;
}
