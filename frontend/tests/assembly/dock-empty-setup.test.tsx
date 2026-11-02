import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: any) => ({ options }), useSearch: () => ({}) }));
vi.mock("@/components/wms/app-shell", () => ({
  AppShell: ({ children }: any) => <div>{children}</div>, StatusBadge: () => null,
}));
vi.mock("@/lib/auth-utils", () => ({ getUserInfo: () => ({ roles: ["WAREHOUSE_MANAGER"] }) }));
vi.mock("@/lib/api-client", () => ({ api: {
  getDocks: vi.fn().mockResolvedValue([]), getDockOverviewMetrics: vi.fn().mockResolvedValue(null),
  getPendingAllocations: vi.fn().mockResolvedValue([]), getDockHistory: vi.fn().mockResolvedValue([]),
  createDock: vi.fn().mockResolvedValue({}),
} }));
import { api } from "@/lib/api-client";
import { Route } from "@/routes/dock-management";

it("lets an empty database configure its first receiving dock", async () => {
  const Page = Route.options.component as any;
  render(<Page />);
  fireEvent.click(await screen.findByRole("button", { name: "Configure dock" }));
  expect(await screen.findByLabelText("Dock code")).toHaveValue("RM-01");
  const pattern = screen.getByLabelText("Dock code").getAttribute("pattern")!;
  const validator = new RegExp(`^(?:${pattern})$`, "v");
  expect(validator.test("RM-01")).toBe(true);
  expect(validator.test("DOCK_01")).toBe(true);
  expect(validator.test("DOCK@01")).toBe(false);
  expect(screen.getByLabelText("Dock name")).toHaveValue("Raw Material Dock 01");
  fireEvent.click(screen.getByRole("button", { name: "Create dock" }));
  await waitFor(() => expect(api.createDock).toHaveBeenCalledWith(expect.objectContaining({
    dock_code: "RM-01", dock_name: "Raw Material Dock 01", direction: "INBOUND", status: "AVAILABLE",
  })));
});
