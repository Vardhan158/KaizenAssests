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
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock,
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
  | "READY_FOR_PUTAWAY";

const statusLabels: Record<ReceivingStatus, string> = {
  PENDING_RECEIVING: "Pending Receiving",
  AT_DOCK: "At Dock",
  UNLOADING: "Unloading",
  UNLOADING_COMPLETED: "Unloading Completed",
  QC_PENDING: "QC Pending",
  QC_IN_PROGRESS: "QC In Progress",
  QC_COMPLETED: "QC Completed",
  GRN_DRAFT: "GRN Draft",
  GRN_REVIEW: "GRN Review",
  GRN_POSTED: "GRN Posted",
  READY_FOR_PUTAWAY: "Ready for Putaway",
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
    poNo: "PO-8741",
    asnNo: "ASN-2026-004582",
    dockNo: "D-04",
    warehouseName: "Raw Material Warehouse",
    zoneName: "Inbound Receiving Bay",
    status: "AT_DOCK",
    entryTime: "07 Oct 2026 • 10:42 AM",
    securityOfficer: "Rajesh Kumar (SEC-8042)",
    assignedOperator: "Ramesh Kumar (Operator)",
    assignedInspector: "Priya Sharma (QC Inspector)",
    expectedQty: 500,
    receivedQty: 500,
    damagedQty: 0,
    acceptedQty: 480,
    rejectedQty: 20,
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
    securityOfficer: "Rajesh Kumar (SEC-8042)",
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
    securityOfficer: "Rajesh Kumar (SEC-8042)",
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

export function ReceivingControlCenter() {
  const [records, setRecords] = useState<InboundRecord[]>(INITIAL_RECORDS);
  const [selectedRecord, setSelectedRecord] = useState<InboundRecord | null>(INITIAL_RECORDS[0]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("overview");

  // Operators & Inspectors for Assignment (Section 9)
  const [assignedOp, setAssignedOp] = useState("Ramesh Kumar (Warehouse Operator)");
  const [assignedQc, setAssignedQc] = useState("Priya Sharma (Incoming Quality Inspector)");

  const handleAssignOperator = (opName: string) => {
    setAssignedOp(opName);
    if (selectedRecord) {
      setSelectedRecord({ ...selectedRecord, assignedOperator: opName });
    }
    toast.success(`Operator assigned: ${opName}`, {
      description: "Mobile notification dispatched to assigned Warehouse Operator.",
    });
  };

  const handleAssignInspector = (qcName: string) => {
    setAssignedQc(qcName);
    if (selectedRecord) {
      setSelectedRecord({ ...selectedRecord, assignedInspector: qcName });
    }
    toast.success(`Quality Inspector assigned: ${qcName}`, {
      description: "Mobile notification dispatched to assigned Quality Inspector.",
    });
  };

  const filteredRecords = records.filter((r) => {
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
      title="Warehouse Manager Inbound Receiving Control Center"
      subtitle="Section 6–9: Dock control, operator assignment, receiving inspection and GRN orchestration"
    >
      <div className="space-y-6">
        {/* Section 6 - KPI Dashboard Stat Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Card className="rounded-2xl border-primary/20 p-4 bg-card shadow-soft">
            <div className="mb-2 flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Truck className="size-5" />
            </div>
            <p className="text-2xl font-black">8</p>
            <p className="text-xs font-semibold text-muted-foreground mt-1">Vehicles Inside</p>
          </Card>

          <Card className="rounded-2xl border-amber-500/20 p-4 bg-card shadow-soft">
            <div className="mb-2 flex size-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
              <Clock className="size-5" />
            </div>
            <p className="text-2xl font-black text-amber-600">2</p>
            <p className="text-xs font-semibold text-muted-foreground mt-1">Waiting for Dock</p>
          </Card>

          <Card className="rounded-2xl border-sky-500/20 p-4 bg-card shadow-soft">
            <div className="mb-2 flex size-9 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600">
              <PackageCheck className="size-5" />
            </div>
            <p className="text-2xl font-black text-sky-600">3</p>
            <p className="text-xs font-semibold text-muted-foreground mt-1">Unloading</p>
          </Card>

          <Card className="rounded-2xl border-cyan-500/20 p-4 bg-card shadow-soft">
            <div className="mb-2 flex size-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-600">
              <ShieldCheck className="size-5" />
            </div>
            <p className="text-2xl font-black text-cyan-600">4</p>
            <p className="text-xs font-semibold text-muted-foreground mt-1">QC Pending</p>
          </Card>

          <Card className="rounded-2xl border-emerald-500/20 p-4 bg-card shadow-soft">
            <div className="mb-2 flex size-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
              <FileCheck2 className="size-5" />
            </div>
            <p className="text-2xl font-black text-emerald-600">5</p>
            <p className="text-xs font-semibold text-muted-foreground mt-1">GRN Pending</p>
          </Card>

          <Card className="rounded-2xl border-red-500/20 p-4 bg-card shadow-soft">
            <div className="mb-2 flex size-9 items-center justify-center rounded-xl bg-red-500/10 text-red-600">
              <AlertTriangle className="size-5" />
            </div>
            <p className="text-2xl font-black text-red-600">2</p>
            <p className="text-xs font-semibold text-muted-foreground mt-1">Receiving Exceptions</p>
          </Card>
        </div>

        {/* Section 6 - Main Table */}
        <Card className="rounded-2xl border-border/50 shadow-soft">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold">INBOUND RECEIVING TABLE</CardTitle>
              <CardDescription>Live inbound vehicles, assigned docks, and receiving status</CardDescription>
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

        {/* Section 7 - Receiving Detail Page */}
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

            {/* Section 7 - Tabs */}
            <Tabs defaultValue="overview" value={activeTab} onValueChange={setActiveTab} className="mt-4">
              <TabsList className="bg-muted/50 p-1 rounded-xl flex-wrap">
                <TabsTrigger value="overview" className="rounded-lg text-xs font-bold">OVERVIEW</TabsTrigger>
                <TabsTrigger value="materials" className="rounded-lg text-xs font-bold">MATERIALS</TabsTrigger>
                <TabsTrigger value="documents" className="rounded-lg text-xs font-bold">DOCUMENTS</TabsTrigger>
                <TabsTrigger value="quality" className="rounded-lg text-xs font-bold">QUALITY</TabsTrigger>
                <TabsTrigger value="grn" className="rounded-lg text-xs font-bold">GRN</TabsTrigger>
                <TabsTrigger value="activity" className="rounded-lg text-xs font-bold">ACTIVITY LOG</TabsTrigger>
              </TabsList>

              {/* Section 8 - Overview Tab */}
              <TabsContent value="overview" className="mt-4 space-y-4">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {/* Gate Information */}
                  <Card className="rounded-xl p-4 bg-muted/20 border-border/60">
                    <h3 className="text-xs font-black uppercase text-primary mb-2">Gate Information</h3>
                    <div className="space-y-1 text-xs">
                      <p className="flex justify-between"><span className="text-muted-foreground">Gate Pass:</span> <span className="font-bold font-mono">{selectedRecord.gatePassNo}</span></p>
                      <p className="flex justify-between"><span className="text-muted-foreground">Gate:</span> <span className="font-bold">Main Gate – 01</span></p>
                      <p className="flex justify-between"><span className="text-muted-foreground">Entry Time:</span> <span className="font-bold">{selectedRecord.entryTime}</span></p>
                      <p className="flex justify-between"><span className="text-muted-foreground">Security Officer:</span> <span className="font-bold">{selectedRecord.securityOfficer}</span></p>
                    </div>
                  </Card>

                  {/* Supplier Information */}
                  <Card className="rounded-xl p-4 bg-muted/20 border-border/60">
                    <h3 className="text-xs font-black uppercase text-primary mb-2">Supplier Information</h3>
                    <div className="space-y-1 text-xs">
                      <p className="flex justify-between"><span className="text-muted-foreground">Supplier Name:</span> <span className="font-bold">{selectedRecord.supplierName}</span></p>
                      <p className="flex justify-between"><span className="text-muted-foreground">Supplier Code:</span> <span className="font-bold font-mono">{selectedRecord.supplierCode}</span></p>
                      <p className="flex justify-between"><span className="text-muted-foreground">Contact:</span> <span className="font-bold">+91 98765 43210</span></p>
                    </div>
                  </Card>

                  {/* Procurement */}
                  <Card className="rounded-xl p-4 bg-muted/20 border-border/60">
                    <h3 className="text-xs font-black uppercase text-primary mb-2">Procurement Details</h3>
                    <div className="space-y-1 text-xs">
                      <p className="flex justify-between"><span className="text-muted-foreground">PO Number:</span> <span className="font-bold font-mono text-primary">{selectedRecord.poNo}</span></p>
                      <p className="flex justify-between"><span className="text-muted-foreground">ASN Number:</span> <span className="font-bold font-mono">{selectedRecord.asnNo}</span></p>
                      <p className="flex justify-between"><span className="text-muted-foreground">Expected Qty:</span> <span className="font-bold">{selectedRecord.expectedQty} KG</span></p>
                    </div>
                  </Card>

                  {/* Transportation */}
                  <Card className="rounded-xl p-4 bg-muted/20 border-border/60">
                    <h3 className="text-xs font-black uppercase text-primary mb-2">Transportation</h3>
                    <div className="space-y-1 text-xs">
                      <p className="flex justify-between"><span className="text-muted-foreground">Vehicle:</span> <span className="font-bold text-sky-600">{selectedRecord.vehicleNo}</span></p>
                      <p className="flex justify-between"><span className="text-muted-foreground">Driver:</span> <span className="font-bold">{selectedRecord.driverName}</span></p>
                      <p className="flex justify-between"><span className="text-muted-foreground">Transporter:</span> <span className="font-bold">{selectedRecord.transporterName}</span></p>
                      <p className="flex justify-between"><span className="text-muted-foreground">LR Number:</span> <span className="font-bold font-mono">{selectedRecord.lrNo} ({selectedRecord.lrDate})</span></p>
                    </div>
                  </Card>

                  {/* Documents */}
                  <Card className="rounded-xl p-4 bg-muted/20 border-border/60">
                    <h3 className="text-xs font-black uppercase text-primary mb-2">Attached Documents</h3>
                    <div className="space-y-1 text-xs">
                      <p className="flex justify-between"><span className="text-muted-foreground">Invoice:</span> <span className="font-bold">{selectedRecord.invoiceNo} ({selectedRecord.invoiceAmount})</span></p>
                      <p className="flex justify-between"><span className="text-muted-foreground">E-Way Bill:</span> <span className="font-bold">{selectedRecord.ewayNo} (Valid: {selectedRecord.ewayValidUntil})</span></p>
                      <p className="flex justify-between"><span className="text-muted-foreground">Challan:</span> <span className="font-bold">DC-2026-4412</span></p>
                    </div>
                  </Card>

                  {/* Section 9 - Assignments */}
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

              {/* Materials Tab */}
              <TabsContent value="materials" className="mt-4">
                <Card className="rounded-xl p-4 bg-card border-border/60">
                  <h3 className="text-xs font-black uppercase text-primary mb-3">Line Items Breakdown</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b bg-muted/40 font-bold uppercase text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">Material Code</th>
                          <th className="px-3 py-2">Description</th>
                          <th className="px-3 py-2 text-right">Expected Qty</th>
                          <th className="px-3 py-2 text-right">Received Qty</th>
                          <th className="px-3 py-2 text-right">Damaged Qty</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        <tr>
                          <td className="px-3 py-2 font-mono font-bold text-primary">MAT-SS-304-001</td>
                          <td className="px-3 py-2 font-medium">Stainless Steel Sheet 304 Grade 2mm</td>
                          <td className="px-3 py-2 text-right font-bold">{selectedRecord.expectedQty} KG</td>
                          <td className="px-3 py-2 text-right font-bold text-emerald-600">{selectedRecord.receivedQty} KG</td>
                          <td className="px-3 py-2 text-right font-bold text-amber-600">{selectedRecord.damagedQty} KG</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </Card>
              </TabsContent>

              {/* Quality Tab */}
              <TabsContent value="quality" className="mt-4">
                <Card className="rounded-xl p-4 bg-card border-border/60 space-y-3">
                  <h3 className="text-xs font-black uppercase text-primary">Quality Inspection Decision</h3>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 text-emerald-700 dark:text-emerald-400">
                      <p className="text-[10px] uppercase font-bold">Accepted Quantity</p>
                      <p className="text-xl font-black mt-1">{selectedRecord.acceptedQty} KG</p>
                    </div>
                    <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-3 text-red-700 dark:text-red-400">
                      <p className="text-[10px] uppercase font-bold">Rejected Quantity</p>
                      <p className="text-xl font-black mt-1">{selectedRecord.rejectedQty} KG</p>
                    </div>
                    <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-amber-700 dark:text-amber-400">
                      <p className="text-[10px] uppercase font-bold">Defect Reason</p>
                      <p className="text-xs font-bold mt-1">Surface Scratch / Dent</p>
                    </div>
                  </div>
                </Card>
              </TabsContent>

              {/* GRN Tab */}
              <TabsContent value="grn" className="mt-4">
                <Card className="rounded-xl p-4 bg-card border-border/60 space-y-3">
                  <h3 className="text-xs font-black uppercase text-primary">GRN & Handling Unit QR Labels</h3>
                  <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/30 p-4 rounded-xl border">
                    <div>
                      <p className="text-sm font-bold font-mono text-primary">GRN-2026-80942</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Handling Unit Pallets: HU-PALLET-2026-901-01 / 02</p>
                    </div>
                    <Button onClick={() => toast.success("GRN Certificate & QR Labels Printed Successfully")} className="rounded-xl shadow-glow">
                      <QrCode className="mr-2 size-4" /> Print GRN & HU QR Labels
                    </Button>
                  </div>
                </Card>
              </TabsContent>

              {/* Activity Tab */}
              <TabsContent value="activity" className="mt-4">
                <Card className="rounded-xl p-4 bg-card border-border/60">
                  <h3 className="text-xs font-black uppercase text-primary mb-3">Timestamped Audit Log</h3>
                  <div className="space-y-2 text-xs">
                    <p className="flex justify-between border-b pb-1"><span>10:42 AM · Security Officer</span> <span className="font-bold">Gate Entry Completed (GP-BLR-0048)</span></p>
                    <p className="flex justify-between border-b pb-1"><span>10:45 AM · Warehouse Manager</span> <span className="font-bold">Dock D-04 Confirmed & Operator Assigned</span></p>
                    <p className="flex justify-between border-b pb-1"><span>11:10 AM · Operator Ramesh</span> <span className="font-bold">Unloading Completed (500 KG Received)</span></p>
                    <p className="flex justify-between"><span>11:30 AM · Quality Inspector Priya</span> <span className="font-bold">QC Decision Submitted (480 KG Accepted / 20 KG Rejected)</span></p>
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
