import React from "react";
import type { AssetCatalogItem } from "@obs-effect/shared-types";
import { useI18n } from "../i18n/I18nProvider";

export function MediaAssetPoolEditor(props: {
  assets: AssetCatalogItem[];
  selectedIds: string[];
  onChange: (ids: string[]) => Promise<void>;
  title?: string;
}): React.ReactElement {
  const { t } = useI18n();
  const candidates = props.assets.filter((asset) => asset.kind === "image" || asset.kind === "video");
  const selected = props.selectedIds.map((id) => ({ id, asset: props.assets.find((item) => item.id === id) }));
  const [pendingId, setPendingId] = React.useState("");
  const remaining = candidates.filter((asset) => !props.selectedIds.includes(asset.id));

  return (
    <section className="media-pool-editor">
      <div className="media-pool-header">
        <div>
          <strong>{props.title ?? t("Random media list")}</strong>
          <small>{selected.length} {t("items / shuffled without repetition")}</small>
        </div>
        <div className="media-pool-add">
          <select value={pendingId} onChange={(event) => setPendingId(event.target.value)}>
            <option value="">{t("Choose image or video")}</option>
            {remaining.map((asset) => (
              <option key={asset.id} value={asset.id}>{asset.name} ({asset.kind})</option>
            ))}
          </select>
          <button
            type="button"
            disabled={!pendingId}
            onClick={() => {
              if (!pendingId) return;
              void props.onChange([...props.selectedIds, pendingId]);
              setPendingId("");
            }}
          >{t("Add")}</button>
        </div>
      </div>
      {selected.length === 0 ? <p className="empty-text">{t("Add at least one image or video.")}</p> : (
        <div className="media-pool-list">
          {selected.map(({ id, asset }, index) => (
            <article key={id} className="media-pool-row">
              <span className="media-pool-preview">
                {asset?.kind === "image" ? <img src={asset.contentUrl} alt="" loading="lazy" /> : <span>{asset?.kind === "video" ? "VIDEO" : "MISSING"}</span>}
              </span>
              <span className="media-pool-name"><strong>{asset?.name ?? id}</strong><small>{asset?.kind ?? t("Missing asset")}</small></span>
              <div className="media-pool-actions">
                <button type="button" disabled={index === 0} onClick={() => void props.onChange(move(props.selectedIds, index, index - 1))}>↑</button>
                <button type="button" disabled={index === selected.length - 1} onClick={() => void props.onChange(move(props.selectedIds, index, index + 1))}>↓</button>
                <button type="button" onClick={() => void props.onChange(props.selectedIds.filter((selectedId) => selectedId !== id))}>{t("Remove")}</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function move<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}
