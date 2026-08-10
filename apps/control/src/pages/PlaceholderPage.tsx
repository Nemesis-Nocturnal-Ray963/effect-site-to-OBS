import React from "react";
import { useI18n } from "../i18n/I18nProvider";

interface PlaceholderPageProps {
  title: string;
  eyebrow: string;
  message: string;
}

export function PlaceholderPage({ title, eyebrow, message }: PlaceholderPageProps): React.ReactElement {
  const { t } = useI18n();
  return (
    <section className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">{t(eyebrow)}</p>
        <h2>{t(title)}</h2>
      </div>
      <div className="panel">
        <p className="empty-text">{t(message)}</p>
      </div>
    </section>
  );
}
