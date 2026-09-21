import React from "react";
import type { GiftCatalogRecord, GiftCatalogStats, GiftImageCacheStatus } from "@obs-effect/shared-types";
import { useI18n } from "../i18n/I18nProvider";
import { createGift, fetchGiftStats, fetchGifts, updateGift } from "../services/httpApi";

const columns = ["Image", "Name", "Gift ID", "Coin", "First Seen", "Last Seen", "Seen", "Image Status"];

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "-";
}

function valueText(value: number | null): string {
  return value === null ? "-" : String(value);
}

function coinValue(gift: GiftCatalogRecord): number | null {
  return gift.coinValue ?? gift.diamondValue;
}

export function GiftCatalogPage(): React.ReactElement {
  const { t } = useI18n();
  const [gifts, setGifts] = React.useState<GiftCatalogRecord[]>([]);
  const [stats, setStats] = React.useState<GiftCatalogStats | null>(null);
  const [selected, setSelected] = React.useState<GiftCatalogRecord | null>(null);
  const [search, setSearch] = React.useState("");
  const [sort, setSort] = React.useState<"lastSeenAt" | "name" | "seenCount" | "coinValue">("lastSeenAt");
  const [cacheStatus, setCacheStatus] = React.useState<"all" | GiftImageCacheStatus>("all");
  const [viewMode, setViewMode] = React.useState<"tile" | "table">("tile");
  const [status, setStatus] = React.useState("");
  const [form, setForm] = React.useState({ name: "", coinValue: "", primaryImageUrl: "", isActive: true });
  const [manualForm, setManualForm] = React.useState({ platformGiftId: "", name: "", coinValue: "", primaryImageUrl: "" });

  const load = React.useCallback(async (): Promise<void> => {
    const [nextGifts, nextStats] = await Promise.all([
      fetchGifts({
        search,
        sort,
        order: sort === "name" ? "asc" : "desc",
        cacheStatus: cacheStatus === "all" ? undefined : cacheStatus,
        limit: 300
      }),
      fetchGiftStats()
    ]);
    setGifts(nextGifts);
    setStats(nextStats);
  }, [cacheStatus, search, sort]);

  React.useEffect(() => {
    void load().catch(() => setStatus(t("Could not load gift catalog")));
  }, [load, t]);

  React.useEffect(() => {
    if (!selected) return;
    setForm({
      name: selected.name,
      coinValue: coinValue(selected) === null ? "" : String(coinValue(selected)),
      primaryImageUrl: selected.image.primaryUrl ?? "",
      isActive: selected.isActive
    });
  }, [selected]);

  async function handleSearch(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setStatus(t("Loading..."));
    try {
      await load();
      setStatus("");
    } catch {
      setStatus(t("Could not load gift catalog"));
    }
  }

  async function handleSave(): Promise<void> {
    if (!selected) return;
    setStatus(t("Saving..."));
    try {
      const updated = await updateGift(selected.id, {
        name: form.name,
        diamondValue: form.coinValue === "" ? null : Number(form.coinValue),
        coinValue: form.coinValue === "" ? null : Number(form.coinValue),
        primaryImageUrl: form.primaryImageUrl || null,
        isActive: form.isActive
      });
      setSelected(updated);
      await load();
      setStatus(t("Saved"));
    } catch {
      setStatus(t("Save failed"));
    }
  }

  async function handleManualCreate(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setStatus(t("Saving..."));
    try {
      const created = await createGift({
        platformGiftId: manualForm.platformGiftId.trim() || undefined,
        name: manualForm.name.trim(),
        coinValue: manualForm.coinValue === "" ? null : Number(manualForm.coinValue),
        primaryImageUrl: manualForm.primaryImageUrl.trim() || null
      });
      setManualForm({ platformGiftId: "", name: "", coinValue: "", primaryImageUrl: "" });
      await load();
      setSelected(created);
      setStatus(t("Saved"));
    } catch {
      setStatus(t("Save failed"));
    }
  }

  return (
    <section className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">{t("Records")}</p>
        <h2>{t("Gift Catalog")}</h2>
      </div>

      <div className="metric-grid">
        <div className="metric-card">
          <span>{t("Total")}</span>
          <strong>{stats?.total ?? "-"}</strong>
        </div>
        <div className="metric-card">
          <span>{t("With Image")}</span>
          <strong>{stats?.withImage ?? "-"}</strong>
        </div>
        <div className="metric-card">
          <span>{t("With Coin")}</span>
          <strong>{stats?.withCoinValue ?? "-"}</strong>
        </div>
        <div className="metric-card">
          <span>{t("Missing Value")}</span>
          <strong>{stats?.missingValue ?? "-"}</strong>
        </div>
      </div>

      <form className="panel form-grid" onSubmit={(event) => void handleManualCreate(event)}>
        <div>
          <h3>{t("Add gift manually")}</h3>
          <p className="empty-text">{t("Gift ID is optional. The app creates an internal ID when it is unknown.")}</p>
        </div>
        <label>{t("Name")}<input required value={manualForm.name} onChange={(event) => setManualForm({ ...manualForm, name: event.target.value })} /></label>
        <label>{t("Gift ID")}<input value={manualForm.platformGiftId} onChange={(event) => setManualForm({ ...manualForm, platformGiftId: event.target.value })} /></label>
        <label>{t("Coin")}<input type="number" min="0" value={manualForm.coinValue} onChange={(event) => setManualForm({ ...manualForm, coinValue: event.target.value })} /></label>
        <label>{t("Primary Image URL")}<input value={manualForm.primaryImageUrl} onChange={(event) => setManualForm({ ...manualForm, primaryImageUrl: event.target.value })} /></label>
        <button type="submit">{t("Add gift")}</button>
      </form>

      <form className="panel monitor-toolbar" onSubmit={(event) => void handleSearch(event)}>
        <label>
          {t("Search")}
          <input value={search} placeholder={t("name or gift id")} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <label>
          {t("Sort")}
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="lastSeenAt">last seen</option>
            <option value="name">name</option>
            <option value="seenCount">seen count</option>
            <option value="coinValue">coin</option>
          </select>
        </label>
        <label>
          {t("Image Status")}
          <select value={cacheStatus} onChange={(event) => setCacheStatus(event.target.value as typeof cacheStatus)}>
            <option value="all">all</option>
            <option value="not-requested">not-requested</option>
            <option value="pending">pending</option>
            <option value="cached">cached</option>
            <option value="failed">failed</option>
          </select>
        </label>
        <label>
          {t("View")}
          <select value={viewMode} onChange={(event) => setViewMode(event.target.value as typeof viewMode)}>
            <option value="tile">tile</option>
            <option value="table">table</option>
          </select>
        </label>
        <div className="button-row">
          <button type="submit">{t("Refresh")}</button>
        </div>
        <span>{status}</span>
      </form>

      <div className="panel">
        <div className="table-meta">
          <span>{gifts.length} {t("gifts")}</span>
          <span>{t("Last discovered")}: {formatDate(stats?.lastDiscoveredAt)}</span>
        </div>
        {viewMode === "tile" ? (
          gifts.length === 0 ? (
            <p className="empty-text">{t("No gifts recorded yet.")}</p>
          ) : (
            <div className="gift-tile-grid">
              {gifts.map((gift) => (
                <button className="gift-tile" key={gift.id} type="button" onClick={() => setSelected(gift)}>
                  <span className="gift-tile-image">
                    {gift.image.primaryUrl ? <img src={gift.image.primaryUrl} alt="" loading="lazy" /> : <span>{t("No image")}</span>}
                  </span>
                  <strong>{gift.name}</strong>
                  <span className="gift-tile-value">{t("Coin")} {valueText(coinValue(gift))}</span>
                </button>
              ))}
            </div>
          )
        ) : (
          <div className="table-panel">
            <table>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column}>{t(column)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {gifts.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length}>{t("No gifts recorded yet.")}</td>
                  </tr>
                ) : (
                  gifts.map((gift) => (
                    <tr key={gift.id} onClick={() => setSelected(gift)}>
                      <td>
                        {gift.image.primaryUrl ? <img className="gift-thumb" src={gift.image.primaryUrl} alt="" loading="lazy" /> : "-"}
                      </td>
                      <td>{gift.name}</td>
                      <td>{gift.platformGiftId}</td>
                      <td>{valueText(coinValue(gift))}</td>
                      <td>{formatDate(gift.firstSeenAt)}</td>
                      <td>{formatDate(gift.lastSeenAt)}</td>
                      <td>{gift.seenCount}</td>
                      <td>{gift.image.cacheStatus}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected ? (
        <aside className="detail-drawer" aria-label={t("Gift detail")}>
          <div className="drawer-header">
            <div>
              <p className="eyebrow">{t("Gift Detail")}</p>
              <h3>{selected.name}</h3>
            </div>
            <button type="button" onClick={() => setSelected(null)}>
              {t("Close")}
            </button>
          </div>
          <dl className="detail-list">
            <dt>internal id</dt>
            <dd>{selected.id}</dd>
            <dt>platform</dt>
            <dd>{selected.platform}</dd>
            <dt>gift id</dt>
            <dd>{selected.platformGiftId}</dd>
            <dt>aliases</dt>
            <dd>{selected.aliases.length > 0 ? selected.aliases.join(", ") : "-"}</dd>
            <dt>first seen</dt>
            <dd>{formatDate(selected.firstSeenAt)}</dd>
            <dt>last seen</dt>
            <dd>{formatDate(selected.lastSeenAt)}</dd>
            <dt>seen count</dt>
            <dd>{selected.seenCount}</dd>
            <dt>value source</dt>
            <dd>{selected.valueSource}</dd>
          </dl>
          <div className="form-grid">
            <label>
              {t("Name")}
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label>
              {t("Coin")}
              <input
                type="number"
                min="0"
                value={form.coinValue}
                onChange={(event) => setForm({ ...form, coinValue: event.target.value })}
              />
            </label>
            <label>
              {t("Primary Image URL")}
              <input value={form.primaryImageUrl} onChange={(event) => setForm({ ...form, primaryImageUrl: event.target.value })} />
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
              {t("Active")}
            </label>
          </div>
          <div className="drawer-actions">
            <button type="button" onClick={() => void handleSave()}>
              {t("Save")}
            </button>
          </div>
          <pre className="json-block">{JSON.stringify(selected.image, null, 2)}</pre>
        </aside>
      ) : null}
    </section>
  );
}
