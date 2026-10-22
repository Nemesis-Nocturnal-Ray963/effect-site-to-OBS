import React from "react";
import { useLocation } from "react-router-dom";
import { AppRoutes } from "./router";
import { AppLayout } from "../components/layout/AppLayout";
import { I18nProvider } from "../i18n/I18nProvider";
import { TimestampMonitoringProvider } from "../features/timestamps/TimestampMonitoringProvider";
import { fetchSystemFonts } from "../services/httpApi";
import { useConnectionStore } from "../stores/connectionStore";
import { applyAppFontFamily, readAppFontFamily, registerUploadedFontFaces } from "../utils/appFont";
import { initializeAppAudioOutput } from "../services/appAudioPlayer";

export function App(): React.ReactElement {
  const connect = useConnectionStore((state) => state.connect);
  const location = useLocation();
  const isSoundboardRemote = location.pathname === "/soundboard/remote";

  React.useEffect(() => {
    if (!isSoundboardRemote) connect();
  }, [connect, isSoundboardRemote]);
  React.useEffect(() => {
    if (isSoundboardRemote) return undefined;
    return initializeAppAudioOutput();
  }, [isSoundboardRemote]);
  React.useEffect(() => {
    if (isSoundboardRemote) return;
    applyAppFontFamily(readAppFontFamily());
    void fetchSystemFonts()
      .then(registerUploadedFontFaces)
      .catch(() => undefined);
  }, [isSoundboardRemote]);

  return (
    <I18nProvider>
      {isSoundboardRemote
        ? <AppRoutes />
        : <TimestampMonitoringProvider><AppLayout><AppRoutes /></AppLayout></TimestampMonitoringProvider>}
    </I18nProvider>
  );
}
