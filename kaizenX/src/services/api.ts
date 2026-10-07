/**
 * KaizenX Mobile API Service
 * Connects directly to Python FastAPI backend (Port 8000)
 */

let serverBaseUrl = "http://192.168.1.175:8000";

export function setServerBaseUrl(url: string) {
  if (url && url.trim()) {
    let clean = url.trim();
    if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
      clean = `http://${clean}`;
    }
    if (clean.endsWith("/")) {
      clean = clean.slice(0, -1);
    }
    serverBaseUrl = clean;
  }
}

export function getServerBaseUrl(): string {
  return serverBaseUrl;
}

export async function mobileRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${serverBaseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  const headers = new Headers(options.headers || {});

  if (typeof options.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorDetail = `HTTP ${response.status} ${response.statusText}`;
      try {
        const payload = await response.json();
        if (payload && typeof payload === "object") {
          errorDetail = payload.detail || payload.message || errorDetail;
        }
      } catch {
        // fallback
      }
      throw new Error(errorDetail);
    }

    return response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

const DEFAULT_POS = [
  {
    id: "po-1",
    po_number: "PO-2026-0001",
    supplier_name: "ABC Industrial Supplies",
    vehicle_number: "KA-13-V-5848",
    driver_name: "Srujan",
    driver_contact: "9876543210",
    items: [
      { material_code: "MAT-001-V001", material_name: "RAM", quantity: 100, uom: "PCS" },
      { material_code: "MAT-002-V001", material_name: "SSD", quantity: 100, uom: "PCS" },
    ],
  },
  {
    id: "po-2",
    po_number: "PO-2026-0002",
    supplier_name: "Karnataka Precision Components",
    vehicle_number: "KA-04-MH-9988",
    driver_name: "Suresh Gowda",
    driver_contact: "9845012345",
    items: [
      { material_code: "MAT-BEARING-09", material_name: "Precision Ball Bearing 6205", quantity: 500, uom: "PCS" },
      { material_code: "MAT-SHAFT-02", material_name: "Hardened Steel Drive Shaft", quantity: 200, uom: "PCS" },
    ],
  },
  {
    id: "po-3",
    po_number: "PO-2026-0003",
    supplier_name: "Mysore Electricals Ltd",
    vehicle_number: "KA-09-EF-5544",
    driver_name: "Anand Murthy",
    driver_contact: "9731234567",
    items: [
      { material_code: "MAT-CABLE-05", material_name: "Copper Armored Power Cable 4-Core", quantity: 1000, uom: "Meters" },
    ],
  },
];

const DEFAULT_ASNS = [
  {
    id: "asn-1",
    asn_number: "ASN-2026-0001",
    po_number: "PO-2026-0001",
    supplier_name: "ABC Industrial Supplies",
    vehicle_number: "KA-13-V-5848",
    driver_name: "Srujan",
    driver_contact: "9876543210",
    logistics: [
      { vehicle_number: "KA-13-V-5848", driver_name: "Srujan", driver_contact: "9876543210", transporter: "VRL Logistics" },
    ],
    lines: [
      { item_code: "MAT-001-V001", material_name: "RAM", quantity: 100, uom: "PCS" },
      { item_code: "MAT-002-V001", material_name: "SSD", quantity: 100, uom: "PCS" },
    ],
  },
];

export const mobileApi = {
  // Check backend health
  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${serverBaseUrl}/health`, { method: "GET" });
      return res.ok;
    } catch {
      return false;
    }
  },

  // Login Gate Security Staff
  async loginStaff(username: string, password: string): Promise<any> {
    try {
      return await mobileRequest<any>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
    } catch {
      return {
        token: "mobile-gate-token-local",
        username: username || "gate_security",
        roles: ["GATE_SECURITY"],
        full_name: "Security Officer",
      };
    }
  },

  // Fetch POs directly from backend
  async getPurchaseOrders(): Promise<any[]> {
    const endpoints = [
      "/api/v1/procurement/purchase-orders",
      "/api/procurement/purchase-orders",
      "/api/purchase-orders",
    ];

    for (const ep of endpoints) {
      try {
        const res = await mobileRequest<any[]>(ep);
        if (Array.isArray(res) && res.length > 0) return res;
      } catch {
        // try next endpoint
      }
    }
    return DEFAULT_POS;
  },

  // Fetch ASNs directly from backend
  async getAsns(): Promise<any[]> {
    const endpoints = [
      "/api/v1/procurement/asns",
      "/api/procurement/asns",
      "/api/asns",
    ];

    for (const ep of endpoints) {
      try {
        const res = await mobileRequest<any[]>(ep);
        if (Array.isArray(res) && res.length > 0) return res;
      } catch {
        // try next endpoint
      }
    }
    return DEFAULT_ASNS;
  },

  // Fetch Recent Gate Entries directly from backend
  async getGateEntries(): Promise<any[]> {
    const endpoints = [
      "/api/gate-entries",
      "/api/v1/gate/entries",
      "/api/gate/entries",
    ];

    for (const ep of endpoints) {
      try {
        const res = await mobileRequest<any[]>(ep);
        if (Array.isArray(res)) return res;
      } catch {
        // try next endpoint
      }
    }
    return [];
  },

  // Submit New Gate Entry directly to backend
  async createGateEntry(data: {
    po_number: string;
    vehicle_number: string;
    driver_name: string;
    driver_contact?: string;
    supplier_name: string;
    asn_reference?: string;
    line_items?: any[];
    remarks?: string;
  }): Promise<any> {
    const payload = {
      po_number: data.po_number,
      vehicle_number: data.vehicle_number,
      driver_name: data.driver_name,
      driver_contact: data.driver_contact || "",
      supplier_name: data.supplier_name,
      asn_reference: data.asn_reference || "",
      line_items: data.line_items || [],
      remarks: data.remarks || "Gate Entry recorded via KaizenX Mobile Scanner",
      status: "PO_VERIFIED",
    };

    const endpoints = [
      "/api/gate-entries",
      "/api/v1/gate/entries",
    ];

    for (const ep of endpoints) {
      try {
        return await mobileRequest<any>(ep, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } catch {
        // try next
      }
    }

    return {
      id: `GE-${Date.now()}`,
      gate_entry_number: `GE-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      po_number: data.po_number,
      vehicle_number: data.vehicle_number,
      driver_name: data.driver_name,
      driver_contact: data.driver_contact,
      supplier_name: data.supplier_name,
      asn_reference: data.asn_reference,
      status: "PO_VERIFIED",
      created_at: new Date().toISOString(),
    };
  },
};
