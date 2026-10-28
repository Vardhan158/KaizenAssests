export type PageAccess = "READ" | "WRITE";

export type PermissionPage = {
  key: string;
  label: string;
};

export const ROLE_PAGES: Record<string, PermissionPage[]> = {
  SUPPLIER: [
    { key: "/supplier-dashboard", label: "Dashboard" },
    { key: "/supplier/asns", label: "ASN Management" },
    { key: "/supplier/dispatch", label: "FG Dispatch Requests" },
  ],
  WAREHOUSE_MANAGER: [
    { key: "/inventory?tab=dashboard", label: "Dashboard" },
    { key: "/inventory?tab=putaway", label: "Putaway" },
    { key: "/inventory?tab=inventory", label: "Inventory" },
    { key: "/inventory?tab=picking", label: "Requisitions & Picking" },
    { key: "/inventory?tab=locations", label: "Locations" },
    { key: "/dock-management", label: "Dock Allocation" },
  ],
  GATE_SECURITY: [
    { key: "/gate-dashboard", label: "Dashboard" },
    { key: "/vehicle-queue", label: "Vehicle Entry & Exit" },
    { key: "/gate/finished-goods-pickup", label: "FG Pickup Entry & Exit" },
  ],
  GRN: [
    { key: "/grn?tab=dashboard", label: "Dashboard" },
    { key: "/grn?tab=wizard", label: "Create GRN" },
    { key: "/grn?tab=records", label: "GRN History" },
  ],
  ASSEMBLY_MANAGER: [
    { key: "/assembly-dashboard", label: "Dashboard" },
    { key: "/assembly/material-requests", label: "Material Requests" },
    { key: "/assembly/production", label: "Production" },
    { key: "/assembly/quality", label: "Quality Check" },
    { key: "/assembly/finished-goods", label: "Finished Goods Records" },
    { key: "/assembly/dispatch", label: "FG Dispatch" },
  ],
  DISPATCH: [
    { key: "/dispatch-orders", label: "Dispatch Orders" },
    { key: "/dispatch-picking-packing", label: "Picking & Packing" },
    { key: "/dispatch-loading", label: "Loading" },
    { key: "/dispatch-gate-out", label: "Gate Out" },
  ],
  QUALITY: [
    { key: "/grn?tab=records", label: "Incoming QC" },
    { key: "/assembly/quality", label: "Finished-Goods QC" },
  ],
  ADMIN: [
    { key: "/admin", label: "Admin Overview" },
    { key: "/admin/users", label: "User Management" },
    { key: "/admin/audit", label: "Audit Log" },
    { key: "/warehouse-dashboard", label: "Operations" },
  ],
};

export function permissionKeyForLocation(pathname: string, search = ""): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const tab = params.get("tab");
  return tab ? `${pathname}?tab=${tab}` : pathname;
}

export function getPageAccess(
  permissions: Record<string, PageAccess> | undefined,
  pathname: string,
  search = "",
): PageAccess | null | undefined {
  if (!permissions || Object.keys(permissions).length === 0) return undefined;
  const key = permissionKeyForLocation(pathname, search);
  const exactAccess = permissions[key] ?? permissions[pathname];
  if (exactAccess) return exactAccess;

  // A permission for a route section also covers its nested screens. For
  // example, /supplier/asns must authorize /supplier/asns/new.
  const parentEntry = Object.entries(permissions)
    .filter(([permissionKey]) => !permissionKey.includes("?"))
    .sort(([left], [right]) => right.length - left.length)
    .find(([permissionKey]) => pathname.startsWith(`${permissionKey}/`));

  return parentEntry?.[1] ?? null;
}
