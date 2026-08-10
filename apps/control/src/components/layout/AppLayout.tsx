import React from "react";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps): React.ReactElement {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  return (
    <div className="app-shell">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="content-shell">
        <Header onMenuClick={() => setSidebarOpen((current) => !current)} />
        <main className="page-shell">{children}</main>
      </div>
    </div>
  );
}
