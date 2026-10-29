import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType, ReactNode } from "react";

const { api, navigate } = vi.hoisted(() => ({
  api: Object.fromEntries(
    [
      "getSupplierFinishedGoodsDispatchRequests",
      "getDispatch",
      "confirmFgLoading",
      "getFgLoading",
    ].map((name) => [name, vi.fn()]),
  ),
  navigate: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({ api }));
vi.mock("@/lib/auth-utils", () => ({ requireRole: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => navigate,
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/wms/app-shell", () => ({
  AppShell: ({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {actions}
      {children}
    </main>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { Route as Dispatch } from "@/routes/assembly.dispatch";

const show = (route: { options: { component: ComponentType } }) =>
  render(<route.options.component />);

const sectionalSections = Array.from({ length: 8 }, (_, i) => ({
  sub_id: `FG-2026-000001-S0${i + 1}`,
  qr_identity: `QR-SEC-0${i + 1}`,
  status: "AVAILABLE",
  gate_visit_id: null,
}));

const sectionalPickup = {
  id: "fgd-sec-1",
  request_number: "FGD-2026-001",
  supplier_name: "Supplier Prajwal",
  product_name: "motor",
  product_code: "FG-MOTO-001",
  quantity: 1,
  uom: "PCS",
  status: "READY FOR PICKUP",
  fg_id: "fg-sec-uuid-1",
  main_fg_id: "FG-2026-000001",
  sections: sectionalSections,
  dispatched_sections: 0,
  remaining_sections: 8,
  dispatch_status: "READY",
  vehicle_number: "KA21DF4578",
  driver_name: "Prajwal",
  driver_contact: "7896541237",
  gate_pass_number: "13A32E",
  gate_pass_status: "INSIDE_FACILITY",
};

describe("Sectional FG Dispatch directly on /assembly/dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("displays 3 sectional steps (Vehicle Arrival, Section Loading, Gate Exit) and allows loading sections when vehicle is inside", async () => {
    api.getSupplierFinishedGoodsDispatchRequests.mockResolvedValue([sectionalPickup]);
    show(Dispatch);

    // Open the request
    const processBtn = await screen.findByRole("button", { name: "Process" });
    await userEvent.click(processBtn);

    // Verify 3 sectional steps rendered
    expect(screen.getByText("1. Vehicle Arrival")).toBeInTheDocument();
    expect(screen.getByText("2. Section Loading")).toBeInTheDocument();
    expect(screen.getByText("3. Gate Exit")).toBeInTheDocument();

    // Verify Vehicle Inside Facility banner
    expect(
      screen.getByText(/Vehicle Inside Facility · Ready for Section Loading/),
    ).toBeInTheDocument();

    // Verify all 8 section sub-IDs rendered
    for (let i = 1; i <= 8; i++) {
      expect(screen.getByText(`FG-2026-000001-S0${i}`)).toBeInTheDocument();
    }

    // Click "Select All Available"
    const selectAllBtn = screen.getByRole("button", { name: /Select All Available \(8\)/ });
    await userEvent.click(selectAllBtn);

    // Confirm loading button should now reflect 8 selected
    const confirmBtn = screen.getByRole("button", { name: "Confirm Section Loading (8 selected)" });
    expect(confirmBtn).toBeEnabled();

    // Click confirm section loading
    api.confirmFgLoading.mockResolvedValue({ status: "READY_FOR_GATE_EXIT" });
    await userEvent.click(confirmBtn);

    expect(api.confirmFgLoading).toHaveBeenCalledWith(
      "13A32E",
      sectionalSections.map((s) => s.qr_identity),
    );
  });

  it("renders READY FOR GATE EXIT state with security instruction once vehicle is loaded", async () => {
    api.getSupplierFinishedGoodsDispatchRequests.mockResolvedValue([
      {
        ...sectionalPickup,
        gate_pass_status: "READY_FOR_GATE_EXIT",
      },
    ]);
    show(Dispatch);

    const processBtn = await screen.findByRole("button", { name: "Process" });
    await userEvent.click(processBtn);

    expect(screen.getByText("Vehicle Loaded & Ready for Departure")).toBeInTheDocument();
    expect(screen.getAllByText("READY FOR GATE EXIT").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Awaiting Gate Security confirmation of Gate Exit/)).toBeInTheDocument();
  });

  it("renders Gate Exit completed state when gate pass is CLOSED", async () => {
    api.getSupplierFinishedGoodsDispatchRequests.mockResolvedValue([
      {
        ...sectionalPickup,
        status: "COMPLETED",
        dispatch_status: "FULLY_DISPATCHED",
        dispatched_sections: 8,
        remaining_sections: 0,
        gate_pass_status: "CLOSED",
      },
    ]);
    show(Dispatch);

    const viewBtn = await screen.findByRole("button", { name: "View" });
    await userEvent.click(viewBtn);

    expect(screen.getByText("Pickup Completed · Gate Exit Recorded")).toBeInTheDocument();
    expect(screen.getByText("FULLY DISPATCHED (8/8)")).toBeInTheDocument();
  });

  it("shows Awaiting Gate Entry banner when vehicle has not yet entered the facility", async () => {
    api.getSupplierFinishedGoodsDispatchRequests.mockResolvedValue([
      {
        ...sectionalPickup,
        gate_pass_number: null,
        gate_pass_status: null,
      },
    ]);
    show(Dispatch);

    const processBtn = await screen.findByRole("button", { name: "Process" });
    await userEvent.click(processBtn);

    expect(screen.getByText("Awaiting Gate Entry")).toBeInTheDocument();
    expect(screen.getByText(/Transport Section Availability \(8\/8 available\)/)).toBeInTheDocument();
  });
});
