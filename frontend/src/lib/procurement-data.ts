export interface MaterialRequest {
  id: string;
  requestNo: string;
  requester: string;
  department: string;
  date: string;
  status: "Draft" | "Pending Approval" | "Approved" | "Converted to RFQ" | "Rejected";
  priority: "High" | "Normal" | "Low";
  items: { code: string; desc: string; qty: number; uom: string }[];
}

export const materialRequests: MaterialRequest[] = [
  {
    id: "MR-1001",
    requestNo: "MR/2026/08/1001",
    requester: "S. Kulkarni",
    department: "Production — Line 4",
    date: "10 Aug 2026",
    status: "Approved",
    priority: "High",
    items: [
      { code: "RM-HDPE-04", desc: "HDPE Granules Grade 5502", qty: 500, uom: "BAG" },
      { code: "RM-POLY-01", desc: "Polypropylene Resin", qty: 200, uom: "KG" },
    ],
  },
  {
    id: "MR-1002",
    requestNo: "MR/2026/08/1002",
    requester: "J. Doe",
    department: "Maintenance",
    date: "11 Aug 2026",
    status: "Pending Approval",
    priority: "Normal",
    items: [{ code: "MRO-OIL-02", desc: "Hydraulic Oil ISO 46", qty: 10, uom: "CAN" }],
  },
  {
    id: "MR-1003",
    requestNo: "MR/2026/08/1003",
    requester: "A. Sharma",
    department: "Packaging",
    date: "12 Aug 2026",
    status: "Draft",
    priority: "Low",
    items: [{ code: "PK-BOX-12", desc: "Corrugated Box 12x12x12", qty: 1000, uom: "PCS" }],
  },
];

export interface RFQ {
  id: string;
  rfqNo: string;
  title: string;
  createdDate: string;
  expiryDate: string;
  status: "Draft" | "Published" | "Quotations Received" | "Closed" | "PO Created";
  vendors: string[];
  items: { code: string; desc: string; qty: number; uom: string }[];
}

export const rfqs: RFQ[] = [
  {
    id: "RFQ-5001",
    rfqNo: "RFQ/2026/08/5001",
    title: "Annual Supply of HDPE Granules",
    createdDate: "05 Aug 2026",
    expiryDate: "15 Aug 2026",
    status: "Quotations Received",
    vendors: ["Hindustan Polymers Ltd.", "Reliance Industries", "Supreme Petrochem"],
    items: [{ code: "RM-HDPE-04", desc: "HDPE Granules Grade 5502", qty: 5000, uom: "BAG" }],
  },
  {
    id: "RFQ-5002",
    rfqNo: "RFQ/2026/08/5002",
    title: "Quarterly Packaging Requirements",
    createdDate: "10 Aug 2026",
    expiryDate: "20 Aug 2026",
    status: "Published",
    vendors: ["Arvind Packaging", "Horizon Packs"],
    items: [{ code: "PK-BOX-12", desc: "Corrugated Box 12x12x12", qty: 10000, uom: "PCS" }],
  },
];

export interface Quotation {
  id: string;
  quotationNo: string;
  rfqNo: string;
  vendor: string;
  date: string;
  totalValue: string;
  status: "Submitted" | "Technical Review" | "Selected" | "Rejected";
  deliveryLeadTime: string;
  items: { code: string; desc: string; qty: number; rate: number; amount: number }[];
}

export const quotations: Quotation[] = [
  {
    id: "QT-9001",
    quotationNo: "QT/HPL/2026/112",
    rfqNo: "RFQ/2026/08/5001",
    vendor: "Hindustan Polymers Ltd.",
    date: "11 Aug 2026",
    totalValue: "₹ 1,09,00,000",
    status: "Selected",
    deliveryLeadTime: "7 Days",
    items: [
      {
        code: "RM-HDPE-04",
        desc: "HDPE Granules Grade 5502",
        qty: 5000,
        rate: 2180,
        amount: 10900000,
      },
    ],
  },
  {
    id: "QT-9002",
    quotationNo: "QT/RIL/2026/08-01",
    rfqNo: "RFQ/2026/08/5001",
    vendor: "Reliance Industries",
    date: "12 Aug 2026",
    totalValue: "₹ 1,12,50,000",
    status: "Submitted",
    deliveryLeadTime: "5 Days",
    items: [
      {
        code: "RM-HDPE-04",
        desc: "HDPE Granules Grade 5502",
        qty: 5000,
        rate: 2250,
        amount: 11250000,
      },
    ],
  },
];

export interface PurchaseOrder {
  id: string;
  poNo: string;
  vendor: string;
  date: string;
  expectedDelivery: string;
  status: "Draft" | "Released" | "Acknowledged" | "Partially Received" | "Completed" | "Cancelled";
  totalValue: string;
  items: { code: string; desc: string; qty: number; uom: string; rate: number; received: number }[];
}

export const purchaseOrders: PurchaseOrder[] = [
  {
    id: "PO-2026-118432",
    poNo: "PO-2026-118432",
    vendor: "Hindustan Polymers Ltd.",
    date: "18 Jul 2026",
    expectedDelivery: "31 Jul 2026",
    status: "Released",
    totalValue: "₹ 24,88,500",
    items: [
      {
        code: "RM-HDPE-04",
        desc: "HDPE Granules Grade 5502",
        qty: 960,
        uom: "BAG",
        rate: 2180,
        received: 0,
      },
      {
        code: "RM-HDPE-09",
        desc: "HDPE Granules Grade 6070",
        qty: 240,
        uom: "BAG",
        rate: 2410,
        received: 0,
      },
    ],
  },
  {
    id: "PO-2026-118401",
    poNo: "PO-2026-118401",
    vendor: "Sundaram Fasteners",
    date: "15 Jul 2026",
    expectedDelivery: "25 Jul 2026",
    status: "Partially Received",
    totalValue: "₹ 11,20,300",
    items: [
      { code: "FS-BOLT-12", desc: "M12 Hex Bolt", qty: 5000, uom: "PCS", rate: 15, received: 3000 },
    ],
  },
];

export interface ASN {
  id: string;
  asnNo: string;
  poNo: string;
  vendor: string;
  shipDate: string;
  expectedArrival: string;
  truckNo: string;
  status: "Shipped" | "In Transit" | "Arrived" | "Cancelled";
}

export const asns: ASN[] = [
  {
    id: "ASN-2026-001",
    asnNo: "ASN/2026/001",
    poNo: "PO-2026-118432",
    vendor: "Hindustan Polymers Ltd.",
    shipDate: "28 Jul 2026",
    expectedArrival: "31 Jul 2026",
    truckNo: "MH 12 QT 4489",
    status: "Shipped",
  },
];
