import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { localDateInput } from "@/lib/input-validation";
import type { ComponentType, ReactNode } from "react";

const { api, navigate } = vi.hoisted(() => ({
  api: Object.fromEntries(
    [
      "getAssemblyDashboard",
      "getAssemblyMaterialRequests",
      "getAssemblyAvailableMaterials",
      "getAssemblyFinishedGoodsInventorySummary",
      "getAssemblyProducts",
      "getProductBOM",
      "createAssemblyMaterialRequest",
      "getMaterialComponents",
      "getAssemblyMaterialRequestDetail",
      "confirmAssemblyMaterialReceipt",
      "getAssemblyProductionOrders",
      "startAssemblyProduction",
      "completeAssemblyProduction",
      "getAssemblyMaterialConsumption",
      "verifyAssemblyMaterialQr",
      "recordAssemblyMaterialConsumption",
      "getAssemblyQualityInspections",
      "performAssemblyQualityInspection",
      "getAssemblyFinishedGoods",
      "getSupplierFinishedGoodsDispatchRequests",
      "allocateSupplierFinishedGoodsFifo",
      "getDispatch",
      "startDispatchPicking",
      "pickDispatchItems",
      "startDispatchPacking",
      "packDispatchItems",
      "scanAllocatedFinishedGoods",
      "scanDispatchPackage",
      "startDispatchLoading",
      "verifyDispatchLoading",
      "verifyDispatchFinal",
      "getFgLoading",
      "confirmFgLoading",
    ].map((name) => [name, vi.fn()]),
  ),
  navigate: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ api }));
