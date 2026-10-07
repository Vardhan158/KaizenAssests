import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/wms/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Database,
  DoorOpen,
  FileCheck2,
  FileText,
  Filter,
  PackageCheck,
  QrCode,
  ScanLine,
  Search,
  ShieldCheck,
  Truck,
  UserCheck,
  UserRound,
  Warehouse,
  X,
} from "lucide-react";

export const Route = createFileRoute("/receiving")({ component: ReceivingControlCenter });

type ReceivingStatus =
  | "PENDING_RECEIVING"
  | "AT_DOCK"
  | "UNLOADING"
  | "UNLOADING_COMPLETED"
  | "QC_PENDING"
  | "QC_IN_PROGRESS"
  | "QC_COMPLETED"
  | "GRN_DRAFT"
  | "GRN_REVIEW"
  | "GRN_POSTED"
  | "READY_FOR_PUTAWAY"
  | "QC_HOLD";

const statusLabels: Record<ReceivingStatus, string> = {
  PENDING_RECEIVING: "Gate Entry (8)",
  AT_DOCK: "At Dock (4)",
  UNLOADING: "Unloading (3)",
  UNLOADING_COMPLETED: "Unloaded",
  QC_PENDING: "QC Pending (6)",
  QC_IN_PROGRESS: "QC In Progress",
  QC_COMPLETED: "QC Completed",
  GRN_DRAFT: "GRN Draft",
  GRN_REVIEW: "GRN Pending (5)",
  GRN_POSTED: "GRN Posted",
  READY_FOR_PUTAWAY: "Ready for Putaway (9)",
  QC_HOLD: "QC Hold (2)",
};

interface InboundRecord {
  id: string;
  gatePassNo: string;
  vehicleNo: string;
  supplierName: string;
  supplierCode: string;
  poNo: string;
  asnNo: string;
  dockNo: string;
  warehouseName: string;
  zoneName: string;
  status: ReceivingStatus;
  entryTime: string;
  securityOfficer: string;
  assignedOperator: string;
  assignedInspector: string;
  expectedQty: number;
  receivedQty: number;
  damagedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  invoiceNo: string;
  invoiceDate: string;
  invoiceAmount: string;
  ewayNo: string;
  ewayValidUntil: string;
  lrNo: string;
  lrDate: string;
  transporterName: string;
  driverName: string;
}

