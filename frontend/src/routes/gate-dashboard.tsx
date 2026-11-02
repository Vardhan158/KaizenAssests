import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Clock3,
  Eye,
  FileCheck2,
  Loader2,
  LogOut,
  PlusCircle,
  Search,
  ShieldCheck,
  Truck,
  Warehouse,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { StatCard } from "@/components/wms/primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api-client";
import { requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/gate-dashboard")({
  beforeLoad: () => requireRole("GATE_SECURITY"),
  head: () => ({ meta: [{ title: "Gate Security Dashboard · KaizenAssests" }] }),
  component: GateDashboard,
});

function GateDashboard() {
  const routeSearch = useSearch({ strict: false }) as { search?: string };
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activityPage, setActivityPage] = useState(1);
  const [selectedDetailsDrawer, setSelectedDetailsDrawer] = useState<any | null>(null);

  const loadDashboard = async () => {
    try {
      setDashboardData(await api.getDashboardStats());
    } catch (error) {
      console.error("Failed to load gate dashboard", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
    const timer = window.setInterval(loadDashboard, 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const entries = Array.isArray(dashboardData?.gateEntries) ? dashboardData.gateEntries : []; /*
    {
      id: "ge-1",
      gate_pass_number: "GP-BLR-20261008-0048",
      vehicle_number: "KA 01 AB 4582",
      supplier_name: "Bharat Electronics Components Pvt. Ltd.",
      po_number: "PO-2026-008741",
      asn_number: "ASN-2026-004582",
      entry_time: "07 Oct 2026 • 10:42 AM",
      dock_number: "Dock D-04",
      status: "INSIDE_FACILITY",
      driver_name: "Suresh Gowda",
      driver_contact: "+91 98450 12345",
      invoice_number: "INV-2026-9901",
    },
    {
      id: "ge-2",
      gate_pass_number: "GP-BLR-20261008-0049",
      vehicle_number: "KA 05 MN 7821",
      supplier_name: "SteelTech Heavy Precision Alloys",
      po_number: "PO-8755",
      asn_number: "ASN-2026-009912",
      entry_time: "07 Oct 2026 • 11:15 AM",
      dock_number: "Dock D-02",
      status: "AT_DOCK",
      driver_name: "Anand Murthy",
      driver_contact: "+91 97312 34567",
      invoice_number: "INV-ST-8810",
    },
    {
      id: "ge-3",
      gate_pass_number: "GP-BLR-20261008-0050",
      vehicle_number: "KA 09 EF 5544",
      supplier_name: "Mysore Electricals Ltd",
      po_number: "PO-8790",
      asn_number: "ASN-2026-003310",
      entry_time: "07 Oct 2026 • 09:30 AM",
      dock_number: "Dock D-01",
      status: "VEHICLE_EXITED",
      driver_name: "Vijay Kumar",
      driver_contact: "+91 98800 11223",
      invoice_number: "INV-ME-1092",
    },
  ]; */

  useEffect(() => {
    const query = routeSearch.search?.trim();
    if (!query || !entries.length || selectedDetailsDrawer) return;
    const match = entries.find((entry: any) =>
      [entry.gate_entry_no, entry.gate_entry_number, entry.gate_pass_number, entry.vehicle_number, entry.id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase() === query.toLowerCase()),
    );
    if (match) setSelectedDetailsDrawer(match);
  }, [routeSearch.search, entries, selectedDetailsDrawer]);

  const filteredEntries = entries.filter((e: any) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const gp = String(
      e.gate_entry_no || e.gate_entry_number || e.gate_pass_number || e.id || "",
    ).toLowerCase();
    const veh = String(e.vehicle_number || "").toLowerCase();
    const sup = String(e.supplier_name || e.vendor || "").toLowerCase();
    const asn = String(e.asn_number || "").toLowerCase();
    return gp.includes(q) || veh.includes(q) || sup.includes(q) || asn.includes(q);
  });
  const activityPageCount = Math.max(1, Math.ceil(filteredEntries.length / 5));
  const currentActivityPage = Math.min(activityPage, activityPageCount);
  const activityStart = (currentActivityPage - 1) * 5;
  const pagedEntries = filteredEntries.slice(activityStart, activityStart + 5);
  useEffect(() => { setActivityPage(1); }, [searchQuery]);
  useEffect(() => { setActivityPage(page => Math.min(page, activityPageCount)); }, [activityPageCount]);

  const metrics = dashboardData?.stats || dashboardData?.metrics || dashboardData || {};
  const totalEntries =
    metrics.totalEntries ?? metrics.totalGateEntries ?? metrics.totalArrivals ?? entries.length;
  const todayEntries =
    metrics.todayEntries ?? metrics.todaysEntries ?? metrics.totalArrivals ?? entries.length;
  const vehiclesInside =
    metrics.vehiclesInside ??
    Math.max(0, Number(todayEntries) - Number(metrics.vehiclesExited || 0));
  const awaitingDock =
    metrics.awaitingDock ??
    entries.filter((e: any) => String(e.status).toUpperCase() === "AWAITING_DOCK").length;
  const totalExits =
    metrics.totalExits ??
    metrics.totalGateExits ??
    entries.filter((e: any) => String(e.status).toUpperCase() === "VEHICLE_EXITED").length;
  // Current status distributions; no historical counts are inferred from totals.
  const statusBars = (statuses: string[]) => statuses.map(status => ({
    label: status.replaceAll("_", " "),
    value: entries.filter((entry: any) => String(entry.status).toUpperCase() === status).length,
  }));
  const gateCharts = {
    entries: statusBars(["AWAITING_DOCK", "DOCK_ASSIGNED", "RECEIVING", "COMPLETED", "RELEASED", "VEHICLE_EXITED"]),
    inside: statusBars(["INSIDE_FACILITY", "AWAITING_DOCK", "DOCK_ASSIGNED", "RECEIVING", "COMPLETED", "RELEASED"]),
    dock: statusBars(["AWAITING_DOCK", "DOCK_ASSIGNED", "RECEIVING"]),
    exits: [
      { label: "Exited", value: Number(totalExits) },
      { label: "Inside", value: Number(vehiclesInside) },
    ],
  };

  return (
    <AppShell
      title="Gate Entry Security Dashboard"
      subtitle="Live gate metrics, searchable gate-pass activity and vehicle tracking."
      actions={
        <div className="flex flex-wrap justify-end gap-2">
          <Button asChild className="rounded-xl font-bold shadow-sm">
            <Link to="/vehicle-queue" search={{ action: "new" }}>
              <PlusCircle className="mr-2 size-4" /> New Gate Entry
            </Link>
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* FR-01 Metric Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total Entries"
            sparkline={gateCharts.entries}
            value={String(totalEntries)}
            delta="All gate entries registered"
            icon={Truck}
            tone="primary"
          />
          <StatCard
            label="Vehicles Inside"
            sparkline={gateCharts.inside}
            value={String(vehiclesInside)}
            delta="Currently inside facility"
            icon={ShieldCheck}
            tone="success"
          />
          <StatCard
            label="Awaiting Dock"
            sparkline={gateCharts.dock}
            value={String(awaitingDock)}
            delta="Pending dock check-in"
            icon={Clock3}
            tone="warning"
          />
          <StatCard
            label="Total Exits"
            sparkline={gateCharts.exits}
            value={String(totalExits)}
            delta="All vehicles exited facility"
            icon={LogOut}
            tone="teal"
            to="/vehicle-exit"
          />
        </div>

        {/* FR-01 Searchable Activity Table */}
        <Card className="rounded-2xl border-border/60 shadow-soft">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base font-bold">RECENT GATE PASS ACTIVITY</CardTitle>
              <CardDescription>
                Searchable log of recent inbound vehicle entries, allocated docks, and statuses
              </CardDescription>
            </div>

            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search Gate Pass, Vehicle, Supplier, ASN..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 w-full rounded-xl border bg-background pl-9 pr-3 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-muted/40 font-bold uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">ASN Number</th>
                    <th className="px-4 py-3">Gate Pass No</th>
                    <th className="px-4 py-3">Vehicle Number</th>
                    <th className="px-4 py-3">Supplier Name</th>
                    <th className="px-4 py-3">Entry Time</th>
                    <th className="px-4 py-3">Allocated Dock</th>
                    <th className="px-4 py-3">Current Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {!loading && !filteredEntries.length && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No gate pass activity found.</td></tr>}
                  {pagedEntries.map((e: any, idx: number) => {
                    const passNo =
                      e.gate_entry_no || e.gate_entry_number || e.gate_pass_number || "—";
                    const vehNo = e.vehicle_number || "—";
                    const suppName = e.supplier_name || e.vendor || "—";
                    const asnNumber = e.asn_number || "—";
                    const entryTime = e.entry_time || e.arrival_time || "—";
                    const dockNo = e.dock_number || e.dock_name || "—";

                    return (
                      <tr key={e.id || idx} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-semibold">{asnNumber}</td>
                        <td className="px-4 py-3 font-mono font-bold text-primary">{passNo}</td>
                        <td className="px-4 py-3 font-bold">{vehNo}</td>
                        <td className="px-4 py-3 font-medium">{suppName}</td>
                        <td className="px-4 py-3 font-medium text-muted-foreground">{entryTime}</td>
                        <td className="px-4 py-3 font-bold text-emerald-600 dark:text-emerald-400">
                          {dockNo}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={e.status || "INSIDE_FACILITY"} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs font-bold text-primary"
                              onClick={() => setSelectedDetailsDrawer(e)}
                            >
                              <Eye className="mr-1 size-3.5" /> Details
                            </Button>

                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm">
              <p className="text-muted-foreground">Showing {filteredEntries.length ? activityStart + 1 : 0}–{Math.min(activityStart + 5, filteredEntries.length)} of {filteredEntries.length} entries</p>
              <nav aria-label="Gate pass activity pagination" className="flex items-center gap-3">
                <Button size="sm" variant="outline" disabled={currentActivityPage === 1} onClick={() => setActivityPage(currentActivityPage - 1)}>Previous</Button>
                <span aria-live="polite">{currentActivityPage} / {activityPageCount}</span>
                <Button size="sm" variant="outline" disabled={currentActivityPage === activityPageCount} onClick={() => setActivityPage(currentActivityPage + 1)}>Next</Button>
              </nav>
            </div>
          </CardContent>
        </Card>

        {/* View Details Drawer / Modal */}
        <Dialog
          open={Boolean(selectedDetailsDrawer)}
          onOpenChange={() => setSelectedDetailsDrawer(null)}
        >
          <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl bg-card p-6 shadow-2xl">
            <DialogHeader>
              <DialogTitle className="pr-6 text-left font-semibold leading-snug">
                Inbound entry record details
              </DialogTitle>
            </DialogHeader>

            {selectedDetailsDrawer && (
              <div className="space-y-5 text-sm">
                <section className="rounded-xl border bg-muted/20 p-4">
                  <h3 className="mb-3 text-sm font-semibold">Entry / Shipment</h3>
                  <dl className="grid gap-4 sm:grid-cols-2 [&_dd]:mt-1 [&_dd]:break-words [&_dd]:leading-relaxed">
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Gate Pass Number</dt>
                    <dd className="font-mono font-semibold text-primary">
                      {selectedDetailsDrawer.gate_pass_number ||
                        selectedDetailsDrawer.gate_entry_no ||
                        "—"}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Invoice Number</dt>
                    <dd className="font-semibold text-foreground">
                      {selectedDetailsDrawer.invoice_number || "INV-2026-9901"}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Assigned Dock</dt>
                    <dd className="font-semibold text-foreground">
                      {selectedDetailsDrawer.dock_number || selectedDetailsDrawer.dock_name || "—"}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Status</dt>
                    <dd className="font-semibold text-foreground">
                      {selectedDetailsDrawer.status || "INSIDE_FACILITY"}
                    </dd>
                  </div>
                  </dl>
                </section>
                <section className="rounded-xl border bg-muted/20 p-4">
                  <h3 className="mb-3 text-sm font-semibold">Vehicle / Driver</h3>
                  <dl className="grid gap-4 sm:grid-cols-2 [&_dd]:mt-1 [&_dd]:break-words [&_dd]:leading-relaxed">
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Vehicle Number</dt>
                    <dd className="font-semibold text-foreground">
                      {selectedDetailsDrawer.vehicle_number}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Driver Name</dt>
                    <dd className="font-semibold text-foreground">
                      {selectedDetailsDrawer.driver_name || "Suresh Gowda"} (
                      {selectedDetailsDrawer.driver_contact || "+91 98450 12345"})
                    </dd>
                  </div>
                  </dl>
                </section>

                <Button
                  className="w-full rounded-xl font-bold"
                  onClick={() => setSelectedDetailsDrawer(null)}
                >
                  Close Details
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
