import { normalizeGrnResponse } from "./grn-response";
/**
 * Central API Client using native fetch.
 * Links frontend components to the backend python business-service (port 8000)
 * and Java auth-service (port 8080).
 */

export const BUSINESS_API_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta.env?.VITE_BUSINESS_API_URL || import.meta.env?.VITE_BUSINESS_SERVICE_URL)) ||
  (typeof window !== "undefined"
    ? window.location.hostname.includes("loca.lt")
      ? "https://wms-mobile-backend-8000.loca.lt"
      : `${window.location.protocol}//${window.location.hostname}:8000`
    : "http://localhost:8000");
import { clearAuthSession, getAuthToken, storeAuthSession, getUserInfo } from "./auth-utils";
function getApiErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;

  const { detail, message } = payload as { detail?: unknown; message?: unknown };
  if (typeof detail === "string") return detail;
  if (typeof message === "string") return message;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const detailMessage = (detail as { message?: unknown }).message;
    if (typeof detailMessage === "string") return detailMessage;
  }

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

  // Inject user roles and warehouse context headers from session when available
  try {
    const userInfo = getUserInfo();
    if (userInfo) {
      if (userInfo.roles && userInfo.roles.length > 0 && !headers.has("X-User-Roles")) {
        headers.set("X-User-Roles", userInfo.roles.join(","));
      }
      if ((userInfo.warehouse_ref_id || userInfo.warehouseRefId) && !headers.has("X-Warehouse-Id")) {
        headers.set("X-Warehouse-Id", userInfo.warehouse_ref_id || userInfo.warehouseRefId!);
      }
      if ((userInfo.warehouse_code || userInfo.warehouseCode) && !headers.has("X-Warehouse-Code")) {
        headers.set("X-Warehouse-Code", userInfo.warehouse_code || userInfo.warehouseCode!);
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

  const method = (options.method || "GET").toUpperCase();
  let response: Response;
  for (let attempt = 0; ; attempt += 1) {
    try {
      response = await fetch(url, {
        ...options,
        headers,
      });
      break;
    } catch (error) {
      // Browser network changes briefly interrupt local API calls while the
      // dev server or network adapter reconnects. Retry idempotent reads only.
      if (!(error instanceof TypeError) || method !== "GET" || attempt >= 2) {
        throw error;
      }
      await new Promise((resolve) => globalThis.setTimeout(resolve, 300 * (attempt + 1)));
    }
  }

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
    if (response.status === 401) clearAuthSession();
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

async function requestWithTimeout<T>(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await request<T>(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `The login server did not respond within ${Math.round(timeoutMs / 1000)} seconds. Check that the business service is running, then try again.`,
      );
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
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
    if (username.trim().toUpperCase() === "EMP-8042" && password === "password") {
      throw new Error("Invalid username or password");
    }
    if (username.startsWith("supplier_") || username === "supplier") {
      const response = await requestWithTimeout<any>(
        `${BUSINESS_API_URL}/api/v1/auth/supplier-login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        },
        15_000,
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
    const response = await requestWithTimeout<any>(
      `${BUSINESS_API_URL}/api/v1/auth/login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      },
      15_000,
    );
    if (!response.token || !response.username || !Array.isArray(response.roles)) {
      clearAuthSession();
      throw new Error("The login response is incomplete");
    }
    const databaseUser = {
      token: response.token,
      username: response.username,
      roles: response.roles,
      employee_id: response.employee_id,
      full_name: response.full_name,
      warehouse_ref_id: response.warehouse_ref_id,
      warehouse_code: response.warehouse_code,
      applications: response.applications || [],
      page_permissions: response.page_permissions || {},
    };
    storeAuthSession(databaseUser, rememberMe);
    return databaseUser;
  },

  async changePassword(data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/auth/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },

  async magicLogin(token: string): Promise<any> {
    const response = await request<any>(`${BUSINESS_API_URL}/api/v1/auth/magic-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
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
      `${BUSINESS_API_URL}/api/v1/auth/verify-magic-token?token=${encodeURIComponent(token)}`,
    );
  },

  async getRfq(rfqId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/rfqs/${rfqId}`);
  },

  async logout() {
    try {
      if (getAuthToken()) {
        await request(`${BUSINESS_API_URL}/api/v1/auth/logout`, { method: "POST" });
      }
    } catch {
      // Keep logout available if the service is temporarily unreachable.
    } finally {
      clearAuthSession();
    }
  },

  // Gate Entry Use Cases
  async getGateEntries(status?: string): Promise<any[]> {
    const url = status
      ? `${BUSINESS_API_URL}/api/gate-entries?status=${encodeURIComponent(status)}`
      : `${BUSINESS_API_URL}/api/gate-entries`;
    return request<any[]>(url);
  },

  async getInboundArrivals(includeHistory = false): Promise<any[]> {
    return request<any[]>(
      `${BUSINESS_API_URL}/api/gate-entries/inbound-arrivals${includeHistory ? "?include_history=true" : ""}`,
    );
  },
  async createUnscheduledGateEntry(formData: FormData): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/unscheduled`, {
      method: "POST",
      body: formData,
    });
  },
  async createFinishedGoodsPickupGateEntry(payload: {
    request_number: string;
    vehicle_number: string;
    driver_name: string;
    driver_contact: string;
  }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/finished-goods-pickup`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  async completeFinishedGoodsPickupGateExit(
    gatePassNumber: string,
    payload: { vehicle_number: string; driver_name: string; documents_verified: boolean; section_qr_identities?: string[] },
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/gate-entries/finished-goods-pickup/${encodeURIComponent(gatePassNumber)}/exit`,
      { method: "POST", body: JSON.stringify(payload) },
    );
  },
  async getFinishedGoodsPickupGatePass(gatePassNumber: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/gate-entries/finished-goods-pickup/${encodeURIComponent(gatePassNumber)}`,
    );
  },

  async getDocks(
    statusOrParams?: string | { dock_type?: string; status?: string; direction?: string },
    type?: string,
  ): Promise<any[]> {
    const query = new URLSearchParams();
    if (typeof statusOrParams === "object" && statusOrParams !== null) {
      if (statusOrParams.dock_type && statusOrParams.dock_type !== "ALL")
        query.set("dock_type", statusOrParams.dock_type);
      if (statusOrParams.status && statusOrParams.status !== "ALL")
        query.set("status", statusOrParams.status);
      if (statusOrParams.direction && statusOrParams.direction !== "ALL")
        query.set("direction", statusOrParams.direction);
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
    // GRN needs the allocation already assigned to an inbound shipment.
    // The pending endpoint deliberately omits those completed allocations.
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/warehouse/dock-allocation-requests`);
  },
  async allocateDock(
    allocationRequestId: string,
    dockId: string,
    warehouseManagerIdOrOpts?:
      | string
      | {
          assignedWarehouseRefId?: string;
          warehouseManagerId?: string;
          warehouseManagerUsername?: string;
          warehouseManagerName?: string;
        },
    warehouseManagerUsername?: string,
    warehouseManagerName?: string,
  ): Promise<any> {
    let smId: string | null = null;
    let smUsername: string | null = null;
    let smName: string | null = null;

    if (warehouseManagerIdOrOpts && typeof warehouseManagerIdOrOpts === "object") {
      smId = warehouseManagerIdOrOpts.warehouseManagerId || null;
      smUsername = warehouseManagerIdOrOpts.warehouseManagerUsername || null;
      smName = warehouseManagerIdOrOpts.warehouseManagerName || null;
    } else {
      smId = (warehouseManagerIdOrOpts as string) || null;
      smUsername = warehouseManagerUsername || null;
      smName = warehouseManagerName || null;
    }

    return request<any>(`${BUSINESS_API_URL}/api/v1/warehouse/dock-allocations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allocation_request_id: allocationRequestId,
        dock_id: dockId,
        assigned_warehouse_ref_id: (warehouseManagerIdOrOpts as any)?.assignedWarehouseRefId || null,
        warehouse_operator_id: smId,
        warehouse_operator_username: smUsername,
        warehouse_operator_name: smName,
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
  async completeDockReceiving(id: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/warehouse/dock-allocations/${encodeURIComponent(id)}/complete`,
      { method: "POST" },
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
    direction?: "INBOUND" | "OUTBOUND" | "BOTH";
    location?: string;
    description?: string;
    status?: string;
    is_active?: boolean;
    warehouse_id?: string;
    warehouse_type?: string;
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
        direction: payload.direction || "INBOUND",
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
          direction?: "INBOUND" | "OUTBOUND" | "BOTH";
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
  async assignDock(gateEntryId: string, dockId: string, warehouseRefId?: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/${gateEntryId}/assign-dock`, {
      method: "POST",
      body: JSON.stringify({ dock_id: dockId, warehouse_ref_id: warehouseRefId }),
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

  async markInboundVehicleExited(gateEntryId: string, gatePassId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate-entries/${gateEntryId}/vehicle-exited`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gate_pass_id: gatePassId }),
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
      const result = await request<{ items?: any[] }>(
        `${BUSINESS_API_URL}/api/dispatches?${params.toString()}`,
        {
          cache: "no-store",
        },
      );
      return result?.items || [];
    }
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (search?.trim()) params.set("search", search.trim());
    const query = params.toString();
    return request<any[]>(
      `${BUSINESS_API_URL}/api/dispatches/ready-for-gate-exit${query ? `?${query}` : ""}`,
      {
        cache: "no-store",
      },
    );
  },

  async getOutboundDispatch(dispatchId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/dispatch/${encodeURIComponent(dispatchId)}`);
  },

  async confirmOutboundGateExit(
    dispatchId: string,
    payload: {
      gate_pass_id: string;
      vehicle_verified: boolean;
      driver_verified: boolean;
      loaded_goods_verified: boolean;
      remarks?: string;
      vehicle_photo_base64?: string;
    },
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/dispatches/${encodeURIComponent(dispatchId)}/dispatch`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
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
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/dispatch/${encodeURIComponent(dispatchId)}/report-mismatch`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
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
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/dispatch/${encodeURIComponent(dispatchId)}/resolve-mismatch`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
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

  async downloadGatePass(id: string, _gateEntryNumber?: string): Promise<void> {
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
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/procurement/suppliers`).catch(() => []);
  },

  async getSupplier(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/suppliers/${id}`).catch(() => null);
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
  async getAssemblyMaterialRequests(
    searchOrParams?: string | { search?: string; status?: string },
    status?: string,
  ): Promise<any[]> {
    const params = new URLSearchParams();
    if (typeof searchOrParams === "object" && searchOrParams !== null) {
      if (searchOrParams.search) params.set("search", searchOrParams.search);
      if (searchOrParams.status && searchOrParams.status !== "ALL") params.set("status", searchOrParams.status);
    } else {
      if (searchOrParams) params.set("search", searchOrParams);
      if (status && status !== "ALL") params.set("status", status);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/assembly/material-requests${qs}`, {
      cache: "no-store",
    });
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
  async assignAssemblyRequisitionWarehouse(id: string, warehouseRefId: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly-requisitions/${encodeURIComponent(id)}/assign-warehouse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouse_ref_id: warehouseRefId }),
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
  async getAssemblyStockReservations(warehouseRefId?: string): Promise<any[]> {
    const endpoint = warehouseRefId
      ? `${BUSINESS_API_URL}/api/v1/assembly-requisitions/reservations/by-warehouse/${encodeURIComponent(warehouseRefId)}`
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
    const url = supplierId
      ? `${BUSINESS_API_URL}/api/gate/expected-deliveries?supplier_id=${encodeURIComponent(supplierId)}`
      : `${BUSINESS_API_URL}/api/gate/expected-deliveries`;
    const res = await request<any[]>(url, { cache: "no-store" });
    return Array.isArray(res) ? res : [];
  },

  async getSupplierReplacementRequests(): Promise<any[]> {
    return [];
  },
  async getSupplierReplacementRequest(id: string): Promise<any> {
    return {
      id,
      status: "SUPPLIER_ACCEPTED",
      original_asn_id: "",
      reason: "Damaged Material Replacement",
    };
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
    // Do not turn a failed lookup into a fabricated empty ASN context. The
    // GRN wizard needs the persisted ASN, gate entry, vehicle and dock data
    // before it can save Step 1.
    return request<any>(`${BUSINESS_API_URL}/api/gate/asn/${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
  },

  async downloadAsnPdf(id: string, fileName?: string): Promise<void> {
    const response = await fetch(
      `${BUSINESS_API_URL}/api/gate/asns/${encodeURIComponent(id)}/pdf`,
      {
        headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {},
      },
    );
    if (!response.ok) throw new Error("Failed to download ASN PDF");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${fileName || id}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },

  async cancelAsn(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate/asns/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    });
  },

  async deleteAsn(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate/asns/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  async getArrivalNotifications(): Promise<any[]> {
    return this.getNotifications("GATE_SECURITY");
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
    try {
      // This is display-only preview data. Final ASN allocation happens inside
      // the create endpoint and is never persisted when the form is opened.
      const result = await request<any>(`${BUSINESS_API_URL}/api/gate/asns/next-number`);
      return result;
    } catch {
      throw new Error("Unable to retrieve the next ASN number from the backend.");
    }
  },

  async getSupplierAsnWarehouses(): Promise<
    Array<{ id: string; code: string; name: string; warehouse_id: string }>
  > {
    return request(`${BUSINESS_API_URL}/api/gate/supplier/warehouses`, {
      cache: "no-store",
    });
  },

  async getMaterialComponents(status: string = "ACTIVE", availableOnly: boolean = false): Promise<any[]> {
    const q = new URLSearchParams({ status });
    if (availableOnly) q.append("available_only", "true");
    return request<any[]>(`${BUSINESS_API_URL}/api/gate/materials?${q.toString()}`);
    /*
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
    ]; */
  },

  async createMaterialComponent(name: string, uom: string = "PCS", materialCode?: string, category = "General", description = ""): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate/materials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, uom, material_code: materialCode, category, description }),
    });
  },

  async updateGateMaterial(id: string, data: any): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate/materials/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  },

  async updateGateMaterialStatus(id: string, status: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate/materials/${encodeURIComponent(id)}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
  },

  async deleteGateMaterial(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/gate/materials/${encodeURIComponent(id)}`, { method: "DELETE" });
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
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/procurement/purchase-orders`, { cache: "no-store", signal }).catch(() => []);
  },

  async getPurchaseOrder(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/procurement/purchase-orders/${id}`).catch(() => null);
  },
  async getPurchaseOrderByNumber(poNumber: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/procurement/purchase-orders/by-number/${encodeURIComponent(poNumber)}`,
    ).catch(() => null);
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
    filters?: { warehouse_code?: string; warehouse_ref_id?: string },
  ): Promise<any[]> {
    const query = new URLSearchParams({ role });
    if (filters?.warehouse_code) query.set("warehouse_code", filters.warehouse_code);
    if (filters?.warehouse_ref_id) query.set("warehouse_ref_id", filters.warehouse_ref_id);
    const response = await request<any>(
      `${BUSINESS_API_URL}/api/storage/inventory/notifications?${query.toString()}`,
    );
    return Array.isArray(response) ? response : [];
  },
  async rejectAssemblyRequisition(id: string, reason: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly-requisitions/${encodeURIComponent(id)}/reject`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      },
    );
  },
  async confirmAssemblyReceipt(id: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly-requisitions/${encodeURIComponent(id)}/confirm-receipt`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
    );
  },

  async markNotificationRead(_id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/notifications/${encodeURIComponent(_id)}/read`, { method: "POST" });
  },

  async markAllNotificationsRead(
    _role: string,
    _filters?: { warehouse_code?: string; warehouse_ref_id?: string },
  ): Promise<any> {
    const query = new URLSearchParams({ role: _role });
    if (_filters?.warehouse_code) query.set("warehouse_code", _filters.warehouse_code);
    return request<any>(`${BUSINESS_API_URL}/api/v1/notifications/read-all?${query}`, { method: "POST" });
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
    const term = (q || "").trim().toLowerCase();
    if (!term) return { results: [] };

    try {
      const res = await request<any>(
        `${BUSINESS_API_URL}/api/v1/procurement/global-search?q=${encodeURIComponent(q)}`,
      );
      if (res && Array.isArray(res.results) && res.results.length > 0) return res;
    } catch {
      // Fallback to client-side multi-entity aggregator
    }

    try {
      const [asns, vehicles, drivers, pos] = await Promise.all([
        this.getAsns().catch(() => []),
        this.getVehicles().catch(() => []),
        this.getDrivers().catch(() => []),
        this.getPurchaseOrders().catch(() => []),
      ]);

      const results: any[] = [];

      // Search ASNs
      if (Array.isArray(asns)) {
        for (const a of asns) {
          const matchStr = `${a.asn_number || ""} ${a.vehicle_number || ""} ${a.status || ""} ${a.supplier_name || ""} ${a.driver_name || ""}`.toLowerCase();
          if (matchStr.includes(term)) {
            results.push({
              id: a.id || a.asn_number,
              type: "ASN",
              title: a.asn_number || "ASN Record",
              subtitle: `Vehicle: ${a.vehicle_number || "—"} · Status: ${String(a.status || "").replaceAll("_", " ")}`,
              link: "/supplier-dashboard",
            });
          }
        }
      }

      // Search Vehicles
      if (Array.isArray(vehicles)) {
        for (const v of vehicles) {
          const matchStr = `${v.vehicle_number || ""} ${v.vehicle_type || ""} ${v.status || ""}`.toLowerCase();
          if (matchStr.includes(term)) {
            results.push({
              id: v.id || v.vehicle_number,
              type: "VEHICLE",
              title: v.vehicle_number || "Vehicle",
              subtitle: `Type: ${v.vehicle_type || "Commercial"} · Status: ${v.status || "AVAILABLE"}`,
              link: "/supplier-dashboard",
            });
          }
        }
      }

      // Search Drivers
      if (Array.isArray(drivers)) {
        for (const d of drivers) {
          const matchStr = `${d.driver_name || d.name || ""} ${d.phone || d.mobile_number || ""} ${d.license_number || ""}`.toLowerCase();
          if (matchStr.includes(term)) {
            results.push({
              id: d.id || d.driver_name,
              type: "DRIVER",
              title: d.driver_name || d.name || "Driver",
              subtitle: `Mobile: ${d.phone || d.mobile_number || "—"} · License: ${d.license_number || "Verified"}`,
              link: "/supplier-dashboard",
            });
          }
        }
      }

      // Search Purchase Orders
      if (Array.isArray(pos)) {
        for (const p of pos) {
          const matchStr = `${p.po_number || p.purchase_order_number || ""} ${p.supplier_name || ""} ${p.status || ""}`.toLowerCase();
          if (matchStr.includes(term)) {
            results.push({
              id: p.id || p.po_number,
              type: "PURCHASE_ORDER",
              title: p.po_number || p.purchase_order_number || "Purchase Order",
              subtitle: `Supplier: ${p.supplier_name || "—"} · Status: ${p.status || "OPEN"}`,
              link: "/supplier-dashboard",
            });
          }
        }
      }

      return { results: results.slice(0, 10) };
    } catch {
      return { results: [] };
    }
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

    return request<any[]>(`${BUSINESS_API_URL}/api/gate/materials${query ? `?${query}` : ""}`);
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

  async getLegacyAssemblyFinishedGoods(): Promise<any[]> {
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
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/procurement/finished-goods-requests/${encodeURIComponent(id)}`,
    );
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
  async getWarehouses(params?: {
    warehouse_id?: string;
    search?: string;
    status?: string;
  }): Promise<any[]> {
    const query = new URLSearchParams();
    if (params?.warehouse_id) query.set("warehouse_id", params.warehouse_id);
    if (params?.search) query.set("search", params.search);
    if (params?.status) query.set("status", params.status);
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/warehouse${query.toString() ? `?${query}` : ""}`);
  },
  async getWarehouseMasterList(filters?: {
    search?: string;
    status?: string;
    warehouse_id?: string;
  }): Promise<any[]> {
    return this.getWarehouses(filters);
  },
  async getWarehouse(idOrCode: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/warehouse/configuration/${encodeURIComponent(idOrCode)}`);
  },
  async getMyWarehouse(): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/warehouse/me`);
  },
  async getWarehouseOperatorMetrics(warehouseRefId?: string): Promise<any> {
    const endpoint = warehouseRefId
      ? `${BUSINESS_API_URL}/api/v1/warehouse/${encodeURIComponent(warehouseRefId)}/dashboard-metrics`
      : `${BUSINESS_API_URL}/api/v1/warehouse/me/dashboard-metrics`;
    return request<any>(endpoint);
  },
  async getWarehouseManagers(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/warehouse/managers`);
  },
  async getNextWarehouseCode(): Promise<{ suggested_warehouse_code: string }> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/warehouse/next-code`);
  },
  async createWarehouse(data: {
    warehouse_name: string;
    description?: string;
    warehouse_id?: string;
    warehouse_type?: string;
    warehouse_operator_id?: string;
    warehouse_operator_name?: string;
    status?: string;
    warehouse_code?: string;
  }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/warehouse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  async updateWarehouse(
    idOrCode: string,
    data: {
      warehouse_name?: string;
      description?: string;
      warehouse_id?: string;
      warehouse_operator_id?: string;
      warehouse_operator_name?: string;
      status?: string;
    },
  ): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/warehouse/configuration/${encodeURIComponent(idOrCode)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  async updateWarehouseStatus(idOrCode: string, status: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/warehouse/${encodeURIComponent(idOrCode)}/status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      },
    );
  },
  async deleteWarehouse(idOrCode: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/warehouse/configuration/${encodeURIComponent(idOrCode)}`, {
      method: "DELETE",
    });
  },
  async getWarehouseHierarchy(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/warehouse/hierarchy/all`);
  },
  async getWarehouseZones(warehouseRefIdOrCode: string, status?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (status) params.append("status", status);
    const query = params.toString();
    return request<any[]>(
      `${BUSINESS_API_URL}/api/v1/warehouse/${encodeURIComponent(warehouseRefIdOrCode)}/zones${query ? `?${query}` : ""}`,
    );
  },
  async getLocationZones(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/zones`);
  },
  async getNextLocationZoneCode(): Promise<{ suggested_zone_code: string }> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/zones/next-code`);
  },
  async createLocationZone(data: {
    zone_name: string;
    description?: string;
    zone_code?: string;
    warehouse_name?: string;
    warehouse_id?: string;
  }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/zones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  async getNextZoneCode(warehouseRefIdOrCode: string): Promise<{ suggested_zone_code: string }> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/warehouse/${encodeURIComponent(warehouseRefIdOrCode)}/zones/next-code`,
    );
  },
  async createZone(
    warehouseRefIdOrCode: string,
    data: {
      zone_name: string;
      description?: string;
      zone_code?: string;
      status?: string;
    },
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/warehouse/${encodeURIComponent(warehouseRefIdOrCode)}/zones`,
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
  async createWarehouseManager(data: {
    full_name: string;
    employee_id: string;
    username: string;
    email: string;
    password: string;
    warehouse_ref_id: string;
    status?: string;
    role?: string;
    applications?: string[];
  }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/warehouse/managers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },
  async updateWarehouseManager(
    managerId: string,
    data: {
      full_name?: string;
      email?: string;
      password?: string;
      warehouse_ref_id?: string;
      status?: string;
      role?: string;
      applications?: string[];
    },
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/warehouse/managers/${encodeURIComponent(managerId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
  },
  async updateWarehouseManagerStatus(managerId: string, status: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/warehouse/managers/${encodeURIComponent(managerId)}/status`,
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
  async getWarehouseBins(warehouseRefIdOrCode: string, status?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (status) params.append("status", status);
    const query = params.toString();
    return request<any[]>(
      `${BUSINESS_API_URL}/api/v1/warehouse/${encodeURIComponent(warehouseRefIdOrCode)}/bins${query ? `?${query}` : ""}`,
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
  async getNextBinCode(zoneId: string): Promise<{ suggested_bin_code: string; suggested_rack_code: string }> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/zones/${encodeURIComponent(zoneId)}/bins/next-code`,
    );
  },
  async deleteRack(zoneId: string, rackId: string): Promise<{ deleted: boolean }> {
    return request(`${BUSINESS_API_URL}/api/v1/zones/${encodeURIComponent(zoneId)}/racks/${encodeURIComponent(rackId)}`, { method: "DELETE" });
  },
  async moveRackMaterial(zoneId: string, rackId: string, data: {
    source_scan: string; material_scan: string; quantity: number; reason: string; destination_scan?: string;
  }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/zones/${encodeURIComponent(zoneId)}/racks/${encodeURIComponent(rackId)}/move`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
  },
  async getRackMaterials(zoneId: string, rackId: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/zones/${encodeURIComponent(zoneId)}/racks/${encodeURIComponent(rackId)}/materials`);
  },
  async updateRackCapacity(zoneId: string, rackId: string, maximum_capacity: number, reason?: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/zones/${encodeURIComponent(zoneId)}/racks/${encodeURIComponent(rackId)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ maximum_capacity, reason }),
    });
  },
  async emptyRack(zoneId: string, rackId: string, reason: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/zones/${encodeURIComponent(zoneId)}/racks/${encodeURIComponent(rackId)}/empty`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true, reason }),
    });
  },
  async getRackHistory(zoneId: string, rackId: string): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/zones/${encodeURIComponent(zoneId)}/racks/${encodeURIComponent(rackId)}/history`);
  },
  async createBin(
    zoneId: string,
    data: {
      bin_name: string;
      qr_identifier?: string;
      bin_code?: string;
      rack?: string;
      shelf?: string;
      position?: string;
      qr_identifier?: string;
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
    batch_number?: string;
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
    warehouse_ref_id?: string;
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
      if (params.warehouse_ref_id && params.warehouse_ref_id !== "ALL") query.append("warehouse_ref_id", params.warehouse_ref_id);
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
  async getPutawayTasks(warehouseRefId?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (warehouseRefId) params.append("warehouse_ref_id", warehouseRefId);
    const q = params.toString();
    return request<any[]>(`${BUSINESS_API_URL}/api/storage/putaway-tasks${q ? `?${q}` : ""}`);
  },
  async getPutawayTask(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/storage/putaway-tasks/${encodeURIComponent(id)}`);
  },
  async assignPutawayLocation(
    taskId: string,
    locationId?: string,
    warehouseRefId?: string,
    zoneId?: string,
    binId?: string,
    quantity?: number,
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/storage/putaway-tasks/${encodeURIComponent(taskId)}/location`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location_id: locationId || undefined,
          warehouse_ref_id: warehouseRefId || undefined,
          zone_id: zoneId || undefined,
          bin_id: binId || undefined,
          quantity: quantity || undefined,
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
      confirmation_id?: string;
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
  async resolveBinQr(binScan: string, warehouseRefId?: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/storage/putaway-tasks/resolve-bin-qr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bin_scan: binScan, warehouse_ref_id: warehouseRefId || undefined }),
    });
  },
  async executePutaway(data: {
    task_id?: string;
    grn_qr_code: string;
    bin_qr_code: string;
    quantity: number;
    batch_number?: string;
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
  async verifyHandlingUnitLabel(scanValue: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/storage/putaway-tasks/handling-units/${encodeURIComponent(scanValue)}/verify-label`,
      {
        method: "POST",
      },
    );
  },
  async getStorageLocations(warehouseId?: string): Promise<any[]> {
    const q = warehouseId ? `?warehouse_id=${encodeURIComponent(warehouseId)}` : "";
    return request<any[]>(`${BUSINESS_API_URL}/api/storage/putaway-tasks/locations${q}`);
  },
  async getInventoryLocationBalances(materialCode?: string, warehouseRefId?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (materialCode) params.append("material_code", materialCode);
    if (warehouseRefId) params.append("warehouse_ref_id", warehouseRefId);
    const q = params.toString() ? `?${params.toString()}` : "";
    return request<any[]>(`${BUSINESS_API_URL}/api/storage/putaway-tasks/inventory-locations${q}`);
  },
  async getWarehouseInventorySummary(params?: {
    material_code?: string;
    warehouse_ref_id?: string;
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
    if (params?.warehouse_ref_id && params.warehouse_ref_id !== "ALL") query.append("warehouse_ref_id", params.warehouse_ref_id);
    if (params?.zone_id && params.zone_id !== "ALL") query.append("zone_id", params.zone_id);
    if (params?.warehouse_id && params.warehouse_id !== "ALL")
      query.append("warehouse_id", params.warehouse_id);
    if (params?.category && params.category !== "ALL") query.append("category", params.category);
    if (params?.batch && params.batch !== "ALL") query.append("batch", params.batch);
    if (params?.supplier && params.supplier !== "ALL") query.append("supplier", params.supplier);
    if (params?.grn && params.grn !== "ALL") query.append("grn", params.grn);
    if (params?.location && params.location !== "ALL") query.append("location", params.location);
    if (params?.stock_status && params.stock_status !== "ALL")
      query.append("stock_status", params.stock_status);
    if (params?.qc_status && params.qc_status !== "ALL")
      query.append("qc_status", params.qc_status);
    if (params?.expiry && params.expiry !== "ALL") query.append("expiry", params.expiry);
    if (params?.availability && params.availability !== "ALL")
      query.append("availability", params.availability);
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
    batch_number?: string;
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
    return request<any>(
      `${BUSINESS_API_URL}/api/storage/inventory/materials/${encodeURIComponent(materialCode)}/detail`,
    );
  },
  async getStockLedger(params?: {
    material_code?: string;
    warehouse_ref_id?: string;
    zone_id?: string;
    transaction_type?: string;
    start_date?: string;
    end_date?: string;
    search?: string;
  }): Promise<any[]> {
    const query = new URLSearchParams();
    if (params?.material_code) query.append("material_code", params.material_code);
    if (params?.warehouse_ref_id && params.warehouse_ref_id !== "ALL") query.append("warehouse_ref_id", params.warehouse_ref_id);
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
  async getPickupTasks(params?: {
    warehouse_code?: string;
    status?: string;
    department?: string;
  }): Promise<any[]> {
    const query = new URLSearchParams();
    if (params?.warehouse_code) query.append("warehouse_code", params.warehouse_code);
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
    data: {
      material_scan: string;
      zone_scan: string;
      quantity: number;
      notes?: string;
      batch_number?: string;
      confirmation_id?: string;
    },
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
  async createBulkRack(warehouseRefId: string, data: {
    zone_id: string;
    rack_code: string;
    bin_code_prefix: string;
    bin_code_start: number;
    count: number;
    position_prefix: string;
    position_start: number;
    code_width: number;
    capacity: number;
  }): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/warehouse/${encodeURIComponent(warehouseRefId)}/bins/bulk`, {
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
  async createMaterialIssue(data: {
    requisition_number?: string;
    assembly_order_number?: string;
    issued_to?: string;
  }): Promise<any> {
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
      body: JSON.stringify({
        lines: lines.map((line) => ({
          itemCode: line.itemCode ?? line.item_code,
          materialName: line.materialName ?? line.material_name,
          materialCategory: line.materialCategory ?? line.material_category,
          variantCode: line.variantCode ?? line.variant_code,
          uom: line.uom,
          receivedQuantity: line.receivedQuantity ?? line.received_quantity,
          goodQuantity: line.goodQuantity ?? line.good_quantity,
          damagedQuantity: line.damagedQuantity ?? line.damaged_quantity,
          rejectedQuantity: line.rejectedQuantity ?? line.rejected_quantity,
          heldQuantity: line.heldQuantity ?? line.held_quantity,
          rejectedReason: line.rejectedReason ?? line.rejected_reason,
          damageReason: line.damageReason ?? line.damage_reason,
          heldReason: line.heldReason ?? line.held_reason,
        })),
      }),
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
    return normalizeGrnResponse(await request<any[]>(`${BUSINESS_API_URL}/api/receiving/grn/lines/${grnLineId}/batches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batches),
    }));
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
    try {
      return normalizeGrnResponse(await request<any>(
        `${BUSINESS_API_URL}/api/receiving/grn/${encodeURIComponent(grnId)}`,
      ));
    } catch (error) {
      // A deleted/stale local session is handled by the GRN screen. Do not
      // surface it as an unhandled console error or resume invalid data.
      if (error instanceof Error && /\b404\b|GRN not found/i.test(error.message)) return null;
      throw error;
    }
  },
  async deleteGrn(grnId: string): Promise<void> {
    await request<void>(`${BUSINESS_API_URL}/api/receiving/grn/${encodeURIComponent(grnId)}`, {
      method: "DELETE",
    });
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
    const url = status
      ? `${BUSINESS_API_URL}/api/dispatches?status=${encodeURIComponent(status)}`
      : `${BUSINESS_API_URL}/api/dispatches`;
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
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/${id}/reserve-stock`, {
      method: "POST",
    });
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
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/${id}/loading/start`, {
      method: "POST",
    });
  },
  async verifyDispatchLoading(id: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/${id}/loading/verify`, {
      method: "POST",
    });
  },
  async scanDispatchPackage(id: string, qrCode: string): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/dispatches/${id}/loading/scan-package`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qr_code: qrCode }),
    });
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
      const res = await request<any[]>(`${BUSINESS_API_URL}/api/dispatches/ready-for-gate-exit`, {
        cache: "no-store",
      });
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
  async getAssemblyDashboard(adminUser?: string | null, assemblyUnit?: string | null): Promise<AssemblyDashboardResponse> {
    const params = new URLSearchParams();
    if (adminUser) params.set("admin_user", adminUser);
    if (assemblyUnit) params.set("assembly_unit", assemblyUnit);
    const query = params.size ? `?${params.toString()}` : "";
    return request<AssemblyDashboardResponse>(`${BUSINESS_API_URL}/api/v1/assembly/dashboard${query}`, {
      cache: "no-store",
    });
  },
  async getAssemblyProducts(): Promise<AssemblyProductOption[]> {
    return request<AssemblyProductOption[]>(`${BUSINESS_API_URL}/api/v1/assembly/products`, {
      cache: "no-store",
    });
  },
  async getAssemblyAvailableMaterials(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/assembly/available-materials`, {
      cache: "no-store",
    });
  },
  async createAssemblyProduct(payload: {
    product_name: string;
    product_code: string;
    description?: string;
    components?: Array<{
      material_code: string;
      material_name: string;
      quantity_per_unit: number;
      uom?: string;
    }>;
  }): Promise<AssemblyProductOption> {
    return request<AssemblyProductOption>(`${BUSINESS_API_URL}/api/v1/assembly/products`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  async getAdjustmentReasons(): Promise<string[]> {
    return request<string[]>(`${BUSINESS_API_URL}/api/v1/inventory/adjustment-reasons`);
  },
  async performBinTransfer(payload: {
    material_code: string;
    batch_number?: string;
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
      body: JSON.stringify(payload),
    });
  },
  async updateProductBOMMaterial(productCode: string, data: { material_code: string; quantity_per_unit: number }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/products/${encodeURIComponent(productCode)}/bom/materials`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
  },

  async addProductBOMMaterial(productCode: string, data: { material_code: string; quantity_per_unit: number }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/products/${encodeURIComponent(productCode)}/bom/materials`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
  },
  async getProductBOM(productCode: string, quantity = 1, availableOnly = false): Promise<AssemblyProductBOMResponse> {
    const q = new URLSearchParams({ quantity: String(quantity) });
    if (availableOnly) q.append("available_only", "true");
    return request<AssemblyProductBOMResponse>(
      `${BUSINESS_API_URL}/api/v1/assembly/products/${encodeURIComponent(productCode)}/bom?${q.toString()}`,
      { cache: "no-store" },
    );
  },

  async createAssemblyMaterialRequest(
    data: CreateAssemblyMaterialRequestPayload,
  ): Promise<AssemblyMaterialRequest> {
    return request<AssemblyMaterialRequest>(
      `${BUSINESS_API_URL}/api/v1/assembly/material-requests`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
  },
  async getAssemblyMaterialRequestDetail(requestId: string): Promise<AssemblyMaterialRequest> {
    return request<AssemblyMaterialRequest>(
      `${BUSINESS_API_URL}/api/v1/assembly/material-requests/${encodeURIComponent(requestId)}`,
      { cache: "no-store" },
    );
  },
  async getAssemblyPickingTasks(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/assembly/material-requests/picking-tasks`, {
      cache: "no-store",
    });
  },
  async completeAssemblyPickingTask(
    id: string,
    data: { material_scan: string; zone_scan: string; quantity: number },
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly/material-requests/picking-tasks/${encodeURIComponent(id)}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
  },
  async approveAssemblyMaterialRequest(
    requestId: string,
    payload?: {
      approved_items?: Array<{ material_code: string; approved_quantity: number }>;
      remarks?: string;
    },
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly/material-requests/${encodeURIComponent(requestId)}/approve`,
      { method: "POST", body: JSON.stringify(payload || {}) },
    );
  },
  async rejectAssemblyMaterialRequest(requestId: string, reason: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly/material-requests/${encodeURIComponent(requestId)}/reject`,
      {
        method: "POST",
        body: JSON.stringify({ reason }),
      },
    );
  },
  async warehouseIssueMaterials(requestId: string, payload?: { remarks?: string }): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly/material-requests/${encodeURIComponent(requestId)}/warehouse-issue`,
      {
        method: "POST",
        body: JSON.stringify(payload || {}),
      },
    );
  },
  async confirmAssemblyMaterialReceipt(
    requestId: string,
    payload?: {
      received_items?: Array<{
        material_code: string;
        received_quantity: number;
        material_scan?: string;
      }>;
      remarks?: string;
    },
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly/material-requests/${encodeURIComponent(requestId)}/confirm-receipt`,
      {
        method: "POST",
        body: JSON.stringify(payload || {}),
      },
    );
  },
  async getAssemblyProductionOrders(params?: {
    search?: string;
    status?: string;
  }): Promise<AssemblyProductionOrder[]> {
    const q = new URLSearchParams();
    if (params?.search) q.append("search", params.search);
    if (params?.status && params.status !== "ALL") q.append("status", params.status);
    const queryStr = q.toString() ? `?${q.toString()}` : "";
    return request<AssemblyProductionOrder[]>(
      `${BUSINESS_API_URL}/api/v1/assembly/production/orders${queryStr}`,
      {
        cache: "no-store",
      },
    );
  },
  async verifyAssemblyMaterialQr(orderId: string, scannedQr: string): Promise<AssemblyMaterialQrVerification> {
    return request<AssemblyMaterialQrVerification>(
      `${BUSINESS_API_URL}/api/v1/assembly/orders/${encodeURIComponent(orderId)}/material-consumption/verify?scanned_qr=${encodeURIComponent(scannedQr)}`,
      { cache: "no-store" },
    );
  },
  async getAssemblyMaterialConsumption(orderId: string): Promise<AssemblyMaterialConsumptionSummary> {
    return request<AssemblyMaterialConsumptionSummary>(
      `${BUSINESS_API_URL}/api/v1/assembly/orders/${encodeURIComponent(orderId)}/material-consumption`,
      { cache: "no-store" },
    );
  },
  async recordAssemblyMaterialConsumption(orderId: string, payload: {
    material_code: string; grn_batch_id: string; material_qr: string;
    actual_consumed: number; uom: string; idempotency_key: string;
  }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/orders/${encodeURIComponent(orderId)}/material-consumption`, {
      method: "POST", body: JSON.stringify(payload),
    });
  },
  async startAssemblyProduction(orderId: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly/orders/${encodeURIComponent(orderId)}/start-production`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
  },
  async completeAssemblyProduction(
    orderId: string,
    payload: {
      produced_quantity: number;
      notes?: string;
      wastage_quantity?: number;
      wastage_material_code?: string;
      wastage_reason?: string;
    },
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly/orders/${encodeURIComponent(orderId)}/complete-production`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },
  async getAssemblyQualityInspections(params?: {
    search?: string;
    status?: string;
  }): Promise<AssemblyQualityInspectionItem[]> {
    const q = new URLSearchParams();
    if (params?.search) q.append("search", params.search);
    if (params?.status && params.status !== "ALL") q.append("status", params.status);
    const queryStr = q.toString() ? `?${q.toString()}` : "";
    return request<AssemblyQualityInspectionItem[]>(
      `${BUSINESS_API_URL}/api/v1/assembly/quality/inspections${queryStr}`,
      {
        cache: "no-store",
      },
    );
  },
  async performAssemblyQualityInspection(payload: {
    order_id: string;
    inspector_name: string;
    authorized_person_confirmed: boolean;
    passed_quantity: number;
    failed_quantity?: number;
    rework_quantity?: number;
    held_quantity?: number;
    notes?: string;
  }): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/quality/inspect`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  async getAssemblyFinishedGoods(params?: {
    search?: string;
    group_by?: "product";
  }): Promise<AssemblyFinishedGoodItem[]> {
    const q = new URLSearchParams();
    if (params?.search) q.append("search", params.search);
    if (params?.group_by) q.append("group_by", params.group_by);
    const queryStr = q.toString() ? `?${q.toString()}` : "";
    return request<AssemblyFinishedGoodItem[]>(
      `${BUSINESS_API_URL}/api/v1/assembly/finished-goods${queryStr}`,
      {
        cache: "no-store",
      },
    );
  },
  async getAssemblyFinishedGoodsInventorySummary(): Promise<{
    total_produced: number;
    qc_approved: number;
    available: number;
    reserved: number;
    packed: number;
    dispatched: number;
    rejected_held: number;
    fifo_oldest_completion?: string | null;
    assembly_location: string;
  }> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/finished-goods/inventory-summary`, {
      cache: "no-store",
    });
  },
  async getSupplierPickupFinishedGoods(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/assembly/supplier/pickup-finished-goods`);
  },
  async getFgLoading(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/assembly/fg-loading`);
  },
  async confirmFgLoading(gatePass: string, qrIdentities: string[]): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/assembly/fg-loading/${encodeURIComponent(gatePass)}/confirm`, {method: "POST", body: JSON.stringify({qr_identities: qrIdentities})});
  },
  async createSupplierFinishedGoodsDispatchRequest(payload: {
    finished_goods_id?: string;
    product_code: string;
    product_name: string;
    quantity: number;
    uom?: string;
    vehicle_number: string;
    driver_name: string;
    driver_contact: string;
    transport_entries?: Array<{
      vehicle_number: string;
      driver_name: string;
      driver_contact: string;
    }>;
    expected_pickup_date: string;
    remarks?: string;
  }): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly/supplier/finished-goods-dispatch-requests`,
      { method: "POST", body: JSON.stringify(payload) },
    );
  },
  async getSupplierFinishedGoodsDispatchRequests(): Promise<any[]> {
    return request<any[]>(
      `${BUSINESS_API_URL}/api/v1/assembly/supplier/finished-goods-dispatch-requests`,
      { cache: "no-store" },
    );
  },
  async allocateSupplierFinishedGoodsFifo(requestId: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly/supplier/finished-goods-dispatch-requests/${encodeURIComponent(requestId)}/allocate-fifo`,
      { method: "POST", body: JSON.stringify({}) },
    );
  },
  async scanAllocatedFinishedGoods(
    dispatchId: string,
    qrCode: string,
    quantity: number,
  ): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly/dispatch/${encodeURIComponent(dispatchId)}/scan-finished-goods`,
      { method: "POST", body: JSON.stringify({ qr_code: qrCode, quantity }) },
    );
  },
  async getAssemblyFinishedGoodsDetail(fgId: string): Promise<AssemblyFinishedGoodDetail> {
    return request<AssemblyFinishedGoodDetail>(
      `${BUSINESS_API_URL}/api/v1/assembly/finished-goods/${encodeURIComponent(fgId)}`,
      {
        cache: "no-store",
      },
    );
  },
  async getAssemblyFinishedGoodsTraceability(fgId: string): Promise<AssemblyFinishedGoodsTraceability> {
    return request<AssemblyFinishedGoodsTraceability>(
      `${BUSINESS_API_URL}/api/v1/assembly/finished-goods/${encodeURIComponent(fgId)}/traceability`,
      { cache: "no-store" },
    );
  },
  async verifyAssemblyFinishedGoodsQr(fgId: string, qrCode: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly/finished-goods/${encodeURIComponent(fgId)}/verify-qr`,
      {
        method: "POST",
        body: JSON.stringify({ qr_code: qrCode }),
      },
    );
  },
  async allocateAssemblyFinishedGoodsFifo(dispatchId: string): Promise<any> {
    return request<any>(
      `${BUSINESS_API_URL}/api/v1/assembly/dispatch/${encodeURIComponent(dispatchId)}/allocate-fifo`,
      { method: "POST" },
    );
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
  async getInventoryTraceability(params?: {
    material_code?: string;
    batch_number?: string;
  }): Promise<any> {
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
  async getAdminOverview(): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/admin/overview`);
  },
  async getAdminAuditLogs(filters?: { module?: string; actor?: string; action?: string; result?: string; limit?: number; offset?: number }): Promise<{ total: number; items: any[] }> {
    const params = new URLSearchParams();
    if (filters?.module) params.set("module", filters.module);
    if (filters?.actor) params.set("actor", filters.actor);
    if (filters?.action) params.set("action", filters.action);
    if (filters?.result) params.set("result", filters.result);
    params.set("limit", String(filters?.limit || 100));
    if (filters?.offset) params.set("offset", String(filters.offset));
    return request(`${BUSINESS_API_URL}/api/v1/admin/audit-logs?${params.toString()}`);
  },
  async getAdminUsers(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/admin/users`);
  },
  async getAdminRoles(): Promise<Array<{ value: string; label: string }>> {
    return request<Array<{ value: string; label: string }>>(
      `${BUSINESS_API_URL}/api/v1/admin/roles`,
    );
  },
  async getAdminAssemblyUnits(): Promise<Array<{ id: string; code: string; name: string; description?: string | null; status: string }>> {
    return request(`${BUSINESS_API_URL}/api/v1/admin/assembly-units`);
  },
  async createAdminAssemblyUnit(payload: { unit_name: string; description?: string }): Promise<any> {
    return request(`${BUSINESS_API_URL}/api/v1/admin/assembly-units`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  async updateAdminAssemblyUnit(unitId: string, payload: { unit_name?: string; description?: string; status?: string }): Promise<any> {
    return request(`${BUSINESS_API_URL}/api/v1/admin/assembly-units/${encodeURIComponent(unitId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  async getAdminWarehouses(): Promise<Array<{ id: string; code: string; name: string }>> {
    return request<Array<{ id: string; code: string; name: string }>>(
      `${BUSINESS_API_URL}/api/v1/admin/warehouses`,
    );
  },
  async getAdminSuppliers(): Promise<any[]> {
    return request<any[]>(`${BUSINESS_API_URL}/api/v1/admin/suppliers`);
  },
  async createAdminUser(payload: Record<string, unknown>): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/admin/users`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  async updateAdminUser(userId: string, payload: Record<string, unknown>): Promise<any> {
    return request<any>(`${BUSINESS_API_URL}/api/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  async assistantCapabilities(): Promise<{ role: string; categories: string[]; suggestions: string[]; read_only: boolean }> {
    return request(`${BUSINESS_API_URL}/api/v1/assistant/capabilities`);
  },
  async assistantChat(
    message: string,
    history: AssistantChatMessage[] = [],
  ): Promise<AssistantChatResponse> {
    return request<AssistantChatResponse>(`${BUSINESS_API_URL}/api/v1/assistant/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history }),
    });
  },
};

export interface AssistantChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantChatResponse {
  reply: string;
  model: string;
}


export interface AssemblyQualityInspectionItem {
  order_id: string;
  order_number: string;
  product_code: string;
  product_name: string;
  uom: string;
  produced_quantity: number;
  target_quantity: number;
  passed_quantity: number;
  failed_quantity: number;
  rework_quantity: number;
  held_quantity: number;
  qc_status: string;
  order_status: string;
  inspected_by?: string | null;
  inspected_at?: string | null;
  notes?: string | null;
  can_inspect: boolean;
  completed_at?: string | null;
}

export interface AssemblyFinishedGoodItem {
  batches?: AssemblyFinishedGoodItem[];
  id: string;
  order_id: string;
  order_number: string;
  product_code: string;
  product_name: string;
  produced_quantity?: number;
  available_quantity?: number;
  reserved_quantity?: number;
  dispatched_quantity?: number;
  manufacturing_date?: string | null;
  qc_status?: string;
  inspected_by?: string | null;
  inspected_at?: string | null;
  quantity: number;
  uom: string;
  status: string;
  warehouse_id: string;
  location_code: string;
  qr_code?: string | null;
  serial_number?: string | null;
  batch_number?: string | null;
  qr_verified_at?: string | null;
  qr_verified_by?: string | null;
  posted_at: string | null;
}

export interface AssemblyFinishedGoodDetail extends AssemblyFinishedGoodItem {
  label_payload?: {
    title: string;
    product_name: string;
    product_code: string;
    order_number: string;
    quantity: string;
    serial_number?: string;
    qr_code?: string;
    location: string;
    inspected_by: string;
    date: string | null;
    qc_status?: string;
  };
}

export interface AssemblyFinishedGoodsTraceabilityMaterial {
  material_code: string;
  material_name: string;
  grn_batch_id: string;
  batch_number: string | null;
  original_qr_identity: string;
  original_qr_payload: string | null;
  quantity_consumed: number;
  uom: string;
  grn_reference: { grn_id: string | null; grn_number: string | null };
  supplier: { supplier_name: string | null; source: string | null };
  consumption_event_ids: string[];
}

export interface AssemblyFinishedGoodsTraceabilityEvent {
  consumption_event_id: string;
  material_code: string;
  grn_batch_id: string;
  batch_number: string | null;
  original_material_qr_reference: string | null;
  quantity_consumed: number;
  uom: string;
  consumed_at: string;
  recorded_by: string;
  traceability_status: "VERIFIED" | "UNLINKED";
}

export interface AssemblyFinishedGoodsUnlinkedMaterialRecord {
  consumption_id?: string;
  consumption_event_id?: string;
  material_code: string;
  batch_number?: string | null;
  quantity_consumed: number;
  uom: string;
  original_material_qr_reference?: string | null;
  traceability_status: "UNLINKED";
  reason: string;
}

export interface AssemblyFinishedGoodsTraceability {
  finished_goods: {
    fg_id: string;
    fg_batch_number: string | null;
    serial_number: string | null;
    product_code: string;
    product_name: string;
    finished_quantity: number;
    uom: string;
    qc_status: string | null;
    qr_identity: string | null;
  };
  assembly: {
    assembly_order_id: string;
    assembly_order_number: string;
    production_status: string;
  };
  traceability: {
    overall_status: "COMPLETE" | "PARTIAL" | "UNLINKED" | "NOT_AVAILABLE";
    total_material_batches: number;
    verified_material_batches: number;
    unlinked_material_records: number;
    data_quality_warnings: string[];
  };
  consumed_materials: AssemblyFinishedGoodsTraceabilityMaterial[];
  consumption_events: AssemblyFinishedGoodsTraceabilityEvent[];
  unlinked_material_records: AssemblyFinishedGoodsUnlinkedMaterialRecord[];
}

export interface AssemblyProductionOrder {
  id: string;
  order_number: string;
  product_code: string;
  product_name: string;
  target_quantity: number;
  produced_quantity: number;
  rejected_quantity: number;
  uom: string;
  status: string;
  priority: string;
  required_date: string | null;
  assigned_line?: string | null;
  assigned_operator?: string | null;
  material_request_number?: string | null;
  can_start: boolean;
  can_complete: boolean;
  traceability_required?: boolean;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
}

export interface AssemblyMaterialQrVerification {
  material_code: string; material_name: string; grn_batch_id: string; batch_number: string;
  material_qr: string; quantity_issued: number; quantity_received: number;
  quantity_already_consumed: number; remaining_quantity: number; uom: string; verified: boolean;
}

export interface AssemblyMaterialConsumptionSummary {
  assembly_order_id: string; traceability_required: boolean; traceability_status: string;
  missing_material_codes: string[]; can_complete: boolean;
  events: Array<{ consumption_event_id: string; material_code: string; grn_batch_id: string;
    batch_number?: string | null; material_qr: string; consumed_quantity: number; uom: string;
    consumed_at: string; recorded_by: string; status: string }>;
}

export interface AssemblyMaterialRequestItem {
  id?: string;
  material_code: string;
  material_name: string;
  quantity: number;
  available_quantity?: number;
  shortage?: number;
  uom: string;
  status?: string;
  issued_quantity?: number;
  received_quantity?: number;
}

export interface AssemblyMaterialRequest {
  id: string;
  request_number: string;
  order_id?: string | null;
  order_number?: string | null;
  order_status?: string | null;
  product_code?: string;
  product_name?: string;
  target_quantity?: number;
  uom?: string;
  items_count: number;
  warehouse_id: string;
  status: string;
  priority: string;
  required_date: string | null;
  remarks?: string | null;
  created_at: string | null;
  material_received_by?: string | null;
  material_received_at?: string | null;
  issue_transaction?: {
    issue_number: string;
    issued_at: string | null;
    issued_by: string;
    items: Array<{ material_code: string; issued_quantity?: number }>;
  } | null;
  material_issue?: {
    id: string;
    issue_number: string;
    issued_by: string;
    received_by: string;
    issued_at: string;
    items: any[];
  } | null;
  approval_history?: any[];
  items: AssemblyMaterialRequestItem[];
}

export interface CreateAssemblyMaterialRequestPayload {
  product_code: string;
  target_quantity: number;
  required_date: string;
  remarks?: string;
  priority?: string;
  assembly_line?: string;
  order_id?: string;
}

export interface AssemblyProductBOMResponse {
  product_code: string;
  product_name: string;
  bom_number: string;
  target_quantity: number;
  uom: string;
  summary: {
    total_components: number;
    available_components: number;
    shortage_components: number;
    has_shortage: boolean;
  };
  materials: AssemblyOrderItem[];
}

export interface AssemblyKPIs {
  open_orders: number;
  material_pending: number;
  in_production: number;
  qc_pending: number;
  completed_today: number;
}

export interface AssemblyOrderItem {
  material_code: string;
  material_name: string;
  quantity_per_unit: number;
  required_quantity: number;
  available_quantity: number;
  requested_quantity?: number;
  received_quantity?: number;
  shortage?: number;
  uom: string;
  status: string;
}

export interface AssemblyWorkStep {
  id: string;
  sequence: number;
  name: string;
  instruction?: string;
  expected_time_minutes?: number;
  qc_required?: boolean;
  status: string;
  started_at?: string | null;
  completed_at?: string | null;
  started_by?: string | null;
  completed_by?: string | null;
}

export interface AssemblyOrder {
  id: string;
  order_number: string;
  product_code: string;
  product_name: string;
  bom_id?: string | null;
  bom_number?: string | null;
  target_quantity: number;
  planned_quantity: number;
  completed_quantity: number;
  rejected_quantity: number;
  uom: string;
  required_date: string | null;
  assembly_line: string | null;
  assigned_line: string | null;
  assigned_operator: string | null;
  priority: string;
  status: string;
  notes: string | null;
  progress: number;
  items: AssemblyOrderItem[];
  assembly_steps: AssemblyWorkStep[];
  created_by: string;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
}

export interface AssemblyAttentionItem {
  id: string;
  order_number: string;
  product_name: string;
  type: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  item_name?: string;
  required?: number;
  available?: number;
  shortage?: number;
  uom?: string;
  message: string;
}

export interface AssemblyActivityItem {
  id: string;
  order_number: string;
  action: string;
  description: string;
  user: string;
  timestamp: string;
}

export interface AssemblyDashboardResponse {
  viewed_user?: { id: string; full_name: string; employee_id: string } | null;
  assembly_unit?: string | null;
  kpis: AssemblyKPIs;
  active_orders: AssemblyOrder[];
  needs_attention: AssemblyAttentionItem[];
  recent_activity: AssemblyActivityItem[];
}

export interface AssemblyProductOption {
  id: string;
  product_code: string;
  product_name: string;
  bom_number: string;
  description: string;
  uom: string;
}



export const apiClient = api;
