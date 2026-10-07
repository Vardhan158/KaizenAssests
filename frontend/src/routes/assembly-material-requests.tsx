import { createFileRoute } from "@tanstack/react-router";
import { MaterialRequestsPage } from "./warehouse.material-requests";
import { requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/assembly-material-requests")({
  beforeLoad: () => requireRole(["ASSEMBLY_MANAGER", "ADMIN"]),
  component: () => <MaterialRequestsPage mode="assembly" />,
});
