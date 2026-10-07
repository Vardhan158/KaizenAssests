import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/procurement/asns")({
  component: () => <Outlet />,
});
