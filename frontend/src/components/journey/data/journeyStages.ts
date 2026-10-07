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
  route: string;
  actionLabel: string;
  alignment: "left" | "right";
  metrics: JourneyMetric[];
  telemetry: {
    label: string;
    value: string;
  }[];
  // 3D camera trajectory waypoints
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
}

export const JOURNEY_STAGES: JourneyStage[] = [
  {
    id: "gate-entry",
    number: "01",
    chapter: "INBOUND",
    title: "GATE ENTRY",
    headline: "Every warehouse journey begins at the gate.",
    description:
      "Inbound commercial delivery transport arrives at perimeter security. High-speed OCR and ANPR verify driver credentials, license plates, and Advance Shipping Notices (ASNs) before grant of entry.",
    route: "/gate-entry",
    actionLabel: "EXPLORE GATE ENTRY",
    alignment: "left",
    metrics: [
      { value: "3.2 min", label: "AVG CLEARANCE" },
      { value: "99.8%", label: "ASN VERIFIED" },
      { value: "ACTIVE", label: "GATE STATUS" },
    ],
    telemetry: [
      { label: "TRUCK ID", value: "FL-8820" },
      { label: "ASN NUMBER", value: "ASN-90412" },
      { label: "GATE PASS", value: "GRANTED" },
    ],
    cameraPosition: [-8, 4.5, 32],
    cameraTarget: [0, 2, 16],
  },
  {
    id: "grn",
    number: "02",
    chapter: "RECEIVING",
    title: "GRN / RECEIVING",
    headline: "Physical goods become verified warehouse stock.",
    description:
      "Freight docks at assigned hydraulic bays. Line-by-line electronic verification reconciles physical piece counts against delivery notes, executing automated Goods Receipt Notes (GRN) with QR labeling.",
    route: "/grn",
    actionLabel: "EXPLORE GRN",
    alignment: "right",
    metrics: [
      { value: "100%", label: "RECEIVED" },
      { value: "45 sec", label: "AVG SCAN" },
      { value: "98.7%", label: "MATCHED" },
    ],
    telemetry: [
      { label: "PO NUMBER", value: "PO-4092-A" },
      { label: "EXPECTED", value: "480 UNITS" },
      { label: "RECEIVED", value: "480 UNITS" },
      { label: "VARIANCE", value: "0.00%" },
    ],
    cameraPosition: [9, 3.8, -18],
    cameraTarget: [-2, 1.8, -25],
  },
  {
    id: "putaway",
    number: "03",
    chapter: "STORAGE",
    title: "STORE / PUTAWAY",
    headline: "Every received item finds its place.",
    description:
      "Algorithmic putaway engines direct operators along velocity-optimized transport routes. Accepted pallets are slotted into structured multi-tier racks with laser-precise bin barcode verification.",
    route: "/putaway-tasks",
    actionLabel: "EXPLORE PUTAWAY",
    alignment: "left",
    metrics: [
      { value: "99.9%", label: "SLOT ACCURACY" },
      { value: "12 sec", label: "AVG PUTAWAY" },
      { value: "REAL-TIME", label: "TRACKING" },
    ],
    telemetry: [
      { label: "TARGET AISLE", value: "AISLE-04" },
      { label: "DESTINATION", value: "RACK-B-08" },
      { label: "PALLET BARCODE", value: "PLT-77291" },
    ],
    cameraPosition: [-7, 4.2, -62],
    cameraTarget: [4, 2.5, -75],
  },
  {
    id: "inventory",
    number: "04",
    chapter: "VISIBILITY",
    title: "INVENTORY",
    headline: "Every movement becomes visible.",
    description:
      "A perpetual single-source-of-truth stock ledger. Real-time telemetry monitors available, allocated, reserved, and quarantined inventory across all zones with instant batch traceability.",
    route: "/inventory",
    actionLabel: "EXPLORE INVENTORY",
    alignment: "right",
    metrics: [
      { value: "99.98%", label: "LEDGER ACCURACY" },
      { value: "LIVE", label: "VISIBILITY" },
      { value: "0", label: "BLIND SPOTS" },
    ],
    telemetry: [
      { label: "AVAILABLE", value: "14,280 UNITS" },
      { label: "ALLOCATED", value: "3,420 UNITS" },
      { label: "RESERVED", value: "890 UNITS" },
      { label: "QUARANTINED", value: "14 UNITS" },
    ],
    cameraPosition: [12, 16, -105],
    cameraTarget: [0, 4, -118],
  },
  {
    id: "assembly",
    number: "05",
    chapter: "PRODUCTION",
    title: "ASSEMBLY",
    headline: "Inventory becomes production.",
    description:
      "Manufacturing work orders synchronize component staging with automated roller conveyors. Multi-level bills of materials (BOM) are debited in real-time as parts converge into finished goods.",
    route: "/assembly-work-orders",
    actionLabel: "EXPLORE ASSEMBLY",
    alignment: "left",
    metrics: [
      { value: "100%", label: "MATERIAL TRACE" },
      { value: "REAL-TIME", label: "CONSUMPTION" },
      { value: "98.7%", label: "YIELD RATE" },
    ],
    telemetry: [
      { label: "WORK ORDER", value: "WO-2026-88" },
      { label: "BOM REVISION", value: "REV-4.2" },
      { label: "INLINE QC", value: "PASS" },
    ],
    cameraPosition: [-8, 4.2, -152],
    cameraTarget: [2, 1.8, -165],
  },
  {
    id: "dispatch",
    number: "06",
    chapter: "OUTBOUND",
    title: "DISPATCH",
    headline: "Finished goods begin their next journey.",
    description:
      "Assembled and certified units are consolidated onto export pallets, stretch-wrapped, and staged at outbound bays. Trailer cube optimization ensures rapid vehicle loading and manifest sealing.",
    route: "/dock-management",
    actionLabel: "EXPLORE DISPATCH",
    alignment: "right",
    metrics: [
      { value: "22 min", label: "AVG LOAD TIME" },
      { value: "99.9%", label: "ORDER ACCURACY" },
      { value: "+48%", label: "DOCK VELOCITY" },
    ],
    telemetry: [
      { label: "STAGING BAY", value: "BAY-12" },
      { label: "TRAILER LOAD", value: "96.4%" },
      { label: "SEAL NUMBER", value: "SL-99318" },
    ],
    cameraPosition: [9, 4.0, -198],
    cameraTarget: [-3, 2.0, -210],
  },
  {
    id: "gate-exit",
    number: "07",
    chapter: "COMPLETE",
    title: "GATE EXIT",
    headline: "From arrival to departure — one connected warehouse journey.",
    description:
      "The outbound transport passes automated weight-bridge verification and final biometric security clearance. Digital gate passes are sealed, closing the end-to-end supply chain loop.",
    route: "/vehicle-exit",
    actionLabel: "EXPLORE GATE EXIT",
    alignment: "left",
    metrics: [
      { value: "100%", label: "DISPATCHED" },
      { value: "<45 sec", label: "EXIT CLEARANCE" },
      { value: "0", label: "UNTRACKED" },
    ],
    telemetry: [
      { label: "GROSS WEIGHT", value: "24,840 KG" },
      { label: "VARIANCE", value: "0.0%" },
      { label: "TRIP STATUS", value: "COMPLETED" },
    ],
    cameraPosition: [-10, 6.5, -235],
    cameraTarget: [0, 2.2, -255],
  },
];
