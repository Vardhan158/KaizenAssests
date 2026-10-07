import { createFileRoute } from "@tanstack/react-router";
import { OutboundGateExitPage } from "@/components/wms/outbound-gate-exit-page";

export const Route = createFileRoute("/dispatch-gate-out")({
  component: () => <OutboundGateExitPage title="Gate Out" subtitle="Release verified outbound vehicles from the warehouse gate" />,
});
