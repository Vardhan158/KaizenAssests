import { expect, it } from "vitest";
import { isDashboardSearchVisible } from "@/lib/dashboard-search";

it.each(["/supplier-dashboard", "/assembly-dashboard", "/gate-dashboard", "/warehouse-dashboard", "/grn", "/inventory"])("keeps header search on %s", path => {
  expect(isDashboardSearchVisible(path)).toBe(true);
});
it.each(["/inventory", "/grn"])("recognizes the dashboard tab on %s", path => {
  expect(isDashboardSearchVisible(path, "?tab=dashboard")).toBe(true);
});
it.each([
  ["/inventory", "?tab=locations"], ["/inventory", "?tab=putaway"], ["/inventory", "?tab=inventory"], ["/inventory", "?tab=picking"],
  ["/grn", "?tab=wizard"], ["/grn", "?tab=records"],
  ["/supplier-materials", ""], ["/supplier/asns", ""], ["/supplier/dispatch", ""], ["/damage-claims", ""],
  ["/assembly/production", ""], ["/assembly/quality", ""], ["/assembly/material-requests", ""], ["/assembly/finished-goods", ""], ["/assembly/dispatch", ""],
  ["/vehicle-queue", ""], ["/vehicle-exit", ""], ["/gate/finished-goods-pickup", ""], ["/dock-management", ""], ["/notifications", ""],
])("removes header search from %s %s", (path, search) => {
  expect(isDashboardSearchVisible(path, search)).toBe(false);
});
