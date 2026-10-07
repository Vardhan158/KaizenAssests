import { createFileRoute } from "@tanstack/react-router";
import { OutboundGateExitPage } from "@/components/wms/outbound-gate-exit-page";

export const Route = createFileRoute("/dispatch-gate-exit")({
  component: () => <OutboundGateExitPage />,
});
