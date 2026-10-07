/**
 * KaizenX Mobile Application Constants
 * Endpoints, Default URLs, and Configuration Constants
 */

export const DEFAULT_SERVER_BASE_URL = "http://192.168.1.175:8000";

export const API_ENDPOINTS = {
  // Auth
  LOGIN: "/api/v1/auth/login",
  HEALTH: "/health",

  // Gate Security Dashboard & Deliveries
  GATEDASHBOARD: "/api/v1/gate/dashboard",
  GATEDASHBOARD_STATS: "/api/v1/gate/dashboard/stats",
  EXPECTED_DELIVERIES: "/api/v1/gate/expected-deliveries",
  ASN_DETAILS: (asnNumber: string) => `/api/v1/gate/asn/${encodeURIComponent(asnNumber)}`,
  PO_DETAILS: (poNumber: string) => `/api/v1/gate/po/${encodeURIComponent(poNumber)}`,

  // Gate Pass & Entries
  GATE_ENTRIES: "/api/v1/gate/entries",
  UNSCHEDULED_ENTRIES: "/api/v1/gate/entries/unscheduled",
  PATCH_GATE_ENTRY: (id: string) => `/api/v1/gate/entries/${id}`,
  UPLOAD_DOCUMENTS: (id: string) => `/api/v1/gate/entries/${id}/documents`,
  UPLOAD_VEHICLE_PHOTO: (id: string) => `/api/v1/gate/entries/${id}/vehicle-photo`,
  GATE_ENTRY_DOCK: (id: string) => `/api/v1/gate/entries/${id}/dock`,
  GENERATE_GATE_PASS: (id: string) => `/api/v1/gate/entries/${id}/gate-pass`,
  CONFIRM_ENTRY: (id: string) => `/api/v1/gate/entries/${id}/confirm-entry`,
  ACTIVE_VEHICLES: "/api/v1/gate/vehicles/active",
  FETCH_GATE_PASS: (gatePassNumber: string) => `/api/v1/gate/gate-pass/${encodeURIComponent(gatePassNumber)}`,
  SCAN_GATE_PASS: "/api/v1/gate/scan",
};

export const VEHICLE_TYPES = [
  "Truck",
  "Container",
  "Mini Truck",
  "Trailer",
  "Tanker",
  "Other",
] as const;

export const VEHICLE_CONDITIONS = ["Normal", "Damaged", "Suspicious"] as const;

export const WIZARD_STEPS = [
  { id: 1, key: "VEHICLE", title: "1. Vehicle" },
  { id: 2, key: "DRIVER", title: "2. Driver" },
  { id: 3, key: "DOCUMENTS", title: "3. Documents" },
  { id: 4, key: "DOCK", title: "4. Dock" },
  { id: 5, key: "REVIEW", title: "5. Review" },
] as const;
