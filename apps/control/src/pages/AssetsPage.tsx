import React from "react";
import type { AssetCatalogItem, AssetKind } from "@obs-effect/shared-types";
import { useI18n } from "../i18n/I18nProvider";
import { deleteAsset, fetchAssets, renameAsset, uploadAsset } from "../services/httpApi";

const kindLabels: Record<AssetKind, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  font: "Font"
};

type AssetFilterMode = "all" | "image" | "video" | "audio" | "font" | "other" | "detail";
type AssetSortKey = "alphabetical" | "japanese" | "createdAt" | "size";
type SortDirection = "asc" | "desc";
type AssetViewMode = "tile" | "list";

export function AssetsPage(): React.ReactElement {
  const { t } = useI18n();
  const [assets, setAssets] = React.useState<AssetCatalogItem[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = React.useState<File[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState({ done: 0, total: 0 });
  const [assetBusy, setAssetBusy] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [audioVolume, setAudioVolume] = React.useState(0.5);
  const [audioPlaying, setAudioPlaying] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [filterMode, setFilterMode] = React.useState<AssetFilterMode>("all");
  const [extensionFilter, setExtensionFilter] = React.useState("all");
  const [sortKey, setSortKey] = React.useState<AssetSortKey>("createdAt");
  const [sortDirection, setSortDirection] = React.useState<SortDirection>("desc");
  const [viewMode, setViewMode] = React.useState<AssetViewMode>("tile");
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const selected = assets.find((asset) => asset.id === selectedId) ?? assets[0] ?? null;
  const selectedIsEditable = selected?.source === "local-copy";
  const availableExtensions = React.useMemo(() => {
    return [...new Set(assets.map((asset) => assetExtension(asset)).filter(Boolean))].sort((left, right) => left.localeCompare(right, "en"));
  }, [assets]);
  const visibleAssets = React.useMemo(() => {
    return assets
      .filter((asset) => assetMatchesSearch(asset, searchQuery))
      .filter((asset) => assetMatchesFilter(asset, filterMode, extensionFilter))
      .sort((left, right) => compareAssets(left, right, sortKey, sortDirection));
  }, [assets, extensionFilter, filterMode, searchQuery, sortDirection, sortKey]);

  React.useEffect(() => {
    void fetchAssets()
      .then((items) => {
        setAssets(items);
        setSelectedId(items[0]?.id ?? null);
        setMessage("");
      })
      .catch(() => setMessage(t("Could not load assets")));
  }, [t]);

  React.useEffect(() => {
    setNameDraft(selected?.name ?? "");
  }, [selected?.id, selected?.name]);

  React.useEffect(() => {
    if (audioRef.current) audioRef.current.volume = audioVolume;
  }, [audioVolume]);

  React.useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setAudioPlaying(false);
  }, [selected?.id]);

  async function handleUpload(): Promise<void> {
    if (selectedFiles.length === 0) {
      setMessage(t("Please choose a file."));
      return;
    }

    setUploading(true);
    setMessage("");
    const filesToUpload = selectedFiles;
    setUploadProgress({ done: 0, total: filesToUpload.length });
    const uploadedAssets: AssetCatalogItem[] = [];
    const failedFiles: string[] = [];
    let firstErrorMessage = "";
    try {
      for (const file of filesToUpload) {
        try {
          const asset = await uploadAsset(file);
          uploadedAssets.push(asset);
        } catch (error) {
          failedFiles.push(file.name);
          if (!firstErrorMessage) firstErrorMessage = error instanceof Error ? error.message : t("Upload failed");
        } finally {
          setUploadProgress((current) => ({ ...current, done: current.done + 1 }));
        }
      }

      if (uploadedAssets.length > 0) {
        setAssets((current) => [...uploadedAssets, ...current]);
        setSelectedId(uploadedAssets[0]?.id ?? null);
      }
      setSelectedFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";

      if (failedFiles.length > 0 && uploadedAssets.length > 0) {
        setMessage(`${t("Uploaded")} ${uploadedAssets.length} / ${filesToUpload.length}. ${t("Some files failed to upload.")}`);
      } else if (failedFiles.length > 0) {
        setMessage(firstErrorMessage || t("Upload failed"));
      } else {
        setMessage(`${t("Uploaded")} ${uploadedAssets.length} ${t("files")}`);
      }
    } finally {
      setUploading(false);
      setUploadProgress({ done: 0, total: 0 });
    }
  }

  async function handleRename(): Promise<void> {
    if (!selected || !selectedIsEditable) return;
    const nextName = nameDraft.trim();
    if (!nextName) {
      setMessage(t("Please enter an asset name."));
      return;
    }

    setAssetBusy(true);
    setMessage("");
    try {
      const asset = await renameAsset(selected.id, nextName);
      setAssets((current) => current.map((item) => (item.id === asset.id ? asset : item)));
      setSelectedId(asset.id);
      setMessage(t("Asset renamed"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("Rename failed"));
    } finally {
      setAssetBusy(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!selected || !selectedIsEditable) return;
    if (!window.confirm(t("Delete this asset?"))) return;

    setAssetBusy(true);
    setMessage("");
    try {
      await deleteAsset(selected.id);
      const nextAssets = assets.filter((asset) => asset.id !== selected.id);
      setAssets(nextAssets);
      setSelectedId(nextAssets[0]?.id ?? null);
      setMessage(t("Asset deleted"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("Delete failed"));
    } finally {
      setAssetBusy(false);
    }
  }

  async function handleAudioPlayback(): Promise<void> {
    if (!selected || selected.kind !== "audio") return;
    const audio = audioRef.current;
    if (!audio) return;

    if (audioPlaying) {
      audio.pause();
      setAudioPlaying(false);
      return;
    }

    audio.volume = audioVolume;
    try {
      await audio.play();
      setAudioPlaying(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("Audio playback failed"));
    }
  }

  return (
    <section className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">{t("Assets")}</p>
        <h2>{t("Asset Library")}</h2>
      </div>

      <div className="action-panel asset-upload-panel">
        <div>
          <h3>{t("Local copied assets")}</h3>
          <p className="empty-text">{t("Manage images, videos, audio, and fonts as local assets.")}</p>
        </div>
        <div className="asset-upload-controls">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,audio/*,font/*,.otf,.ttc,.ttf,.woff,.woff2"
            multiple
            disabled={uploading}
            onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))}
          />
          <button type="button" onClick={() => void handleUpload()} disabled={uploading || selectedFiles.length === 0}>
            {uploading && uploadProgress.total > 0 ? `${t("Uploading")} ${uploadProgress.done}/${uploadProgress.total}` : t("Upload")}
          </button>
        </div>
      </div>

      <div className="table-meta">
        <span>
          {visibleAssets.length} / {assets.length} {t("assets")}
        </span>
        <span>{selectedFiles.length > 0 ? selectedFilesLabel(selectedFiles, t) : message}</span>
      </div>

      <section className="asset-layout">
        <div className="asset-browser">
          <div className="asset-toolbar">
            <label className="asset-search">
              {t("Search assets")}
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t("Search by name or filename")} />
            </label>
            <label>
              {t("Filter")}
              <select
                value={filterMode}
                onChange={(event) => {
                  setFilterMode(event.target.value as AssetFilterMode);
                  setExtensionFilter("all");
                }}
              >
                <option value="all">{t("All")}</option>
                <option value="image">{t("Image")}</option>
                <option value="video">{t("Video")}</option>
                <option value="audio">{t("Audio")}</option>
                <option value="font">{t("Font")}</option>
                <option value="other">{t("Other")}</option>
                <option value="detail">{t("Detail")}</option>
              </select>
            </label>
            {filterMode === "detail" ? (
              <label>
                {t("Extension")}
                <select value={extensionFilter} onChange={(event) => setExtensionFilter(event.target.value)}>
                  <option value="all">{t("All extensions")}</option>
                  {availableExtensions.map((extension) => (
                    <option key={extension} value={extension}>
                      {extension}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              {t("Sort by")}
              <select value={sortKey} onChange={(event) => setSortKey(event.target.value as AssetSortKey)}>
                <option value="alphabetical">{t("Alphabetical")}</option>
                <option value="japanese">{t("Japanese syllabary")}</option>
                <option value="createdAt">{t("Added date")}</option>
                <option value="size">{t("Asset size")}</option>
              </select>
            </label>
            <label>
              {t("Order")}
              <select value={sortDirection} onChange={(event) => setSortDirection(event.target.value as SortDirection)}>
                <option value="asc">{t("Ascending")}</option>
                <option value="desc">{t("Descending")}</option>
              </select>
            </label>
            <label>
              {t("View mode")}
              <select value={viewMode} onChange={(event) => setViewMode(event.target.value as AssetViewMode)}>
                <option value="tile">{t("Tile")}</option>
                <option value="list">{t("List")}</option>
              </select>
            </label>
          </div>

          <div className="asset-scroll">
            {viewMode === "tile" ? (
              <div className="asset-grid">
                {visibleAssets.map((asset) => (
                  <button
                    className={`asset-tile ${asset.id === selected?.id ? "selected" : ""}`}
                    key={asset.id}
                    type="button"
                    onClick={() => setSelectedId(asset.id)}
                  >
                    <AssetPreview asset={asset} label={t(kindLabels[asset.kind])} />
                    <strong>{asset.name}</strong>
                    <span>
                      {t(kindLabels[asset.kind])} · {assetExtension(asset) || "-"}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="asset-list">
                {visibleAssets.map((asset) => (
                  <button
                    className={`asset-list-row ${asset.id === selected?.id ? "selected" : ""}`}
                    key={asset.id}
                    type="button"
                    onClick={() => setSelectedId(asset.id)}
                  >
                    <strong>{asset.name}</strong>
                    <span>{t(kindLabels[asset.kind])}</span>
                    <span>{assetExtension(asset) || "-"}</span>
                    <span>{formatBytes(asset.sizeBytes)}</span>
                  </button>
                ))}
              </div>
            )}
            {visibleAssets.length === 0 ? <p className="empty-text asset-empty">{t("No assets match the current filters.")}</p> : null}
          </div>
        </div>

        {selected ? (
          <aside className="panel asset-detail">
            <AssetPreview asset={selected} label={t(kindLabels[selected.kind])} large />
            <div>
              <p className="eyebrow">{t(kindLabels[selected.kind])}</p>
              <h3>{selected.name}</h3>
              <p className="empty-text">{selected.description}</p>
            </div>
            {selected.kind === "audio" ? (
              <div className="asset-audio-controls">
                <audio ref={audioRef} src={selected.contentUrl} onEnded={() => setAudioPlaying(false)} />
                <button type="button" onClick={() => void handleAudioPlayback()}>
                  {audioPlaying ? t("Stop") : t("Play")}
                </button>
                <label>
                  <span>
                    {t("Volume")} {Math.round(audioVolume * 100)}%
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={audioVolume}
                    onChange={(event) => setAudioVolume(Number(event.target.value))}
                  />
                </label>
              </div>
            ) : null}
            <div className="asset-detail-actions">
              <label>
                {t("Name")}
                <input value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} disabled={!selectedIsEditable || assetBusy} />
              </label>
              <div className="button-row">
                <button type="button" onClick={() => void handleRename()} disabled={!selectedIsEditable || assetBusy || nameDraft.trim() === selected.name}>
                  {t("Rename")}
                </button>
                <button type="button" onClick={() => void handleDelete()} disabled={!selectedIsEditable || assetBusy}>
                  {t("Delete")}
                </button>
              </div>
              {!selectedIsEditable ? <p className="empty-text">{t("Bundled assets cannot be edited.")}</p> : null}
            </div>
            <dl className="detail-list compact">
              <dt>{t("file")}</dt>
              <dd>{selected.fileName}</dd>
              <dt>{t("source")}</dt>
              <dd>{selected.source}</dd>
              <dt>{t("size")}</dt>
              <dd>{selected.width && selected.height ? `${selected.width} x ${selected.height}` : formatBytes(selected.sizeBytes)}</dd>
              <dt>{t("url")}</dt>
              <dd>{selected.contentUrl}</dd>
            </dl>
          </aside>
        ) : null}
      </section>
    </section>
  );
}

function AssetPreview({ asset, label, large = false }: { asset: AssetCatalogItem; label: string; large?: boolean }): React.ReactElement {
  if (asset.kind === "image") {
    return (
      <span className={`asset-preview ${large ? "large" : ""}`}>
        <img src={asset.contentUrl} alt="" />
      </span>
    );
  }

  return <span className={`asset-preview asset-preview-placeholder ${large ? "large" : ""}`}>{label}</span>;
}

function formatBytes(sizeBytes?: number): string {
  if (!sizeBytes) return "-";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function selectedFilesLabel(files: File[], t: (key: string) => string): string {
  if (files.length === 1) return files[0]?.name ?? "";
  return `${files.length} ${t("files selected")}`;
}

function assetMatchesSearch(asset: AssetCatalogItem, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  const searchable = [asset.name, asset.fileName, asset.description ?? "", asset.mimeType, assetExtension(asset), asset.kind].map(normalizeSearchText).join(" ");
  return searchable.includes(normalizedQuery);
}

function assetMatchesFilter(asset: AssetCatalogItem, filterMode: AssetFilterMode, extensionFilter: string): boolean {
  if (filterMode === "all") return true;
  if (filterMode === "detail") return extensionFilter === "all" || assetExtension(asset) === extensionFilter;
  if (filterMode === "other") return !["image", "video", "audio", "font"].includes(asset.kind);
  return asset.kind === filterMode;
}

function compareAssets(left: AssetCatalogItem, right: AssetCatalogItem, sortKey: AssetSortKey, direction: SortDirection): number {
  const multiplier = direction === "asc" ? 1 : -1;
  let result = 0;
  if (sortKey === "alphabetical") {
    result = left.name.localeCompare(right.name, "en", { numeric: true, sensitivity: "base" });
  } else if (sortKey === "japanese") {
    result = left.name.localeCompare(right.name, "ja-JP", { numeric: true, sensitivity: "base" });
  } else if (sortKey === "size") {
    result = (left.sizeBytes ?? 0) - (right.sizeBytes ?? 0);
  } else {
    result = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  }
  if (result === 0) result = left.name.localeCompare(right.name, "ja-JP", { numeric: true, sensitivity: "base" });
  return result * multiplier;
}

function assetExtension(asset: AssetCatalogItem): string {
  const candidate = asset.fileName || asset.name;
  const match = /\.([^.\\/]+)$/u.exec(candidate);
  return match?.[1]?.toLocaleLowerCase("en-US") ?? "";
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP").trim();
}