const INITIAL_RECORDS: InboundRecord[] = [
  {
    id: "rec-1",
    gatePassNo: "GP-BLR-0048",
    vehicleNo: "KA 01 AB 4582",
    supplierName: "Bharat Electronics Components Pvt. Ltd.",
    supplierCode: "SUP-IND-1042",
    poNo: "PO-2026-008741",
    asnNo: "ASN-2026-004582",
    dockNo: "D-04",
    warehouseName: "Raw Material Warehouse",
    zoneName: "Inbound Receiving Bay",
    status: "AT_DOCK",
    entryTime: "07 Oct 2026 • 09:52 AM",
    securityOfficer: "Rajesh Kumar (Security)",
    assignedOperator: "Ramesh Kumar (Operator)",
    assignedInspector: "Priya Sharma (QC Inspector)",
    expectedQty: 500,
    receivedQty: 495,
    damagedQty: 5,
    acceptedQty: 490,
    rejectedQty: 5,
    invoiceNo: "INV-2026-9901",
    invoiceDate: "2026-10-07",
    invoiceAmount: "₹ 2,45,000.00",
    ewayNo: "EWAY-8812-4091",
    ewayValidUntil: "2026-10-10",
    lrNo: "LR-2026-9921",
    lrDate: "2026-10-05",
    transporterName: "VRL Logistics Ltd",
    driverName: "Suresh Gowda (+91 98450 12345)",
  },
  {
    id: "rec-2",
    gatePassNo: "GP-BLR-0049",
    vehicleNo: "KA 05 MN 7821",
    supplierName: "SteelTech Heavy Precision Alloys",
    supplierCode: "SUP-IND-2098",
    poNo: "PO-8755",
    asnNo: "ASN-2026-009912",
    dockNo: "D-02",
    warehouseName: "Raw Material Warehouse",
    zoneName: "Heavy Metals Dock",
    status: "UNLOADING",
    entryTime: "07 Oct 2026 • 11:15 AM",
    securityOfficer: "Rajesh Kumar (Security)",
    assignedOperator: "Amit Joshi (Operator)",
    assignedInspector: "Neha Kulkarni (QC Inspector)",
    expectedQty: 1000,
    receivedQty: 950,
    damagedQty: 10,
    acceptedQty: 940,
    rejectedQty: 10,
    invoiceNo: "INV-ST-8810",
    invoiceDate: "2026-10-06",
    invoiceAmount: "₹ 5,80,000.00",
    ewayNo: "EWAY-9912-3301",
    ewayValidUntil: "2026-10-12",
    lrNo: "LR-ST-4412",
    lrDate: "2026-10-06",
    transporterName: "TCI Freight",
    driverName: "Anand Murthy (+91 97312 34567)",
  },
  {
    id: "rec-3",
    gatePassNo: "GP-BLR-0050",
    vehicleNo: "KA 09 EF 5544",
    supplierName: "Mysore Electricals Ltd",
    supplierCode: "SUP-IND-3055",
    poNo: "PO-8790",
    asnNo: "ASN-2026-003310",
    dockNo: "D-01",
    warehouseName: "Electrical Spares Store",
    zoneName: "Components Receiving",
    status: "QC_PENDING",
    entryTime: "07 Oct 2026 • 09:30 AM",
    securityOfficer: "Rajesh Kumar (Security)",
    assignedOperator: "Ramesh Kumar (Operator)",
    assignedInspector: "Priya Sharma (QC Inspector)",
    expectedQty: 250,
    receivedQty: 250,
    damagedQty: 0,
    acceptedQty: 250,
    rejectedQty: 0,
    invoiceNo: "INV-ME-1092",
    invoiceDate: "2026-10-05",
    invoiceAmount: "₹ 1,12,500.00",
    ewayNo: "EWAY-7721-0021",
    ewayValidUntil: "2026-10-09",
    lrNo: "LR-ME-1102",
    lrDate: "2026-10-05",
    transporterName: "GATI KWE",
    driverName: "Vijay Kumar (+91 98800 11223)",
  },
];

