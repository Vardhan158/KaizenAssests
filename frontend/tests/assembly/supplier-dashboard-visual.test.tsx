import { expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Route } from "@/routes/supplier-dashboard";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: any) => ({ options }),
  useSearch: () => ({ search: "" }),
  Link: ({ to, children, search, ...props }: any) => <a href={to} {...props}>{children}</a>,
}));
vi.mock("@/components/wms/app-shell", () => ({
  AppShell: ({ title, actions, children }: any) => <main><h1>{title}</h1>{actions}{children}</main>,
}));
vi.mock("@/lib/auth-utils", () => ({ getUserInfo: () => ({ username: "supplier" }) }));
vi.mock("@/lib/api-client", () => ({ api: {
  getAsns: vi.fn().mockResolvedValue([
    { id: "a", asn_number: "ASN-A", vehicle_number: "KA02AH2900", status: "AWAITING_DOCK", created_at: new Date().toISOString(), lines: [] },
    { id: "b", asn_number: "ASN-B", vehicle_number: "KA02AH2988", status: "SUBMITTED", created_at: new Date().toISOString(), lines: [] },
    { id: "c", asn_number: "ASN-C", vehicle_number: "KA02AH2988", status: "REJECTED", created_at: new Date().toISOString(), lines: [] },
  ]),
  getSuppliers: vi.fn().mockResolvedValue([]), getMaterialComponents: vi.fn().mockResolvedValue([]),
  getVehicles: vi.fn().mockResolvedValue([]), getDrivers: vi.fn().mockResolvedValue([]),
  getPurchaseOrders: vi.fn().mockResolvedValue([]),
} }));

it("styles the real statuses without relabelling them and keeps View working", async () => {
  const Page = Route.options.component as any;
  render(<Page />);
  const asn = await screen.findByRole("button", { name: "ASN-A" });
  const row = asn.closest("tr")!;
  expect(within(row).getByText("AWAITING DOCK")).toHaveClass("supplier-status-waiting");
  expect(screen.getByText("SUBMITTED")).toHaveClass("supplier-status-submitted");
  expect(screen.getByText("REJECTED")).toHaveClass("supplier-status-rejected");
  fireEvent.click(within(row).getByRole("button", { name: "View" }));
  expect(await screen.findByRole("dialog")).toBeVisible();
});
it("keeps search and Create ASN navigation and exposes data-backed mini charts", async () => {
  const Page = Route.options.component as any;
  render(<Page />);
  await screen.findByRole("button", { name: "ASN-A" });
  expect(screen.getByRole("link", { name: "Create ASN" })).toHaveAttribute("href", "/supplier/asns/new");
  expect(screen.getAllByRole("img", { name: /last seven days/ })).toHaveLength(3);
  fireEvent.change(screen.getByRole("textbox", { name: /Search deliveries by ASN/ }), { target: { value: "ASN-B" } });
  expect(screen.queryByRole("button", { name: "ASN-A" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "ASN-B" })).toBeVisible();
});

it("keeps Supplier Guide sections, module links and Close behaviour intact", async () => {
  const Page = Route.options.component as any;
  render(<Page />);
  await screen.findByRole("button", { name: "ASN-A" });
  fireEvent.click(screen.getByRole("button", { name: "Supplier Guide" }));
  const guide = await screen.findByRole("dialog", { name: "Supplier Guide" });
  expect(guide).toHaveAttribute("id", "supplier-asn-help-dialog");
  expect(guide.querySelectorAll("details")).toHaveLength(5);
  expect(guide.querySelector("details")).toHaveAttribute("open");
  expect(within(guide).getAllByRole("link", { name: /Go to Module: ASN Management/ })[0]).toHaveAttribute("href", "/supplier/asns");
  expect(within(guide).queryByRole("link", { name: "Create ASN" })).not.toBeInTheDocument();
  fireEvent.click(within(guide).getAllByRole("button", { name: "Close" })[0]);
  expect(screen.queryByRole("dialog", { name: "Supplier Guide" })).not.toBeInTheDocument();
});
