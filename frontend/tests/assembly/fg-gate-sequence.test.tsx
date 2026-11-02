import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  getSupplierFinishedGoodsDispatchRequests: vi.fn(),
  getFinishedGoodsPickupGatePass: vi.fn(),
  completeFinishedGoodsPickupGateExit: vi.fn(),
  createFinishedGoodsPickupGateEntry: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({ api: mocks }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useSearch: () => ({ search: "" }),
}));
vi.mock("@/components/wms/app-shell", () => ({
  AppShell: ({ children, actions }: any) => <main>{actions}{children}</main>,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { Route } from "@/routes/gate.finished-goods-pickup";

async function lookup(status: string) {
  mocks.getFinishedGoodsPickupGatePass.mockResolvedValue({
    gate_pass_number: "ABC123",
    status,
    request_number: "FGD-1",
    vehicle_number: "KA01AB1234",
    driver_name: "Ravi Kumar",
    fg_id: "fg-1",
    loaded_sections:
      status === "READY_FOR_GATE_EXIT"
        ? [{ sub_id: "FG-0001-S01", qr_identity: "SECTION-1", status: "LOADED" }]
        : [],
  });
  const Page = (Route as any).options.component;
  render(<Page />);
  fireEvent.click(await screen.findByRole("button", { name: "Exit Vehicle" }));
  fireEvent.change(screen.getByLabelText("Gate Pass Number"), { target: { value: "ABC123" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify", exact: true }));
}

describe("FG gate entry/loading/exit order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSupplierFinishedGoodsDispatchRequests.mockResolvedValue([]);
    mocks.completeFinishedGoodsPickupGateExit.mockResolvedValue({
      request_number: "FGD-1",
      exited_at: new Date().toISOString(),
    });
  });

  it("blocks Gate Exit until Assembly confirms loading", async () => {
    await lookup("INSIDE_FACILITY");
    await screen.findByText("Assembly must confirm loading before Gate Exit.");
    fireEvent.click(screen.getByRole("checkbox", { name: /Packing list and dispatch documents/ }));
    expect(screen.getByRole("button", { name: "Confirm Exit" })).toBeDisabled();
    expect(mocks.completeFinishedGoodsPickupGateExit).not.toHaveBeenCalled();
  });

  it("allows Security to exit vehicle using original pass without scanning sections", async () => {
    await lookup("READY_FOR_GATE_EXIT");
    await screen.findByText(/Loaded Transport Sections/);
    expect(screen.getByText("✓ FG-0001-S01")).toBeInTheDocument();
    expect(screen.queryByLabelText("Verify loaded section")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /Packing list and dispatch documents/ }));
    const confirmBtn = screen.getByRole("button", { name: "Confirm Exit" });
    expect(confirmBtn).toBeEnabled();
    fireEvent.click(confirmBtn);

    await waitFor(() =>
      expect(mocks.completeFinishedGoodsPickupGateExit).toHaveBeenCalledWith(
        "ABC123",
        expect.objectContaining({
          vehicle_number: "KA01AB1234",
          driver_name: "Ravi Kumar",
          documents_verified: true,
        }),
      ),
    );
    expect(mocks.createFinishedGoodsPickupGateEntry).not.toHaveBeenCalled();
  });
});
