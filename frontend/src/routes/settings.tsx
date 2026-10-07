import { createFileRoute } from "@tanstack/react-router";
import { Settings as SettingsIcon } from "lucide-react";
import { AppShell } from "@/components/wms/app-shell";
import { ModulePlaceholder } from "@/components/wms/module-placeholder";
import { requireAuth } from "@/lib/auth-utils";

export const Route = createFileRoute("/settings")({
  beforeLoad: () => requireAuth(),
  head: () => ({
    meta: [
      { title: "Settings · KaizenX" },
      {
        name: "description",
        content: "Notification rules, escalation matrix, shift configuration and user preferences.",
      },
      { property: "og:title", content: "Settings · KaizenX" },
      {
        property: "og:description",
        content: "Escalation matrix, shift configuration and notification preferences.",
      },
    ],
  }),
  component: () => (
    <AppShell
      title="Settings"
      subtitle="Notification rules, escalation matrix, shifts and preferences"
    >
      <ModulePlaceholder
        icon={SettingsIcon}
        title="Workspace settings"
        description="Escalation thresholds and notification routing are configured here in the full product."
      />
    </AppShell>
  ),
});