vi.mock("@/lib/auth-utils", () => ({ requireRole: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => navigate,
  useSearch: () => ({}),
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/wms/app-shell", () => ({
  AppShell: ({
    title,
    children,
    actions,
  }: {
    title: string;
    children: ReactNode;
    actions?: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      {actions}
      {children}
    </main>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { Route as Dashboard } from "@/routes/assembly-dashboard";
import { Route as Requests } from "@/routes/assembly.material-requests";
import { Route as Production } from "@/routes/assembly.production";
import { Route as Quality } from "@/routes/assembly.quality";
import { Route as Dispatch } from "@/routes/assembly.dispatch";
import { Route as FinishedGoods } from "@/routes/assembly.finished-goods";

const item = {
  material_code: "MAT-BOLT",
  material_name: "Steel bolt",
  quantity: 12,
  uom: "PCS",
  received_quantity: 3,
};
const request = (id: string, status: string) => ({
  id,
  request_number: `MR-${id}`,
  status,
  product_name: `Pump ${id}`,
  product_code: `PUMP-${id}`,
  order_number: `ASM-${id}`,
  items_count: 1,
  warehouse_id: "WH-1",
  priority: "NORMAL",
  required_date: "2026-10-20",
  created_at: "2026-10-16",
  target_quantity: 12,
  uom: "PCS",
  items: [{ ...item }],
  issue_transaction: { items: [{ material_code: "MAT-BOLT", issued_quantity: 8 }] },
});
const productionOrder = {
  id: "prod-1",
  order_number: "ASM-101",
  product_name: "Water pump",
  product_code: "PUMP",
  status: "IN_PRODUCTION",
  target_quantity: 10,
  completed_quantity: 0,
  uom: "PCS",
  can_start: false,
  can_complete: true,
  assembly_steps: [],
  material_status: "MATERIAL_READY",
};
function show(route: unknown) {
  const Component = (route as { options: { component: ComponentType } }).options.component;
  return render(<Component />);
}
beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of Object.values(api)) mock.mockResolvedValue([]);
  api.getAssemblyDashboard.mockResolvedValue({
    kpis: { in_production: 7, qc_pending: 4, material_pending: 2 },
    active_orders: [],
    needs_attention: [],
    recent_activity: [],
  });
  api.getAssemblyFinishedGoodsInventorySummary.mockResolvedValue({ available: 23 });
  api.getAssemblyMaterialRequestDetail.mockImplementation(async (id) => request(id, "PENDING"));
  api.getAssemblyMaterialRequests.mockResolvedValue([
    request("1", "PENDING"),
    request("2", "APPROVED"),
    request("3", "PICKING"),
    request("4", "ISSUED"),
    request("5", "MATERIAL_READY"),
  ]);
});

describe("Assembly dashboard", () => {
  it("displays API-backed metrics without Manage Orders or the removed overview", async () => {
    show(Dashboard);
    expect(await screen.findByText("23")).toBeInTheDocument();
    for (const value of ["5", "7", "4"]) expect(screen.getByText(value)).toBeInTheDocument();
    expect(screen.queryByText("Manage Orders")).not.toBeInTheDocument();
    expect(screen.queryByText("Assembly overview")).not.toBeInTheDocument();
  });
  it("loads all dashboard sources without the removed Refresh button", async () => {
    show(Dashboard);
    await screen.findByText("23");
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
    expect(api.getAssemblyDashboard).toHaveBeenCalledTimes(1);
    expect(api.getAssemblyMaterialRequests).toHaveBeenCalledTimes(1);
    expect(api.getAssemblyFinishedGoodsInventorySummary).toHaveBeenCalledTimes(1);
  });
  it("reports a partial API failure without showing a fake inventory zero", async () => {
    api.getAssemblyFinishedGoodsInventorySummary.mockRejectedValue(new Error("offline"));
    show(Dashboard);
    expect(await screen.findByRole("alert")).toHaveTextContent("finished goods availability");
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("Production Status")).toBeInTheDocument();
  });
  it("navigates to material requests", async () => {
    show(Dashboard);
    await screen.findByText("23");
    await userEvent.click(screen.getAllByRole("button", { name: "New Material Request" })[0]!);
    expect(navigate).toHaveBeenCalledWith({ to: "/assembly/material-requests" });
  });
});

describe("Material request queue", () => {
  it("searches material details and keeps global totals when filtering", async () => {
    show(Requests);
    await screen.findByText("MR-1");
    await userEvent.click(screen.getByRole("button", { name: "Picking (1)" }));
    expect(screen.getByText("MR-3")).toBeInTheDocument();
    expect(screen.queryByText("MR-1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All (5)" })).toBeInTheDocument();
    expect(api.getAssemblyMaterialRequests).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "All (5)" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search requisitions and materials" }), {
      target: { value: "no-such-material" },
    });
    expect(screen.queryByText("MR-1")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search requisitions and materials" }), {
      target: { value: "Steel bolt" },
    });
    expect(screen.getByText("MR-1")).toBeInTheDocument();
  }, 15000);
  it("keeps the queue compact and shows material quantities in Details", async () => {
    show(Requests);
    await screen.findByText("MR-1");
    expect(
      screen.queryByRole("list", { name: "Material request workflow" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Request ID",
      "Product",
      "Quantity",
      "Required Date",
      "Status",
      "Actions",
    ]);
    expect(screen.queryByRole("button", { name: /^Approved \(/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Rejected \/ Cancelled \(/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("MR-2")).toBeInTheDocument();
    expect(
      screen.queryByRole("table", { name: "Material quantities for MR-1" }),
    ).not.toBeInTheDocument();
    const row = screen.getByText("MR-1").closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: "Details" }));
    const table = await screen.findByRole("table", { name: "Material quantities for MR-1" });
    for (const value of ["12 PCS", "8 PCS", "3 PCS"])
      expect(within(table).getByText(value)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("ASM-1");
  });
  it("opens the creation dialog", async () => {
    show(Requests);
    await screen.findByText("MR-1");
    await userEvent.click(screen.getByRole("button", { name: "New Material Request" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Request Raw Materials from Warehouse",
    );
  });
  it.each(["", "2000-01-01"])(
    "blocks invalid completion date %s with an inline error",
    async (value) => {
      api.getAssemblyProducts.mockResolvedValue([
        { id: "p1", product_code: "PUMP", product_name: "Pump" },
      ]);
      api.getProductBOM.mockResolvedValue({
        product_code: "PUMP",
        target_quantity: 10,
        bom_number: "BOM-1",
        materials: [item],
      });
      show(Requests);
      await screen.findByText("MR-1");
      await userEvent.click(screen.getByRole("button", { name: "New Material Request" }));
      const input = screen.getByLabelText("Required Completion Date *");
      expect(input).toBeRequired();
      expect(input).toHaveAttribute("min", localDateInput());
      fireEvent.change(input, { target: { value } });
      expect(await screen.findByRole("alert")).toHaveTextContent(
        value ? "today or later" : "is required",
      );
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Submit Request to Warehouse" })).toBeEnabled(),
      );
      // Direct submit exercises the handler even when native validation is bypassed.
      fireEvent.submit(input.closest("form")!);
      expect(api.createAssemblyMaterialRequest).not.toHaveBeenCalled();
      expect(input).toHaveAttribute("aria-invalid", "true");
      fireEvent.change(input, { target: { value: localDateInput() } });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      api.createAssemblyMaterialRequest.mockResolvedValue({
        request_number: "MR-new",
        product_name: "Pump",
        target_quantity: 10,
        uom: "PCS",
      });
      fireEvent.submit(input.closest("form")!);
      await waitFor(() =>
        expect(api.createAssemblyMaterialRequest).toHaveBeenCalledWith(
          expect.objectContaining({ required_date: localDateInput() }),
        ),
      );
    },
  );
  it("confirms physical receipt through the existing API", async () => {
    api.getAssemblyMaterialRequestDetail.mockResolvedValue({
      ...request("4", "ISSUED"),
      items: [{ ...item, issued_quantity: 8, received_quantity: 8 }],
    });
    api.confirmAssemblyMaterialReceipt.mockResolvedValue({});
    show(Requests);
    await screen.findByText("MR-4");
    await userEvent.click(screen.getByRole("button", { name: "Confirm Receipt" }));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: "Confirm Physical Receipt" }));
    await waitFor(() =>
      expect(api.confirmAssemblyMaterialReceipt).toHaveBeenCalledWith("4", {
        received_items: [
          { material_code: "MAT-BOLT", received_quantity: 8, material_scan: undefined },
        ],
        remarks: "",
      }),
    );
  });
  it("shows an API error instead of zero KPIs", async () => {
    api.getAssemblyMaterialRequests.mockRejectedValue(new Error("Warehouse unavailable"));
    show(Requests);
    expect(await screen.findByRole("alert")).toHaveTextContent("Warehouse unavailable");
    expect(screen.getAllByText("Unavailable")).toHaveLength(4);
  });
});

