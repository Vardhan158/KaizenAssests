import { redirect } from "@tanstack/react-router";
import { getPageAccess, type PageAccess } from "@/lib/page-permissions";

export interface UserInfo {
  token: string;
  username: string;
  roles: string[];
  supplierId?: string;
  warehouse_ref_id?: string;
  warehouse_code?: string;
  warehouseRefId?: string;
  warehouseCode?: string;
  employee_id?: string;
  full_name?: string;
  page_permissions?: Record<string, PageAccess>;
}

const AUTH_TOKEN_KEY = "auth_token";
const USER_INFO_KEY = "user_info";

function normalizeRole(role: string): string {
  return role.trim().toUpperCase();
}

function getActiveStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  if (sessionStorage.getItem(AUTH_TOKEN_KEY)) return sessionStorage;
  return null;
}

export function getAuthToken(): string | null {
  return getActiveStorage()?.getItem(AUTH_TOKEN_KEY) ?? null;
}

export function storeAuthSession(user: UserInfo, rememberMe: boolean): void {
  if (typeof window === "undefined") return;
  clearAuthSession();
  // Bearer tokens are intentionally tab-scoped. `rememberMe` is retained in
  // the API for UI compatibility but never persists credentials to disk.
  void rememberMe;
  const storage = sessionStorage;
  storage.setItem(AUTH_TOKEN_KEY, user.token);
  storage.setItem(USER_INFO_KEY, JSON.stringify(user));
}

export function clearAuthSession(): void {
  if (typeof window === "undefined") return;
  for (const storage of [localStorage, sessionStorage]) {
    storage.removeItem(AUTH_TOKEN_KEY);
    storage.removeItem(USER_INFO_KEY);
  }
}

export function getUserInfo(): UserInfo | null {
  const info = getActiveStorage()?.getItem(USER_INFO_KEY);
  if (!info) return null;
  try {
    const user = JSON.parse(info) as Partial<UserInfo>;
    if (
      typeof user.token !== "string" ||
      typeof user.username !== "string" ||
      !Array.isArray(user.roles) ||
      !user.roles.every((role) => typeof role === "string")
    ) {
      return null;
    }

    // Remove sessions manufactured by the retired username-based development
    // login. Staff sessions must now be backed by a user_account row.
    if (
      user.token.startsWith("mock-jwt-") &&
      !user.token.startsWith("mock-jwt-db-user-") &&
      user.token !== "mock-jwt-supplier-token"
    ) {
      clearAuthSession();
      return null;
    }

    return {
      ...user,
      roles: user.roles.map(normalizeRole),
    } as UserInfo;
  } catch {
    return null;
  }
}

export function hasRole(roles: string[] | string): boolean {
  const user = getUserInfo();
  if (!user) return false;
  const userRoles = user.roles.map(normalizeRole);
  if (userRoles.some((role) => ["ADMIN", "SUPERUSER", "SUPER_ADMIN"].includes(role))) {
    return true;
  }
  const requiredRoles = (Array.isArray(roles) ? roles : [roles]).map(normalizeRole);
  return requiredRoles.some((role) => userRoles.includes(role));
}

export function getRequiredRolesForPath(pathname: string): string[] | null {
  if (pathname.startsWith("/admin")) return ["ADMIN", "SUPERUSER", "SUPER_ADMIN"];
  if (
    pathname.startsWith("/supplier") ||
    pathname === "/supplier-dashboard" ||
    pathname === "/submit-quotation" ||
    pathname === "/damage-claims"
  )
    return ["SUPPLIER", "PROCUREMENT", "ADMIN", "SUPERUSER"];
  if (pathname.startsWith("/gate/finished-goods-pickup"))
    return ["GATE_SECURITY", "GATE_OPERATOR", "ADMIN", "SUPERUSER"];
  if (pathname.startsWith("/assembly/quality"))
    return ["QUALITY", "QC", "ASSEMBLY", "ASSEMBLY_MANAGER", "ADMIN", "SUPERUSER"];
  if (pathname.startsWith("/assembly"))
    return ["ASSEMBLY", "ASSEMBLY_MANAGER", "ADMIN", "SUPERUSER"];
  if (["/dispatch-picking-packing", "/dispatch-loading"].includes(pathname))
    return ["ASSEMBLY", "ASSEMBLY_MANAGER", "DISPATCH", "DISPATCH_MANAGER", "ADMIN", "SUPERUSER"];
  // These outbound gate screens use a dispatch-prefixed URL, but are operated
  // from the gate-security sidebar. Keep them ahead of the broader dispatch
  // route match so gate users are not redirected back to their dashboard.
  if (pathname === "/dispatch-gate-out")
    return [
      "GATE_SECURITY",
      "GATE_OPERATOR",
      "WAREHOUSE",
      "WAREHOUSE_MANAGER",
      "ADMIN",
      "SUPERUSER",
    ];
  if (pathname.startsWith("/dispatch") || pathname.startsWith("/dispatch-"))
    return ["DISPATCH", "DISPATCH_MANAGER", "ADMIN", "SUPERUSER"];
  if (
    pathname === "/gate-dashboard" ||
    pathname === "/vehicle-exit"
  )
    return [
      "GATE_SECURITY",
      "GATE_OPERATOR",
      "WAREHOUSE",
      "WAREHOUSE_MANAGER",
      "ADMIN",
      "SUPERUSER",
    ];
  if (pathname === "/grn" || pathname === "/receiving")
    return ["GRN", "GRN_MANAGER", "RECEIVING", "WAREHOUSE", "ADMIN", "SUPERUSER"];
  if (pathname === "/inventory")
    return ["WAREHOUSE", "WAREHOUSE_MANAGER", "WAREHOUSE_OPERATOR", "ADMIN", "SUPERUSER"];
  if (
    pathname.startsWith("/warehouse") ||
    pathname === "/warehouse-dashboard" ||
    pathname === "/dock-management" ||
    pathname === "/dock-master" ||
    pathname === "/inventory" ||
    pathname === "/putaway-tasks" ||
    pathname === "/reports"
  )
    return [
      "WAREHOUSE",
      "WAREHOUSE_MANAGER",
      "WAREHOUSE_OPERATOR",
      "WAREHOUSE_OPERATOR",
      "ADMIN",
      "SUPERUSER",
    ];
  if (pathname === "/inventory") return ["WAREHOUSE_OPERATOR", "ADMIN", "SUPERUSER"];
  return null;
}

