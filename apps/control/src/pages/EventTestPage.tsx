import React from "react";
import { useI18n } from "../i18n/I18nProvider";
import { buildTestEvent, fetchApiKey, postEvent, type EventTestForm } from "../services/httpApi";

export function EventTestPage(): React.ReactElement {
  const { t } = useI18n();
  const [form, setForm] = React.useState<EventTestForm>({
    eventId: `test-${Date.now()}`,
    platform: "tiktok",
    type: "gift",
    displayName: "sample_user",
    giftName: "Rose",
    repeatCount: 1,
    diamondValueTotal: 1,
    comment: ""
  });
  const [result, setResult] = React.useState(t("Not sent"));

  const event = buildTestEvent(form);

  const update = <K extends keyof EventTestForm>(key: K, value: EventTestForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async () => {
    try {
      const apiKey = await fetchApiKey();
      const response = await postEvent(event, apiKey);
      setResult(JSON.stringify(response, null, 2));
    } catch (caught) {
      setResult(caught instanceof Error ? caught.message : t("Send failed"));
    }
  };

  return (
    <section className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">{t("Events")}</p>
        <h2>{t("Event Test")}</h2>
      </div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>
            eventId
            <input value={form.eventId} onChange={(change) => update("eventId", change.target.value)} />
          </label>
          <label>
            platform
            <select value={form.platform} onChange={(change) => update("platform", change.target.value as EventTestForm["platform"])}>
              <option value="tiktok">tiktok</option>
              <option value="youtube">youtube</option>
              <option value="twitch">twitch</option>
              <option value="local">local</option>
              <option value="external">external</option>
            </select>
          </label>
          <label>
            type
            <select value={form.type} onChange={(change) => update("type", change.target.value as EventTestForm["type"])}>
              <option value="gift">gift</option>
              <option value="gift-streak-end">gift-streak-end</option>
              <option value="follow">follow</option>
              <option value="comment">comment</option>
              <option value="like">like</option>
              <option value="custom">custom</option>
            </select>
          </label>
          <label>
            user.displayName
            <input value={form.displayName} onChange={(change) => update("displayName", change.target.value)} />
          </label>
          <label>
            giftName
            <input value={form.giftName} onChange={(change) => update("giftName", change.target.value)} />
          </label>
          <label>
            repeatCount
            <input type="number" value={form.repeatCount} onChange={(change) => update("repeatCount", Number(change.target.value))} />
          </label>
          <label>
            diamondValueTotal
            <input type="number" value={form.diamondValueTotal} onChange={(change) => update("diamondValueTotal", Number(change.target.value))} />
          </label>
          <label>
            comment
            <input value={form.comment} onChange={(change) => update("comment", change.target.value)} />
          </label>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => update("eventId", `test-${Date.now()}`)}>
            {t("Generate eventId")}
          </button>
          <button type="button" onClick={() => void submit()}>
            {t("Send")}
          </button>
        </div>
      </div>

      <div className="content-grid">
        <div className="panel">
          <h3>{t("JSON Preview")}</h3>
          <code className="code-block">{JSON.stringify(event, null, 2)}</code>
        </div>
        <div className="panel">
          <h3>{t("Send Result")}</h3>
          <code className="code-block">{result}</code>
        </div>
      </div>
    </section>
  );
}
