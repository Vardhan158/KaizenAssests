import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  Clock3,
  Eye,
  FileCheck2,
  Loader2,
  LogOut,
  PlusCircle,
  Printer,
  QrCode,
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
  head: () => ({ meta: [{ title: "Gate Security Dashboard · KaizenX" }] }),
  component: GateDashboard,
});

function GateDashboard() {
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPassModal, setSelectedPassModal] = useState<any | null>(null);
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

  const entries = dashboardData?.gateEntries || [
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
  ];

  const filteredEntries = entries.filter((e: any) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const gp = String(e.gate_pass_number || e.gate_entry_no || e.id || "").toLowerCase();
    const veh = String(e.vehicle_number || "").toLowerCase();
    const sup = String(e.supplier_name || e.vendor || "").toLowerCase();
    const po = String(e.po_number || "").toLowerCase();
    const asn = String(e.asn_number || "").toLowerCase();
    return gp.includes(q) || veh.includes(q) || sup.includes(q) || po.includes(q) || asn.includes(q);
  });

  const handlePrintPass = (pass: any) => {
    toast.success(`Print job sent for Gate Pass ${pass.gate_pass_number || pass.id}`, {
      description: "Opening print preview...",
    });
    window.print();
  };

  return (
    <AppShell
      title="Gate Entry Security Dashboard (FR-01)"
      subtitle="FR-01: Live gate metrics, searchable recent gate pass activity, and vehicle tracking"
      actions={
        <Button asChild className="rounded-xl font-bold shadow-sm">
          <Link to="/vehicle-queue">
            <PlusCircle className="mr-2 size-4" /> New Gate Entry
          </Link>
        </Button>
      }
    >
      <div className="space-y-6">
        {/* FR-01 Metric Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Today's Entries"
            value="24"
            delta="Total vehicles registered today"
            icon={Truck}
            tone="primary"
            to="/vehicle-queue"
          />
          <StatCard
            label="Vehicles Inside"
            value="8"
            delta="Currently inside facility"
            icon={ShieldCheck}
            tone="success"
            to="/vehicle-queue"
          />
          <StatCard
            label="Awaiting Dock"
            value="3"
            delta="Pending dock check-in"
            icon={Clock3}
            tone="warning"
            to="/vehicle-queue?tab=waiting"
          />
          <StatCard
            label="Today's Exits"
            value="16"
            delta="Cleared & exited facility"
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
                placeholder="Search Gate Pass, Vehicle, Supplier, PO..."
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
                    <th className="px-4 py-3">Gate Pass No</th>
                    <th className="px-4 py-3">Vehicle Number</th>
                    <th className="px-4 py-3">Supplier Name</th>
                    <th className="px-4 py-3">PO / ASN Number</th>
                    <th className="px-4 py-3">Entry Time</th>
                    <th className="px-4 py-3">Allocated Dock</th>
                    <th className="px-4 py-3">Current Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredEntries.map((e: any, idx: number) => {
                    const passNo = e.gate_pass_number || e.gate_entry_no || `GP-BLR-20261008-00${idx + 48}`;
                    const vehNo = e.vehicle_number || "KA 01 AB 4582";
                    const suppName = e.supplier_name || e.vendor || "Bharat Electronics Components Pvt. Ltd.";
                    const poAsn = `${e.po_number || "PO-8741"} / ${e.asn_number || "ASN-004582"}`;
                    const entryTime = e.entry_time || e.arrival_time || "10:42 AM";
                    const dockNo = e.dock_number || e.dock_name || "Dock D-04";

                    return (
                      <tr key={e.id || idx} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-mono font-bold text-primary">{passNo}</td>
                        <td className="px-4 py-3 font-bold">{vehNo}</td>
                        <td className="px-4 py-3 font-medium">{suppName}</td>
                        <td className="px-4 py-3 font-semibold">{poAsn}</td>
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

                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs font-bold text-sky-600"
                              onClick={() => setSelectedPassModal(e)}
                            >
                              <QrCode className="mr-1 size-3.5" /> Gate Pass
                            </Button>

                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs font-bold text-emerald-600"
                              onClick={() => handlePrintPass(e)}
                            >
                              <Printer className="mr-1 size-3.5" /> Print
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Gate Pass Modal Preview */}
        <Dialog open={Boolean(selectedPassModal)} onOpenChange={() => setSelectedPassModal(null)}>
          <DialogContent className="max-w-md rounded-2xl bg-card p-6 shadow-2xl">
            <DialogHeader>
              <DialogTitle className="text-center font-black text-primary uppercase text-sm">
                KAIZENTRIX GATE PASS TICKET
              </DialogTitle>
            </DialogHeader>

            {selectedPassModal && (
              <div className="space-y-4">
                <div className="rounded-xl bg-muted/40 p-4 border space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground font-semibold">Gate Pass ID:</span>
                    <span className="font-mono font-bold text-primary">
                      {selectedPassModal.gate_pass_number || "GP-BLR-20261008-0048"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground font-semibold">Vehicle Plate:</span>
                    <span className="font-bold text-foreground">{selectedPassModal.vehicle_number}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground font-semibold">Supplier:</span>
                    <span className="font-bold text-foreground text-right">{selectedPassModal.supplier_name}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="text-muted-foreground font-semibold">Allocated Dock:</span>
                    <span className="font-bold text-emerald-600">{selectedPassModal.dock_number || "Dock D-04"}</span>
                  </div>
                </div>

                <div className="rounded-2xl border-2 border-dashed border-primary/40 bg-muted/20 p-4 text-center">
                  <QrCode className="mx-auto size-28 text-primary" />
                  <p className="font-mono text-xs font-bold mt-2 text-primary">
                    {selectedPassModal.gate_pass_number || "GP-BLR-20261008-0048"}
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button className="flex-1 rounded-xl font-bold" onClick={() => handlePrintPass(selectedPassModal)}>
                    <Printer className="mr-2 size-4" /> Print Ticket
                  </Button>
                  <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setSelectedPassModal(null)}>
                    Close
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* View Details Drawer / Modal */}
        <Dialog open={Boolean(selectedDetailsDrawer)} onOpenChange={() => setSelectedDetailsDrawer(null)}>
          <DialogContent className="max-w-lg rounded-2xl bg-card p-6 shadow-2xl">
            <DialogHeader>
              <DialogTitle className="font-black text-base">INBOUND ENTRY RECORD DETAILS</DialogTitle>
            </DialogHeader>

            {selectedDetailsDrawer && (
              <div className="space-y-3 text-xs">
                <div className="rounded-xl bg-muted/40 p-3 border space-y-1.5">
                  <p className="flex justify-between"><span className="text-muted-foreground">Gate Pass Number:</span> <span className="font-mono font-bold text-primary">{selectedDetailsDrawer.gate_pass_number || "GP-BLR-20261008-0048"}</span></p>
                  <p className="flex justify-between"><span className="text-muted-foreground">Vehicle Number:</span> <span className="font-bold text-foreground">{selectedDetailsDrawer.vehicle_number}</span></p>
                  <p className="flex justify-between"><span className="text-muted-foreground">Driver Name:</span> <span className="font-bold text-foreground">{selectedDetailsDrawer.driver_name || "Suresh Gowda"} ({selectedDetailsDrawer.driver_contact || "+91 98450 12345"})</span></p>
                  <p className="flex justify-between"><span className="text-muted-foreground">Invoice Number:</span> <span className="font-bold text-foreground">{selectedDetailsDrawer.invoice_number || "INV-2026-9901"}</span></p>
                  <p className="flex justify-between"><span className="text-muted-foreground">Assigned Dock:</span> <span className="font-bold text-emerald-600">{selectedDetailsDrawer.dock_number || "Dock D-04"}</span></p>
                  <p className="flex justify-between"><span className="text-muted-foreground">Status:</span> <span className="font-bold uppercase text-emerald-600">{selectedDetailsDrawer.status || "INSIDE_FACILITY"}</span></p>
                </div>

                <Button className="w-full rounded-xl font-bold" onClick={() => setSelectedDetailsDrawer(null)}>
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
