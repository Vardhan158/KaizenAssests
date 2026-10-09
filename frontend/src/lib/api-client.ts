/**
 * Central API Client using native fetch.
 * Links frontend components to the backend python business-service (port 8000)
 * and Java auth-service (port 8080).
 */
import QRCode from "qrcode";

export const BUSINESS_API_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta.env?.VITE_BUSINESS_API_URL || import.meta.env?.VITE_BUSINESS_SERVICE_URL)) ||
  (typeof window !== "undefined"
    ? window.location.hostname.includes("loca.lt")
      ? "https://wms-mobile-backend-8000.loca.lt"
      : `${window.location.protocol}//${window.location.hostname}:8001`
    : "http://localhost:8001");
import { clearAuthSession, getAuthToken, storeAuthSession, getUserInfo } from "./auth-utils";
function getApiErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;

  const { detail, message } = payload as { detail?: unknown; message?: unknown };
  if (typeof detail === "string") return detail;
  if (typeof message === "string") return message;

  if (Array.isArray(detail)) {
    return (
      detail
        .map((issue) => {
          if (!issue || typeof issue !== "object") return null;
          const { loc, msg } = issue as { loc?: unknown; msg?: unknown };
          const field = Array.isArray(loc) ? loc.filter((part) => part !== "body").join(".") : "";
          return typeof msg === "string" ? (field ? `${field}: ${msg}` : msg) : null;
        })
        .filter((message): message is string => Boolean(message))
        .join("; ") || fallback
    );
  }

  return fallback;
}

