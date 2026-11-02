import { api } from "@/lib/api-client";
import { getUserInfo } from "@/lib/auth-utils";

export type ModuleSearchResult = { id: string; type: string; title: string; subtitle: string; url: string };
const rows = (data: any): any[] => Array.isArray(data) ? data : data?.items || data?.results || [];
const fields = ["asn_number", "grn_number", "po_number", "gate_entry_number", "vehicle_number", "driver_name", "supplier_name", "supplier_company_name", "status", "material_code", "item_code", "material_name", "batch_number", "location_code", "bin_code", "task_number", "request_number", "requisition_number", "order_number", "production_order_number", "product_name", "product_code", "dock_code", "dock_name"];
export function matchesModuleSearch(row: any, query: string): boolean {
  const text = fields.map((key) => row[key] || "").join(" ");
  return `${text} ${text.replaceAll("_", " ")}`.toLowerCase().includes(query.trim().toLowerCase());
}
const url = (path: string, params: Record<string, string>) => `${path}?${new URLSearchParams(params)}`;

/** Only query the active dashboard's existing, permission-checked data APIs. */
export async function searchModule(path: string, query: string): Promise<ModuleSearchResult[]> {
  const results: ModuleSearchResult[] = [];
  const collect = (data: any, type: string, titleFields: string[], destination: (row: any, title: string) => string) => {
    for (const raw of rows(data)) {
      // Receiving responses can use camelCase aliases; dashboards normalize
      // these before rendering, so search must do the same.
      const row = { ...raw };
      for (const [key, value] of Object.entries(raw)) {
        const normalized = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
        if (row[normalized] == null) row[normalized] = value;
      }
      if (!matchesModuleSearch(row, query)) continue;
      const title = titleFields.map((key) => row[key]).find(Boolean);
      if (!title) continue;
      results.push({ id: String(row.id || title), type, title: String(title),
        subtitle: [row.supplier_name || row.material_name || row.product_name, row.vehicle_number, row.status?.replaceAll("_", " ")].filter(Boolean).join(" · "),
        url: destination(row, String(title)) });
    }
  };
  if (path === "/grn") {
    collect(await api.getGrns({ search: query, limit: 100 }), "GRN", ["grn_number"], (_, title) => url("/grn", { tab: "records", search: title }));
  } else if (path === "/supplier-dashboard") {
    collect(await api.getAsns(getUserInfo()?.supplierId), "ASN", ["asn_number"], (_, title) => url("/supplier-dashboard", { search: title }));
  } else if (path === "/gate-dashboard") {
    const [inbound, pickups] = await Promise.all([api.getInboundArrivals(true).catch(() => []), api.getFinishedGoodsRequests().catch(() => [])]);
    collect(inbound, "Gate Entry", ["gate_entry_number", "asn_number"], (_, title) => url("/gate-dashboard", { search: title }));
    collect(pickups, "Pickup", ["request_number"], (_, title) => url("/gate/finished-goods-pickup", { search: title }));
  } else if (path === "/inventory" || path === "/warehouse-dashboard") {
    const [stock, tasks, docks] = await Promise.all([api.getWarehouseInventorySummary().catch(() => []), api.getPutawayTasks().catch(() => []), api.getDocks().catch(() => [])]);
    collect(stock, "Inventory", ["material_code", "item_code", "material_name"], (_, title) => url("/inventory", { tab: "inventory", search: title }));
    collect(tasks, "Putaway", ["grn_number", "task_number", "item_code"], (_, title) => url("/inventory", { tab: "putaway", search: title }));
    collect(docks, "Dock", ["dock_code"], (_, title) => url("/dock-management", { search: title }));
  } else if (path === "/assembly-dashboard") {
    const [orders, requests] = await Promise.all([api.getAssemblyProductionOrders().catch(() => []), api.getAssemblyMaterialRequests().catch(() => [])]);
    collect(orders, "Production", ["order_number", "production_order_number", "product_name"], (_, title) => url("/assembly/production", { search: title }));
    collect(requests, "Requisition", ["request_number", "requisition_number"], (_, title) => url("/assembly/material-requests", { search: title }));
  }
  return results.slice(0, 30);
}
