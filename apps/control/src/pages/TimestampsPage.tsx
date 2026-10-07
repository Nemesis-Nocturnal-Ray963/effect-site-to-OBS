import React from "react";
import { useTimestampMonitoring } from "../features/timestamps/TimestampMonitoringProvider";
import { useI18n } from "../i18n/I18nProvider";

export function TimestampsPage(): React.ReactElement {
  const { language, t } = useI18n();
  const {
    microphones,
    microphoneId,
    microphoneMessage,
    isMonitoring,
    volumeLevel,
    volumeThreshold,
    timestamps,
    timestampHistory,
    setMicrophone,
    setVolumeThreshold,
    startMonitoring,
    stopMonitoring
  } = useTimestampMonitoring();
  const [activeTimestampTab, setActiveTimestampTab] = React.useState<"current" | "past">("current");
  const [selectedHistoryDate, setSelectedHistoryDate] = React.useState("all");
  const [calendarMonth, setCalendarMonth] = React.useState(() => {
    const latest = timestampHistory[timestampHistory.length - 1]?.recordedAt ?? new Date().toISOString();
    return localDateKey(latest).slice(0, 7);
  });
  const currentSessionId = timestamps[0]?.sessionId;
  const pastTimestamps = timestampHistory
    .filter((timestamp) => !currentSessionId || timestamp.sessionId !== currentSessionId)
    .slice()
    .reverse();
  const historyDates = [...new Set(pastTimestamps.map((timestamp) => localDateKey(timestamp.recordedAt)))].sort((left, right) => right.localeCompare(left));
  const filteredPastTimestamps = selectedHistoryDate === "all"
    ? pastTimestamps
    : pastTimestamps.filter((timestamp) => localDateKey(timestamp.recordedAt) === selectedHistoryDate);
  const visibleTimestamps = activeTimestampTab === "current" ? timestamps : filteredPastTimestamps;
  const recordedDateSet = new Set(historyDates);
  const calendarDays = buildCalendarDays(calendarMonth);

  function formatRecordedTime(recordedAt: string): string {
    return new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(new Date(recordedAt));
  }

  function formatRecordedDate(recordedAt: string): string {
    return new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date(recordedAt));
  }

  function timestampLabel(kind: "volume" | "stream-start" | "stream-end"): string {
    if (kind === "stream-start") return t("Stream started");
    if (kind === "stream-end") return t("Stream ended");
    return t("Volume exceeded threshold");
  }

  return (
    <section className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">{t("Volume monitoring")}</p>
        <h2>{t("Timestamps")}</h2>
      </div>

      <div className="panel">
        <p className="empty-text">{t("Monitor microphone volume and record moments that exceed the configured threshold.")}</p>
      </div>

      <section className="panel timestamp-microphone-panel">
        <div>
          <h3>{t("Microphone")}</h3>
          <p className="empty-text">{t("Choose the microphone used for volume monitoring.")}</p>
        </div>

        <div className="timestamp-microphone-controls">
          <label>
            {t("Microphone to use")}
            <select value={microphoneId} onChange={(event) => setMicrophone(event.target.value)}>
              <option value="">{t("System default microphone")}</option>
              {microphones.map((microphone, index) => (
                <option key={microphone.deviceId} value={microphone.deviceId}>
                  {microphone.label || `${t("Microphone")} ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
          {isMonitoring ? (
            <button type="button" onClick={stopMonitoring}>{t("Stop monitoring")}</button>
          ) : (
            <button type="button" onClick={() => void startMonitoring()}>{t("Start monitoring")}</button>
          )}
        </div>

        {microphoneMessage ? <p className="empty-text">{t(microphoneMessage)}</p> : null}
      </section>

      <section className="panel timestamp-volume-panel">
        <div>
          <h3>{t("Volume threshold")}</h3>
          <p className="empty-text">{t("Set the volume level that will trigger a timestamp.")}</p>
        </div>

        <div className="timestamp-threshold-controls">
          <input aria-label={t("Volume threshold")} type="range" min="0" max="100" value={volumeThreshold} onChange={(event) => setVolumeThreshold(Number(event.target.value))} />
          <label>
            {t("Threshold")}
            <input type="number" min="0" max="100" value={volumeThreshold} onChange={(event) => setVolumeThreshold(Number(event.target.value))} />
          </label>
          <span>%</span>
        </div>

        <div className={`volume-meter ${isMonitoring && volumeLevel >= volumeThreshold ? "over-threshold" : ""}`}>
          <div className="volume-meter-track" role="meter" aria-label={t("Microphone input level")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={volumeLevel}>
            <div className="volume-meter-fill" style={{ width: `${volumeLevel}%` }} />
            <span className="volume-threshold-marker" style={{ left: `${volumeThreshold}%` }} />
          </div>
          <strong>{volumeLevel}%</strong>
          <span>{isMonitoring ? t("Monitoring") : t("Monitoring stopped")}</span>
        </div>

        <div className="recorded-timestamps">
          <div className="timestamp-tabs" role="tablist" aria-label={t("Recorded timestamps")}>
            <button className={activeTimestampTab === "current" ? "active" : ""} type="button" role="tab" aria-selected={activeTimestampTab === "current"} onClick={() => setActiveTimestampTab("current")}>
              {t("Current timestamps")}
            </button>
            <button className={activeTimestampTab === "past" ? "active" : ""} type="button" role="tab" aria-selected={activeTimestampTab === "past"} onClick={() => setActiveTimestampTab("past")}>
              {t("Previously recorded timestamps")}
            </button>
          </div>

          <p className="empty-text">
            {activeTimestampTab === "current" ? t("The current time is recorded for stream start, stream end, and volume threshold events.") : t("Saved timestamps from previous monitoring sessions.")}
          </p>

          {activeTimestampTab === "past" ? (
            <section className="timestamp-calendar" aria-label={t("Filter by date")}>
              <div className="timestamp-calendar-header">
                <button type="button" aria-label={t("Previous month")} onClick={() => setCalendarMonth(shiftMonth(calendarMonth, -1))}>‹</button>
                <strong>{formatMonthKey(calendarMonth, language)}</strong>
                <button type="button" aria-label={t("Next month")} onClick={() => setCalendarMonth(shiftMonth(calendarMonth, 1))}>›</button>
              </div>
              <div className="timestamp-calendar-weekdays" aria-hidden="true">
                {weekdayLabels(language).map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
              </div>
              <div className="timestamp-calendar-days">
                {calendarDays.map(({ dateKey, day, inCurrentMonth }) => {
                  const hasRecords = recordedDateSet.has(dateKey);
                  return (
                    <button
                      className={`${inCurrentMonth ? "" : "outside-month"} ${hasRecords ? "has-records" : ""} ${selectedHistoryDate === dateKey ? "selected" : ""}`}
                      type="button"
                      key={dateKey}
                      disabled={!hasRecords}
                      aria-label={formatDateKey(dateKey, language)}
                      aria-pressed={selectedHistoryDate === dateKey}
                      onClick={() => setSelectedHistoryDate(dateKey)}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
              <div className="timestamp-calendar-footer">
                <button className={selectedHistoryDate === "all" ? "active" : ""} type="button" onClick={() => setSelectedHistoryDate("all")}>{t("All dates")}</button>
                <span>{selectedHistoryDate === "all" ? t("Showing all dates") : formatDateKey(selectedHistoryDate, language)}</span>
              </div>
            </section>
          ) : null}

          {visibleTimestamps.length > 0 ? (
            <ol>
              {visibleTimestamps.map((timestamp) => (
                <li key={timestamp.id}>
                  <span>
                    {activeTimestampTab === "past" ? `${formatRecordedDate(timestamp.recordedAt)} / ` : ""}
                    {timestampLabel(timestamp.kind)}
                  </span>
                  <strong>{formatRecordedTime(timestamp.recordedAt)}</strong>
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty-text timestamp-empty">
              {activeTimestampTab === "current" ? t("Timestamps will appear here when the volume exceeds the threshold.") : t("No previously recorded timestamps.")}
            </p>
          )}
        </div>
      </section>
    </section>
  );
}

function localDateKey(recordedAt: string): string {
  const date = new Date(recordedAt);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateKey(dateKey: string, language: "en" | "ja"): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(year ?? 0, (month ?? 1) - 1, day ?? 1));
}

function formatMonthKey(monthKey: string, language: "en" | "ja"): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: "long"
  }).format(new Date(year ?? 0, (month ?? 1) - 1, 1));
}

function shiftMonth(monthKey: string, amount: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const shifted = new Date(year ?? 0, (month ?? 1) - 1 + amount, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

function buildCalendarDays(monthKey: string): Array<{ dateKey: string; day: number; inCurrentMonth: boolean }> {
  const [year, month] = monthKey.split("-").map(Number);
  const firstDay = new Date(year ?? 0, (month ?? 1) - 1, 1);
  const firstVisibleDay = new Date(firstDay);
  firstVisibleDay.setDate(1 - firstDay.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstVisibleDay);
    date.setDate(firstVisibleDay.getDate() + index);
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { dateKey, day: date.getDate(), inCurrentMonth: date.getMonth() === firstDay.getMonth() };
  });
}

function weekdayLabels(language: "en" | "ja"): string[] {
  const formatter = new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", { weekday: "narrow" });
  return Array.from({ length: 7 }, (_, index) => formatter.format(new Date(2024, 0, 7 + index)));
}
