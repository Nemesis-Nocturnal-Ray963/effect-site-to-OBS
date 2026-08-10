import React from "react";
import { useI18n } from "../i18n/I18nProvider";
import { languages, type LanguageCode } from "../i18n/translations";
import { fetchSystemFonts, uploadAsset, type SystemFontInfo } from "../services/httpApi";
import { defaultAppFontOption, fontFamilyCss, readAppFontFamily, registerUploadedFontFaces, saveAppFontFamily } from "../utils/appFont";

export function SettingsPage(): React.ReactElement {
  const { language, setLanguage, t } = useI18n();
  const [saved, setSaved] = React.useState(false);
  const [appFontFamily, setAppFontFamily] = React.useState(() => readAppFontFamily());
  const [fonts, setFonts] = React.useState<SystemFontInfo[]>([]);
  const [fontFile, setFontFile] = React.useState<File | null>(null);
  const [fontUploading, setFontUploading] = React.useState(false);
  const [fontMessage, setFontMessage] = React.useState("");
  const fontInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    void fetchSystemFonts()
      .then((items) => {
        setFonts(items);
        registerUploadedFontFaces(items);
      })
      .catch(() => setFontMessage(t("settings.fontLoadFailed")));
  }, [t]);

  function handleLanguageChange(event: React.ChangeEvent<HTMLSelectElement>): void {
    setLanguage(event.target.value as LanguageCode);
    setSaved(true);
  }

  async function handleFontUpload(): Promise<void> {
    if (!fontFile) {
      setFontMessage(t("settings.fontChooseFile"));
      return;
    }
    setFontUploading(true);
    setFontMessage("");
    try {
      const asset = await uploadAsset(fontFile);
      const nextFonts = await fetchSystemFonts();
      setFonts(nextFonts);
      registerUploadedFontFaces(nextFonts);
      setFontFile(null);
      if (fontInputRef.current) fontInputRef.current.value = "";
      setFontMessage(`${t("settings.fontUploaded")}: ${asset.name}`);
    } catch (error) {
      setFontMessage(error instanceof Error ? error.message : t("settings.fontUploadFailed"));
    } finally {
      setFontUploading(false);
    }
  }

  function handleAppFontChange(event: React.ChangeEvent<HTMLSelectElement>): void {
    const nextFont = saveAppFontFamily(event.target.value);
    setAppFontFamily(nextFont);
    setSaved(true);
  }

  const fontOptions = React.useMemo(() => groupedFontOptions(fonts), [fonts]);

  return (
    <section className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">{t("settings.eyebrow")}</p>
        <h2>{t("settings.title")}</h2>
        <p className="empty-text">{t("settings.description")}</p>
      </div>

      <section className="panel settings-panel">
        <div>
          <h3>{t("settings.languageTitle")}</h3>
          <p className="empty-text">{t("settings.languageDescription")}</p>
        </div>
        <label>
          {t("settings.languageLabel")}
          <select value={language} onChange={handleLanguageChange}>
            {languages.map((item) => (
              <option key={item.code} value={item.code}>
                {item.nativeLabel}
              </option>
            ))}
          </select>
        </label>
        <p className="empty-text">{t("settings.languageHelp")}</p>
        {saved ? <p className="success-text">{t("settings.saved")}</p> : null}
      </section>

      <section className="panel settings-panel">
        <div>
          <h3>{t("settings.appFontTitle")}</h3>
          <p className="empty-text">{t("settings.appFontDescription")}</p>
        </div>
        <label>
          {t("settings.appFontLabel")}
          <select value={appFontFamily} onChange={handleAppFontChange}>
            <option value={defaultAppFontOption()}>{t("settings.appFontDefault")}</option>
            {fontOptions.localFonts.length > 0 ? (
              <optgroup label={t("Local fonts")}>
                {fontOptions.localFonts.map((font) => (
                  <option key={`local-${font.id}`} value={font.family} style={{ fontFamily: font.family }}>
                    {font.family}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <optgroup label={t("System fonts")}>
              {fontOptions.systemFamilies.map((family) => (
                <option key={family} value={family} style={{ fontFamily: family }}>
                  {family}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <p className="settings-note">{t("settings.appFontWarning")}</p>
        <span className="font-family-preview settings-font-preview" style={{ fontFamily: fontFamilyCss(appFontFamily) }}>
          {t("settings.appFontPreview")}
        </span>
        {saved ? <p className="success-text">{t("settings.saved")}</p> : null}
      </section>

      <section className="panel settings-panel">
        <div>
          <h3>{t("settings.fontTitle")}</h3>
          <p className="empty-text">{t("settings.fontDescription")}</p>
        </div>
        <div className="asset-upload-controls">
          <input
            ref={fontInputRef}
            type="file"
            accept="font/*,.otf,.ttc,.ttf,.woff,.woff2"
            disabled={fontUploading}
            onChange={(event) => setFontFile(event.target.files?.[0] ?? null)}
          />
          <button type="button" onClick={() => void handleFontUpload()} disabled={fontUploading || !fontFile}>
            {fontUploading ? t("Uploading") : t("settings.fontUpload")}
          </button>
        </div>
        <p className="empty-text">{fontMessage || t("settings.fontHelp")}</p>
      </section>

      <section className="panel settings-panel">
        <div>
          <h3>{t("settings.futureTitle")}</h3>
          <p className="empty-text">{t("settings.futureDescription")}</p>
        </div>
        <div className="settings-placeholder-grid">
          <PlaceholderCard title={t("settings.themeTitle")} description={t("settings.themeDescription")} badge={t("settings.placeholderBadge")} />
          <PlaceholderCard title={t("settings.storageTitle")} description={t("settings.storageDescription")} badge={t("settings.placeholderBadge")} />
          <PlaceholderCard title={t("settings.connectionTitle")} description={t("settings.connectionDescription")} badge={t("settings.placeholderBadge")} />
        </div>
      </section>
    </section>
  );
}

const recommendedAppFontFamilies = ["Inter", "Segoe UI", "Yu Gothic", "Meiryo", "BIZ UDPGothic", "Noto Sans JP", "Arial", "sans-serif"];

function groupedFontOptions(fonts: SystemFontInfo[]): { localFonts: SystemFontInfo[]; systemFamilies: string[] } {
  const localFonts = fonts
    .filter((font) => font.source === "asset")
    .sort((left, right) => left.family.localeCompare(right.family, "ja-JP", { sensitivity: "base" }));
  const localKeys = new Set(localFonts.map((font) => font.family.toLocaleLowerCase("ja-JP")));
  const systemFamilies = [...new Set([...recommendedAppFontFamilies, ...fonts.filter((font) => font.source === "system").map((font) => font.family)])]
    .filter((family) => !localKeys.has(family.toLocaleLowerCase("ja-JP")))
    .sort((left, right) => left.localeCompare(right, "ja-JP", { sensitivity: "base" }));
  return { localFonts, systemFamilies };
}

function PlaceholderCard({ title, description, badge }: { title: string; description: string; badge: string }): React.ReactElement {
  return (
    <article className="settings-placeholder-card">
      <span className="level-pill">{badge}</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </article>
  );
}
