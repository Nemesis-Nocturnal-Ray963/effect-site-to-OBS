import React from "react";
import { useI18n } from "../i18n/I18nProvider";
import { fetchApiKey, fetchHttpApiConfig, regenerateApiKey, type HttpApiConfig } from "../services/httpApi";

export function HttpApiPage(): React.ReactElement {
  const { t } = useI18n();
  const [config, setConfig] = React.useState<HttpApiConfig | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const loadConfig = React.useCallback(async () => {
    try {
      setConfig(await fetchHttpApiConfig());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("Could not load HTTP API config"));
    }
  }, [t]);

  React.useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const copyKey = async () => {
    const apiKey = await fetchApiKey();
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const regenerate = async () => {
    const next = await regenerateApiKey();
    await navigator.clipboard.writeText(next.apiKey);
    await loadConfig();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">{t("Connections")}</p>
        <h2>HTTP API</h2>
      </div>

      <div className="content-grid">
        <div className="panel">
          <h3>{t("Event Receive API")}</h3>
          <code className="code-block">{config?.endpointUrl ?? "http://127.0.0.1:3190/api/v1/events"}</code>
          <div className="kv-list">
            <span>{t("Status")}</span>
            <strong>{config?.enabled ? t("Enabled") : t("Loading")}</strong>
            <span>{t("API Key")}</span>
            <strong>{config?.apiKeyMasked ?? "----"}</strong>
          </div>
          <div className="button-row">
            <button type="button" onClick={() => void copyKey()}>
              {t("Copy")}
            </button>
            <button type="button" onClick={() => void regenerate()}>
              {t("Regenerate")}
            </button>
          </div>
          {copied ? <p className="success-text">{t("API key copied to clipboard.")}</p> : null}
          {error ? <p className="error-text">{error}</p> : null}
        </div>

        <div className="panel">
          <h3>{t("Receive Stats")}</h3>
          <div className="kv-list">
            <span>{t("Received")}</span>
            <strong>{config?.metrics.receivedCount ?? 0}</strong>
            <span>{t("Duplicates")}</span>
            <strong>{config?.metrics.duplicateCount ?? 0}</strong>
            <span>{t("Validation errors")}</span>
            <strong>{config?.metrics.validationErrorCount ?? 0}</strong>
            <span>{t("Last received")}</span>
            <strong>{config?.metrics.lastReceivedAt ?? "-"}</strong>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>{t("curl sample")}</h3>
        <code className="code-block">{`curl -X POST "http://127.0.0.1:3190/api/v1/events" ^
  -H "Content-Type: application/json" ^
  -H "X-Effect-App-Key: YOUR_API_KEY" ^
  -d "{\\"schemaVersion\\":\\"1.0\\",\\"eventId\\":\\"event-001\\",\\"source\\":\\"external-http\\",\\"platform\\":\\"tiktok\\",\\"type\\":\\"gift\\",\\"timestamp\\":\\"2026-07-16T00:00:00.000Z\\",\\"data\\":{\\"giftName\\":\\"Rose\\"}}"`}</code>
      </div>

      <div className="panel">
        <h3>{t("Python sample")}</h3>
        <code className="code-block">{`import requests

payload = {
    "schemaVersion": "1.0",
    "eventId": "event-001",
    "source": "external-http",
    "platform": "tiktok",
    "type": "gift",
    "timestamp": "2026-07-16T00:00:00.000Z",
    "data": {"giftName": "Rose"}
}

requests.post(
    "http://127.0.0.1:3190/api/v1/events",
    headers={"X-Effect-App-Key": "YOUR_API_KEY"},
    json=payload,
    timeout=3
)`}</code>
      </div>
    </section>
  );
}
