export const DEFAULT_SERVER_BASE_URL = 'http://192.168.88.45:8000';

export const API_ENDPOINTS = {
  LOGIN: '/api/v1/auth/login',
  HEALTH: '/health',
  GATE_DASHBOARD: '/api/v1/gate/dashboard',
  GATE_DASHBOARD_STATS: '/api/v1/gate/dashboard/stats',
  EXPECTED_DELIVERIES: '/api/v1/gate/expected-deliveries',
  ASN_DETAILS: (asnNumber: string) =>
    `/api/v1/gate/asn/${encodeURIComponent(asnNumber)}`,
  GATE_ENTRIES: '/api/v1/gate/entries',
  UNSCHEDULED_ENTRIES: '/api/v1/gate/entries/unscheduled',
  PATCH_GATE_ENTRY: (id: string) => `/api/v1/gate/entries/${id}`,
  UPLOAD_VEHICLE_PHOTO: (id: string) =>
    `/api/v1/gate/entries/${id}/vehicle-photo`,
  GATE_ENTRY_DOCK: (id: string) => `/api/v1/gate/entries/${id}/dock`,
  GENERATE_GATE_PASS: (id: string) => `/api/v1/gate/entries/${id}/gate-pass`,
  CONFIRM_ENTRY: (id: string) => `/api/v1/gate/entries/${id}/confirm-entry`,
  ACTIVE_VEHICLES: '/api/v1/gate/vehicles/active',
  FETCH_GATE_PASS: (gatePassNumber: string) =>
    `/api/v1/gate/gate-pass/${encodeURIComponent(gatePassNumber)}`,
  SCAN_GATE_PASS: '/api/v1/gate/scan',
} as const;

export const GATE_ENTRY_STEPS = [
  { id: 1, key: 'VEHICLE', title: 'Vehicle' },
  { id: 2, key: 'DRIVER', title: 'Driver' },
  { id: 3, key: 'DOCK', title: 'Dock' },
  { id: 4, key: 'REVIEW', title: 'Review' },
] as const;
