import React from "react";
import { AppRoutes } from "./router";
import { AppLayout } from "../components/layout/AppLayout";
import { I18nProvider } from "../i18n/I18nProvider";
import { fetchSystemFonts } from "../services/httpApi";
import { useConnectionStore } from "../stores/connectionStore";
import { applyAppFontFamily, readAppFontFamily, registerUploadedFontFaces } from "../utils/appFont";

export function App(): React.ReactElement {
  const connect = useConnectionStore((state) => state.connect);

  React.useEffect(() => connect(), [connect]);
  React.useEffect(() => {
    applyAppFontFamily(readAppFontFamily());
    void fetchSystemFonts()
      .then(registerUploadedFontFaces)
      .catch(() => undefined);
  }, []);

  return (
    <I18nProvider>
      <AppLayout>
        <AppRoutes />
      </AppLayout>
    </I18nProvider>
  );
}