function ReceivingControlCenter() {
  const [records, setRecords] = useState<InboundRecord[]>(INITIAL_RECORDS);
  const [selectedRecord, setSelectedRecord] = useState<InboundRecord | null>(INITIAL_RECORDS[0]);
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("ALL");
  const [activeTab, setActiveTab] = useState("overview");

  // Operators & Inspectors
  const [assignedOp, setAssignedOp] = useState("Ramesh Kumar (Warehouse Operator)");
  const [assignedQc, setAssignedQc] = useState("Priya Sharma (Incoming Quality Inspector)");

  const handleAssignOperator = (opName: string) => {
    setAssignedOp(opName);
    if (selectedRecord) {
      setSelectedRecord({ ...selectedRecord, assignedOperator: opName });
    }
    toast.success(`Operator Notification Sent: ${opName}`, {
      description: "New Receiving Assignment: Vehicle KA 01 AB 4582 at Dock D-04",
    });
  };

  const handleAssignInspector = (qcName: string) => {
    setAssignedQc(qcName);
    if (selectedRecord) {
      setSelectedRecord({ ...selectedRecord, assignedInspector: qcName });
    }
    toast.success(`Quality Inspector Notification Sent: ${qcName}`, {
      description: "Material Ready for Inspection: RCV-BLR-0048 at Dock D-04",
    });
  };

  const filteredRecords = records.filter((r) => {
    if (stageFilter !== "ALL" && r.status !== stageFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.gatePassNo.toLowerCase().includes(q) ||
      r.vehicleNo.toLowerCase().includes(q) ||
      r.supplierName.toLowerCase().includes(q) ||
      r.poNo.toLowerCase().includes(q) ||
      r.dockNo.toLowerCase().includes(q)
    );
  });

  return (
    <AppShell
      title="Warehouse Manager Receiving Monitor"
      subtitle="Section 41–45: Real-time receiving monitor, timestamped timeline, role notifications & traceability matrix"
    >
      <div className="space-y-6">
        {/* Section 41 - Real-Time Receiving Stage Monitor */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-black uppercase tracking-widest text-primary">
              RECEIVING STAGE MONITOR (SECTION 41)
            </h2>
            {stageFilter !== "ALL" && (
              <Button size="sm" variant="ghost" onClick={() => setStageFilter("ALL")} className="h-7 text-xs text-primary font-bold">
                Clear Filter (Showing All)
              </Button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {[
              { label: "GATE ENTRY", count: 8, filter: "PENDING_RECEIVING", color: "text-slate-700 bg-slate-500/10 border-slate-500/30" },
              { label: "AT DOCK", count: 4, filter: "AT_DOCK", color: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30" },
              { label: "UNLOADING", count: 3, filter: "UNLOADING", color: "text-sky-600 bg-sky-500/10 border-sky-500/30" },
              { label: "QC PENDING", count: 6, filter: "QC_PENDING", color: "text-amber-600 bg-amber-500/10 border-amber-500/30" },
              { label: "QC HOLD", count: 2, filter: "QC_HOLD", color: "text-red-600 bg-red-500/10 border-red-500/30" },
              { label: "GRN PENDING", count: 5, filter: "GRN_REVIEW", color: "text-purple-600 bg-purple-500/10 border-purple-500/30" },
              { label: "READY FOR PUTAWAY", count: 9, filter: "READY_FOR_PUTAWAY", color: "text-emerald-700 bg-emerald-500/20 border-emerald-500/50" },
            ].map((st) => (
              <Card
                key={st.label}
                className={cn(
                  "rounded-2xl p-3.5 border transition-all cursor-pointer hover:scale-[1.02]",
                  st.color,
                  stageFilter === st.filter && "ring-2 ring-primary"
                )}
                onClick={() => setStageFilter(st.filter)}
              >
                <p className="text-2xl font-black">{st.count}</p>
                <p className="text-[10px] font-black uppercase tracking-wider mt-1">{st.label}</p>
              </Card>
            ))}
          </div>
        </div>

        {/* Section 41 & 43 - Main Table */}
        <Card className="rounded-2xl border-border/50 shadow-soft">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold">INBOUND RECEIVING TRANSACTIONS</CardTitle>
              <CardDescription>Live inbound vehicles, assigned docks, and stage progression</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-64">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search Gate Pass, Vehicle, PO..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 w-full rounded-xl border bg-background pl-9 pr-3 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-muted/40 font-bold uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Gate Pass</th>
                    <th className="px-4 py-3">Vehicle</th>
                    <th className="px-4 py-3">Supplier</th>
                    <th className="px-4 py-3">PO</th>
                    <th className="px-4 py-3">Dock</th>
                    <th className="px-4 py-3">Receiving Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredRecords.map((r) => (
                    <tr
                      key={r.id}
                      className={cn(
                        "hover:bg-muted/30 transition-colors cursor-pointer",
                        selectedRecord?.id === r.id && "bg-primary/5"
                      )}
                      onClick={() => setSelectedRecord(r)}
                    >
                      <td className="px-4 py-3 font-mono font-bold text-primary">{r.gatePassNo}</td>
                      <td className="px-4 py-3 font-bold">{r.vehicleNo}</td>
                      <td className="px-4 py-3 font-medium">{r.supplierName}</td>
                      <td className="px-4 py-3 font-semibold">{r.poNo}</td>
                      <td className="px-4 py-3 font-bold text-emerald-600 dark:text-emerald-400">{r.dockNo}</td>
                      <td className="px-4 py-3">
                        <Badge className="rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-400 border border-sky-500/30">
                          {statusLabels[r.status] || r.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="ghost" className="h-7 text-xs font-bold text-primary">
                          Open Record <ArrowRight className="ml-1 size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Detail Page */}
        {selectedRecord && (
          <Card className="rounded-2xl border-primary/30 p-6 shadow-xl bg-card">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-black">Inbound Receipt Record</h2>
                  <Badge variant="outline" className="font-mono text-xs font-bold border-primary/30 text-primary">
                    {selectedRecord.gatePassNo}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Vehicle: <span className="font-bold text-foreground">{selectedRecord.vehicleNo}</span> · Supplier:{" "}
                  <span className="font-bold text-foreground">{selectedRecord.supplierName}</span>
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase text-muted-foreground text-right">Dock Assignment</p>
                  <p className="text-sm font-black text-emerald-600 dark:text-emerald-400 text-right">
                    {selectedRecord.dockNo}
                  </p>
                </div>
                <Badge className="rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-3 py-1 font-bold">
                  {statusLabels[selectedRecord.status]}
                </Badge>
              </div>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="overview" value={activeTab} onValueChange={setActiveTab} className="mt-4">
              <TabsList className="bg-muted/50 p-1 rounded-xl flex-wrap">
                <TabsTrigger value="overview" className="rounded-lg text-xs font-bold">OVERVIEW</TabsTrigger>
                <TabsTrigger value="timeline" className="rounded-lg text-xs font-bold">TIMELINE (SEC 42)</TabsTrigger>
                <TabsTrigger value="matrix" className="rounded-lg text-xs font-bold">PERMISSIONS (SEC 44)</TabsTrigger>
                <TabsTrigger value="data" className="rounded-lg text-xs font-bold font-mono">TRACEABILITY (SEC 45)</TabsTrigger>
              </TabsList>

              {/* Overview Tab */}
              <TabsContent value="overview" className="mt-4 space-y-4">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <Card className="rounded-xl p-4 bg-muted/20 border-border/60">
                    <h3 className="text-xs font-black uppercase text-primary mb-2">Gate Information</h3>
                    <div className="space-y-1 text-xs">
                      <p className="flex justify-between"><span className="text-muted-foreground">Gate Pass:</span> <span className="font-bold font-mono">{selectedRecord.gatePassNo}</span></p>
                      <p className="flex justify-between"><span className="text-muted-foreground">Gate:</span> <span className="font-bold">Main Gate – 01</span></p>
                      <p className="flex justify-between"><span className="text-muted-foreground">Entry Time:</span> <span className="font-bold">{selectedRecord.entryTime}</span></p>
                      <p className="flex justify-between"><span className="text-muted-foreground">Security Officer:</span> <span className="font-bold">{selectedRecord.securityOfficer}</span></p>
                    </div>
                  </Card>

                  <Card className="rounded-xl p-4 bg-muted/20 border-border/60">
                    <h3 className="text-xs font-black uppercase text-primary mb-2">Procurement Details</h3>
                    <div className="space-y-1 text-xs">
                      <p className="flex justify-between"><span className="text-muted-foreground">PO Number:</span> <span className="font-bold font-mono text-primary">{selectedRecord.poNo}</span></p>
                      <p className="flex justify-between"><span className="text-muted-foreground">ASN Number:</span> <span className="font-bold font-mono">{selectedRecord.asnNo}</span></p>
                      <p className="flex justify-between"><span className="text-muted-foreground">Expected Qty:</span> <span className="font-bold">{selectedRecord.expectedQty} KG</span></p>
                    </div>
                  </Card>

                  {/* Assignments */}
                  <Card className="rounded-xl p-4 bg-primary/5 border-primary/30">
                    <h3 className="text-xs font-black uppercase text-primary mb-2 flex items-center gap-1.5">
                      <UserCheck className="size-4" /> Receiving Assignments
                    </h3>
                    <div className="space-y-3 text-xs">
                      <div>
                        <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Assigned Warehouse Operator</p>
                        <select
                          value={assignedOp}
                          onChange={(e) => handleAssignOperator(e.target.value)}
                          className="h-8 w-full rounded-lg border bg-background px-2 text-xs font-bold"
                        >
                          <option value="Ramesh Kumar (Warehouse Operator)">Ramesh Kumar (Warehouse Operator)</option>
                          <option value="Amit Joshi (Warehouse Operator)">Amit Joshi (Warehouse Operator)</option>
                          <option value="Suresh Nair (Dock Operator)">Suresh Nair (Dock Operator)</option>
                        </select>
                      </div>

                      <div>
                        <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Assigned Quality Inspector</p>
                        <select
                          value={assignedQc}
                          onChange={(e) => handleAssignInspector(e.target.value)}
                          className="h-8 w-full rounded-lg border bg-background px-2 text-xs font-bold"
                        >
                          <option value="Priya Sharma (Incoming Quality Inspector)">Priya Sharma (Incoming Quality Inspector)</option>
                          <option value="Neha Kulkarni (Quality Inspector)">Neha Kulkarni (Quality Inspector)</option>
                          <option value="Rajesh V (Lead QC Officer)">Rajesh V (Lead QC Officer)</option>
                        </select>
                      </div>
                    </div>
                  </Card>
                </div>
              </TabsContent>

              {/* Section 42 - Timeline Tab */}
              <TabsContent value="timeline" className="mt-4">
                <Card className="rounded-xl p-5 bg-card border-border/60">
                  <h3 className="text-xs font-black uppercase text-primary mb-4">
                    RECEIVING TIMELINE (SECTION 42)
                  </h3>
                  <div className="space-y-3 text-xs">
                    {[
                      { time: "09:52 AM", actor: "Security – Rajesh", event: "Gate Entry Completed (GP-BLR-20261007-0048)" },
                      { time: "10:01 AM", actor: "Warehouse Manager – Arun", event: "Dock D-04 Assigned & Operators Notified" },
                      { time: "10:58 AM", actor: "Operator – Ramesh", event: "Vehicle Arrived at Dock D-04" },
                      { time: "11:02 AM", actor: "Operator – Ramesh", event: "Unloading Started" },
                      { time: "11:37 AM", actor: "Operator – Ramesh", event: "Unloading Completed (495 KG Received)" },
                      { time: "11:42 AM", actor: "Inspector – Priya", event: "QC Inspection Started" },
                      { time: "12:06 PM", actor: "Inspector – Priya", event: "QC Completed (Partially Accepted: 490 KG Accepted / 5 KG Rejected)" },
                      { time: "12:18 PM", actor: "Store Manager – Suresh", event: "GRN Posted (GRN-BLR-2026-000184)" },
                      { time: "12:21 PM", actor: "System", event: "Material Handling Unit QR Labels Generated (HU-BLR-20261007-00845)" },
                    ].map((item, idx) => (
                      <div key={idx} className="flex items-center gap-3 border-b pb-2">
                        <div className="grid size-6 place-items-center rounded-full bg-primary/10 text-primary text-[10px] font-black">
                          {idx + 1}
                        </div>
                        <span className="font-mono text-xs font-bold text-sky-600 w-20">{item.time}</span>
                        <div className="flex-1">
                          <p className="font-bold text-foreground">{item.event}</p>
                          <p className="text-[10px] text-muted-foreground">{item.actor}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </TabsContent>

              {/* Section 44 - Permissions Matrix Tab */}
              <TabsContent value="matrix" className="mt-4">
                <Card className="rounded-xl p-5 bg-card border-border/60">
                  <h3 className="text-xs font-black uppercase text-primary mb-3">
                    PERMISSION MATRIX (SECTION 44)
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border">
                      <thead className="bg-muted font-bold uppercase text-muted-foreground border-b">
                        <tr>
                          <th className="p-2.5">Function</th>
                          <th className="p-2.5 text-center">Warehouse Manager</th>
                          <th className="p-2.5 text-center">Operator</th>
                          <th className="p-2.5 text-center">QC</th>
                          <th className="p-2.5 text-center">Store Manager</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y font-semibold">
                        <tr><td className="p-2.5">View Gate Pass / PO / ASN</td><td className="text-center text-emerald-600 font-black">✓</td><td className="text-center text-emerald-600 font-black">✓</td><td className="text-center text-emerald-600 font-black">✓</td><td className="text-center text-emerald-600 font-black">✓</td></tr>
                        <tr><td className="p-2.5">Assign Operator / QC Inspector</td><td className="text-center text-emerald-600 font-black">✓</td><td className="text-center text-muted-foreground">—</td><td className="text-center text-muted-foreground">—</td><td className="text-center text-muted-foreground">—</td></tr>
                        <tr><td className="p-2.5">Confirm Dock Arrival</td><td className="text-center text-emerald-600 font-black">✓</td><td className="text-center text-emerald-600 font-black">✓</td><td className="text-center text-muted-foreground">—</td><td className="text-center text-muted-foreground">—</td></tr>
                        <tr><td className="p-2.5">Start Unloading & Count Material</td><td className="text-center text-muted-foreground">—</td><td className="text-center text-emerald-600 font-black">✓</td><td className="text-center text-muted-foreground">—</td><td className="text-center text-muted-foreground">—</td></tr>
                        <tr><td className="p-2.5">Perform QC & Accept/Reject</td><td className="text-center text-muted-foreground">—</td><td className="text-center text-muted-foreground">—</td><td className="text-center text-emerald-600 font-black">✓</td><td className="text-center text-muted-foreground">—</td></tr>
                        <tr><td className="p-2.5">Create GRN Draft & Post GRN</td><td className="text-center text-muted-foreground">—</td><td className="text-center text-muted-foreground">—</td><td className="text-center text-muted-foreground">—</td><td className="text-center text-emerald-600 font-black">✓</td></tr>
                        <tr><td className="p-2.5">Generate Material / HU QR</td><td className="text-center text-muted-foreground">—</td><td className="text-center text-amber-600">Limited</td><td className="text-center text-muted-foreground">—</td><td className="text-center text-emerald-600 font-black">✓</td></tr>
                        <tr><td className="p-2.5">Approve Exceptions (Over-receipt)</td><td className="text-center text-emerald-600 font-black">✓</td><td className="text-center text-muted-foreground">—</td><td className="text-center text-muted-foreground">—</td><td className="text-center text-sky-600">Configurable</td></tr>
                      </tbody>
                    </table>
                  </div>
                </Card>
              </TabsContent>

              {/* Section 45 - Traceability Tab */}
              <TabsContent value="data" className="mt-4">
                <Card className="rounded-xl p-5 bg-card border-border/60">
                  <h3 className="text-xs font-black uppercase text-primary mb-3">
                    CORE DATA RELATIONSHIP & TRACEABILITY (SECTION 45)
                  </h3>
                  <div className="bg-muted/30 p-4 rounded-xl border border-primary/20 text-center font-mono text-xs space-y-1 font-bold">
                    <p className="text-primary">PurchaseOrder ➔ PurchaseOrderItem</p>
                    <p>↓</p>
                    <p>ASN ➔ ASNItem</p>
                    <p>↓</p>
                    <p>GateEntry ➔ GatePass</p>
                    <p>↓</p>
                    <p>DockReceiving ➔ ReceivingItem</p>
                    <p>↓</p>
                    <p className="text-amber-600">QualityInspection</p>
                    <p>↓</p>
                    <p className="text-emerald-600 font-black">GRN ➔ GRNItem</p>
                    <p>↓</p>
                    <p>MaterialLot ➔ HandlingUnit ➔ QR / Barcode</p>
                  </div>
                </Card>
              </TabsContent>
            </Tabs>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
