import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: any) => ({ options }) }));
vi.mock("@/components/wms/app-shell", () => ({ AppShell: ({ children, actions }: any) => <main>{actions}{children}</main>, StatusBadge: () => null }));
vi.mock("@/lib/api-client", () => ({ api: {
  getSupplierFinishedGoodsDispatchRequests: vi.fn().mockResolvedValue([]),
  getAssemblyFinishedGoods: vi.fn().mockResolvedValue([
    { product_code: "MOTOR", product_name: "Motor", quantity: 3, uom: "PCS", status: "AVAILABLE" },
    { product_code: "EMPTY", product_name: "Empty", quantity: 0, uom: "PCS", status: "AVAILABLE" },
  ]),
} }));
import { Route } from "@/routes/supplier.dispatch";

const originalScroll = HTMLElement.prototype.scrollIntoView;
beforeAll(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterAll(() => { HTMLElement.prototype.scrollIntoView = originalScroll; });

it("shows available stock and allows selecting and clearing a finished good", async () => {
  const Page = Route.options.component as any;
  render(<Page />);
  fireEvent.click(screen.getByRole("button", { name: "Create Dispatch" }));
  const trigger = await screen.findByRole("combobox", { name: "Finished good *" });
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: "Motor (3 PCS)" }));
  expect(trigger).toHaveTextContent("Motor (3 PCS)");
  fireEvent.click(trigger);
  expect(screen.queryByRole("option", { name: /Empty/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: "Select a finished good" }));
  expect(trigger).toHaveTextContent("Select a finished good");
});