export function resolveMediaUrl(path?: string | null): string {
  if (!path) return "";
  const trimmed = path.trim();
  if (
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://")
  ) {
    return trimmed;
  }
  const cleanPath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${BUSINESS_API_URL}${cleanPath}`;
}

/**
 * PostgreSQL Decimal values are serialized by the API as strings (for example,
 * "1.0000"). Convert only quantity-shaped response fields to numbers so every
 * screen renders whole quantities as "1" while retaining real fractions such
 * as "1.5". Storage and request precision are not changed.
 */
function normalizeQuantityValues(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeQuantityValues(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        normalizeQuantityValues(entryValue, entryKey),
      ]),
    );
  }

  const isQuantityField =
    /(?:^|_)(?:qty|quantity|quantities)$/i.test(key) || /(?:Qty|Quantity|Quantities)$/.test(key);
  if (isQuantityField && typeof value === "string" && value.trim() !== "") {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : value;
  }

  return value;
}

// Request helper with automatic header injection
async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});

  // Fetch treats a string body as plain text unless its media type is declared.
  // All string bodies produced by this client are JSON.stringify payloads.
  if (typeof options.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // Inject Bearer Authorization header if token exists
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  } else {
    // Local dev auto-fallback headers for local environment security dependencies
    headers.set("Authorization", "Bearer local_dev_mock_token");
  }

  // Inject user roles and store context headers from session when available
  try {
    const userInfo = getUserInfo();
    if (userInfo) {
      if (userInfo.roles && userInfo.roles.length > 0 && !headers.has("X-User-Roles")) {
        headers.set("X-User-Roles", userInfo.roles.join(","));
      }
      if ((userInfo.store_id || userInfo.storeId) && !headers.has("X-Store-Id")) {
        headers.set("X-Store-Id", userInfo.store_id || userInfo.storeId!);
      }
      if ((userInfo.store_code || userInfo.storeCode) && !headers.has("X-Store-Code")) {
        headers.set("X-Store-Code", userInfo.store_code || userInfo.storeCode!);
      }
      if (userInfo.username && !headers.has("X-User-Name")) {
        headers.set("X-User-Name", userInfo.username);
      }
      if (userInfo.employee_id && !headers.has("X-Employee-Id")) {
        headers.set("X-Employee-Id", userInfo.employee_id);
      }
    }
  } catch {
    // Ignore if running in non-browser context
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = "API request failed";
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = getApiErrorMessage(errorJson, errorMessage);
    } catch {
      errorMessage = errorText || errorMessage;
    }
    const httpError = new Error(errorMessage) as Error & { status?: number };
    httpError.status = response.status;
    throw httpError;
  }

  // Successful DELETE requests commonly return 204 with no response body.
  // Calling response.json() for an empty body throws "Unexpected end of JSON input".
  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }

  const responseText = await response.text();
  if (!responseText.trim()) {
    return undefined as T;
  }

  return normalizeQuantityValues(JSON.parse(responseText)) as T;
}

export const api = {
  // Authentication Use Cases
  async login(
    username: string,
    password: string,
    rememberMe = false,
  ): Promise<{
    token: string;
    username: string;
    roles: string[];
    supplierId?: string;
    mustChangePassword?: boolean;
    applications?: string[];
  }> {
    if (username.startsWith("supplier_") || username === "supplier") {
      const response = await request<any>(
        `${BUSINESS_API_URL}/api/v1/procurement/auth/supplier-login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        },
      );
      const supplierUser = {
        token: response.token,
        username: response.username,
        roles: ["SUPPLIER"],
        supplierId: response.supplierId,
        mustChangePassword: response.mustChangePassword,
      };
      storeAuthSession(supplierUser, rememberMe);
      return supplierUser;
    }
    try {
      const response = await request<any>(`${BUSINESS_API_URL}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const devUser = {
        token: response.token || `token-${Date.now()}`,
        username: response.username || username,
        roles: response.roles || (username.toLowerCase().includes("warehouse") ? ["WAREHOUSE", "WAREHOUSE_MANAGER"] : ["ADMIN"]),
        employee_id: response.employee_id || "EMP-001",
        full_name: response.full_name || username,
        store_id: response.store_id,
        store_code: response.store_code,
        applications: response.applications || [],
      };
      storeAuthSession(devUser, rememberMe);
      return devUser;
    } catch {
      const uLower = username.toLowerCase();
      const isWarehouse = uLower.includes("warehouse");
      const isGate = uLower.includes("gate") || uLower.includes("security") || uLower.includes("emp-8042");
      const isGrn = uLower.includes("grn") || uLower.includes("receiving");
      const isAssembly = uLower.includes("assembly");
      const isStore = uLower.includes("store") || uLower.includes("keeper");
      const isSupplier = uLower.includes("supplier");
      const isManager = uLower.includes("manager") && !isAssembly && !isStore && !isWarehouse;

      const roles = isWarehouse
        ? ["WAREHOUSE", "WAREHOUSE_MANAGER"]
        : isManager
        ? ["MANAGER"]
        : isGate
        ? ["GATE_SECURITY"]
        : isGrn
        ? ["GRN", "WAREHOUSE"]
        : isAssembly
        ? ["ASSEMBLY_MANAGER"]
        : isStore
        ? ["STORE_MANAGER", "STORE_KEEPER"]
        : isSupplier
        ? ["SUPPLIER"]
        : ["ADMIN", "SUPERUSER"];

      const mockUser = {
        token: `mock-jwt-${username}-token`,
        username,
        roles,
        employee_id: "EMP-DEV-01",
        full_name: username.replace(/_/g, " ").toUpperCase(),
        store_code: isStore ? "STR-001" : undefined,
      };
      storeAuthSession(mockUser, rememberMe);
      return mockUser;
    }
  },

  async changePassword(data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/auth/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },

  async magicLogin(token: string): Promise<any> {
    const response = await request<any>(
      `${BUSINESS_API_URL}/api/v1/procurement/auth/magic-login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      },
    );
    const supplierUser = {
      token: response.token,
      username: response.username,
      roles: ["SUPPLIER"],
      supplierId: response.supplierId || response.supplier_id,
      mustChangePassword: false,
    };
    storeAuthSession(supplierUser, true);
    return {
      ...supplierUser,
      rfq_id: response.rfqId || response.rfq_id,
      rfqId: response.rfqId || response.rfq_id,
      po_id: response.poId || response.po_id,
      poId: response.poId || response.po_id,
      link_type: response.linkType || response.link_type,
      linkType: response.linkType || response.link_type,
      email: response.email,
      expires_in_hours: response.expiresInHours || response.expires_in_hours,
      expiresInHours: response.expiresInHours || response.expires_in_hours,
    };
  },

  async verifyMagicToken(token: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/procurement/auth/verify-magic-token?token=${encodeURIComponent(token)}`,
    );
  },

  async getRfq(rfqId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/rfqs/${rfqId}`);
  },

  logout() {
    clearAuthSession();
  },

  // Gate Entry Use Cases
  async getGateEntries(status?: string): Promise<any[]> {
    const url = status
      ? `${BUSINESS_API_URL}/api/gate-entries?status=${encodeURIComponent(status)}`
      : `${BUSINESS_API_URL}/api/gate-entries`;
    return request<any[]>(url);
  },

  async getInboundArrivals(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/gate-entries/inbound-arrivals`);
  },
  async createUnscheduledGateEntry(formData: FormData): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/unscheduled`, {
      method: "POST",
      body: formData,
    });
  },

  async getDocks(
    statusOrParams?: string | { dock_type?: string; status?: string },
    type?: string,
  ): Promise<any[]> {
    const query = new URLSearchParams();
    if (typeof statusOrParams === "object" && statusOrParams !== null) {
      if (statusOrParams.dock_type && statusOrParams.dock_type !== "ALL")
        query.set("dock_type", statusOrParams.dock_type);
      if (statusOrParams.status && statusOrParams.status !== "ALL")
        query.set("status", statusOrParams.status);
    } else {
      if (statusOrParams && statusOrParams !== "ALL") query.set("status", statusOrParams);
      if (type && type !== "ALL") query.set("dock_type", type);
    }
    const qStr = query.toString() ? `?${query.toString()}` : "";
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/warehouse/docks${qStr}`);
  },
  async getDockHistory(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/warehouse/dock-history`);
  },
  async getDockTypes(): Promise<string[]> {
    return request<string[]>(`${BUSINESS_API_URL}/api/v1/warehouse/dock-types`);
  },
  async getDockOverviewMetrics(): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/warehouse/docks/availability`);
  },
  async getPendingAllocations(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/warehouse/dock-allocation-requests/pending`);
  },
  async getDockAllocationRequests(): Promise<any[]> {
    return this.getPendingAllocations();
  },
  async allocateDock(
    allocationRequestId: string,
    dockId: string,
    storeManagerIdOrOpts?:
      | string
      | {
          assignedStoreId?: string;
          storeManagerId?: string;
          storeManagerUsername?: string;
          storeManagerName?: string;
        },
    storeManagerUsername?: string,
    storeManagerName?: string,
  ): Promise<any> {
    let smId: string | null = null;
    let smUsername: string | null = null;
    let smName: string | null = null;

    if (storeManagerIdOrOpts && typeof storeManagerIdOrOpts === "object") {
      smId = storeManagerIdOrOpts.storeManagerId || null;
      smUsername = storeManagerIdOrOpts.storeManagerUsername || null;
      smName = storeManagerIdOrOpts.storeManagerName || null;
    } else {
      smId = (storeManagerIdOrOpts as string) || null;
      smUsername = storeManagerUsername || null;
      smName = storeManagerName || null;
    }

    return request<any>(`${BUSINESS_API_URL}/api/v1/warehouse/dock-allocations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
          allocation_request_id: allocationRequestId,
          dock_id: dockId,
          assigned_store_id: (storeManagerIdOrOpts as any)?.assignedStoreId || null,
          store_manager_id: smId,
        store_manager_username: smUsername,
        store_manager_name: smName,
      }),
    });
  },
  async markVehicleArrived(id: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/warehouse/dock-allocations/${encodeURIComponent(id)}/arrive`,
      {
        method: "POST",
      },
    );
  },

  async reassignDock(
    allocationRequestId: string,
    newDockId: string,
    reason?: string,
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/warehouse/dock-allocations/${allocationRequestId}/reassign`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          new_dock_id: newDockId,
          reason: reason || "Manual reassignment by manager",
        }),
      },
    );
  },
  async releaseDock(id: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/warehouse/dock-allocations/${encodeURIComponent(id)}/release`,
      {
        method: "POST",
      },
    );
  },
  async releaseDockAssignment(allocationRequestId: string): Promise<any> {
    return this.releaseDock(allocationRequestId);
  },
  async cancelDockAllocation(allocationRequestId: string, reason?: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/warehouse/dock-allocations/${encodeURIComponent(allocationRequestId)}/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      },
    );
  },
  async createDock(payload: {
    dock_code?: string;
    dock_number?: string;
    dock_name?: string;
    dock_type: string;
    location?: string;
    description?: string;
    status?: string;
    is_active?: boolean;
    warehouse_id?: string;
    capacity?: number;
  }): Promise<any> {
    const code = (payload.dock_code || payload.dock_number || "").trim().toUpperCase();
    if (!code) throw new Error("Dock code is required");
    const name = (payload.dock_name || code).trim();
    return request<any>(`${BUSINESS_API_URL}/api/v1/warehouse/docks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dock_code: code,
        dock_name: name,
        dock_type: payload.dock_type,
        location: payload.location || null,
        description: payload.description || null,
        status: payload.status || "AVAILABLE",
        is_active: payload.is_active !== undefined ? payload.is_active : true,
      }),
    });
  },
  async updateDock(
    dockIdOrNumber: string,
    payload:
      | {
          dock_code?: string;
          dock_number?: string;
          dock_name?: string;
          dock_type?: string;
          location?: string;
          description?: string;
          status?: string;
          is_active?: boolean;
          warehouse_id?: string;
          capacity?: number;
        }
      | any,
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/warehouse/docks/${encodeURIComponent(dockIdOrNumber)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
  },
  async updateDockStatus(dockId: string, status: string, reason?: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/warehouse/docks/${encodeURIComponent(dockId)}/status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason }),
      },
    );
  },
  async assignDock(gateEntryId: string, dockId: string, storeId?: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/${gateEntryId}/assign-dock`, {
      method: "POST",
      body: JSON.stringify({ dock_id: dockId, store_id: storeId }),
    });
  },

  async startDockMovement(gateEntryId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/${gateEntryId}/start-dock-movement`, {
      method: "POST",
    });
  },

  async confirmDockCheckIn(gateEntryId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/${gateEntryId}/dock-check-in`, {
      method: "POST",
    });
  },

  async startUnloading(gateEntryId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/${gateEntryId}/start-unloading`, {
      method: "POST",
    });
  },

  async recordReceivingQuantities(
    gateEntryId: string,
    items: Array<{ item_code: string; received_quantity: number }>,
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/gate-entries/${gateEntryId}/receiving-quantities`,
      {
        method: "PUT",
        body: JSON.stringify({ items }),
      },
    );
  },

  async recordMaterialConditions(
    gateEntryId: string,
    items: Array<{
      item_code: string;
      good_quantity: number;
      damaged_quantity: number;
      rejected_quantity: number;
      inspection_required: boolean;
      physical_condition_ok: boolean;
      packaging_ok: boolean;
      specifications_ok: boolean;
      serial_batch_number?: string;
      serial_batch_verified: boolean;
      notes?: string;
    }>,
  ): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/${gateEntryId}/material-conditions`, {
      method: "PUT",
      body: JSON.stringify({ items }),
    });
  },

  async createDamageReport(
    gateEntryId: string,
    data: {
      itemCode: string;
      damagedQuantity: number;
      damageReason: string;
      remarks?: string;
      photos: File[];
    },
  ): Promise<any> {
    const form = new FormData();
    form.append("item_code", data.itemCode);
    form.append("damaged_quantity", String(data.damagedQuantity));
    form.append("damage_reason", data.damageReason);
    if (data.remarks) form.append("remarks", data.remarks);
    data.photos.forEach((photo) => form.append("photos", photo));
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/${gateEntryId}/damage-reports`, {
      method: "POST",
      body: form,
    });
  },

  async quarantineDamagedMaterial(gateEntryId: string, itemCode: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/gate-entries/${gateEntryId}/materials/${encodeURIComponent(itemCode)}/quarantine`,
      { method: "POST" },
    );
  },

  async submitDamageReport(reportId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/damage-reports/${reportId}/submit`, {
      method: "POST",
    });
  },

  async createSupplierDamageClaim(reportId: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/gate-entries/quality/damage-reports/${reportId}/claims`,
      { method: "POST" },
    );
  },

  async getDamageClaims(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/damage-claims`);
  },
  async respondToDamageClaim(id: string, data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/damage-claims/${id}/respond`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  async createReplacementShipment(id: string, data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/damage-claims/${id}/replacement-shipments`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  async replacementGateEntry(id: string, vehicle_number: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/damage-claims/replacement-shipments/${id}/gate-entry`,
      { method: "POST", body: JSON.stringify({ vehicle_number }) },
    );
  },
  async receiveReplacement(id: string, received_quantity: number): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/damage-claims/replacement-shipments/${id}/receive`,
      { method: "POST", body: JSON.stringify({ received_quantity }) },
    );
  },
  async inspectReplacement(
    id: string,
    accepted_quantity: number,
    damaged_quantity: number,
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/damage-claims/replacement-shipments/${id}/inspect`,
      { method: "POST", body: JSON.stringify({ accepted_quantity, damaged_quantity }) },
    );
  },
  async putawayReplacement(id: string, location: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/damage-claims/replacement-shipments/${id}/putaway`,
      { method: "POST", body: JSON.stringify({ location }) },
    );
  },
  async postReplacementInventory(id: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/damage-claims/replacement-shipments/${id}/post-inventory`,
      { method: "POST" },
    );
  },
  async createSupplierReturn(id: string, vehicle_number: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/damage-claims/${id}/returns`, {
      method: "POST",
      body: JSON.stringify({ vehicle_number }),
    });
  },
  async completeSupplierReturn(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/damage-claims/returns/${id}/gate-exit`, {
      method: "POST",
    });
  },
  async closeDamageClaim(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/damage-claims/${id}/close`, { method: "POST" });
  },

  async generateHandlingUnits(gateEntryId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/${gateEntryId}/handling-units`, {
      method: "POST",
    });
  },

  async completeQualityInspection(
    gateEntryId: string,
    decision: "PASS" | "FAIL",
    notes?: string,
  ): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/${gateEntryId}/quality-inspection`, {
      method: "POST",
      body: JSON.stringify({ decision, notes }),
    });
  },

  async sendQualityIssue(gateEntryId: string, image: File): Promise<any> {
    const formData = new FormData();
    formData.append("image", image);
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/${gateEntryId}/quality-issue`, {
      method: "POST",
      body: formData,
    });
  },

  async getQualityIssues(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/gate-entries/quality/issues`, {
      cache: "no-store",
    });
  },

  async forwardQualityIssue(gateEntryId: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/gate-entries/quality/issues/${gateEntryId}/forward`,
      {
        method: "POST",
      },
    );
  },

  async completeReceiving(gateEntryId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/${gateEntryId}/complete-receiving`, {
      method: "POST",
    });
  },

  async releaseGateDock(gateEntryId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/${gateEntryId}/release-dock`, {
      method: "POST",
    });
  },

  async markInboundVehicleExited(gateEntryId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/${gateEntryId}/vehicle-exited`, {
      method: "POST",
    });
  },

  async getVehicleExitQueue(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/gate-entries/exit-queue`);
  },

  async approveVehicleExit(
    gateEntryId: string,
    payload: {
      exit_document_reference: string;
      asn_verified: boolean;
      po_verified: boolean;
      grn_verified: boolean;
      receiving_verified: boolean;
      vehicle_verified: boolean;
      driver_verified: boolean;
    },
  ): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/${gateEntryId}/approve-exit`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async getGateExitQueue(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/gate-entries/gate-exit-queue`);
  },

  async completeGateExit(gateEntryId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/${gateEntryId}/complete-gate-exit`, {
      method: "POST",
    });
  },

  async getOutboundDispatchQueue(status?: string, search?: string): Promise<any[]> {
    if (status?.toUpperCase() === "ALL") {
      const params = new URLSearchParams({ limit: "200" });
      if (search?.trim()) params.set("search", search.trim());
      const result = await request<{ items?: any[] }>(`${BUSINESS_API_URL}/api/dispatches?${params.toString()}`, {
        cache: "no-store",
      });
      return result?.items || [];
    }
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (search?.trim()) params.set("search", search.trim());
    const query = params.toString();
    return request<any[]>(`${BUSINESS_API_URL}/api/dispatches/ready-for-gate-exit${query ? `?${query}` : ""}`, {
      cache: "no-store",
    });
  },

  async getOutboundDispatch(dispatchId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/dispatch/${encodeURIComponent(dispatchId)}`);
  },

  async confirmOutboundGateExit(
    dispatchId: string,
    payload: { vehicle_verified: boolean; driver_verified: boolean; remarks?: string; vehicle_photo_base64?: string },
  ): Promise<any> {
    void payload;
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/${encodeURIComponent(dispatchId)}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  },

  async reportOutboundGateExitMismatch(
    dispatchId: string,
    payload: {
      verification_result: string;
      mismatch_reason: string;
      actual_vehicle?: string;
      actual_driver?: string;
    },
  ): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/dispatch/${encodeURIComponent(dispatchId)}/report-mismatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  async resolveOutboundGateExitMismatch(
    dispatchId: string,
    payload: {
      resolution_action: string;
      resolution_notes: string;
      new_vehicle_number?: string;
      new_driver_name?: string;
      new_driver_phone?: string;
    },
  ): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/dispatch/${encodeURIComponent(dispatchId)}/resolve-mismatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  async seedSampleDispatches(force = false): Promise<any> {
    const url = `${BUSINESS_API_URL}/api/v1/dispatch/seed-sample${force ? "?force=true" : ""}`;
    return request<any>(url, {
      method: "POST",
    });
  },
  async getDashboardStats(): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/dashboard/stats`);
  },

  async createGateEntry(formData: FormData): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries`, {
      method: "POST",
      // Leave Content-Type empty to let the browser set it automatically for Form-Data boundary
      body: formData,
    });
  },

  async resetGateEntries(): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/reset-dev-entries`, {
      method: "POST",
    });
  },

  async scanGateEntry(formData: FormData): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/scan`, {
      method: "POST",
      body: formData,
    });
  },

  async verifyGateEntry(id: string, approved: boolean, notes: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/${id}/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: approved ? "APPROVE" : "UNSCHEDULED_ARRIVAL",
        remarks: notes || (approved ? "Gate entry approved" : "Moved to unscheduled arrivals"),
      }),
    });
  },

  async getGateEntry(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/${id}`);
  },

  async downloadGatePass(id: string, gateEntryNumber?: string): Promise<void> {
    // Open synchronously from the click handler so browser pop-up protection
    // does not prevent the printable pass from appearing after the fetch.
    const passWindow = window.open("", "gate-pass", "width=520,height=760");
    if (!passWindow) {
      throw new Error("Allow pop-ups to print the gate pass");
    }

    const token = getAuthToken();
    const headers = new Headers();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    } else {
      headers.set("Authorization", "Bearer local_dev_mock_token");
    }

    try {
      const response = await fetch(`${BUSINESS_API_URL}/api/gate-entries/${id}/pass`, {
        headers,
      });

      if (!response.ok) {
        passWindow.close();
        throw new Error("Failed to download gate pass");
      }

      let passHtml = await response.text();

      // Generate QR Code to embed in the pass for digital verification at internal checkpoints
      try {
        const qrData = gateEntryNumber || id;
        const qrDataUrl = await QRCode.toDataURL(qrData, {
          width: 160,
          margin: 1,
          color: {
            dark: "#000000",
            light: "#ffffff",
          },
        });

        const qrHtml = `
          <div style="display: flex; flex-direction: column; align-items: center;" class="qr-container">
            <img src="${qrDataUrl}" style="width: 140px; height: 140px; border: 1px solid #eee; padding: 8px; border-radius: 12px; background: #fff;" alt="Pass QR Code" />
          </div>
        `;

        // Replace the placeholder entirely if it exists
        if (passHtml.includes('<div class="pass-number">')) {
          // Find the end of the div and replace its contents or the whole div
          // For simplicity with string replacement, we'll just target the placeholder text if found
          const placeholderText = "(Auto-generated)";
          if (passHtml.includes(placeholderText)) {
            passHtml = passHtml.replace(/<div class="pass-number">[\s\S]*?<\/div>/, qrHtml);
          } else {
            passHtml = passHtml.replace(
              '<div class="pass-number">',
              `${qrHtml}<div class="pass-number">`,
            );
          }
        }
      } catch (qrErr) {
        console.error("QR generation failed", qrErr);
      }

      passWindow.document.open();
      passWindow.document.write(passHtml);
      passWindow.document.close();
      passWindow.focus();
      window.setTimeout(() => passWindow.print(), 250);
    } catch (error) {
      if (passWindow) passWindow.close();
      throw error;
    }
  },

  async scanOcr(file: File, kind = "general"): Promise<any> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("kind", kind);
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/scan-ocr`, {
      method: "POST",
      body: formData,
    });
  },

  async previewPoOcr(base64Image: string, poNumberOverride?: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate/po-ocr-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentImageBase64: base64Image,
        poNumberOverride: poNumberOverride,
      }),
    });
  },

  // Returns Use Cases
  async createReturn(
    lines: { itemCode: string; quantity: number; reason: string }[],
  ): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/returns`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ lines }),
    });
  },

  // Procurement Use Cases
  async checkSupplierExistence(params: {
    company_name?: string;
    gstin?: string;
    email?: string;
    phone?: string;
    account_number?: string;
    swift?: string;
  }): Promise<any> {
    const searchParams = new URLSearchParams();
    if (params.company_name) searchParams.append("company_name", params.company_name);
    if (params.gstin) searchParams.append("gstin", params.gstin);
    if (params.email) searchParams.append("email", params.email);
    if (params.phone) searchParams.append("phone", params.phone);
    if (params.account_number) searchParams.append("account_number", params.account_number);
    if (params.swift) searchParams.append("swift", params.swift);
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/procurement/suppliers/check-existence?${searchParams.toString()}`,
    );
  },

  async getBankDetailsByIfsc(ifsc: string): Promise<{
    ifsc: string;
    bank_name: string;
    branch_name: string;
  }> {
    const response = await fetch(`https://ifsc.razorpay.com/${encodeURIComponent(ifsc)}`);
    if (response.status === 404) throw new Error("IFSC code was not found");
    if (!response.ok) throw new Error("IFSC lookup service is unavailable");
    const details = await response.json();
    if (!details.BANK || !details.BRANCH) throw new Error("Incomplete bank details received");
    return { ifsc: details.IFSC, bank_name: details.BANK, branch_name: details.BRANCH };
  },

  async getSuppliers(filters?: {
    search?: string;
    category?: string;
    material?: string;
    city?: string;
    vendor_type?: string;
    status?: string;
  }): Promise<any[]> {
    let url = `${BUSINESS_API_URL}/api/v1/procurement/suppliers`;
    if (filters) {
      const params = new URLSearchParams();
      if (filters.search) params.append("search", filters.search);
      if (filters.category) params.append("category", filters.category);
      if (filters.material) params.append("material", filters.material);
      if (filters.city) params.append("city", filters.city);
      if (filters.vendor_type) params.append("vendor_type", filters.vendor_type);
      if (filters.status) params.append("status", filters.status);
      const query = params.toString();
      if (query) url += `?${query}`;
    }
    return request<any[]>(url);
  },

  async getSupplier(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/suppliers/${id}`);
  },

  async updateSupplier(id: string, data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/suppliers/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },

  async blockSupplier(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/suppliers/${id}/block`, {
      method: "POST",
    });
  },

  async unblockSupplier(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/suppliers/${id}/unblock`, {
      method: "POST",
    });
  },

  async updateSupplierStatus(id: string, status: string, remarks?: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/suppliers/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, remarks }),
    });
  },

  async createSupplier(data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/suppliers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  },
  async getMaterialRequests(department?: string): Promise<any[]> {
    const q = department ? `?department=${encodeURIComponent(department)}` : "";
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/procurement/material-requests${q}`);
  },
  async getMaterialRequest(id: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/procurement/material-requests/${encodeURIComponent(id)}`,
    );
  },

  async createMaterialRequest(data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/material-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  async getAssemblyRequisitions(department?: string, status?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (department) params.append("department", department);
    if (status) params.append("status", status);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/assembly-requisitions${qs}`);
  },
  async getAssemblyRequisition(id: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly-requisitions/${encodeURIComponent(id)}`,
    );
  },
  async createAssemblyRequisition(data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly-requisitions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  async assignAssemblyRequisitionStore(id: string, storeId: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly-requisitions/${encodeURIComponent(id)}/assign-store`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store_id: storeId }),
      },
    );
  },
  async reserveAssemblyRequisitionStock(id: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly-requisitions/${encodeURIComponent(id)}/reserve-stock`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
    );
  },
  async createMaterialRequestForAssemblyShortage(id: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly-requisitions/${encodeURIComponent(id)}/create-material-request`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
    );
  },
  async getAssemblyStockReservations(storeId?: string): Promise<any[]> {
    const endpoint = storeId
      ? `${BUSINESS_API_URL}/api/v1/assembly-requisitions/reservations/by-store/${encodeURIComponent(storeId)}`
      : `${BUSINESS_API_URL}/api/v1/assembly-requisitions/reservations/all`;
    return request<any[]>(endpoint);
  },
  async createMaterialForAssemblyRequisitionItem(
    requisitionId: string,
    itemId: string,
    data: any = {},
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly-requisitions/${encodeURIComponent(requisitionId)}/items/${encodeURIComponent(itemId)}/create-material`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
  },
  async linkMaterialForAssemblyRequisitionItem(
    requisitionId: string,
    itemId: string,
    data: { material_id: string; material_variant_id?: string },
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly-requisitions/${encodeURIComponent(requisitionId)}/items/${encodeURIComponent(itemId)}/link-material`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
  },
  async createMaterialForMaterialRequestItem(
    requestId: string,
    itemId: string,
    data: any = {},
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/procurement/material-requests/${encodeURIComponent(requestId)}/items/${encodeURIComponent(itemId)}/create-material`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
  },
  async updateMaterialRequest(id: string, data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/material-requests/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },

  async processMaterialRequest(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/material-requests/${id}/process`, {
      method: "POST",
    });
  },

  async updateMaterialRequestStatus(
    id: string,
    status: string,
    comments?: string,
    actor?: string,
  ): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/material-requests/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, comments, actor }),
    });
  },

  async getMatchingSuppliersForMaterialRequest(id: string): Promise<any[]> {
    return request<any[]>(
      `${BUSINESS_API_URL}/api/v1/procurement/material-requests/${encodeURIComponent(id)}/matching-suppliers`,
    );
  },

  async sendMaterialRequestToSupplier(
    id: string,
    data?: { supplier_id?: string; notes?: string },
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/procurement/material-requests/${encodeURIComponent(id)}/send-to-supplier`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data || {}),
      },
    );
  },

  async getMaterialStock(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/procurement/material-stock`);
  },

  async getProcurementStats(): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/stats`);
  },

  async uploadASNAttachment(file: File, category: string = "SUPPORTING_DOC"): Promise<any> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", category);
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/asns/attachments/upload`, {
      method: "POST",
      body: formData,
    });
  },

  async uploadSupplierDocument(documentType: string, file: File): Promise<any> {
    try {
      const formData = new FormData();
      formData.append("document_type", documentType);
      formData.append("file", file);
      return await request<any>(`${BUSINESS_API_URL}/api/v1/gate/entries/documents`, {
        method: "POST",
        body: formData,
      });
    } catch {
      return {
        file_name: file.name,
        storage_path: `/media/${file.name}`,
        file_url: `/media/${file.name}`,
      };
    }
  },

  async uploadQuotationDocument(file: File): Promise<any> {
    const formData = new FormData();
    formData.append("file", file);
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/quotations/documents`, {
      method: "POST",
      body: formData,
    });
  },

  // New Purchase Order Management Module
  async getRfqs(supplierId?: string): Promise<any[]> {
    const url = supplierId
      ? `${BUSINESS_API_URL}/api/v1/procurement/rfqs?supplier_id=${supplierId}`
      : `${BUSINESS_API_URL}/api/v1/procurement/rfqs`;
    return request<any[]>(url);
  },

  async createRfq(data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/rfqs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },

  async cancelRfq(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/rfqs/${id}/cancel`, {
      method: "POST",
    });
  },

  async updateRfq(id: string, data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/rfqs/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },

  async getVendorTypes(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/procurement/vendor-types`);
  },

  async createVendorType(name: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/vendor-types`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  },

  async getSupplierCategories(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/procurement/supplier-categories`);
  },

  async createSupplierCategory(name: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/supplier-categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  },

  async getRawMaterials(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/procurement/raw-materials`);
  },

  async getMaterialCatalog(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/procurement/material-catalog`, {
      cache: "no-store",
    });
  },

  async createRawMaterial(name: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/raw-materials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  },

  async sendRfq(rfqId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/rfqs/${rfqId}/send`, {
      method: "POST",
    });
  },

  async getQuotations(rfqId?: string, supplierId?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (rfqId) params.append("rfq_id", rfqId);
    if (supplierId) params.append("supplier_id", supplierId);
    const query = params.toString();
    const url = query
      ? `${BUSINESS_API_URL}/api/v1/procurement/quotations?${query}`
      : `${BUSINESS_API_URL}/api/v1/procurement/quotations`;
    return request<any[]>(url);
  },

  async submitQuotation(data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/quotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },

  async getAsns(supplierId?: string): Promise<any[]> {
    try {
      const url = supplierId
        ? `${BUSINESS_API_URL}/api/gate/expected-deliveries?supplier_id=${supplierId}`
        : `${BUSINESS_API_URL}/api/gate/expected-deliveries`;
      const res = await request<any[]>(url, { cache: "no-store" });
      return Array.isArray(res) ? res : [];
    } catch {
      return [];
    }
  },

  async getSupplierReplacementRequests(): Promise<any[]> {
    return [];
  },
  async getSupplierReplacementRequest(id: string): Promise<any> {
    return { id, status: "SUPPLIER_ACCEPTED", original_asn_id: "", reason: "Damaged Material Replacement" };
  },

  async acceptSupplierReplacementRequest(_id: string): Promise<any> {
    return { status: "ACCEPTED" };
  },

  async requestSupplierReplacementExtension(_id: string, _remarks: string): Promise<any> {
    return { status: "EXTENSION_REQUESTED" };
  },

  async disputeSupplierReplacementRequest(_id: string, _remarks: string): Promise<any> {
    return { status: "DISPUTED" };
  },

  async getAsn(id: string): Promise<any> {
    try {
      return await request<any>(`${BUSINESS_API_URL}/api/gate/asn/${encodeURIComponent(id)}`, { cache: "no-store" });
    } catch {
      return {
        id,
        asn_number: id.startsWith("ASN") ? id : "",
        po_number: "",
        supplier_name: "",
        vehicle_number: "",
        driver_name: "",
        driver_contact: "",
        status: "SUBMITTED",
      };
    }
  },

  async getArrivalNotifications(): Promise<any[]> {
    return [];
  },

  async createAsn(data: any): Promise<any> {
    const result = await request<any>(`${BUSINESS_API_URL}/api/gate/asns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    // Consume the locally reserved number only after the ASN is saved.
    if (typeof window !== "undefined" && data?.asn_number) {
      const sequence = Number.parseInt(String(data.asn_number).split("-").pop() || "0", 10);
      if (Number.isFinite(sequence)) {
        window.localStorage.setItem("kaizen-next-asn-sequence-v2", String(sequence));
      }
      window.localStorage.removeItem("kaizen-pending-asn-number-v2");
    }
    return result;
  },

  async updateAsn(id: string, data: any): Promise<any> {
    return { id, ...data };
  },

  async getNextAsnNumber(): Promise<{ asnNumber: string }> {
    const pendingKey = "kaizen-pending-asn-number-v2";
    if (typeof window !== "undefined") {
      const pending = window.localStorage.getItem(pendingKey);
      if (pending) return { asnNumber: pending };
    }
    try {
      const result = await request<any>(`${BUSINESS_API_URL}/api/v1/gate/asns/next-number`);
      if (typeof window !== "undefined" && result?.asnNumber) {
        window.localStorage.setItem(pendingKey, result.asnNumber);
      }
      return result;
    } catch {
      // Keep the local/demo fallback sequential as well. The backend endpoint
      // remains authoritative whenever it is available.
      const key = "kaizen-next-asn-sequence-v2";
      const pending = window.localStorage.getItem(pendingKey);
      if (pending) return { asnNumber: pending };
      const stored = Number.parseInt(window.localStorage.getItem(key) || "0", 10);
      const next = Number.isFinite(stored) ? stored + 1 : 1;
      const asnNumber = `ASN-${new Date().getFullYear()}-${next}`;
      window.localStorage.setItem(pendingKey, asnNumber);
      return {
        asnNumber,
      };
    }
  },

  async getMaterialComponents(): Promise<any[]> {
    try {
      const res = await request<any[]>(`${BUSINESS_API_URL}/api/v1/gate/materials`);
      if (Array.isArray(res) && res.length > 0) return res;
    } catch {}

    return [
      { code: "MAT-RAD-001", name: "SKID MOUNTED RADIATOR", category: "Heavy Components", uom: "PCS" },
      { code: "MAT-ECP-002", name: "ENGINE CONTROL PANEL", category: "Control Systems", uom: "PCS" },
      { code: "MAT-EXS-003", name: "EXHAUST SILENCER", category: "Exhaust Systems", uom: "PCS" },
      { code: "MAT-EFP-004", name: "EXHAUST FLEXIBLE PIPE WITH INSULATION AND ALUMINIUM CLADDING", category: "Piping & Cladding", uom: "METER" },
      { code: "MAT-ATB-005", name: "ALTERNATOR TERMINAL BOX", category: "Electrical", uom: "PCS" },
      { code: "MAT-DTK-006", name: "990 LITERS DOUBLE WALL DAY TANK", category: "Tanks & Vessels", uom: "PCS" },
      { code: "MAT-MVI-007", name: "MV Isolator", category: "Electrical", uom: "PCS" },
      { code: "MAT-PWC-008", name: "Power Cable", category: "Electrical", uom: "METER" },
      { code: "MAT-FPA-009", name: "Fuel Pipe & accessories", category: "Piping", uom: "SET" },
      { code: "MAT-CTR-010", name: "Cable Trays", category: "Electrical Accessories", uom: "METER" },
      { code: "MAT-ENC-011", name: "Enclosure Module-1 (DG Set + Radiator)", category: "Enclosure Modules", uom: "SET" },
      { code: "MAT-ENC-012", name: "Enclosure Module-2 (Fuel Tank + MV Isolator)", category: "Enclosure Modules", uom: "SET" },
      { code: "MAT-ENC-013", name: "Enclosure Module-3 (Top cover Module 1)", category: "Enclosure Modules", uom: "SET" },
      { code: "MAT-ENC-014", name: "Enclosure Module-4 (Top cover Module 2)", category: "Enclosure Modules", uom: "SET" },
      { code: "MAT-ENC-015", name: "Enclosure Module-5 (Air Intake)", category: "Enclosure Modules", uom: "SET" },
      { code: "MAT-ENC-016", name: "Enclosure Module-6 (Exhaust Attenuators)", category: "Enclosure Modules", uom: "SET" },
      { code: "MAT-ENC-017", name: "Enclosure Module-7 (Exhaust duct on top of Module 6)", category: "Enclosure Modules", uom: "SET" },
      { code: "MAT-ENC-018", name: "Enclosure Module-8 (Exhaust duct with hood on top of Module 7)", category: "Enclosure Modules", uom: "SET" },
      { code: "MAT-EOD-019", name: "Enclosure Overall Dimension", category: "Enclosure Structures", uom: "SET" },
      { code: "MAT-GWR-020", name: "Genset with radiator", category: "Gensets", uom: "SET" },
      { code: "MAT-GNR-021", name: "Genset without radiator", category: "Gensets", uom: "SET" },
      { code: "MAT-LSE-022", name: "Loose Item", category: "General Accessories", uom: "BOX" },
    ];
  },

  async createMaterialComponent(name: string, uom: string = "PCS"): Promise<any> {
    try {
      return await request<any>(`${BUSINESS_API_URL}/api/v1/gate/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, uom }),
      });
    } catch {
      return {
        code: `MAT-${name.slice(0, 3).toUpperCase()}-${Date.now().toString().slice(-4)}`,
        name,
        category: "General Components",
        uom,
      };
    }
  },

  async getNextMaterialRequestNumber(): Promise<{
    requestNumber: string;
    nextMaterialSequence: number;
  }> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/material-requests/next-number`);
  },

  async updateQuotation(id: string, data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/quotations/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },

  async rejectQuotation(id: string, reason: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/quotations/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
  },

  async selectSupplier(rfqId: string, data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/rfqs/${rfqId}/select-supplier`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },

  async getQuotation(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/quotations/${id}`);
  },

  async getPurchaseOrders(
    searchOrParams?: string | { search?: string; supplierId?: string },
    signal?: AbortSignal,
  ): Promise<any[]> {
    let url = `${BUSINESS_API_URL}/api/v1/procurement/purchase-orders`;
    const params = new URLSearchParams();
    if (typeof searchOrParams === "string" && searchOrParams) {
      params.append("search", searchOrParams);
    } else if (typeof searchOrParams === "object" && searchOrParams) {
      if (searchOrParams.search) params.append("search", searchOrParams.search);
      if (searchOrParams.supplierId) params.append("supplier_id", searchOrParams.supplierId);
    }
    const qStr = params.toString();
    if (qStr) url += `?${qStr}`;
    return request<any[]>(url, { cache: "no-store", signal });
  },

  async getPurchaseOrder(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/purchase-orders/${id}`);
  },
  async getPurchaseOrderByNumber(poNumber: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/procurement/purchase-orders/by-number/${encodeURIComponent(poNumber)}`,
    );
  },
  async getPoDamagedGoods(poIdentifier: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/procurement/purchase-orders/${encodeURIComponent(poIdentifier)}/damaged-goods`,
    );
  },
  async downloadPoPdf(id: string, poNumber?: string): Promise<void> {
    const token = getAuthToken();
    const headers = new Headers();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    } else {
      headers.set("Authorization", "Bearer local_dev_mock_token");
    }

    const response = await fetch(
      `${BUSINESS_API_URL}/api/v1/procurement/purchase-orders/${id}/pdf`,
      {
        headers,
      },
    );

    if (!response.ok) {
      throw new Error("Failed to download PDF");
    }

    // Try to get filename from Content-Disposition header
    let filename = poNumber ? `PO-${poNumber}.pdf` : `PO-${id}.pdf`;
    const disposition = response.headers.get("Content-Disposition");
    if (disposition && disposition.includes("filename=")) {
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
      if (filenameMatch && filenameMatch[1]) {
        filename = filenameMatch[1];
      }
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try {
        window.URL.revokeObjectURL(url);
        if (a.parentNode) document.body.removeChild(a);
      } catch {}
    }, 2000);
  },

  async approvePurchaseOrder(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/purchase-orders/${id}/approve`, {
      method: "POST",
    });
  },

  async rejectPurchaseOrder(id: string, reason: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/purchase-orders/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
  },

  async resubmitPurchaseOrder(id: string, data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/purchase-orders/${id}/resubmit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },

  async sendPoToSupplier(id: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/procurement/purchase-orders/${id}/send-to-supplier`,
      {
        method: "POST",
      },
    );
  },

  async acknowledgePurchaseOrder(id: string, comments?: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/procurement/purchase-orders/${id}/acknowledge`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comments }),
      },
    );
  },

  async amendPurchaseOrder(id: string, data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/purchase-orders/${id}/amend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  async getNotifications(
    role: string,
    filters?: { store_code?: string; store_id?: string },
  ): Promise<any[]> {
    const query = new URLSearchParams({ role });
    if (filters?.store_code) query.set("store_code", filters.store_code);
    if (filters?.store_id) query.set("store_id", filters.store_id);
    const response = await request<any>(
      `${BUSINESS_API_URL}/api/storage/inventory/notifications?${query.toString()}`,
    );
    return Array.isArray(response) ? response : [];
  },
  async rejectAssemblyRequisition(id: string, reason: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly-requisitions/${encodeURIComponent(id)}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
  },
  async confirmAssemblyReceipt(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly-requisitions/${encodeURIComponent(id)}/confirm-receipt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  },

  subscribeNotifications(role: string, onChange: () => void): () => void {
    // The business service does not expose the old SSE endpoint. Poll the
    // canonical notifications resource instead of repeatedly requesting a 404.
    void role;
    const timer = window.setInterval(onChange, 30000);
    return () => window.clearInterval(timer);
  },

  async markNotificationRead(_id: string): Promise<any> {
    return { status: "OK" };
  },

  async markAllNotificationsRead(
    _role: string,
    _filters?: { store_code?: string; store_id?: string },
  ): Promise<any> {
    return { status: "OK" };
  },

  async markArrivalNotificationRead(_id: string): Promise<any> {
    try {
      return await request<any>(
        `${BUSINESS_API_URL}/api/v1/procurement/arrival-notifications/${_id}/read`,
        {
          method: "POST",
        },
      );
    } catch {
      return { success: true };
    }
  },

  async markAllArrivalNotificationsRead(): Promise<any> {
    try {
      return await request<any>(
        `${BUSINESS_API_URL}/api/v1/procurement/arrival-notifications/read-all`,
        {
          method: "POST",
        },
      );
    } catch {
      return { success: true };
    }
  },

  async globalSearch(q: string): Promise<{ results: any[] }> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/procurement/global-search?q=${encodeURIComponent(q)}`,
    );
  },
  async getAssemblyDashboard(): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/dashboard`);
  },

  async getAssemblyReports(): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/reports`);
  },

  async getAssemblyModuleOverview(section: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly/overview/${encodeURIComponent(section)}`,
    );
  },

  async getAssemblyOrders(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/assembly/orders`);
  },

  async updateAssemblyOrderDetails(id: string, data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/orders/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  async updateAssemblyOrder(id: string, data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/orders/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  async getOrderRequirements(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/orders/${id}/requirements`);
  },

  async getAssemblyOrder(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/orders/${id}`);
  },

  async getAssemblyMaterialIssue(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/orders/${id}/material-issue`);
  },

  async updateAssemblyStep(orderId: string, stepId: string, status: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/orders/${orderId}/steps/${stepId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  },

  async updateAssemblyProgress(orderId: string, completedQuantity: number): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/orders/${orderId}/progress`, {
      method: "PATCH",
      body: JSON.stringify({ completed_quantity: completedQuantity }),
    });
  },

  async getAssemblyConsumption(orderId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/orders/${orderId}/consumption`);
  },

  async recordAssemblyConsumption(orderId: string, data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/orders/${orderId}/consumption`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async getAssemblyScrap(orderId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/orders/${orderId}/scrap`);
  },

  async createAssemblyScrap(orderId: string, data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/orders/${orderId}/scrap`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async approveAssemblyScrap(orderId: string, scrapId: string, approvedBy: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly/orders/${orderId}/scrap/${scrapId}/approve`,
      {
        method: "PATCH",
        body: JSON.stringify({ approved_by: approvedBy }),
      },
    );
  },

  async getAssemblyQualityInspection(orderId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/orders/${orderId}/quality-inspection`);
  },

  async recordAssemblyQualityInspection(orderId: string, data: any): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly/orders/${orderId}/quality-inspection`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    );
  },

  async getFinishedGoods(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/assembly/finished-goods`);
  },

  async getGenealogy(identifier: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly/genealogy/${encodeURIComponent(identifier)}`,
    );
  },


  // ============================
  // WAREHOUSE MATERIAL MASTER
  // ============================
  async getMaterials(filters?: {
    search?: string;
    category?: string;
    status?: string;
  }): Promise<any[]> {
    const params = new URLSearchParams();

    if (filters?.search) {
      params.append("search", filters.search);
    }

    if (filters?.category) {
      params.append("category", filters.category);
    }

    if (filters?.status) {
      params.append("status", filters.status);
    }

    const query = params.toString();

    return request<any[]>(`${BUSINESS_API_URL}/api/v1/materials${query ? `?${query}` : ""}`);
  },

  async getMaterial(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/materials/${encodeURIComponent(id)}`);
  },

  async createMaterial(data: {
    material_code: string;
    material_name: string;
    category: string;
    description?: string;
    base_uom: string;
    status?: string;
    variants?: any[];
  }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/materials`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  },

  async updateMaterial(id: string, data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/materials/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  },

  async updateMaterialStatus(id: string, status: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/materials/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status }),
    });
  },

  async addMaterialVariant(materialId: string, data: any): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/materials/${encodeURIComponent(materialId)}/variants`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      },
    );
  },

  async getAssemblyFinishedGoods(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/assembly/finished-goods`);
  },

  async getAssemblyFinishedGoodsRequests(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/assembly/finished-goods-requests`);
  },

  async getBOMs(params?: { product_code?: string; product_name?: string }): Promise<any[]> {
    const qs = new URLSearchParams();
    if (params?.product_code) qs.append("product_code", params.product_code);
    if (params?.product_name) qs.append("product_name", params.product_name);
    const q = qs.toString() ? `?${qs.toString()}` : "";
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/assembly/bom${q}`);
  },

  async getBOMByProduct(params: { product_name?: string; product_code?: string }): Promise<any> {
    const qs = new URLSearchParams();
    if (params.product_name) qs.append("product_name", params.product_name);
    if (params.product_code) qs.append("product_code", params.product_code);
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/bom/by-product?${qs.toString()}`);
  },

  async getBOM(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/bom/${encodeURIComponent(id)}`);
  },

  async createBOM(data: {
    product_name: string;
    product_code?: string | null;
    description?: string | null;
    created_by?: string;
    items: Array<{
      material_id?: string | null;
      material_code: string;
      material_name: string;
      variant_code?: string | null;
      quantity_per_unit: number;
      uom?: string;
      notes?: string | null;
    }>;
  }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/bom`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },

  async updateBOM(id: string, data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/bom/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },

  async getFinishedGoodsRequests(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/procurement/finished-goods-requests`);
  },

  async getFinishedGoodsRequest(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/finished-goods-requests/${encodeURIComponent(id)}`);
  },

  async createFinishedGoodsRequest(data: {
    warehouse_id?: string;
    finished_goods_code?: string | null;
    finished_goods_name: string;
    quantity: number;
    uom?: string;
    required_date?: string;
    requested_by?: string;
    requested_date?: string;
    bom_attachment_url?: string | null;
    bom_attachment_name?: string | null;
    remarks?: string | null;
  }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/finished-goods-requests`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  },

  async uploadBomAttachment(file: File): Promise<{ file_name: string; file_url: string }> {
    const formData = new FormData();
    formData.append("file", file);
    return request<{ file_name: string; file_url: string }>(
      `${BUSINESS_API_URL}/api/v1/procurement/finished-goods-requests/upload-bom`,
      {
        method: "POST",
        body: formData,
      },
    );
  },

  async getAssemblyRework(orderId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/orders/${orderId}/rework`);
  },

  async createAssemblyRework(orderId: string, data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/orders/${orderId}/rework`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async updateAssemblyRework(orderId: string, reworkId: string, data: any): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly/orders/${orderId}/rework/${reworkId}`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      },
    );
  },

  async createMaterialVariant(materialId: string, data: any): Promise<any> {
    return this.addMaterialVariant(materialId, data);
  },

  async updateMaterialVariant(materialId: string, variantId: string, data: any): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/materials/${encodeURIComponent(materialId)}/variants/${encodeURIComponent(variantId)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      },
    );
  },

  async getAssemblyTeams(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/assembly/teams`);
  },

  async createAssemblyTeam(data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/teams`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async updateAssemblyTeam(id: string, data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/teams/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  async requestShortageMaterials(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/orders/${id}/material-request`, {
      method: "POST",
    });
  },

  async updateMaterialVariantStatus(
    materialId: string,
    variantId: string,
    status: string,
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/materials/${encodeURIComponent(materialId)}/variants/${encodeURIComponent(variantId)}/status`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      },
    );
  },

  async deleteMaterialVariant(materialId: string, variantId: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/materials/${encodeURIComponent(materialId)}/variants/${encodeURIComponent(variantId)}`,
      {
        method: "DELETE",
      },
    );
  },

  async getMaterialCategories(): Promise<string[]> {
    return request<string[]>(`${BUSINESS_API_URL}/api/v1/materials/categories`);
  },

  async getMaterialUoms(): Promise<string[]> {
    return request<string[]>(`${BUSINESS_API_URL}/api/v1/materials/uoms`);
  },

  async getNextMaterialCode(category?: string): Promise<{
    suggested_material_code: string;
    suggested_variant_code: string;
  }> {
    const query = category ? `?category=${encodeURIComponent(category)}` : "";

    return request<any>(`${BUSINESS_API_URL}/api/v1/materials/next-code${query}`);
  },
  async getStores(filters?: {
    search?: string;
    status?: string;
    warehouse_id?: string;
  }): Promise<any[]> {
    const params = new URLSearchParams();
    if (filters?.search) params.append("search", filters.search);
    if (filters?.status) params.append("status", filters.status);
    if (filters?.warehouse_id) params.append("warehouse_id", filters.warehouse_id);
    const query = params.toString();
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/stores${query ? `?${query}` : ""}`);
  },
  async getStoreMasterList(filters?: {
    search?: string;
    status?: string;
    warehouse_id?: string;
  }): Promise<any[]> {
    return this.getStores(filters);
  },
  async getStore(idOrCode: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/stores/${encodeURIComponent(idOrCode)}`);
  },
  async getMyStore(): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/stores/me`);
  },
  async getStoreDashboardMetrics(storeId?: string): Promise<any> {
    const endpoint = storeId
      ? `${BUSINESS_API_URL}/api/v1/stores/${encodeURIComponent(storeId)}/dashboard-metrics`
      : `${BUSINESS_API_URL}/api/v1/stores/me/dashboard-metrics`;
    return request<any>(endpoint);
  },
  async getStoreManagers(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/stores/managers`);
  },
  async getNextStoreCode(): Promise<{ suggested_store_code: string }> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/stores/next-code`);
  },
  async createStore(data: {
    store_name: string;
    description?: string;
    warehouse_id?: string;
    store_manager_id?: string;
    store_manager_name?: string;
    status?: string;
    store_code?: string;
  }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/stores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  async updateStore(
    idOrCode: string,
    data: {
      store_name?: string;
      description?: string;
      warehouse_id?: string;
      store_manager_id?: string;
      store_manager_name?: string;
      status?: string;
    },
  ): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/stores/${encodeURIComponent(idOrCode)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  async updateStoreStatus(idOrCode: string, status: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/stores/${encodeURIComponent(idOrCode)}/status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      },
    );
  },
  async deleteStore(idOrCode: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/stores/${encodeURIComponent(idOrCode)}`, {
      method: "DELETE",
    });
  },
  async getStoreHierarchy(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/stores/hierarchy/all`);
  },
  async getStoreZones(storeIdOrCode: string, status?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (status) params.append("status", status);
    const query = params.toString();
    return request<any[]>(
      `${BUSINESS_API_URL}/api/v1/stores/${encodeURIComponent(storeIdOrCode)}/zones${query ? `?${query}` : ""}`,
    );
  },
  async getNextZoneCode(storeIdOrCode: string): Promise<{ suggested_zone_code: string }> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/stores/${encodeURIComponent(storeIdOrCode)}/zones/next-code`,
    );
  },
  async createZone(
    storeIdOrCode: string,
    data: {
      zone_name: string;
      description?: string;
      zone_code?: string;
      status?: string;
    },
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/stores/${encodeURIComponent(storeIdOrCode)}/zones`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
  },
  async getZone(zoneId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/zones/${encodeURIComponent(zoneId)}`);
  },
  async updateZone(
    zoneId: string,
    data: {
      zone_name?: string;
      description?: string;
      status?: string;
    },
  ): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/zones/${encodeURIComponent(zoneId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  async updateZoneStatus(zoneId: string, status: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/zones/${encodeURIComponent(zoneId)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  },
  async createStoreManager(data: {
    full_name: string;
    employee_id: string;
    username: string;
    email: string;
    password: string;
    store_id: string;
    status?: string;
    role?: string;
    applications?: string[];
  }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/stores/managers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  async updateStoreManager(
    managerId: string,
    data: {
      full_name?: string;
      email?: string;
      password?: string;
      store_id?: string;
      status?: string;
      role?: string;
      applications?: string[];
    },
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/stores/managers/${encodeURIComponent(managerId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
  },
  async updateStoreManagerStatus(managerId: string, status: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/stores/managers/${encodeURIComponent(managerId)}/status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      },
    );
  },
  async getZoneQR(zoneId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/zones/${encodeURIComponent(zoneId)}/qr`);
  },
  async lookupZoneByQR(scanValue: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/zones/scan-lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scan_value: scanValue }),
    });
  },
  async getStoreBins(storeIdOrCode: string, status?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (status) params.append("status", status);
    const query = params.toString();
    return request<any[]>(
      `${BUSINESS_API_URL}/api/v1/stores/${encodeURIComponent(storeIdOrCode)}/bins${query ? `?${query}` : ""}`,
    );
  },
  async getZoneBins(zoneId: string, status?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (status) params.append("status", status);
    const query = params.toString();
    return request<any[]>(
      `${BUSINESS_API_URL}/api/v1/zones/${encodeURIComponent(zoneId)}/bins${query ? `?${query}` : ""}`,
    );
  },
  async getNextBinCode(zoneId: string): Promise<{ suggested_bin_code: string }> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/zones/${encodeURIComponent(zoneId)}/bins/next-code`,
    );
  },
  async createBin(
    zoneId: string,
    data: {
      bin_name: string;
      bin_code?: string;
      rack?: string;
      shelf?: string;
      position?: string;
      storage_type?: string;
      capacity?: number;
      maximum_weight?: number;
      maximum_volume?: number;
      allowed_material_category?: string;
      hazardous_material_permitted?: boolean;
      temperature_requirement?: string;
      status?: string;
    },
  ): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/zones/${encodeURIComponent(zoneId)}/bins`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  async getBin(binId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/bins/${encodeURIComponent(binId)}`);
  },
  async updateBin(
    binId: string,
    data: {
      bin_name?: string;
      rack?: string;
      shelf?: string;
      position?: string;
      storage_type?: string;
      capacity?: number;
      maximum_weight?: number;
      maximum_volume?: number;
      allowed_material_category?: string;
      hazardous_material_permitted?: boolean;
      temperature_requirement?: string;
      status?: string;
    },
  ): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/bins/${encodeURIComponent(binId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  async updateBinStatus(binId: string, status: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/bins/${encodeURIComponent(binId)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  },
  async getBinQR(binId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/bins/${encodeURIComponent(binId)}/qr`);
  },
  async getBinMaterials(binIdOrCode: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/bins/${encodeURIComponent(binIdOrCode)}/materials`,
    );
  },
  async performTakeaway(payload: {
    bin_scan: string;
    material_scan: string;
    quantity: number;
    remarks?: string;
    reference_document?: string;
  }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/storage/inventory/takeaway`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  async getMovementHistory(params?: {
    movement_type?: string;
    material_code?: string;
    store_id?: string;
    bin_id?: string;
    start_date?: string;
    end_date?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<any[]> {
    const query = new URLSearchParams();
    if (params) {
      if (params.movement_type && params.movement_type !== "ALL")
        query.append("movement_type", params.movement_type);
      if (params.material_code) query.append("material_code", params.material_code);
      if (params.store_id && params.store_id !== "ALL") query.append("store_id", params.store_id);
      if (params.bin_id) query.append("bin_id", params.bin_id);
      if (params.start_date) query.append("start_date", params.start_date);
      if (params.end_date) query.append("end_date", params.end_date);
      if (params.search) query.append("search", params.search);
      if (params.limit !== undefined) query.append("limit", String(params.limit));
      if (params.offset !== undefined) query.append("offset", String(params.offset));
    }
    const qStr = query.toString() ? `?${query.toString()}` : "";
    return request<any[]>(`${BUSINESS_API_URL}/api/storage/inventory/movement-history${qStr}`);
  },
  async lookupBinByQR(scanValue: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/bins/scan-lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scan_value: scanValue }),
    });
  },
  async getPutawayTasks(storeId?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (storeId) params.append("store_id", storeId);
    const q = params.toString();
    return request<any[]>(`${BUSINESS_API_URL}/api/storage/putaway-tasks${q ? `?${q}` : ""}`);
  },
  async getPutawayTask(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/storage/putaway-tasks/${encodeURIComponent(id)}`);
  },
  async assignPutawayLocation(
    taskId: string,
    locationId?: string,
    storeId?: string,
    zoneId?: string,
    binId?: string,
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/storage/putaway-tasks/${encodeURIComponent(taskId)}/location`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location_id: locationId || undefined,
          store_id: storeId || undefined,
          zone_id: zoneId || undefined,
          bin_id: binId || undefined,
        }),
      },
    );
  },
  async startPutaway(taskId: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/storage/putaway-tasks/${encodeURIComponent(taskId)}/start`,
      {
        method: "POST",
      },
    );
  },
  async completePutaway(
    taskId: string,
    data: {
      material_scan: string;
      location_scan: string;
      quantity: number;
    },
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/storage/putaway-tasks/${encodeURIComponent(taskId)}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
  },
  async resolveGrnQr(qrCode: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/storage/putaway-tasks/resolve-grn-qr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qr_code: qrCode }),
    });
  },
  async resolveFinishedGoodsQr(qrCode: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/storage/putaway-tasks/resolve-finished-goods-qr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qr_code: qrCode }),
    });
  },
  async resolveBinQr(binScan: string, storeId?: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/storage/putaway-tasks/resolve-bin-qr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bin_scan: binScan, store_id: storeId || undefined }),
    });
  },
  async executePutaway(data: {
    task_id?: string;
    grn_qr_code: string;
    bin_qr_code: string;
    quantity: number;
  }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/storage/putaway-tasks/execute-putaway`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  async getHandlingUnit(scanValue: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/storage/putaway-tasks/handling-units/${encodeURIComponent(scanValue)}`,
    );
  },
  async getStorageLocations(warehouseId?: string): Promise<any[]> {
    const q = warehouseId ? `?warehouse_id=${encodeURIComponent(warehouseId)}` : "";
    return request<any[]>(`${BUSINESS_API_URL}/api/storage/putaway-tasks/locations${q}`);
  },
  async getInventoryLocationBalances(materialCode?: string, storeId?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (materialCode) params.append("material_code", materialCode);
    if (storeId) params.append("store_id", storeId);
    const q = params.toString() ? `?${params.toString()}` : "";
    return request<any[]>(`${BUSINESS_API_URL}/api/storage/putaway-tasks/inventory-locations${q}`);
  },
  async getWarehouseInventorySummary(params?: {
    material_code?: string;
    store_id?: string;
    zone_id?: string;
    warehouse_id?: string;
    category?: string;
    batch?: string;
    supplier?: string;
    grn?: string;
    location?: string;
    stock_status?: string;
    qc_status?: string;
    expiry?: string;
    availability?: string;
    status_filter?: string;
    search?: string;
  }): Promise<any[]> {
    const query = new URLSearchParams();
    if (params?.material_code) query.append("material_code", params.material_code);
    if (params?.store_id && params.store_id !== "ALL") query.append("store_id", params.store_id);
    if (params?.zone_id && params.zone_id !== "ALL") query.append("zone_id", params.zone_id);
    if (params?.warehouse_id && params.warehouse_id !== "ALL") query.append("warehouse_id", params.warehouse_id);
    if (params?.category && params.category !== "ALL") query.append("category", params.category);
    if (params?.batch && params.batch !== "ALL") query.append("batch", params.batch);
    if (params?.supplier && params.supplier !== "ALL") query.append("supplier", params.supplier);
    if (params?.grn && params.grn !== "ALL") query.append("grn", params.grn);
    if (params?.location && params.location !== "ALL") query.append("location", params.location);
    if (params?.stock_status && params.stock_status !== "ALL") query.append("stock_status", params.stock_status);
    if (params?.qc_status && params.qc_status !== "ALL") query.append("qc_status", params.qc_status);
    if (params?.expiry && params.expiry !== "ALL") query.append("expiry", params.expiry);
    if (params?.availability && params.availability !== "ALL") query.append("availability", params.availability);
    if (params?.status_filter && params.status_filter !== "ALL")
      query.append("status_filter", params.status_filter);
    if (params?.search) query.append("search", params.search);
    const qs = query.toString() ? `?${query.toString()}` : "";
    return request<any[]>(`${BUSINESS_API_URL}/api/storage/inventory/warehouse-summary${qs}`);
  },
  async getMovementReasons(): Promise<string[]> {
    return request<string[]>(`${BUSINESS_API_URL}/api/storage/inventory/movement-reasons`);
  },
  async getStockStatuses(): Promise<string[]> {
    return request<string[]>(`${BUSINESS_API_URL}/api/storage/inventory/stock-statuses`);
  },
  async performBinTransfer(data: {
    material_code: string;
    source_bin_code: string;
    destination_bin_code: string;
    quantity: number;
    reason: string;
    remarks?: string;
    mobile_controlled_mode?: boolean;
    scanned_source_bin_qr?: string;
    scanned_dest_bin_qr?: string;
    scanned_material_qr?: string;
  }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/storage/inventory/bin-transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  async getMaterialInventoryDetail(materialCode: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/storage/inventory/materials/${encodeURIComponent(materialCode)}/detail`);
  },
  async getStockLedger(params?: {
    material_code?: string;
    store_id?: string;
    zone_id?: string;
    transaction_type?: string;
    start_date?: string;
    end_date?: string;
    search?: string;
  }): Promise<any[]> {
    const query = new URLSearchParams();
    if (params?.material_code) query.append("material_code", params.material_code);
    if (params?.store_id && params.store_id !== "ALL") query.append("store_id", params.store_id);
    if (params?.zone_id && params.zone_id !== "ALL") query.append("zone_id", params.zone_id);
    if (params?.transaction_type && params.transaction_type !== "ALL")
      query.append("transaction_type", params.transaction_type);
    if (params?.start_date) query.append("start_date", params.start_date);
    if (params?.end_date) query.append("end_date", params.end_date);
    if (params?.search) query.append("search", params.search);
    const qs = query.toString() ? `?${query.toString()}` : "";
    return request<any[]>(`${BUSINESS_API_URL}/api/storage/inventory/ledger${qs}`);
  },
  async getInventoryStats(): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/storage/inventory/stats`);
  },
  async getWarehouseDashboardMetrics(): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/storage/inventory/dashboard-metrics`);
  },
  async getQuarantineRecords(params?: {
    status?: string;
    material?: string;
    grn?: string;
    search?: string;
  }): Promise<any[]> {
    const query = new URLSearchParams();
    if (params?.status && params.status !== "ALL") query.append("status", params.status);
    if (params?.material) query.append("material", params.material);
    if (params?.grn) query.append("grn", params.grn);
    if (params?.search) query.append("search", params.search);
    const qs = query.toString() ? `?${query.toString()}` : "";
    return request<any[]>(`${BUSINESS_API_URL}/api/quarantine${qs}`);
  },
  async getQuarantineRecord(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/quarantine/${encodeURIComponent(id)}`);
  },
  async reviewQuarantineRecord(
    id: string,
    data: { disposition: string; remarks?: string },
  ): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/quarantine/${encodeURIComponent(id)}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  async getPickupTasks(params?: {
    store_code?: string;
    status?: string;
    department?: string;
  }): Promise<any[]> {
    const query = new URLSearchParams();
    if (params?.store_code) query.append("store_code", params.store_code);
    if (params?.status && params.status !== "ALL") query.append("status", params.status);
    if (params?.department) query.append("department", params.department);
    const qs = query.toString() ? `?${query.toString()}` : "";
    return request<any[]>(`${BUSINESS_API_URL}/api/storage/pickup-tasks${qs}`);
  },
  async getPickupTask(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/storage/pickup-tasks/${encodeURIComponent(id)}`);
  },
  async startPickupTask(id: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/storage/pickup-tasks/${encodeURIComponent(id)}/start`,
      {
        method: "POST",
      },
    );
  },
  async completePickupTask(
    id: string,
    data: { material_scan: string; zone_scan: string; quantity: number; notes?: string },
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/storage/pickup-tasks/${encodeURIComponent(id)}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
  },
  async getStores(params?: { warehouse_id?: string; search?: string }): Promise<any[]> {
    const q = new URLSearchParams();
    if (params?.warehouse_id) q.append("warehouse_id", params.warehouse_id);
    if (params?.search) q.append("search", params.search);
    const qs = q.toString() ? `?${q.toString()}` : "";
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/stores${qs}`);
  },
  async getStore(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/stores/${encodeURIComponent(id)}`);
  },
  async createStore(data: { store_name: string; store_code?: string; description?: string; warehouse_id?: string }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/stores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  async getStoreZones(storeId: string): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/stores/${encodeURIComponent(storeId)}/zones`);
  },
  async createZone(storeId: string, data: { zone_name: string; zone_code?: string; description?: string }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/stores/${encodeURIComponent(storeId)}/zones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  async getStoreBins(storeId: string, zoneId?: string): Promise<any[]> {
    if (zoneId) {
      return request<any[]>(`${BUSINESS_API_URL}/api/v1/zones/${encodeURIComponent(zoneId)}/bins`);
    }
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/stores/${encodeURIComponent(storeId)}/bins`);
  },
  async createBin(storeId: string, zoneId: string, data: { bin_code: string; bin_name?: string; rack?: string; position?: string; qr_identifier?: string }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/zones/${encodeURIComponent(zoneId)}/bins`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  async getMaterialRequests(params?: { status?: string }): Promise<any[]> {
    const q = new URLSearchParams();
    if (params?.status && params.status !== "ALL") q.append("status_filter", params.status);
    const qs = q.toString() ? `?${q.toString()}` : "";
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/assembly-requisitions${qs}`);
  },
  async approveMaterialRequest(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly-requisitions/${encodeURIComponent(id)}/approve`, {
      method: "POST",
    });
  },
  async createMaterialIssue(data: { requisition_number?: string; assembly_order_number?: string; issued_to?: string }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/storage/inventory/material-issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  // ============================
  // GRN / RECEIVING
  // ============================
  async getGrns(params?: {
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ total: number; items: any[] }> {
    const q = new URLSearchParams();
    if (params?.status && params.status !== "ALL") q.append("status", params.status);
    if (params?.search && params.search.trim()) q.append("search", params.search.trim());
    if (params?.limit !== undefined) q.append("limit", String(params.limit));
    if (params?.offset !== undefined) q.append("offset", String(params.offset));
    const qs = q.toString() ? `?${q.toString()}` : "";
    return request<{ total: number; items: any[] }>(`${BUSINESS_API_URL}/api/receiving/grn${qs}`);
  },
  async getGrnDrafts(status?: string, search?: string): Promise<any[]> {
    const res = await this.getGrns({ status, search, limit: 100 });
    return res.items || [];
  },
  async createGrnHeader(data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/receiving/grn/header`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  async updateGrnLines(grnId: string, lines: any[]): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/receiving/grn/${grnId}/lines`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines }),
    });
  },
  async uploadDamageEvidence(grnLineId: string, formData: FormData): Promise<any> {
    const token = getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(
      `${BUSINESS_API_URL}/api/receiving/grn/lines/${grnLineId}/damage-evidence`,
      {
        method: "POST",
        headers,
        body: formData,
      },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || "Failed to upload damage evidence");
    }
    return res.json();
  },
  async submitQualityInspection(grnId: string, lines: any[]): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/receiving/grn/${grnId}/quality`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines }),
    });
  },
  async createGrnBatches(grnLineId: string, batches: { batch_quantity: number }[]): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/receiving/grn/lines/${grnLineId}/batches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batches),
    });
  },
  async generateDamageQrs(grnId: string): Promise<any[]> {
    return request<any[]>(
      `${BUSINESS_API_URL}/api/receiving/grn/${encodeURIComponent(grnId)}/damage-qrs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
    );
  },
  async uploadGrnDocument(grnId: string, formData: FormData): Promise<any> {
    const token = getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${BUSINESS_API_URL}/api/receiving/grn/${grnId}/documents`, {
      method: "POST",
      headers,
      body: formData,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || "Failed to upload GRN document");
    }
    return res.json();
  },
  async completeGrn(grnId: string, verification_notes?: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/receiving/grn/${grnId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verification_notes }),
    });
  },
  async postGrn(grnId: string, verificationNotes?: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/receiving/grn/${grnId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verification_notes: verificationNotes }),
    });
  },
  async getGrnDetail(grnId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/receiving/grn/${grnId}`);
  },
  async getGrn(grnId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/receiving/grn/${grnId}`);
  },
  async getGrnContext(
    input?:
      | string
      | {
          poNumber?: string;
          poId?: string;
          gateEntryId?: string;
          vehicleNumber?: string;
          receiptType?: string;
        },
    poId?: string,
    gateEntryId?: string,
  ): Promise<any> {
    const params = new URLSearchParams();
    if (typeof input === "object" && input !== null) {
      if (input.poNumber) params.set("po_number", input.poNumber);
      if (input.poId) params.set("po_id", input.poId);
      if (input.gateEntryId) params.set("gate_entry_id", input.gateEntryId);
      if (input.vehicleNumber) params.set("vehicle_number", input.vehicleNumber);
      if (input.receiptType) params.set("receipt_type", input.receiptType);
    } else if (typeof input === "string") {
      params.set("po_number", input);
      if (poId) params.set("po_id", poId);
      if (gateEntryId) params.set("gate_entry_id", gateEntryId);
    }
    return request<any>(`${BUSINESS_API_URL}/api/receiving/grn/context?${params.toString()}`);
  },
  async confirmGrn(
    poId: string,
    lines: {
      itemCode: string;
      quantity: number;
    }[],
  ): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/receiving/grn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ po_id: poId, lines }),
    });
  },
  async updateGrnStep(
    grnId: string,
    payload: { current_step: number; max_completed_step?: number },
  ): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/receiving/grn/${grnId}/step`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  async notifyVendorDamage(
    grnId: string,
    payload: {
      supplier_email?: string;
      custom_remarks?: string;
      notify_procurement?: boolean;
      damage_items?: any[];
      photo_ids?: string[];
    },
  ): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/receiving/grn/${grnId}/notify-vendor-damage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  async lookupQrCode(code: string): Promise<any> {
    const encoded = encodeURIComponent(code.trim());
    return request<any>(`${BUSINESS_API_URL}/api/receiving/grn/qr-lookup?code=${encoded}`);
  },
  async getNextVariantCode(materialId: string): Promise<{
    material_code: string;
    suggested_variant_code: string;
  }> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/materials/${materialId}/next-variant-code`);
  },
  resolveMediaUrl(path?: string | null): string {
    return resolveMediaUrl(path);
  },
  async getDispatches(status?: string): Promise<{ items: any[]; total: number }> {
    const url = status ? `${BUSINESS_API_URL}/api/dispatches?status=${encodeURIComponent(status)}` : `${BUSINESS_API_URL}/api/dispatches`;
    return request<{ items: any[]; total: number }>(url, { cache: "no-store" });
  },
  async getDispatch(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/${id}`, { cache: "no-store" });
  },
  async createDispatch(data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/dispatches`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  async reserveDispatchStock(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/${id}/reserve-stock`, { method: "POST" });
  },
  async startDispatchPicking(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/${id}/picking`, { method: "POST" });
  },
  async pickDispatchItems(id: string, items: any[]): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/${id}/pick-items`, {
      method: "POST",
      body: JSON.stringify({ items }),
    });
  },
  async startDispatchPacking(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/${id}/pack`, { method: "POST" });
  },
  async packDispatchItems(id: string, items: any[]): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/${id}/pack-items`, {
      method: "POST",
      body: JSON.stringify({ items }),
    });
  },
  async allocateDispatchDriver(id: string, driverId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/${id}/driver`, {
      method: "POST",
      body: JSON.stringify({ driver_id: driverId }),
    });
  },
  async allocateDispatchVehicle(id: string, vehicleId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/${id}/vehicle`, {
      method: "POST",
      body: JSON.stringify({ vehicle_id: vehicleId }),
    });
  },
  async assignDispatchRoute(id: string, routeCode: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/${id}/route`, {
      method: "POST",
      body: JSON.stringify({ route_code: routeCode }),
    });
  },
  async startDispatchLoading(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/${id}/loading/start`, { method: "POST" });
  },
  async verifyDispatchLoading(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/${id}/loading/verify`, { method: "POST" });
  },
  async verifyDispatchFinal(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/${id}/verify`, { method: "POST" });
  },
  async dispatchOrder(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/${id}/dispatch`, { method: "POST" });
  },
  async transitDispatch(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/${id}/transit`, { method: "POST" });
  },
  async deliverDispatch(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/${id}/deliver`, { method: "POST" });
  },
  async closeDispatch(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/${id}/close`, { method: "POST" });
  },
  async cancelDispatch(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/${id}/cancel`, { method: "POST" });
  },
  async returnDispatch(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/${id}/return`, { method: "POST" });
  },
  async getDispatchesReadyForGateExit(): Promise<any[]> {
    try {
      const res = await request<any[]>(`${BUSINESS_API_URL}/api/dispatches/ready-for-gate-exit`, { cache: "no-store" });
      return Array.isArray(res) ? res : [];
    } catch {
      return [];
    }
  },
  async getDispatchKpis(): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/kpis`, { cache: "no-store" });
  },
  async getDrivers(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/drivers`, { cache: "no-store" });
  },
  async createDriver(data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/drivers`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  async updateDriver(driverId: string, data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/drivers/${encodeURIComponent(driverId)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },
  async deleteDriver(driverId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/drivers/${encodeURIComponent(driverId)}`, {
      method: "DELETE",
    });
  },
  async getVehicles(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/vehicles`, { cache: "no-store" });
  },
  async createVehicle(data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/vehicles`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  async updateVehicle(vehicleId: string, data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/vehicles/${encodeURIComponent(vehicleId)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },
  async deleteVehicle(vehicleId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/vehicles/${encodeURIComponent(vehicleId)}`, {
      method: "DELETE",
    });
  },

  // Inventory API endpoints (Parts E, F, J, K, L, M)
  async getMovementReasons(): Promise<string[]> {
    return request<string[]>(`${BUSINESS_API_URL}/api/v1/inventory/movement-reasons`);
  },
  async getStockStatuses(): Promise<string[]> {
    return request<string[]>(`${BUSINESS_API_URL}/api/v1/inventory/stock-statuses`);
  },
  async getAdjustmentReasons(): Promise<string[]> {
    return request<string[]>(`${BUSINESS_API_URL}/api/v1/inventory/adjustment-reasons`);
  },
  async performBinTransfer(payload: {
    material_code: string;
    source_bin_code: string;
    destination_bin_code: string;
    quantity: number;
    reason: string;
    remarks?: string;
    scanned_source_bin_qr?: string;
    scanned_dest_bin_qr?: string;
    scanned_material_qr?: string;
  }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/inventory/bin-transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  async getMaterialInventoryDetail(materialCode: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/storage/inventory/materials/${encodeURIComponent(materialCode)}/detail`,
    );
  },
  async getWarehouseInventorySummary(params?: Record<string, string | undefined>): Promise<any[]> {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v && v !== "ALL") query.set(k, v);
      });
    }
    const qStr = query.toString() ? `?${query.toString()}` : "";
    return request<any[]>(`${BUSINESS_API_URL}/api/storage/inventory/warehouse-summary${qStr}`);
  },
  async getStockLedger(params?: Record<string, string | undefined>): Promise<any[]> {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v && v !== "ALL") query.set(k, v);
      });
    }
    const qStr = query.toString() ? `?${query.toString()}` : "";
    return request<any[]>(`${BUSINESS_API_URL}/api/storage/inventory/ledger${qStr}`);
  },
  async getMaterialIssues(status?: string): Promise<any[]> {
    const qStr = status && status !== "ALL" ? `?status=${encodeURIComponent(status)}` : "";
    return request<any[]>(`${BUSINESS_API_URL}/api/storage/inventory/material-issues${qStr}`);
  },
  async createMaterialIssue(payload: {
    request_number?: string;
    requisition_number?: string;
    assembly_order_number?: string;
    issued_to?: string;
    issued_to_line?: string;
    issued_by_name?: string;
    notes?: string;
    items?: Array<{
      material_code: string;
      batch_number: string;
      location_code: string;
      picked_quantity: number;
    }>;
  }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/storage/inventory/material-issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  async confirmMaterialHandover(
    issueNumber: string,
    payload: {
      assembly_receiver_name: string;
      scanned_material_qr?: string;
      remarks?: string;
    },
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/storage/inventory/material-issues/${encodeURIComponent(issueNumber)}/handover-confirm`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
  },
  async getMaterialReturns(status?: string): Promise<any[]> {
    const qStr = status && status !== "ALL" ? `?status=${encodeURIComponent(status)}` : "";
    return request<any[]>(`${BUSINESS_API_URL}/api/storage/inventory/material-returns${qStr}`);
  },
  async createMaterialReturn(payload: {
    material_issue_number: string;
    assembly_line: string;
    material_code: string;
    batch_number: string;
    issued_quantity: number;
    used_quantity: number;
    return_quantity: number;
    condition: "GOOD" | "DAMAGED" | "UNKNOWN CONDITION";
    returned_by: string;
    notes?: string;
  }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/storage/inventory/material-returns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  async getCycleCounts(status?: string): Promise<any[]> {
    const qStr = status && status !== "ALL" ? `?status=${encodeURIComponent(status)}` : "";
    return request<any[]>(`${BUSINESS_API_URL}/api/storage/inventory/cycle-counts${qStr}`);
  },
  async createCycleCount(payload: {
    zone_code: string;
    rack_code: string;
    assigned_operator_name: string;
    notes?: string;
    items: Array<{
      location_code: string;
      material_code: string;
      batch_number: string;
      system_quantity: number;
    }>;
  }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/storage/inventory/cycle-counts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  async submitCycleCount(
    countNumber: string,
    payload: {
      item_counts: Array<{
        item_id: string;
        physical_quantity: number;
        scanned_bin_qr?: string;
        scanned_material_qr?: string;
      }>;
      operator_notes?: string;
    },
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/storage/inventory/cycle-counts/${encodeURIComponent(countNumber)}/submit-count`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
  },
  async getStockAdjustments(status?: string): Promise<any[]> {
    const qStr = status && status !== "ALL" ? `?status=${encodeURIComponent(status)}` : "";
    return request<any[]>(`${BUSINESS_API_URL}/api/storage/inventory/stock-adjustments${qStr}`);
  },
  async createStockAdjustment(payload: {
    material_code: string;
    batch_number: string;
    location_code: string;
    current_quantity: number;
    adjustment_quantity: number;
    reason: string;
    notes?: string;
    evidence_url?: string;
    requester_name: string;
    approver_name: string;
  }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/storage/inventory/stock-adjustments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  async universalScan(scanCode: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/storage/inventory/universal-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scan_code: scanCode }),
    });
  },
  async getMobileTasksSummary(): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/storage/inventory/mobile-tasks-summary`);
  },
  async getInventoryTraceability(params?: { material_code?: string; batch_number?: string }): Promise<any> {
    const q = new URLSearchParams();
    if (params?.material_code) q.append("material_code", params.material_code);
    if (params?.batch_number) q.append("batch_number", params.batch_number);
    const qStr = q.toString() ? `?${q.toString()}` : "";
    return request<any>(`${BUSINESS_API_URL}/api/storage/inventory/traceability${qStr}`);
  },
  async getPermissionMatrix(): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/storage/inventory/role-permissions`);
  },
  async getRoleNotifications(role?: string): Promise<any> {
    const qStr = role ? `?role=${encodeURIComponent(role)}` : "";
    return request<any>(`${BUSINESS_API_URL}/api/storage/inventory/notifications${qStr}`);
  },
};

export const apiClient = api;
