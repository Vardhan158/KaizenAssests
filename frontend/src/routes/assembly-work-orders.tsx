import { createFileRoute } from "@tanstack/react-router";
import { AssemblyModulePage } from "@/components/assembly/module-page";
import { requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/assembly-work-orders")({
  beforeLoad: () => requireRole(["ASSEMBLY_MANAGER", "ADMIN"]),
  component: () => <AssemblyModulePage section="work-orders" />,
});
