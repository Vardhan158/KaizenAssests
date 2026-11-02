/** The shared header search belongs only to module dashboard views. */
export function isDashboardSearchVisible(path: string, search = ""): boolean {
  if (["/supplier-dashboard", "/assembly-dashboard", "/gate-dashboard", "/warehouse-dashboard"].includes(path)) return true;
  if (path === "/inventory" || path === "/grn") {
    return (new URLSearchParams(search).get("tab") || "dashboard") === "dashboard";
  }
  return false;
}
