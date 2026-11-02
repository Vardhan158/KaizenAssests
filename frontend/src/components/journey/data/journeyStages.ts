export interface JourneyMetric {
  value: string;
  label: string;
}

export interface JourneyStage {
  id: string;
  number: string;
  chapter: string;
  title: string;
  headline: string;
  description: string;
  department: string;
  document: string;
  nextProcess: string;
  route: string;
  actionLabel: string;
  alignment: "left" | "right";
  metrics: JourneyMetric[];
  telemetry: {
    label: string;
    value: string;
  }[];
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
}

export const JOURNEY_STAGES: JourneyStage[] = [
  {
    id: "supplier-asn",
    number: "01",
    chapter: "SUPPLIER",
    title: "SUPPLIER CREATES & SENDS ASN",
    headline: "Electronic shipping manifest dispatched prior to vehicle arrival.",
    description:
      "Supplier creates an Advance Shipping Notice (ASN) linked to PO-2026-4092. Electronic notification is transmitted to Gate Security and Warehouse Manager.",
    department: "Supplier Logistics",
    document: "ASN-90412 / PO-2026-4092",
    nextProcess: "Step 02: Truck Arrives at Security Gate",
    route: "/supplier-dashboard",
    actionLabel: "VIEW ASN DISPATCH",
    alignment: "left",
    metrics: [
      { value: "ASN-90412", label: "MANIFEST ID" },
      { value: "480 UNITS", label: "SHIPMENT QTY" },
      { value: "SCHEDULED", label: "DISPATCH STATUS" },
    ],
    telemetry: [
      { label: "SUPPLIER", value: "Apex Components Ltd" },
      { label: "PO REF", value: "PO-2026-4092" },
      { label: "DESTINATION", value: "Bay D-04 / Gate 1" },
    ],
    cameraPosition: [-12, 10, 38],
    cameraTarget: [0.8, 1.8, 23.0],
  },
  {
    id: "gate-arrival",
    number: "02",
    chapter: "SECURITY GATE",
    title: "TRUCK ARRIVES AT SECURITY GATE",
    headline: "Inbound delivery transport reaches security checkpoint.",
    description:
      "Loaded commercial delivery vehicle arrives at factory entrance. Stopped by automated security barrier for document and driver verification.",
    department: "Perimeter Security",
    document: "Vehicle KA-01-AB-1234",
    nextProcess: "Step 03: Security Verification & Gate Pass",
    route: "/gate-entry",
    actionLabel: "EXPLORE GATE ARRIVAL",
    alignment: "right",
    metrics: [
      { value: "KA-01-AB-1234", label: "TRUCK NO" },
      { value: "3.2 min", label: "CHECKPOINT DURATION" },
      { value: "ARRIVED", label: "ENTRY STATUS" },
    ],
    telemetry: [
      { label: "DRIVER", value: "Ramesh Kumar" },
      { label: "CARGO", value: "Raw Industrial Materials" },
      { label: "CHECKPOINT", value: "Gate #01" },
    ],
    cameraPosition: [-7.5, 4.5, 28.5],
    cameraTarget: [0.0, 1.8, 17.5],
  },
  {
    id: "gate-verification",
    number: "03",
    chapter: "SECURITY GATE",
    title: "SECURITY VERIFICATION & GATE PASS",
    headline: "Driver credentials and shipping documents verified.",
    description:
      "Security officer verifies ASN, Purchase Order, supplier credentials, driver ID, and vehicle registration. QR Gate Pass generated and entrance barrier opens.",
    department: "Security Clearance",
    document: "Gate Pass GP-2026-88",
    nextProcess: "Step 04: Warehouse Dock Allocation",
    route: "/gate-entry",
    actionLabel: "VIEW GATE PASS",
    alignment: "left",
    metrics: [
      { value: "99.8%", label: "VERIFICATION RATE" },
      { value: "GP-2026-88", label: "GATE PASS ID" },
      { value: "APPROVED", label: "ENTRY STATUS" },
    ],
    telemetry: [
      { label: "INVOICE", value: "INV-883921" },
      { label: "QR BARCODE", value: "GP-QR-8821" },
      { label: "BARRIER", value: "OPENED" },
    ],
    cameraPosition: [-4.5, 3.8, 20.0],
    cameraTarget: [0.0, 1.8, 10.0],
  },
  {
    id: "dock-allocation",
    number: "04",
    chapter: "DOCK MANAGEMENT",
    title: "WAREHOUSE DOCK ALLOCATION",
    headline: "Warehouse Manager assigns an available unloading bay.",
    description:
      "Warehouse control allocates Hydraulic Bay D-04 based on cargo type and bay availability. Automated assignment notification dispatched to Gate Security.",
    department: "Warehouse Management",
    document: "Bay D-04 Allocation Slip",
    nextProcess: "Step 05: Truck Arrives at Dock",
    route: "/dock-management",
    actionLabel: "VIEW DOCK ALLOCATION",
    alignment: "right",
    metrics: [
      { value: "D-04", label: "ALLOCATED BAY" },
      { value: "HYDRAULIC", label: "DOCK TYPE" },
      { value: "READY", label: "BAY STATUS" },
    ],
    telemetry: [
      { label: "STORE MGR", value: "Rajesh V." },
      { label: "BAY NUMBER", value: "D-04" },
      { label: "ROUTE SIGNAL", value: "SENT TO GATE" },
    ],
    cameraPosition: [5.0, 6.0, -5.0],
    cameraTarget: [-8.5, 2.0, -22.0],
  },
  {
    id: "dock-arrival",
    number: "05",
    chapter: "DOCK MANAGEMENT",
    title: "TRUCK ARRIVES AT DOCK",
    headline: "Vehicle maneuvers and docks at designated unloading bay.",
    description:
      "Supplier truck drives through internal perimeter access road and reverses into Bay D-04. Dock seal engages and hydraulic door opens.",
    department: "Inbound Dock Ops",
    document: "Dock Manifest D-04",
    nextProcess: "Step 06: Goods Unloading",
    route: "/dock-management",
    actionLabel: "VIEW DOCK ARRIVAL",
    alignment: "left",
    metrics: [
      { value: "100%", label: "DOCK ALIGNMENT" },
      { value: "SEALED", label: "DOCK SEAL" },
      { value: "DOCKED", label: "VEHICLE STATUS" },
    ],
    telemetry: [
      { label: "BAY ID", value: "BAY-D04" },
      { label: "HYDRAULIC RAMP", value: "LEVELLED" },
      { label: "REAR DOORS", value: "OPENED" },
    ],
    cameraPosition: [1.0, 4.8, -14.0],
    cameraTarget: [-8.5, 1.8, -21.5],
  },
  {
    id: "goods-unloading",
    number: "06",
    chapter: "RECEIVING",
    title: "GOODS UNLOADING",
    headline: "Pallets unloaded from vehicle into receiving area.",
    description:
      "Warehouse operators and forklift unload raw material pallets from trailer bed into dock receiving staging zone for manifest count verification.",
    department: "Receiving Team",
    document: "Unloading Manifest",
    nextProcess: "Step 07: Quality Inspection",
    route: "/grn",
    actionLabel: "VIEW RECEIVING STAGING",
    alignment: "right",
    metrics: [
      { value: "480 UNITS", label: "UNLOADED QTY" },
      { value: "12 PALLETS", label: "PALLET COUNT" },
      { value: "IN PROGRESS", label: "UNLOAD STATUS" },
    ],
    telemetry: [
      { label: "UNLOAD ZONE", value: "RECEIVING-01" },
      { label: "FORKLIFT ID", value: "FL-01" },
      { label: "DAMAGE REPORT", value: "0 DEFECTS" },
    ],
    cameraPosition: [-3.5, 3.2, -19.5],
    cameraTarget: [-8.5, 1.5, -24.0],
  },
  {
    id: "quality-inspection",
    number: "07",
    chapter: "QUALITY CONTROL",
    title: "QUALITY INSPECTION (IQC)",
    headline: "Incoming materials inspected for quality & specs.",
    description:
      "Incoming Quality Control (IQC) inspector checks material specifications, piece counts, and packaging integrity. Goods marked Accepted, Rejected, or Hold.",
    department: "Quality Control (IQC)",
    document: "IQC Inspection Report #8821",
    nextProcess: "Step 08: Material QR Generation",
    route: "/grn",
    actionLabel: "VIEW QUALITY REPORT",
    alignment: "left",
    metrics: [
      { value: "100%", label: "INSPECTED" },
      { value: "99.2%", label: "ACCEPTANCE RATE" },
      { value: "APPROVED", label: "IQC STATUS" },
    ],
    telemetry: [
      { label: "INSPECTOR", value: "Anil S." },
      { label: "GOOD QTY", value: "480 UNITS" },
      { label: "REJECT QTY", value: "0 UNITS" },
    ],
    cameraPosition: [-3.5, 2.8, -21.0],
    cameraTarget: [-7.5, 1.5, -23.8],
  },
  {
    id: "material-qr",
    number: "08",
    chapter: "RECEIVING",
    title: "MATERIAL QR GENERATION",
    headline: "Serialized QR barcode labels generated and attached.",
    description:
      "Automated thermal barcode printer generates unique QR labels for accepted raw materials. Labels scanned and recorded into perpetual inventory ledger.",
    department: "Stock Identification",
    document: "Material QR Tags / GRN-2026-904",
    nextProcess: "Step 09: Forklift Moves Materials to Inventory",
    route: "/grn",
    actionLabel: "VIEW GRN & QR TAGS",
    alignment: "right",
    metrics: [
      { value: "480 TAGS", label: "QR GENERATED" },
      { value: "SERIALIZED", label: "TRACKING" },
      { value: "GRN POSTED", label: "RECEIVING STATUS" },
    ],
    telemetry: [
      { label: "GRN NO", value: "GRN-2026-904" },
      { label: "QR BARCODE", value: "MAT-MOT-1001-QR" },
      { label: "LEDGER LINK", value: "CONFIRMED" },
    ],
    cameraPosition: [-4.0, 2.6, -21.5],
    cameraTarget: [-8.5, 1.5, -23.8],
  },
  {
    id: "inventory-putaway",
    number: "09",
    chapter: "STORAGE",
    title: "INVENTORY PUTAWAY",
    headline: "Forklift places pallets into assigned high-bay storage racks.",
    description:
      "Forklift transports QR-labeled pallets along warehouse aisles and slots them into assigned storage bins and high-bay rack locations.",
    department: "Warehouse Storage",
    document: "Putaway Slip #4012",
    nextProcess: "Step 10: Assembly Requests Raw Materials",
    route: "/putaway-tasks",
    actionLabel: "EXPLORE PUTAWAY TASKS",
    alignment: "left",
    metrics: [
      { value: "RACK-B-08", label: "SLOTTED BIN" },
      { value: "99.9%", label: "BIN ACCURACY" },
      { value: "STORED", label: "PUTAWAY STATUS" },
    ],
    telemetry: [
      { label: "TARGET AISLE", value: "AISLE-04" },
      { label: "BIN CODE", value: "MEC-Z01-B08" },
      { label: "FORKLIFT", value: "FL-02 ACTIVE" },
    ],
    cameraPosition: [-2.5, 4.0, -62.0],
    cameraTarget: [8.0, 2.2, -68.0],
  },
  {
    id: "assembly-request",
    number: "10",
    chapter: "MANUFACTURING",
    title: "ASSEMBLY MATERIAL REQUEST",
    headline: "Assembly line requests raw materials for production.",
    description:
      "Assembly Line Manager submits raw material requisition for Work Order WO-2026-88. Requisition transmitted electronically to Warehouse Control.",
    department: "Assembly Staging",
    document: "Requisition REQ-9904 / WO-2026-88",
    nextProcess: "Step 11: Warehouse Issues Materials to Assembly",
    route: "/assembly-work-orders",
    actionLabel: "VIEW REQUISITIONS",
    alignment: "right",
    metrics: [
      { value: "REQ-9904", label: "REQUISITION ID" },
      { value: "WO-2026-88", label: "WORK ORDER" },
      { value: "APPROVED", label: "REQ STATUS" },
    ],
    telemetry: [
      { label: "ASSEMBLY MGR", value: "Suresh P." },
      { label: "REQUIRED ITEM", value: "Electric Motor 15HP" },
      { label: "REQUIRED QTY", value: "50 UNITS" },
    ],
    cameraPosition: [-13.0, 8.5, -146.0],
    cameraTarget: [-0.8, 1.8, -165.0],
  },
  {
    id: "warehouse-issue",
    number: "11",
    chapter: "STORE ISSUE",
    title: "WAREHOUSE MATERIAL ISSUE",
    headline: "Warehouse operator picks & delivers requested components.",
    description:
      "Warehouse keeper picks required components from storage racks, scans QR code for verification, and delivers to assembly staging area.",
    department: "Store Issue",
    document: "Pick Slip & Material Issue Voucher",
    nextProcess: "Step 12: Production Starts",
    route: "/inventory",
    actionLabel: "VIEW MATERIAL ISSUE",
    alignment: "left",
    metrics: [
      { value: "50 UNITS", label: "ISSUED QTY" },
      { value: "VERIFIED", label: "QR SCAN" },
      { value: "DELIVERED", label: "ISSUE STATUS" },
    ],
    telemetry: [
      { label: "PICK LOCATION", value: "BIN-MEC-Z01" },
      { label: "KEEPER", value: "Venkatesh K." },
      { label: "TRANSFER", value: "STORE TO ASSEMBLY" },
    ],
    cameraPosition: [-12.0, 8.0, -150.0],
    cameraTarget: [0.0, 1.8, -165.0],
  },
  {
    id: "production-start",
    number: "12",
    chapter: "MANUFACTURING",
    title: "PRODUCTION IN PROGRESS",
    headline: "Assembly line machinery & operators commence production.",
    description:
      "Workstation operators and automated assembly equipment process raw materials and components along the active roller conveyor line.",
    department: "Manufacturing Line",
    document: "Work Order WO-2026-88 Execution",
    nextProcess: "Step 13: Finished Goods & QR Generation",
    route: "/assembly-work-orders",
    actionLabel: "VIEW WORK ORDERS",
    alignment: "right",
    metrics: [
      { value: "98.7%", label: "LINE EFFICIENCY" },
      { value: "50 UNITS", label: "TARGET OUTPUT" },
      { value: "RUNNING", label: "LINE STATUS" },
    ],
    telemetry: [
      { label: "WORKSTATION", value: "LINE-01 / CELL-A" },
      { label: "CONVEYOR", value: "SPEED 1.2 m/s" },
      { label: "INLINE QC", value: "PASS" },
    ],
    cameraPosition: [-11.0, 7.5, -153.0],
    cameraTarget: [0.35, 1.5, -165.0],
  },
  {
    id: "fg-qr-storage",
    number: "13",
    chapter: "MANUFACTURING",
    title: "FINISHED GOODS QR & HOLDING",
    headline: "Assembled products inspected, serialized & stored in assembly.",
    description:
      "Completed products pass final inspection, receive Finished Goods serialization QR tag, and enter the designated assembly holding area.",
    department: "Finished Goods Staging",
    document: "FG Serial #FG-9004",
    nextProcess: "Step 14: Customer Requests Finished Goods",
    route: "/assembly-work-orders",
    actionLabel: "VIEW FINISHED GOODS",
    alignment: "left",
    metrics: [
      { value: "FG-9004", label: "SERIAL RANGE" },
      { value: "50 UNITS", label: "FG COMPLETED" },
      { value: "STORED IN ASSY", label: "HOLDING STATUS" },
    ],
    telemetry: [
      { label: "STAGING AREA", value: "ASSEMBLY HOLDING" },
      { label: "QUALITY CERT", value: "PASSED 100%" },
      { label: "SERIALIZATION", value: "COMPLETED" },
    ],
    cameraPosition: [-12.0, 7.0, -154.0],
    cameraTarget: [3.5, 1.5, -168.0],
  },
  {
    id: "customer-order",
    number: "14",
    chapter: "OUTBOUND",
    title: "CUSTOMER DISPATCH REQUEST",
    headline: "External sales order received for finished product dispatch.",
    description:
      "External customer sales order reference received. Dispatch team authorizes picking and staging of finished goods from assembly holding.",
    department: "Dispatch Operations",
    document: "Sales Order SO-7712",
    nextProcess: "Step 15: Finished Goods Packing & Truck Loading",
    route: "/dock-management",
    actionLabel: "VIEW SALES ORDERS",
    alignment: "right",
    metrics: [
      { value: "SO-7712", label: "SALES ORDER" },
      { value: "50 UNITS", label: "ORDERED QTY" },
      { value: "AUTHORIZED", label: "DISPATCH STATUS" },
    ],
    telemetry: [
      { label: "CUSTOMER", value: "Global Motors Corp" },
      { label: "DESTINATION", value: "Pune Distribution Hub" },
      { label: "DISPATCH PLAN", value: "EXPRESS SHIPMENT" },
    ],
    cameraPosition: [-11.0, 7.0, -160.0],
    cameraTarget: [3.5, 1.8, -175.0],
  },
  {
    id: "fg-packing-loading",
    number: "15",
    chapter: "OUTBOUND",
    title: "PACKING & TRUCK LOADING",
    headline: "Finished goods packed, verified & loaded onto outbound truck.",
    description:
      "Finished goods are packed, QR verified, and loaded onto outbound transport trailer at dispatch bay with stretch wrap and seal authorization.",
    department: "Outbound Shipping",
    document: "Shipping Manifest & Trailer Seal #SL-99318",
    nextProcess: "Step 16: Outbound Gate Exit",
    route: "/dock-management",
    actionLabel: "VIEW OUTBOUND DOCK",
    alignment: "left",
    metrics: [
      { value: "BAY-12", label: "OUTBOUND BAY" },
      { value: "96.4%", label: "TRAILER LOAD" },
      { value: "LOADED", label: "SHIPPING STATUS" },
    ],
    telemetry: [
      { label: "OUTBOUND TRUCK", value: "MH-12-PQ-9988" },
      { label: "SEAL NO", value: "SL-99318" },
      { label: "LOAD TIME", value: "18 MINUTES" },
    ],
    cameraPosition: [8.0, 6.0, -190.0],
    cameraTarget: [-6.0, 2.0, -207.0],
  },
  {
    id: "gate-exit",
    number: "16",
    chapter: "DISPATCH EXIT",
    title: "OUTBOUND GATE EXIT",
    headline: "Outbound truck departs facility with verified gate pass.",
    description:
      "Outbound transport reaches exit checkpoint. Security verifies dispatch authorization and gate pass. Barrier opens and truck departs.",
    department: "Perimeter Security",
    document: "Exit Gate Pass EX-2026-99",
    nextProcess: "Lifecycle Complete (Restart or Enter Dashboard)",
    route: "/vehicle-exit",
    actionLabel: "EXPLORE VEHICLE EXIT",
    alignment: "right",
    metrics: [
      { value: "EX-2026-99", label: "EXIT PASS ID" },
      { value: "<45 sec", label: "EXIT CLEARANCE" },
      { value: "DISPATCHED", label: "FINAL STATUS" },
    ],
    telemetry: [
      { label: "GROSS WEIGHT", value: "24,840 KG" },
      { label: "AUTHORIZATION", value: "SECURITY VERIFIED" },
      { label: "TRIP STATUS", value: "COMPLETED" },
    ],
    cameraPosition: [10.0, 7.0, -230.0],
    cameraTarget: [0.8, 2.0, -252.0],
  },
];