describe("Production, quality and finished goods", () => {
  it("matches persisted QC aliases and keeps global counts while filtering", async () => {
    const base = {
      product_name: "Pump",
      product_code: "PUMP",
      produced_quantity: 10,
      uom: "PCS",
      passed_quantity: 10,
      failed_quantity: 0,
      rework_quantity: 0,
      held_quantity: 0,
      can_inspect: false,
      order_status: "COMPLETED",
    };
    api.getAssemblyQualityInspections.mockResolvedValue([
      {
        ...base,
        order_id: "qc-pass",
        order_number: "ASM-PASS",
        qc_status: "QC_APPROVED",
        inspected_by: "Asha Kumar",
      },
      {
        ...base,
        order_id: "qc-pending",
        order_number: "ASM-PENDING",
        qc_status: "PENDING_INSPECTION",
        can_inspect: true,
        order_status: "QC_PENDING",
      },
      {
        ...base,
        order_id: "qc-partial",
        order_number: "ASM-PARTIAL",
        qc_status: "PARTIALLY_APPROVED",
        passed_quantity: 6,
        failed_quantity: 4,
      },
      {
        ...base,
        order_id: "qc-rework",
        order_number: "ASM-REWORK",
        qc_status: "PARTIALLY_APPROVED",
        passed_quantity: 8,
        rework_quantity: 2,
        order_status: "REWORK_REQUIRED",
        can_inspect: true,
      },
    ]);
    show(Quality);
    await userEvent.click(await screen.findByRole("button", { name: "QC Passed (1)" }));
    expect(screen.getByText("ASM-PASS")).toBeInTheDocument();
    expect(screen.queryByText("ASM-PENDING")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View FG Label/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Re-inspect" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All Inspections (4)" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Partial (1)" }));
    expect(screen.getByText("Partially Approved")).toBeInTheDocument();
    expect(screen.getByText("ASM-PARTIAL")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Rework (1)" }));
    expect(screen.getByText("ASM-REWORK")).toBeInTheDocument();
    expect(api.getAssemblyQualityInspections).toHaveBeenCalledTimes(1);
  });
  it("keeps production status totals stable across filters", async () => {
    api.getAssemblyProductionOrders.mockResolvedValue([
      {
        ...productionOrder,
        id: "p-ready",
        order_number: "ASM-READY",
        status: "MATERIAL_READY",
        can_start: true,
        can_complete: false,
      },
      {
        ...productionOrder,
        id: "p-done",
        order_number: "ASM-DONE",
        status: "COMPLETED",
        produced_quantity: 10,
        can_start: false,
        can_complete: false,
      },
    ]);
    show(Production);
    await userEvent.click(await screen.findByRole("button", { name: "Ready to Start (1)" }));
    expect(screen.getByText("ASM-READY")).toBeInTheDocument();
    expect(screen.queryByText("ASM-DONE")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All Orders (2)" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "QC / Completed (1)" }));
    expect(screen.getByText("ASM-DONE")).toBeInTheDocument();
    expect(api.getAssemblyProductionOrders).toHaveBeenCalledTimes(1);
  });

  it("starts a ready production order", async () => {
    api.getAssemblyProductionOrders.mockResolvedValue([
      { ...productionOrder, status: "READY", can_start: true, can_complete: false },
    ]);
    api.startAssemblyProduction.mockResolvedValue({ message: "Started" });
    show(Production);
    await screen.findByText("ASM-101");
    await userEvent.click(screen.getByRole("button", { name: /Start Production/i }));
    await waitFor(() => expect(api.startAssemblyProduction).toHaveBeenCalledWith("prod-1"));
  });
  it("records production output and routes it to QC", async () => {
    api.getAssemblyProductionOrders.mockResolvedValue([productionOrder]);
    api.completeAssemblyProduction.mockResolvedValue({});
    show(Production);
    await screen.findByText("ASM-101");
    await userEvent.click(screen.getByRole("button", { name: /Complete Production/i }));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: "Complete & Route to QC" }));
    await waitFor(() =>
      expect(api.completeAssemblyProduction).toHaveBeenCalledWith("prod-1", {
        produced_quantity: 10,
      }),
    );
  });
  it("opens verified consumption for traceability orders and shows separate history", async () => {
    api.getAssemblyProductionOrders.mockResolvedValue([
      { ...productionOrder, traceability_required: true },
    ]);
    api.getAssemblyMaterialConsumption.mockResolvedValue({
      assembly_order_id: "prod-1",
      traceability_required: true,
      traceability_status: "INCOMPLETE",
      missing_material_codes: ["MAT-BOLT"],
      can_complete: false,
      events: [],
    });
    api.verifyAssemblyMaterialQr.mockResolvedValue({
      material_code: "MAT-BOLT",
      material_name: "Steel bolt",
      grn_batch_id: "batch-1",
      batch_number: "LOT-1",
      material_qr: "QR-1",
      quantity_issued: 20,
      quantity_received: 20,
      quantity_already_consumed: 0,
      remaining_quantity: 20,
      uom: "PCS",
      verified: true,
    });
    api.recordAssemblyMaterialConsumption.mockResolvedValue({ consumed_quantity: 4, uom: "PCS" });
    show(Production);
    await screen.findByText("ASM-101");
    await userEvent.click(screen.getByRole("button", { name: /Record Material Consumption/i }));
    expect(
      await screen.findByText("No verified consumption events recorded for this order."),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Scan Material QR"), "QR-1");
    await userEvent.click(screen.getByRole("button", { name: "Verify Material" }));
    expect(await screen.findByText("Original material QR verified")).toBeInTheDocument();
    expect(screen.getByText("LOT-1")).toBeInTheDocument();
    expect(screen.getAllByText("20 PCS")).toHaveLength(3);
  });
  it("submits quality quantities through the existing API", async () => {
    api.getAssemblyQualityInspections.mockResolvedValue([
      {
        id: "qc-1",
        order_id: "prod-1",
        order_number: "ASM-101",
        product_name: "Water pump",
        product_code: "PUMP",
        produced_quantity: 10,
        qc_status: "PENDING_INSPECTION",
        can_inspect: true,
        uom: "PCS",
        passed_quantity: 0,
        failed_quantity: 0,
        rework_quantity: 0,
        held_quantity: 0,
      },
    ]);
    api.performAssemblyQualityInspection.mockResolvedValue({});
    show(Quality);
    await screen.findByText("ASM-101");
    await userEvent.click(screen.getByRole("button", { name: "Perform QC" }));
    const submit = await screen.findByRole("button", { name: "Submit QC Certification" });
    expect(submit).toBeDisabled();
    const name = screen.getByLabelText("Quality Engineer Name *");
    await userEvent.type(name, "123");
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Quality check performed by authorized person" }),
    );
    expect(submit).toBeDisabled();
    await userEvent.clear(name);
    await userEvent.tab();
    expect(screen.getByText(/Enter a valid quality engineer name/)).toBeInTheDocument();
    await userEvent.type(name, "Asha Kumar");
    expect(submit).toBeEnabled();
    expect(screen.queryByText("Rework Qty")).not.toBeInTheDocument();
    expect(screen.queryByText("Failed / Scrap")).not.toBeInTheDocument();
    expect(screen.queryByText("Held Qty")).not.toBeInTheDocument();
    const quantities = screen.getAllByRole("spinbutton");
    expect(quantities).toHaveLength(1);
    fireEvent.change(quantities[0], { target: { value: "9" } });
    expect(submit).toBeDisabled();
    fireEvent.change(quantities[0], { target: { value: "10" } });
    await userEvent.click(submit);
    await waitFor(() =>
      expect(api.performAssemblyQualityInspection).toHaveBeenCalledWith({
        order_id: "prod-1",
        inspector_name: "Asha Kumar",
        authorized_person_confirmed: true,
        passed_quantity: 10,
        failed_quantity: 0,
        rework_quantity: 0,
        held_quantity: 0,
      }),
    );
  });
  it("shows persisted finished-goods batch quantities and QC details", async () => {
    api.getAssemblyFinishedGoods.mockResolvedValue([
      {
        id: "fg-1",
        order_number: "ASM-FG-1",
        product_code: "PUMP",
        product_name: "Water pump",
        quantity: 8,
        produced_quantity: 12,
        available_quantity: 5,
        reserved_quantity: 3,
        dispatched_quantity: 4,
        uom: "PCS",
        batch_number: "FG-BATCH-1",
        status: "QC_APPROVED",
        qc_status: "QC_APPROVED",
        inspected_by: "Asha Kumar",
        manufacturing_date: "2026-10-16",
        location_code: "ASSEMBLY-STORAGE-01",
      },
    ]);
    show(FinishedGoods);
    const batch = await screen.findByText("Water pump");
    const row = within(batch.closest("tr")!);
    const quantities = row.getAllByRole("cell").map((cell) => cell.textContent);
    for (const qty of ["12 PCS", "5 PCS"]) expect(quantities).toContain(qty);
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Product",
      "Produced",
      "Available",
      "Reserved",
      "Dispatched",
      "Status",
      "Actions",
    ]);
    expect(row.queryByText("ASM-FG-1")).not.toBeInTheDocument();
    expect(row.queryByRole("button", { name: "View/Print QR" })).not.toBeInTheDocument();
    await userEvent.click(row.getByRole("button", { name: "View Details" }));
    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.click(dialog.getByRole("button", { name: "Batch details" }));
    for (const value of ["ASM-FG-1", "3 PCS", "4 PCS", "Asha Kumar", "ASSEMBLY-STORAGE-01"]) {
      expect(dialog.getAllByText(value).length).toBeGreaterThan(0);
    }
    expect(dialog.getByText("Manufacturing Date")).toBeInTheDocument();
    await userEvent.click(dialog.getAllByRole("button", { name: "Close" })[0]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("shows one product row, preserves batch details, and updates zero stock after restocking", async () => {
    const batches = [1, 2].map((number) => ({
      id: `fg-${number}`,
      batch_number: `BATCH-${number}`,
      manufacturing_date: number === 1 ? "2026-10-17T10:00:00" : "2026-10-16T10:00:00",
      posted_at: number === 1 ? "2026-10-17T11:00:00" : "2026-10-18T11:00:00",
      order_number: `ASM-${number}`,
      product_code: "PUMP",
      product_name: "Water pump",
      quantity: 2,
      produced_quantity: 5,
      available_quantity: 0,
      reserved_quantity: 2,
      dispatched_quantity: 3,
      uom: "PCS",
      status: "QC_APPROVED",
    }));
    const product = {
      ...batches[0],
      batches,
      quantity: 4,
      produced_quantity: 10,
      available_quantity: 0,
      reserved_quantity: 4,
      dispatched_quantity: 6,
      status: "OUT_OF_STOCK",
    };
    api.getAssemblyFinishedGoods.mockResolvedValue([product]);
    show(FinishedGoods);
    expect(await screen.findByText("OUT OF STOCK")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getAllByRole("cell").map((cell) => cell.textContent)).toContain("10 PCS");
    expect(screen.queryByText("BATCH-2")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "View Details" }));
    const popup = within(await screen.findByRole("dialog"));
    expect(popup.getByText("BATCH-1")).toBeInTheDocument();
    expect(popup.getByText("BATCH-2")).toBeInTheDocument();
    expect(popup.getAllByRole("button", { name: "View/Print QR" })).toHaveLength(2);
    expect(popup.getAllByRole("row")[1]).toHaveTextContent("BATCH-1");
    expect(popup.getAllByRole("row")[2]).toHaveTextContent("BATCH-2");
    for (const button of popup.getAllByRole("button", { name: "View/Print QR" }))
      expect(button).toBeEnabled();
    await userEvent.click(popup.getAllByRole("button", { name: "Close" })[0]);
    api.getAssemblyFinishedGoods.mockResolvedValue([
      { ...product, available_quantity: 3, status: "AVAILABLE" },
    ]);
    fireEvent.focus(window);
    expect(await screen.findByText("AVAILABLE")).toBeInTheDocument();
    expect(screen.queryByText("OUT OF STOCK")).not.toBeInTheDocument();
    expect(api.getAssemblyFinishedGoods).toHaveBeenCalledWith({ group_by: "product" });
  });
  it("shows the finished-goods empty state from an empty API result", async () => {
    show(FinishedGoods);
    expect(await screen.findByText("No Finished Goods in storage yet")).toBeInTheDocument();
    expect(api.getAssemblyFinishedGoods).toHaveBeenCalled();
  });
});

