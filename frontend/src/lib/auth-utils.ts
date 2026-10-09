import { redirect } from "@tanstack/react-router";

export interface UserInfo {
  token: string;
  username: string;
  roles: string[];
  supplierId?: string;
  store_id?: string;
  store_code?: string;
  storeId?: string;
  storeCode?: string;
  employee_id?: string;
  full_name?: string;
}

const AUTH_TOKEN_KEY = "auth_token";
const USER_INFO_KEY = "user_info";

function normalizeRole(role: string): string {
  return role.trim().toUpperCase();
}

function getActiveStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  if (localStorage.getItem(AUTH_TOKEN_KEY)) return localStorage;
  if (sessionStorage.getItem(AUTH_TOKEN_KEY)) return sessionStorage;
  return null;
}

export function getAuthToken(): string | null {
  return getActiveStorage()?.getItem(AUTH_TOKEN_KEY) ?? null;
}

export function storeAuthSession(user: UserInfo, rememberMe: boolean): void {
  if (typeof window === "undefined") return;
  clearAuthSession();
  const storage = rememberMe ? localStorage : sessionStorage;
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
  if (userRoles.includes("ADMIN") || userRoles.includes("SUPERUSER")) return true;
  const requiredRoles = (Array.isArray(roles) ? roles : [roles]).map(normalizeRole);
  return requiredRoles.some((role) => userRoles.includes(role));
}

export function getRequiredRolesForPath(pathname: string): string[] | null {
  if (pathname.startsWith("/admin")) return ["ADMIN", "SUPERUSER"];
  if (pathname === "/manager-dashboard") return ["MANAGER", "ADMIN", "SUPERUSER"];
  if (
    pathname.startsWith("/supplier") ||
    pathname === "/supplier-dashboard" ||
    pathname === "/submit-quotation"
  )
    return ["SUPPLIER", "PROCUREMENT", "MANAGER", "ADMIN", "SUPERUSER"];
  if (pathname.startsWith("/assembly"))
    return ["ASSEMBLY", "ASSEMBLY_MANAGER", "ADMIN", "SUPERUSER"];
  // These outbound gate screens use a dispatch-prefixed URL, but are operated
  // from the gate-security sidebar. Keep them ahead of the broader dispatch
  // route match so gate users are not redirected back to their dashboard.
  if (pathname === "/dispatch-gate-exit" || pathname === "/dispatch-gate-out")
    return ["GATE_SECURITY", "GATE_OPERATOR", "WAREHOUSE", "WAREHOUSE_MANAGER", "ADMIN", "SUPERUSER"];
  if (pathname.startsWith("/dispatch") || pathname.startsWith("/dispatch-"))
    return ["DISPATCH", "DISPATCH_MANAGER", "ADMIN", "SUPERUSER"];
  if (
    pathname === "/gate-dashboard" ||
    pathname === "/vehicle-exit" ||
    pathname === "/unscheduled-arrivals"
  )
    return ["GATE_SECURITY", "GATE_OPERATOR", "WAREHOUSE", "WAREHOUSE_MANAGER", "ADMIN", "SUPERUSER"];
  if (pathname === "/grn" || pathname === "/receiving")
    return ["GRN", "GRN_MANAGER", "RECEIVING", "WAREHOUSE", "ADMIN", "SUPERUSER"];
  if (pathname === "/warehouse/stores")
    return ["WAREHOUSE", "WAREHOUSE_MANAGER", "ADMIN", "SUPERUSER"];
  if (pathname === "/warehouse/quarantine")
    return ["WAREHOUSE", "WAREHOUSE_MANAGER", "ADMIN", "SUPERUSER"];
  if (
    pathname.startsWith("/warehouse") ||
    pathname === "/warehouse-dashboard" ||
    pathname === "/dock-management" ||
    pathname === "/dock-master" ||
    pathname === "/inventory" ||
    pathname === "/putaway-tasks" ||
    pathname === "/reports" ||
    pathname === "/damage-claims"
  )
    return [
      "WAREHOUSE",
      "WAREHOUSE_MANAGER",
      "STORE_MANAGER",
      "STORE_KEEPER",
      "ADMIN",
      "SUPERUSER",
    ];
  if (pathname === "/my-store")
    return ["STORE_MANAGER", "STORE_KEEPER", "ADMIN", "SUPERUSER"];
  return null;
}

export function requireRouteAccess(pathname: string): void {
  requireAuth();
  const requiredRoles = getRequiredRolesForPath(pathname);
  if (requiredRoles && !hasRole(requiredRoles)) {
    throw redirect({ to: getDefaultRouteForUser(getUserInfo()) as any });
  }
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
  const username = (user?.username || "").toLowerCase();

  if (
    roles.includes("WAREHOUSE") ||
    roles.includes("WAREHOUSE_MANAGER") ||
    username.includes("warehouse")
  ) {
    return "/warehouse-dashboard";
  }
  if (roles.includes("MANAGER")) return "/manager-dashboard";
  if (roles.includes("ADMIN") || roles.includes("SUPERUSER")) return "/admin/users";
  if (roles.includes("GATE_SECURITY")) return "/gate-dashboard";
  if (roles.includes("SUPPLIER")) return "/supplier-dashboard";
  if (roles.includes("ASSEMBLY_MANAGER") || roles.includes("ASSEMBLY") || roles.includes("ASSEMBLY_OPERATOR")) return "/assembly-dashboard";
  if (roles.includes("DISPATCH") || roles.includes("DISPATCH_MANAGER") || user?.username?.toLowerCase() === "dispatch") return "/dispatch";
  if (roles.includes("STORE_MANAGER") || roles.includes("STORE_KEEPER"))
    return "/my-store";
  if (
    roles.includes("GRN") ||
    roles.includes("GRN_MANAGER") ||
    roles.includes("OPERATIONS_MANAGER") ||
    roles.includes("OPERATIONS") ||
    roles.includes("RECEIVING") ||
    user?.username?.toLowerCase() === "grn" ||
    user?.username?.toLowerCase()?.includes("grn")
  ) {
    return "/grn";
  }
  if (
    roles.includes("DISPATCH") ||
    roles.includes("DISPATCH_MANAGER") ||
    roles.includes("DISPATCH_OFFICER") ||
    roles.includes("DISPATCH_OPERATOR") ||
    user?.username?.toLowerCase() === "dispatch" ||
    user?.username?.toLowerCase()?.includes("dispatch")
  ) {
    return "/dispatch";
  }
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
    const primaryRole = user?.roles[0];

    throw redirect({ to: getDefaultRouteForUser(user) as any });
  }
}
