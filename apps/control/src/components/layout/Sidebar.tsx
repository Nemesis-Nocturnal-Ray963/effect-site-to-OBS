import React from "react";
import { NavLink } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

const sections: Array<{
  titleKey: TranslationKey;
  items: Array<{ labelKey: TranslationKey; to: string }>;
}> = [
  {
    titleKey: "nav.dashboard",
    items: [{ labelKey: "nav.dashboard", to: "/dashboard" }]
  },
  {
    titleKey: "nav.connections",
    items: [
      { labelKey: "nav.tiktokLive", to: "/connections/tiktok" },
      { labelKey: "nav.tiktokRawEvents", to: "/connections/tiktok/raw-events" },
      { labelKey: "nav.tiktokBrowserFrames", to: "/connections/tiktok/browser-frames" },
      { labelKey: "nav.httpApi", to: "/connections/http" },
      { labelKey: "nav.obs", to: "/connections/obs" }
    ]
  },
  {
    titleKey: "nav.events",
    items: [
      { labelKey: "nav.eventCatalog", to: "/events/catalog" },
      { labelKey: "nav.eventMonitor", to: "/events/monitor" },
      { labelKey: "nav.eventTest", to: "/events/test" }
    ]
  },
  {
    titleKey: "nav.records",
    items: [{ labelKey: "nav.gifts", to: "/records/gifts" }]
  },
  {
    titleKey: "nav.effects",
    items: [
      { labelKey: "nav.effectLibrary", to: "/effects" },
      { labelKey: "nav.overlays", to: "/overlays" },
      { labelKey: "nav.assets", to: "/assets" },
      { labelKey: "nav.presets", to: "/presets" },
      { labelKey: "nav.macros", to: "/macros" }
    ]
  },
  {
    titleKey: "nav.automation",
    items: [
      { labelKey: "nav.timeTriggers", to: "/time-triggers" },
      { labelKey: "nav.rules", to: "/rules" }
    ]
  },
  {
    titleKey: "nav.system",
    items: [
      { labelKey: "nav.logs", to: "/logs" },
      { labelKey: "nav.settings", to: "/settings" }
    ]
  }
];

export function Sidebar({ open, onClose }: SidebarProps): React.ReactElement {
  const { t } = useI18n();

  return (
    <>
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-brand">
          <span className="brand-mark">OE</span>
          <div>
            <strong>OBS Effect</strong>
            <span>Phase 1</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label={t("nav.aria")}>
          {sections.map((section) => (
            <section className="nav-section" key={section.titleKey}>
              <h2>{t(section.titleKey)}</h2>
              {section.items.map((item) => (
                <NavLink
                  className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
                  key={item.to}
                  to={item.to}
                  onClick={onClose}
                >
                  {t(item.labelKey)}
                </NavLink>
              ))}
            </section>
          ))}
        </nav>
      </aside>
      {open ? <button className="sidebar-backdrop" type="button" onClick={onClose} aria-label={t("nav.closeMenu")} /> : null}
    </>
  );
}
