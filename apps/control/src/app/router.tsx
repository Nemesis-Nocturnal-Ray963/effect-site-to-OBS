import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AssetsPage } from "../pages/AssetsPage";
import { DashboardPage } from "../pages/DashboardPage";
import { EffectsPage } from "../pages/EffectsPage";
import { EventMonitorPage } from "../pages/EventMonitorPage";
import { EventCatalogPage } from "../pages/EventCatalogPage";
import { EventTestPage } from "../pages/EventTestPage";
import { GiftCatalogPage } from "../pages/GiftCatalogPage";
import { HttpApiPage } from "../pages/HttpApiPage";
import { LogsPage } from "../pages/LogsPage";
import { MacrosPage } from "../pages/MacrosPage";
import { ObsConnectionPage } from "../pages/ObsConnectionPage";
import { OverlaysPage } from "../pages/OverlaysPage";
import { OverlayInteractionPage } from "../pages/OverlayInteractionPage";
import { PresetsPage } from "../pages/PresetsPage";
import { RulesPage } from "../pages/RulesPage";
import { SettingsPage } from "../pages/SettingsPage";
import { TikTokConnectionPage } from "../pages/TikTokConnectionPage";
import { TikTokBrowserFramesPage } from "../pages/TikTokBrowserFramesPage";
import { TikTokRawEventsPage } from "../pages/TikTokRawEventsPage";
import { TimeTriggersPage } from "../pages/TimeTriggersPage";

export function AppRoutes(): React.ReactElement {
  return (
    <Routes>
      <Route index element={<Navigate to="/dashboard" replace />} />
      <Route path="dashboard" element={<DashboardPage />} />
      <Route path="connections/tiktok" element={<TikTokConnectionPage />} />
      <Route path="connections/tiktok/raw-events" element={<TikTokRawEventsPage />} />
      <Route path="connections/tiktok/browser-frames" element={<TikTokBrowserFramesPage />} />
      <Route path="connections/http" element={<HttpApiPage />} />
      <Route path="connections/obs" element={<ObsConnectionPage />} />
      <Route path="events/monitor" element={<EventMonitorPage />} />
      <Route path="events/catalog" element={<EventCatalogPage />} />
      <Route path="events/test" element={<EventTestPage />} />
      <Route path="records/gifts" element={<GiftCatalogPage />} />
      <Route path="effects" element={<EffectsPage />} />
      <Route path="overlays" element={<OverlaysPage />} />
      <Route path="overlays/:overlayId/interact" element={<OverlayInteractionPage />} />
      <Route path="assets" element={<AssetsPage />} />
      <Route path="presets" element={<PresetsPage />} />
      <Route path="macros" element={<MacrosPage />} />
      <Route path="time-triggers" element={<TimeTriggersPage />} />
      <Route path="rules" element={<RulesPage />} />
      <Route path="logs" element={<LogsPage />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