describe("Assembly FG dispatch", () => {
  const pickup = {
    id: "pickup-1",
    request_number: "FGD-101",
    supplier_name: "Supplier One",
    product_name: "Water pump",
    product_code: "PUMP",
    quantity: 10,
    uom: "PCS",
    status: "PENDING_ASSEMBLY",
    vehicle_number: "MH12AB1234",
    driver_name: "Ravi Kumar",
    driver_contact: "9876543210",
    gate_pass_number: "GP-101",
    gate_pass_status: "INSIDE_FACILITY",
    allocated_batches: [
      {
        finished_goods_id: "fg-1",
        batch_number: "FG-BATCH-1",
        quantity: 10,
        status: "ALLOCATED",
        qr_code: "FG-QR-1",
      },
    ],
  };
  it("shows backend FCFS priority and blocks a newer request", async () => {
    api.getSupplierFinishedGoodsDispatchRequests.mockResolvedValue([
      {
        ...pickup,
        id: "newer",
        request_number: "FGD-NEW",
        priority_rank: 2,
        next_to_process: false,
        allocation_eligible: true,
        requested_on: "2026-10-16T10:00:00",
      },
      {
        ...pickup,
        id: "older",
        request_number: "FGD-OLD",
        priority_rank: 1,
        next_to_process: true,
        allocation_eligible: true,
        requested_on: "2026-10-16T09:00:00",
      },
    ]);
    show(Dispatch);
    await screen.findByText("Next to Process");
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("FGD-OLD");
    expect(rows[2]).toHaveTextContent("FGD-NEW");
    expect(screen.queryByRole("columnheader", { name: "Requested On" })).not.toBeInTheDocument();
    expect(within(rows[1]).getByRole("button", { name: "Process" })).toBeInTheDocument();
    await userEvent.click(within(rows[2]).getByRole("button", { name: "View" }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Request, quantity/ }));
    expect(screen.getByRole("button", { name: "Verify & Allocate" })).toBeDisabled();
    expect(
      screen.getByText(/An older eligible request must be allocated first/),
    ).toBeInTheDocument();
    expect(api.allocateSupplierFinishedGoodsFifo).not.toHaveBeenCalled();
  });
  it.each(["READY_FOR_GATE_EXIT", "DISPATCHED", "COMPLETED", "CANCELLED"])(
    "shows View for %s requests without assigning pending priority",
    async (status) => {
      api.getSupplierFinishedGoodsDispatchRequests.mockResolvedValue([
        { ...pickup, status, dispatch_status: status, next_to_process: false, priority_rank: null },
      ]);
      show(Dispatch);
      expect(await screen.findByRole("button", { name: "View" })).toBeInTheDocument();
      expect(screen.queryByText("Next to Process")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Process" })).not.toBeInTheDocument();
    },
  );
  it.each([false, true])(
    "uses backend Gate Exit confirmation for completion: %s",
    async (confirmed) => {
      api.getSupplierFinishedGoodsDispatchRequests.mockResolvedValue([
        {
          ...pickup,
          status: "DISPATCHED",
          dispatch_status: "DISPATCHED",
          priority_rank: 1,
          next_to_process: false,
          gate_exit_confirmed: confirmed,
          workflow_status: confirmed ? "COMPLETED" : "AWAITING_GATE_EXIT",
        },
      ]);
      show(Dispatch);
      await userEvent.click(await screen.findByRole("button", { name: "View" }));
      expect(screen.getByText("#1")).toBeInTheDocument();
      if (confirmed) expect(screen.getByText(/Pickup completed. Gate Exit/)).toBeInTheDocument();
      else expect(screen.getByText(/Awaiting Gate Security confirmation/)).toBeInTheDocument();
      expect(screen.queryByText("Next to Process")).not.toBeInTheDocument();
    },
  );
  it("filters every stage using backend classification and refreshes after Gate Exit", async () => {
    const records = [
      {
        ...pickup,
        id: "pending",
        request_number: "FGD-PENDING",
        processing_group: "0",
        workflow_status: "PENDING_ASSEMBLY",
      },
      {
        ...pickup,
        id: "picking",
        request_number: "FGD-PICKING",
        processing_group: "1",
        workflow_status: "STOCK_RESERVED",
      },
      {
        ...pickup,
        id: "loading",
        request_number: "FGD-LOADING",
        processing_group: "2",
        workflow_status: "READY_FOR_GATE_EXIT",
      },
      {
        ...pickup,
        id: "done",
        request_number: "FGD-DONE",
        processing_group: "COMPLETE",
        workflow_status: "COMPLETED",
        gate_exit_confirmed: true,
      },
      {
        ...pickup,
        id: "cancelled",
        request_number: "FGD-CANCELLED",
        processing_group: "COMPLETE",
        workflow_status: "CANCELLED",
      },
    ];
    api.getSupplierFinishedGoodsDispatchRequests.mockResolvedValue(records);
    show(Dispatch);
    await screen.findByText("FGD-PENDING");
    for (const [label, expected] of [
      ["Awaiting verification", ["FGD-PENDING"]],
      ["Picking & Packing", ["FGD-PICKING"]],
      ["Loading", ["FGD-LOADING"]],
      ["Completed / Cancelled", ["FGD-DONE", "FGD-CANCELLED"]],
    ] as const) {
      await userEvent.click(screen.getByRole("button", { name: label }));
      for (const row of records)
        expect(Boolean(screen.queryByText(row.request_number))).toBe(
          (expected as readonly string[]).includes(row.request_number),
        );
    }
    api.getSupplierFinishedGoodsDispatchRequests.mockResolvedValue(
      records.map((row) =>
        row.id === "loading"
          ? {
              ...row,
              processing_group: "COMPLETE",
              gate_exit_confirmed: true,
              workflow_status: "COMPLETED",
            }
          : row,
      ),
    );
    fireEvent.focus(window);
    expect(await screen.findByText("FGD-LOADING")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "All" }));
    for (const row of records) expect(screen.getByText(row.request_number)).toBeInTheDocument();
  });
  it("verifies only the selected request before allocating FIFO", async () => {
    api.getSupplierFinishedGoodsDispatchRequests.mockResolvedValue([pickup]);
    show(Dispatch);
    await userEvent.click(await screen.findByRole("button", { name: /^(Process|View)$/ }));
    const allocate = screen.getByRole("button", { name: "Verify & Allocate" });
    expect(allocate).toBeDisabled();
    expect(api.allocateSupplierFinishedGoodsFifo).not.toHaveBeenCalled();
    expect(screen.getByText("MH12AB1234")).toBeInTheDocument();
    expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Assign Vehicle|Assign Driver/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /Request, quantity/ }));
    await userEvent.click(allocate);
    await waitFor(() =>
      expect(api.allocateSupplierFinishedGoodsFifo).toHaveBeenCalledWith("pickup-1"),
    );
  });
  it("resumes packed requests at Loading and blocks loading before Gate Entry", async () => {
    api.getSupplierFinishedGoodsDispatchRequests.mockResolvedValue([
      {
        ...pickup,
        status: "ALLOCATED",
        dispatch_id: "d1",
        dispatch_status: "PACKED",
        gate_pass_status: undefined,
      },
    ]);
    api.getDispatch.mockResolvedValue({
      id: "d1",
      status: "PACKED",
      items: [{ quantity_ordered: 10, quantity_packed: 10, quantity_loaded: 0 }],
    });
    show(Dispatch);
    await userEvent.click(await screen.findByRole("button", { name: /^(Process|View)$/ }));
    expect(await screen.findByRole("button", { name: "Confirm Loading" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Confirm Packing" })).not.toBeInTheDocument();
    expect(screen.getByText(/Awaiting Gate Entry/)).toBeInTheDocument();
    expect(api.allocateSupplierFinishedGoodsFifo).not.toHaveBeenCalled();
  });
  it("completes QR verification, picking, packing and loading through existing APIs", async () => {
    let state = {
      id: "d1",
      status: "STOCK_RESERVED",
      items: [
        {
          id: "di1",
          material_code: "PUMP",
          quantity_ordered: 10,
          quantity_picked: 0,
          quantity_packed: 0,
          quantity_loaded: 0,
          package_number: "",
        },
      ],
    };
    api.getSupplierFinishedGoodsDispatchRequests.mockImplementation(async () => [
      { ...pickup, status: "ALLOCATED", dispatch_id: "d1", dispatch_status: state.status },
    ]);
    api.getDispatch.mockImplementation(async () => structuredClone(state));
    api.scanAllocatedFinishedGoods.mockResolvedValue({ finished_goods_id: "fg-1" });
    api.pickDispatchItems.mockImplementation(async () => {
      state = {
        ...state,
        status: "PICKING_COMPLETED",
        items: state.items.map((item) => ({ ...item, quantity_picked: 10 })),
      };
      return state;
    });
    api.packDispatchItems.mockImplementation(async (_id, items) => {
      state = {
        ...state,
        status: "PACKED",
        items: state.items.map((item) => ({
          ...item,
          quantity_packed: 10,
          package_number: items[0].package_number,
        })),
      };
      return state;
    });
    api.scanDispatchPackage.mockImplementation(async () => {
      state = {
        ...state,
        status: "LOADING_STARTED",
        items: state.items.map((item) => ({ ...item, quantity_loaded: 10 })),
      };
      return state;
    });
    api.verifyDispatchFinal.mockImplementation(async () => {
      state = { ...state, status: "READY_FOR_GATE_EXIT" };
      return state;
    });
    show(Dispatch);
    await userEvent.click(await screen.findByRole("button", { name: /^(Process|View)$/ }));
    const pick = await screen.findByRole("button", { name: "Confirm Picking" });
    expect(pick).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Finished goods / package QR"), "FG-QR-1");
    await userEvent.click(screen.getByRole("button", { name: "Verify FG QR" }));
    await waitFor(() => expect(pick).toBeEnabled());
    await userEvent.click(pick);
    await userEvent.type(await screen.findByLabelText("Package Type"), "Carton");
    await userEvent.type(screen.getByLabelText("Package Count"), "1");
    expect(screen.queryByLabelText("Packed Quantity")).toBeNull();
    expect(screen.getByRole("button", { name: "Confirm Packing" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Confirm Packing" }));
    await userEvent.click(
      await screen.findByRole("checkbox", { name: /Supplier vehicle and driver physically/ }),
    );
    await userEvent.type(screen.getByLabelText("Finished goods / package QR"), "FG-QR-1");
    await userEvent.click(screen.getByRole("button", { name: "Verify & Load QR" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Confirm Loading" })).toBeEnabled(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm Loading" }));
    expect(
      await screen.findByText(/Awaiting Gate Security confirmation of Gate Exit/),
    ).toBeInTheDocument();
    expect(api.scanAllocatedFinishedGoods).toHaveBeenCalledWith("d1", "FG-QR-1", 10);
    expect(api.verifyDispatchLoading).toHaveBeenCalledWith("d1");
    expect(api.verifyDispatchFinal).toHaveBeenCalledWith("d1");
  });
  it("searches supplier requests by assigned vehicle", async () => {
    api.getSupplierFinishedGoodsDispatchRequests.mockResolvedValue([
      pickup,
      {
        ...pickup,
        id: "pickup-2",
        request_number: "FGD-102",
        vehicle_number: "KA01AB1234",
        status: "DISPATCHED",
      },
    ]);
    show(Dispatch);
    await screen.findByText("FGD-101");
    await userEvent.type(screen.getByRole("textbox", { name: "Search dispatch requests" }), "KA01");
    expect(screen.queryByText("FGD-101")).not.toBeInTheDocument();
    expect(screen.getByText("FGD-102")).toBeInTheDocument();
  });
});

describe("Material request date submission", () => {
  it("submits a valid completion date unchanged", async () => {
    api.getAssemblyProducts.mockResolvedValue([
      {
        id: "p1",
        product_code: "FG-LAPT-001",
        product_name: "LAPTOP",
        bom_number: "BOM-1",
        uom: "PCS",
      },
    ]);
    api.getProductBOM.mockResolvedValue({
      product_code: "FG-LAPT-001",
      target_quantity: 10,
      bom_number: "BOM-1",
      summary: {},
      materials: [
        {
          material_code: "MAT-LAPT-001",
          material_name: "Laptop",
          required_quantity: 10,
          available_quantity: 10,
          uom: "PCS",
        },
      ],
    });
    api.createAssemblyMaterialRequest.mockResolvedValue(request("new", "PENDING"));
    show(Requests);
    await screen.findByText("MR-1");
    await userEvent.click(screen.getByRole("button", { name: "New Material Request" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("MAT-LAPT-001");
    const validDate = localDateInput();
    const dateInput = dialog.querySelector('input[type="date"]') as HTMLInputElement;
    await userEvent.clear(dateInput);
    await userEvent.type(dateInput, validDate);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Submit Request to Warehouse" }),
    );
    await waitFor(() =>
      expect(api.createAssemblyMaterialRequest).toHaveBeenCalledWith({
        product_code: "FG-LAPT-001",
        target_quantity: 10,
        required_date: validDate,
        remarks: "",
      }),
    );
  });
});

describe("Dashboard production queue", () => {
  it("keeps order details, progress and the action accessible in a populated row", async () => {
    api.getAssemblyDashboard.mockResolvedValue({
      kpis: { in_production: 0, qc_pending: 0, material_pending: 0 },
      active_orders: [
        {
          ...productionOrder,
          status: "MATERIAL_ISSUED",
          progress: 0,
          assembly_line: "LINE-01",
          priority: "NORMAL",
          required_date: "2026-10-24",
          bom_number: "BOM-20261016-0002",
        },
      ],
      needs_attention: [],
      recent_activity: [],
    });
    show(Dashboard);
    await screen.findByText("ASM-101");
    expect(screen.getByText("Awaiting Receipt")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Production progress for ASM-101" }),
    ).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("BOM-20261016-0002")).toHaveAttribute("title", "BOM-20261016-0002");
    await userEvent.click(screen.getByRole("button", { name: "View production for ASM-101" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/assembly/production" });
  });
});
