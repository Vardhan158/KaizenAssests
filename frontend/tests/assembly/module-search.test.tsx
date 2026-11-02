import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { matchesModuleSearch, searchModule } from "@/lib/module-search";
vi.mock("@/lib/api-client", () => ({ api: {
  getGrns: vi.fn(), getAsns: vi.fn(), getInboundArrivals: vi.fn(), getFinishedGoodsRequests: vi.fn(),
  getWarehouseInventorySummary: vi.fn(), getPutawayTasks: vi.fn(), getDocks: vi.fn(),
  getAssemblyProductionOrders: vi.fn(), getAssemblyMaterialRequests: vi.fn(),
} }));
vi.mock("@/lib/auth-utils", () => ({ getUserInfo: () => ({ supplierId: "supplier-1" }) }));
beforeEach(() => { for (const method of Object.values(api)) vi.mocked(method).mockReset().mockResolvedValue([]); });
it("searches GRNs without returning unrelated ASNs", async () => {
  vi.mocked(api.getGrns).mockResolvedValue({ total: 1, items: [{ id: "g1", grn_number: "GRN-2026-001", supplier_name: "MTU" }] });
  const results = await searchModule("/grn", "grn");
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ type: "GRN", title: "GRN-2026-001", url: "/grn?tab=records&search=GRN-2026-001" });
  expect(api.getAsns).not.toHaveBeenCalled();
});
it("limits supplier searches to supplier deliveries", async () => {
  vi.mocked(api.getAsns).mockResolvedValue([{ id: "a1", asn_number: "ASN-001", status: "AWAITING_DOCK" }]);
  expect(await searchModule("/supplier-dashboard", "awaiting dock")).toHaveLength(1);
  expect(api.getAsns).toHaveBeenCalledWith("supplier-1");
  expect(api.getGrns).not.toHaveBeenCalled();
});
it("searches warehouse stock and keeps permitted sources when another fails", async () => {
  vi.mocked(api.getWarehouseInventorySummary).mockResolvedValue([{ material_code: "MAT-001", material_name: "Bus Duct" }]);
  vi.mocked(api.getDocks).mockRejectedValue(new Error("not permitted"));
  const results = await searchModule("/inventory", "bus duct");
  expect(results[0]).toMatchObject({ type: "Inventory", url: "/inventory?tab=inventory&search=MAT-001" });
  expect(api.getAsns).not.toHaveBeenCalled();
});
it("searches gate passes in gate dashboards", async () => {
  vi.mocked(api.getInboundArrivals).mockResolvedValue([{ gate_entry_number: "GP-001", vehicle_number: "KA01" }]);
  expect((await searchModule("/gate-dashboard", "GP-001"))[0].type).toBe("Gate Entry");
});
it("searches assembly orders in assembly dashboards", async () => {
  vi.mocked(api.getAssemblyProductionOrders).mockResolvedValue([{ order_number: "PROD-001", product_name: "Bus" }] as any);
  expect((await searchModule("/assembly-dashboard", "prod"))[0]).toMatchObject({ type: "Production", url: "/assembly/production?search=PROD-001" });
});
it("matches dedicated fields case-insensitively and returns no unrelated matches", () => {
  expect(matchesModuleSearch({ grn_number: "GRN-001" }, " grn ")).toBe(true);
  expect(matchesModuleSearch({ material_name: "Bus Duct" }, "battery")).toBe(false);
});
it("does not query unrelated modules for unsupported routes", async () => {
  expect(await searchModule("/unknown", "grn")).toEqual([]);
  expect(api.getGrns).not.toHaveBeenCalled();
});

it("normalizes camelCase API aliases just like the GRN dashboard", async () => {
  vi.mocked(api.getGrns).mockResolvedValue({ total: 1, items: [{ grnId: "g2", grnNumber: "GRN-2026-002", supplierName: "MTU", vehicleNumber: "KA02" }] });
  expect((await searchModule("/grn", "GRN-2026-002"))[0]).toMatchObject({ title: "GRN-2026-002", type: "GRN", url: "/grn?tab=records&search=GRN-2026-002" });
});