export function requireRouteAccess(pathname: string, search = ""): void {
  requireAuth();
  const user = getUserInfo();
  const supplierDamageClaims = pathname === "/damage-claims" && hasRole("SUPPLIER");
  if (!supplierDamageClaims && getPageAccess(user?.page_permissions, pathname, search) === null) {
    redirectToDefault(user, pathname, search);
  }
  const requiredRoles = getRequiredRolesForPath(pathname);
  if (requiredRoles && !hasRole(requiredRoles)) {
    redirectToDefault(user, pathname, search);
  }
}

function redirectToDefault(user: UserInfo | null, pathname: string, search = ""): never {
  const target = getDefaultRouteForUser(user);
  const targetUrl = new URL(target, window.location.origin);
  const currentSearch = search
    ? search.startsWith("?")
      ? search
      : `?${search}`
    : "";

  // A bad or stale permission assignment must not redirect back to the same
  // forbidden URL forever. Clear that unusable session and return to login.
  if (targetUrl.pathname === pathname && targetUrl.search === currentSearch) {
    clearAuthSession();
    throw redirect({ to: "/login" });
  }

  throw redirect({
    to: targetUrl.pathname as any,
    search: Object.fromEntries(targetUrl.searchParams) as any,
  });
}

export function isAuthenticated(): boolean {
  const token = getAuthToken();
  const user = getUserInfo();
  return Boolean(token?.trim() && user && user.token === token);
}

/**
 * Returns an in-app location only. This prevents a login URL such as
 * `/login?redirect=https://example.com` from sending users off-site.
 */
export function getSafeRedirectPath(redirectPath: unknown): string | null {
  if (
    typeof redirectPath !== "string" ||
    !redirectPath.startsWith("/") ||
    redirectPath.startsWith("//")
  ) {
    return null;
  }

  return redirectPath;
}

export function getDefaultRouteForUser(user = getUserInfo()): string {
  const roles = user?.roles || [];
  const permissions = user?.page_permissions;

  const permittedDefault = (target: string): string | null => {
    const url = new URL(target, typeof window === "undefined" ? "http://localhost" : window.location.origin);
    return getPageAccess(permissions, url.pathname, url.search) === null ? null : target;
  };

  if (roles.includes("ADMIN") || roles.includes("SUPERUSER") || roles.includes("SUPER_ADMIN")) {
    const target = permittedDefault("/admin");
    if (target) return target;
  }

  // GRN users may also carry warehouse permissions, but their landing page
  // must remain the GRN operations dashboard.
  if (
    roles.includes("GRN") ||
    roles.includes("GRN_MANAGER") ||
    roles.includes("OPERATIONS_MANAGER") ||
    roles.includes("OPERATIONS") ||
    roles.includes("RECEIVING")
  ) {
    const target = permittedDefault("/grn?tab=dashboard");
    if (target) return target;
  }

  if (
    roles.includes("WAREHOUSE") ||
    roles.includes("WAREHOUSE_MANAGER")
  ) {
    const target = permittedDefault("/warehouse-dashboard");
    if (target) return target;
  }
  if (roles.includes("GATE_SECURITY")) {
    const target = permittedDefault("/gate-dashboard");
    if (target) return target;
  }
  if (roles.includes("SUPPLIER")) {
    const target = permittedDefault("/supplier-dashboard");
    if (target) return target;
  }
  if (
    roles.includes("ASSEMBLY_MANAGER") ||
    roles.includes("ASSEMBLY") ||
    roles.includes("ASSEMBLY_OPERATOR")
  ) {
    const target = permittedDefault("/assembly-dashboard");
    if (target) return target;
  }
  if (roles.includes("WAREHOUSE_OPERATOR") || roles.includes("WAREHOUSE_OPERATOR")) {
    const target = permittedDefault("/inventory?tab=dashboard");
    if (target) return target;
  }

  const assignedPage = Object.keys(permissions || {})[0];
  if (assignedPage) return assignedPage;
  return "/inventory";
}

export function requireAuth() {
  if (typeof window === "undefined") return;
  if (!isAuthenticated()) {
    throw redirect({
      to: "/login",
      search: {
        redirect: window.location.pathname,
      },
    });
  }
}

export function requireRole(roles: string[] | string) {
  if (typeof window === "undefined") return;
  requireAuth();
  if (!hasRole(roles)) {
    // If they are authenticated but don't have the role, send them to their primary dashboard
    const user = getUserInfo();
    redirectToDefault(user, window.location.pathname, window.location.search);
  }
}
