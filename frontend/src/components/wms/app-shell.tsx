import { useNotificationAlerts } from "@/hooks/use-notification-alerts";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Truck,
  ListOrdered,
  Warehouse,
  PackageCheck,
  FileCheck2,
  Boxes,
  BarChart3,
  Database,
  Settings,
  Search,
  Bell,
  Moon,
  Sun,
  LogOut,
  Building2,
  ClipboardList,
  FileBadge,
  Loader2,
  ShieldCheck,
  Sliders,
  PanelLeftClose,
  Menu,
  AlertTriangle,
  QrCode,
  PlusCircle,
  Store,
  ShieldAlert,
  DoorOpen,
  Factory,
  Users,
  Inbox,
  GitFork,
  Navigation,
  CheckCircle2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { InformationTooltip } from "@/components/ui/information-tooltip";
import { pageHelp } from "@/lib/information-help";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";
import logoUrl from "@/assets/Logo.png";
import { toast } from "sonner";
import { getUserInfo, type UserInfo } from "@/lib/auth-utils";
import { getPageAccess } from "@/lib/page-permissions";
import { SecureAssistant } from "@/components/wms/secure-assistant";

function getUserDisplayName(user: UserInfo | null): string {
  if (!user) return "User";
  if (user.full_name?.trim()) return user.full_name.trim();
  if (user.username?.trim()) return user.username.trim();
  if (user.employee_id?.trim()) return user.employee_id.trim();
  return "User";
}

function getUserInitials(user: UserInfo | null): string {
  const name = getUserDisplayName(user);
  if (!name || name === "User") return "U";
  const parts = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

function getUserRoleLabel(user: UserInfo | null): string {
  if (!user?.roles || user.roles.length === 0) return "User";
  const roles = user.roles;
  if (roles.includes("ADMIN") || roles.includes("SUPERUSER") || roles.includes("SUPER_ADMIN")) {
    return "Administrator";
  }

  if (roles.includes("GATE_SECURITY") || roles.includes("GATE_OPERATOR")) {
    return "Security Officer";
  }
  if (
    roles.includes("GRN") ||
    roles.includes("GRN_MANAGER") ||
    roles.includes("OPERATIONS_MANAGER") ||
    roles.includes("OPERATIONS") ||
    roles.includes("RECEIVING") ||
    user?.username?.toLowerCase() === "grn" ||
    user?.username?.toLowerCase()?.includes("grn")
  ) {
    return "GRN / Operations Manager";
  }
  if (roles.includes("STORE_MANAGER")) {
    return "Warehouse Manager";
  }
  if (roles.includes("STORE_KEEPER") || roles.includes("STORE_OPERATOR")) {
    return "Warehouse Operator";
  }
  if (roles.includes("ASSEMBLY") || roles.includes("ASSEMBLY_MANAGER")) {
    return "Assembly Manager";
  }
  if (roles.includes("DISPATCH") || roles.includes("DISPATCH_MANAGER")) {
    return "Dispatch Manager";
  }
  if (roles.includes("SUPPLIER")) {
    return "Supplier";
  }
  if (roles.includes("WAREHOUSE") || roles.includes("WAREHOUSE_MANAGER")) {
    return "Warehouse Manager";
  }
  return roles[0]?.replace(/_/g, " ") ?? "User";
}

function getSearchPlaceholder(path: string, searchStr: string): string {
  const route = `${path}${searchStr}`.toLowerCase();
  if (route.startsWith("/supplier/asns")) return "Search ASN, vehicle, driver, or status...";
  if (route.startsWith("/supplier-materials")) return "Search material code or name...";
  if (route.startsWith("/supplier/dispatch"))
    return "Search dispatch request, product, or status...";
  if (route.startsWith("/supplier-dashboard")) return "Search ASN, vehicle, or shipment status...";
  if (route.startsWith("/dock-management")) return "Search vehicle, gate pass, or vendor...";
  if (route.startsWith("/vehicle-queue")) return "Search gate pass, vehicle, supplier, or ASN...";
  if (route.startsWith("/vehicle-exit")) return "Search vehicle, gate pass, or GRN...";
  if (route.startsWith("/gate-dashboard")) return "Search gate pass, vehicle, or supplier...";
  if (route.startsWith("/grn")) return "Search GRN, PO, supplier, vehicle, or material...";
  if (route.startsWith("/inventory")) {
    if (route.includes("tab=locations")) return "Search zone, bin, or location code...";
    if (route.includes("tab=putaway")) return "Search putaway task, GRN, or material...";
    if (route.includes("tab=picking")) return "Search pick task, request, or material...";
    if (route.includes("tab=requests")) return "Search request, material, or status...";
    return "Search material, SKU, batch, or location...";
  }
  if (
    route.startsWith("/assembly/material-requests") ||
    route.startsWith("/warehouse/assembly-requisitions")
  )
    return "Search request, production order, or material...";
  if (
    route.startsWith("/assembly/production") ||
    route.startsWith("/assembly/orders") ||
    route.startsWith("/assembly-dashboard")
  )
    return "Search production order, product, or work order...";
  if (route.startsWith("/assembly/quality"))
    return "Search inspection, product, or serial number...";
  if (route.startsWith("/assembly/finished-goods"))
    return "Search product, order, or serial number...";
  if (route.startsWith("/dispatch")) return "Search dispatch order, customer, or vehicle...";
  if (route.startsWith("/notifications")) return "Search notifications by title or message...";
  return "Search ASN, vehicle, vendor, gate pass, or material...";
}

type NavItem = {
  label: string;
  to: string;
  icon: any;
  count?: number;
  isUser?: boolean;
  isUnit?: boolean;
};

const grnNav: NavItem[] = [
  { label: "Dashboard", to: "/grn?tab=dashboard", icon: LayoutDashboard },
  { label: "Create GRN", to: "/grn?tab=wizard", icon: PlusCircle },
  { label: "GRN History", to: "/grn?tab=records", icon: ClipboardList },
];

const dispatchNav = [
  { label: "Dispatch Orders", to: "/dispatch-orders", icon: ClipboardList },
  { label: "Picking & Packing", to: "/dispatch-picking-packing", icon: PackageCheck },
  { label: "Loading", to: "/dispatch-loading", icon: Navigation },
  { label: "Gate Out", to: "/dispatch-gate-out", icon: DoorOpen },
];

const storeManagerNav = [
  { label: "Dashboard", to: "/inventory?tab=dashboard", icon: LayoutDashboard },
  { label: "Putaway", to: "/inventory?tab=putaway", icon: PackageCheck },
  { label: "Inventory", to: "/inventory?tab=inventory", icon: Boxes },
  { label: "Material Requests", to: "/inventory?tab=requests", icon: ClipboardList },
  { label: "Picking", to: "/inventory?tab=picking", icon: ListOrdered },
  { label: "Locations", to: "/inventory?tab=locations", icon: Building2 },
  { label: "Material Issue", to: "/inventory?tab=material-issue", icon: ClipboardList },
];

const assemblyNav = [
  { label: "Dashboard", to: "/assembly-dashboard", icon: LayoutDashboard },
  { label: "Material Requests", to: "/assembly/material-requests", icon: Boxes },
  { label: "Production", to: "/assembly/production", icon: Factory },
  { label: "Quality Check", to: "/assembly/quality", icon: ShieldCheck },
  { label: "Finished Goods Records", to: "/assembly/finished-goods", icon: PackageCheck },
  { label: "FG Dispatch", to: "/assembly/dispatch", icon: Truck },
];

const warehouseOperatorNav = [
  { label: "Dashboard", to: "/inventory?tab=dashboard", icon: LayoutDashboard },
  { label: "Putaway Tasks", to: "/inventory?tab=putaway", icon: PackageCheck },
  { label: "QR Scanning", to: "/inventory?tab=putaway", icon: QrCode },
  { label: "Picking Tasks", to: "/inventory?tab=picking", icon: ListOrdered },
];

const qualityNav = [
  { label: "Incoming QC", to: "/grn?tab=records", icon: ShieldCheck },
  { label: "Finished-Goods QC", to: "/assembly/quality", icon: ShieldCheck },
  { label: "QC History", to: "/assembly/quality?status=ALL", icon: ClipboardList },
];

const warehouseNav = [
  { label: "Dashboard", to: "/inventory?tab=dashboard", icon: LayoutDashboard },
  { label: "Putaway", to: "/inventory?tab=putaway", icon: PackageCheck },
  { label: "Inventory", to: "/inventory?tab=inventory", icon: Boxes },
  { label: "Requisitions & Picking", to: "/inventory?tab=picking", icon: ClipboardList },
  { label: "Locations", to: "/inventory?tab=locations", icon: Building2 },
  { label: "Dock Allocation", to: "/dock-management", icon: Warehouse },
];

const supplierNav = [
  { label: "Dashboard", to: "/supplier-dashboard", icon: LayoutDashboard },
  { label: "Material Master", to: "/supplier-materials", icon: Database },
  { label: "ASN Management", to: "/supplier/asns", icon: Truck },
  { label: "Damage Claims", to: "/damage-claims", icon: ShieldAlert },
  { label: "FG Dispatch Requests", to: "/supplier/dispatch", icon: PackageCheck },
];

const managerNav: any[] = [];

const adminNav: NavItem[] = [
  { label: "Dashboard", to: "/admin", icon: LayoutDashboard },
  { label: "User Management", to: "/admin/users", icon: Users },
  { label: "Suppliers", to: "/admin/suppliers", icon: Truck },
  { label: "Gate Security", to: "/gate-dashboard", icon: ShieldCheck },
  { label: "GRN / Receiving", to: "/grn?tab=dashboard", icon: FileCheck2 },
  { label: "Warehouse", to: "/inventory?tab=dashboard", icon: Warehouse },
  { label: "Assembly", to: "/assembly-dashboard", icon: Factory },
  { label: "Dispatch", to: "/dispatch-orders", icon: PackageCheck },
];

const gateSecurityNav = [
  { label: "Dashboard", to: "/gate-dashboard", icon: LayoutDashboard },
  { label: "Vehicle Entry & Exit", to: "/vehicle-queue", icon: PlusCircle },
  { label: "FG Pickup Entry & Exit", to: "/gate/finished-goods-pickup", icon: QrCode },
];

const ICON_MAP: Record<string, any> = {
  LayoutDashboard,
  Building2,
  ClipboardList,
  FileBadge,
  Truck,
  AlertTriangle,
  FileCheck2,
  DoorOpen,
  LogOut,
  ListOrdered,
  Boxes,
  Factory,
  Users,
  BarChart3,
  Settings,
  Warehouse,
  Database,
  PackageCheck,
  ShieldCheck,
  QrCode,
  Bell,
  Inbox,
  Store,
  ShieldAlert,
  PlusCircle,
};

function getIconComponent(iconName: any) {
  if (typeof iconName !== "string") return iconName || LayoutDashboard;
  return ICON_MAP[iconName] || LayoutDashboard;
}

function hasUserRole(user: { roles?: string[] } | null, role: string): boolean {
  const expected = role.toUpperCase();
  return Boolean(user?.roles?.some((value) => value.toUpperCase() === expected));
}

function isGrnSession(user: { username?: string; roles?: string[] } | null): boolean {
  const username = user?.username?.toLowerCase() ?? "";
  return Boolean(
    user?.roles?.some((role) =>
      ["GRN", "GRN_MANAGER", "OPERATIONS_MANAGER", "OPERATIONS", "RECEIVING"].includes(role),
    ) ||
    username === "grn" ||
    username.includes("grn"),
  );
}

function isDispatchSession(user: { username?: string; roles?: string[] } | null): boolean {
  const username = user?.username?.toLowerCase() ?? "";
  return Boolean(
    user?.roles?.some((role) =>
      ["DISPATCH", "DISPATCH_MANAGER", "DISPATCH_OFFICER", "DISPATCH_OPERATOR"].includes(role),
    ) ||
    username === "dispatch" ||
    username.includes("dispatch"),
  );
}

function getNotificationRole(user: { username?: string; roles?: string[] } | null): string {
  if (hasUserRole(user, "SUPPLIER")) return "SUPPLIER";
  if (hasUserRole(user, "GATE_SECURITY")) return "GATE_SECURITY";
  if (hasUserRole(user, "ASSEMBLY") || hasUserRole(user, "ASSEMBLY_MANAGER"))
    return "ASSEMBLY_MANAGER";
  if (isDispatchSession(user)) return "DISPATCH";
  if (isGrnSession(user)) return "GRN";
  return "WAREHOUSE";
}

function getStrictRoleNav(user: { username?: string; roles?: string[] } | null): NavItem[] {
  if (!user) return [];
  if (
    hasUserRole(user, "ADMIN") ||
    hasUserRole(user, "SUPERUSER") ||
    hasUserRole(user, "SUPER_ADMIN")
  )
    return adminNav;
  if (hasUserRole(user, "SUPPLIER")) return supplierNav;
  if (hasUserRole(user, "GATE_SECURITY") || hasUserRole(user, "GATE_OPERATOR"))
    return gateSecurityNav;
  if (hasUserRole(user, "QUALITY") || hasUserRole(user, "QC")) return qualityNav;
  if (hasUserRole(user, "ASSEMBLY") || hasUserRole(user, "ASSEMBLY_MANAGER")) return assemblyNav;
  if (hasUserRole(user, "STORE_MANAGER") || hasUserRole(user, "STORE_KEEPER"))
    return warehouseNav;
  if (hasUserRole(user, "WAREHOUSE_OPERATOR") || hasUserRole(user, "STORE_OPERATOR"))
    return warehouseOperatorNav;
  if (isDispatchSession(user)) return dispatchNav;
  if (isGrnSession(user)) return grnNav;
  return warehouseNav;
}

function getRoleLabel(user: { username?: string; roles?: string[] } | null): string {
  if (hasUserRole(user, "ADMIN") || hasUserRole(user, "SUPERUSER")) return "Administrator";
  if (hasUserRole(user, "GATE_SECURITY")) return "Security Officer";
  if (hasUserRole(user, "QUALITY") || hasUserRole(user, "QC")) return "Quality Inspector";
  if (hasUserRole(user, "ASSEMBLY") || hasUserRole(user, "ASSEMBLY_MANAGER"))
    return "Assembly Manager";
  if (hasUserRole(user, "STORE_MANAGER")) return "Warehouse Manager";
  if (hasUserRole(user, "WAREHOUSE_OPERATOR") || hasUserRole(user, "STORE_OPERATOR"))
    return "Warehouse Operator";
  if (hasUserRole(user, "STORE_KEEPER")) return "Warehouse Operator";
  if (isDispatchSession(user)) return "Dispatch Manager";
  if (isGrnSession(user)) return "GRN / Operations Manager";
  return "Operations Manager";
}

export function AppShell({
  children,
  title,
  subtitle,
  actions,
  onSearchChange,
}: {
  children: ReactNode;
  title?: ReactNode;
  subtitle?: string;
  actions?: ReactNode;
  onSearchChange?: (value: string) => void;
}) {
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    setUser(getUserInfo());
  }, []);
  const location = useRouterState({ select: (s) => s.location });
  const path = location.pathname;
  const searchStr = location.searchStr || "";
  const fullHref = path + searchStr;
  const navigate = useNavigate();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [adminModules, setAdminModules] = useState<any[]>([]);
  const isAdmin = Boolean(user?.roles?.some((role) =>
    ["ADMIN", "SUPERUSER", "SUPER_ADMIN"].includes(role.toUpperCase()),
  ));
  useEffect(() => {
    if (!isAdmin) {
      setAdminModules([]);
      return;
    }
    void api.getAdminOverview()
      .then((overview) => setAdminModules(overview?.modules || []))
      .catch(() => setAdminModules([]));
  }, [isAdmin]);
  const {
    unreadCount: unreadNotifications,
    alert: notificationAlert,
    dismissAlert,
  } = useNotificationAlerts(user ? getNotificationRole(user) : null, user?.username);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const executeSearch = async (term: string) => {
    if (!term || !term.trim()) {
      setSearchResults([]);
      setShowSearch(false);
      return;
    }
    setIsSearching(true);
    try {
      const data = await api.globalSearch(term.trim());
      setSearchResults(data?.results || []);
      setShowSearch(true);
    } catch (e) {
      console.error("Search failed", e);
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (searchTerm.length >= 1) {
        void executeSearch(searchTerm);
      } else {
        setSearchResults([]);
        setShowSearch(false);
      }
    }, 200);
    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      void executeSearch(searchTerm);
      window.dispatchEvent(new CustomEvent("app:search", { detail: searchTerm.trim() }));
      setShowSearch(true);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        if (searchTerm.length >= 1) {
          setShowSearch(true);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchTerm]);
  const isGrnUser =
    mounted &&
    (user?.roles?.includes("GRN") ||
      user?.roles?.includes("GRN_MANAGER") ||
      user?.roles?.includes("OPERATIONS_MANAGER") ||
      user?.roles?.includes("OPERATIONS") ||
      user?.roles?.includes("RECEIVING") ||
      user?.username?.toLowerCase() === "grn" ||
      user?.username?.toLowerCase()?.includes("grn"));

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  const isAssemblyUser =
    mounted &&
    (user?.roles?.includes("ASSEMBLY") ||
      user?.roles?.includes("ASSEMBLY_MANAGER") ||
      user?.roles?.includes("ASSEMBLY_OPERATOR"));
  const isAssemblyRoute =
    path === "/assembly-dashboard" ||
    path === "/dispatch-picking-packing" ||
    path === "/dispatch-loading";
  const isStoreUser =
    mounted && (user?.roles?.includes("STORE_MANAGER") || user?.roles?.includes("STORE_KEEPER"));
  const isStoreRoute = path === "/my-store" || path.startsWith("/my-store");
  const isGrnRoute = path === "/grn" || path.startsWith("/grn");
  const isSupplierRoute =
    path === "/supplier-dashboard" ||
    path === "/submit-quotation" ||
    path === "/damage-claims" ||
    (mounted &&
      hasUserRole(user, "SUPPLIER") &&
      ["/supplier/dispatch", "/supplier/asns", "/supplier/asns/"].some(
        (prefix) => path === prefix || path.startsWith(prefix),
      ));
  const isGateSecurityUser =
    mounted && (user?.roles?.includes("GATE_SECURITY") || user?.roles?.includes("GATE_OPERATOR"));
  const isDispatchUser =
    mounted &&
    (user?.roles?.includes("DISPATCH") ||
      user?.roles?.includes("DISPATCH_MANAGER") ||
      user?.username?.toLowerCase() === "dispatch");
  const isNotificationsRoute = path.startsWith("/notifications");
  const isSharedOperationsRoute = ["/warehouse-dashboard", "/vehicle-exit"].some((route) =>
    path.startsWith(route),
  );
  const isWarehouseRoute =
    isSharedOperationsRoute ||
    path.startsWith("/warehouse") ||
    ["/inventory", "/dock-management", "/receiving", "/putaway-tasks", "/reports"].some((p) =>
      path.startsWith(p),
    );
  const isWarehouseWorkspace =
    path === "/inventory" ||
    path.startsWith("/warehouse") ||
    ["/dock-management", "/receiving", "/putaway-tasks"].some((p) => path.startsWith(p));
  const isGateSecurityRoute =
    [
      "/vehicle-queue",
      "/vehicle-exit",
      "/gate-dashboard",
      "/accept-arrival",
      "/driver-verification",
      "/vehicle-verification",
      "/dock-assignment",
      "/arrival-success",
    ].some((route) => path.startsWith(route)) ||
    (isGateSecurityUser && (isSharedOperationsRoute || isNotificationsRoute));
  const adminNavWithUsers = adminNav.flatMap((item) => {
    const itemPath = item.to.split("?")[0];
    const module = adminModules.find((candidate) => candidate.route?.split("?")[0] === itemPath);
    if (!module) return [item];
    if ((module.assembly_units || []).length) {
      return [
        item,
        ...module.assembly_units.flatMap((unit: any) => [
          {
            label: unit.name,
            to: unit.route,
            icon: Factory,
            isUnit: true,
          },
          ...(unit.users || []).map((moduleUser: any) => ({
            label: moduleUser.full_name,
            to: `${unit.route}${unit.route.includes("?") ? "&" : "?"}admin_user=${encodeURIComponent(moduleUser.id)}&admin_user_name=${encodeURIComponent(moduleUser.full_name)}`,
            icon: Users,
            isUser: true,
          })),
        ]),
      ];
    }
    return [
      item,
      ...(module.users || []).map((moduleUser: any) => ({
        label: moduleUser.full_name,
        to: `${module.route}${module.route.includes("?") ? "&" : "?"}admin_user=${encodeURIComponent(moduleUser.id)}&admin_user_name=${encodeURIComponent(moduleUser.full_name)}`,
        icon: Users,
        isUser: true,
      })),
    ];
  });
  const resolvedNav = isAdmin
    ? adminNavWithUsers
    : isSupplierRoute
    ? supplierNav
    : path.startsWith("/admin")
      ? adminNav
      : isAssemblyUser || isAssemblyRoute
        ? assemblyNav
        : isStoreUser || isStoreRoute
          ? warehouseNav
          : isGrnUser || isGrnRoute
            ? grnNav
            : isSupplierRoute
              ? supplierNav
              : isGateSecurityRoute
                ? gateSecurityNav
                : isWarehouseRoute
                  ? warehouseNav
                  : mounted && user?.roles?.includes("DISPATCH")
                    ? dispatchNav
                    : mounted && user?.roles?.includes("ASSEMBLY")
                      ? assemblyNav
                      : mounted && user?.roles?.includes("SUPPLIER")
                        ? supplierNav
                        : isGateSecurityUser
                          ? gateSecurityNav
                          : warehouseNav;
  const navigationPending = !mounted && isSharedOperationsRoute;
  const nav = navigationPending
    ? []
    : resolvedNav.filter((item) => {
        const [itemPath, itemSearch = ""] = item.to.split("?");
        return getPageAccess(user?.page_permissions, itemPath, itemSearch) !== null;
      });
  const currentPageAccess = getPageAccess(user?.page_permissions, path, searchStr);
  const isReadOnlyPage = currentPageAccess === "READ";
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [fullHref]);
  const handleLogout = () => {
    api.logout();
    setUser(null);
    toast.success("Logged out successfully");
    navigate({ to: "/login" });
  };
  const isActiveNavItem = (to: string) => {
    if (to.includes("?")) {
      const [targetPath, targetQuery] = to.split("?");
      const targetParams = new URLSearchParams(targetQuery);
      const targetTab = targetParams.get("tab");
      const targetPage = targetParams.get("page");
      const targetModule = targetParams.get("module");
      const targetAction = targetParams.get("action");
      const currentParams = new URLSearchParams(searchStr);
      const currentTab = currentParams.get("tab") || (path === "/grn" ? "dashboard" : "");
      const currentPage = currentParams.get("page") || "";
      const currentModule = currentParams.get("module") || "";
      const currentAction = currentParams.get("action") || "";
      if (targetPage && targetTab) {
        return path === targetPath && targetTab === currentTab && targetPage === currentPage;
      }
      if (targetTab) {
        return (
          path === targetPath &&
          targetTab === currentTab &&
          (!targetPage || !currentPage || targetTab !== "wizard")
        );
      }
      if (targetModule) {
        return (
          path === targetPath &&
          (targetModule === currentModule || (!currentModule && targetModule === "warehouse"))
        );
      }
      if (targetAction) {
        return path === targetPath && targetAction === currentAction;
      }
      if (
        targetPath === "/vehicle-queue" &&
        !targetTab &&
        !targetPage &&
        !targetModule &&
        !targetAction
      ) {
        return (
          path === targetPath && !currentTab && !currentPage && !currentModule && !currentAction
        );
      }
      return fullHref === to || (searchStr ? fullHref.startsWith(to) : to === "/grn?tab=dashboard");
    }
    return (
      path === to ||
      (to !== "/dashboard" &&
        to !== "/dispatch" &&
        to !== "/gate" &&
        (path.startsWith(to + "/") || path.startsWith(to + "?")))
    );
  };
  const desktopSidebarCollapsed = !sidebarHovered;

  return (
    <div className="flex min-h-screen w-full bg-background">
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <aside className="relative flex h-full w-[min(84vw,320px)] flex-col border-r border-sidebar-border bg-sidebar shadow-2xl">
            <div className="flex h-16 items-center justify-between gap-2 border-b border-sidebar-border/40 px-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-glow">
                  <Warehouse className="size-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold tracking-tight">KaizenAssests</p>
                  <p className="truncate text-[11px] text-muted-foreground">Pune DC - Plant 1200</p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close navigation menu"
                className="grid size-9 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                onClick={() => setMobileSidebarOpen(false)}
              >
                <PanelLeftClose className="size-[18px]" />
              </button>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
              {navigationPending &&
                Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="h-10 animate-pulse rounded-xl bg-sidebar-accent/60" />
                ))}
              {nav.map((item) => {
                const active = isActiveNavItem(item.to);
                return (
                  <Link
                    key={`${item.label}-${item.to}`}
                    to={item.to as any}
                    onClick={(e) => {
                      e.preventDefault();
                      setMobileSidebarOpen(false);
                      void navigate({ to: item.to as any });
                    }}

                    className={cn(
                      "group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-sidebar-foreground transition-all",
                      "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      item.isUser && "ml-6 py-2 text-xs text-muted-foreground",
                      active && "bg-primary-soft text-primary shadow-soft",
                    )}
                  >
                    <item.icon className={cn(item.isUser ? "size-3.5" : "size-[18px]", "shrink-0", active && "text-primary")} />
                    <span className="truncate">{item.label}</span>
                    {(item as any).badge && (
                      <span className="ml-auto grid size-5 place-items-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground">
                        {(item as any).badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      <aside
        onMouseEnter={() => setSidebarHovered(true)}
        onMouseLeave={() => setSidebarHovered(false)}
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-300 md:flex",
          desktopSidebarCollapsed ? "w-[76px]" : "w-[264px]",
        )}
      >
        <div
          className={cn(
            "flex h-16 items-center border-b border-sidebar-border/40 transition-all",
            desktopSidebarCollapsed ? "justify-center px-2" : "justify-between gap-2 px-4",
          )}
        >
          {!desktopSidebarCollapsed ? (
            <>
              <div className="flex items-center gap-3 min-w-0">
                <div className="relative flex h-10 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 via-blue-500/10 to-teal/20 p-1 border border-primary/30 shadow-glow">
                  <img
                    src={logoUrl}
                    alt="KGS Logo"
                    className="h-full w-full object-contain drop-shadow-[0_2px_6px_rgba(6,182,212,0.4)]"
                  />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold tracking-wider uppercase bg-gradient-to-r from-primary via-blue-600 to-teal bg-clip-text text-transparent">
                    KaizenAssests
                  </p>
                  <p className="truncate text-[10px] font-mono text-muted-foreground font-semibold">
                    Pune DC · Plant 1200
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 via-blue-500/10 to-teal/20 p-1 border border-primary/30 shadow-glow">
              <img
                src={logoUrl}
                alt="KGS Logo"
                className="h-full w-full object-contain drop-shadow-[0_2px_6px_rgba(6,182,212,0.4)]"
              />
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
          {navigationPending &&
            Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-10 animate-pulse rounded-xl bg-sidebar-accent/60" />
            ))}
          {nav.map((item) => {
            if (desktopSidebarCollapsed && item.isUser) return null;
            const active = isActiveNavItem(item.to);
            return (
              <Link
                key={`${item.label}-${item.to}`}
                to={item.to as any}
                onClick={(e) => {
                  e.preventDefault();
                  void navigate({ to: item.to as any });
                }}

                className={cn(
                  "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition-all",
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  item.isUser && "ml-6 py-2 text-xs text-muted-foreground",
                  active && "bg-primary-soft text-primary shadow-soft",
                )}
              >
                <item.icon className={cn(item.isUser ? "size-3.5" : "size-[18px]", "shrink-0", active && "text-primary")} />
                {!desktopSidebarCollapsed && <span className="truncate">{item.label}</span>}
                {!desktopSidebarCollapsed && (item as any).badge && (
                  <span className="ml-auto grid size-5 place-items-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground">
                    {(item as any).badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          isWarehouseWorkspace && "bg-[#eef5fd] dark:bg-[#151d2a]",
        )}
      >
        <header
          className={cn(
            "sticky top-0 z-30 glass-strong",
            isWarehouseWorkspace &&
              "border-b border-[#d7e5f7] bg-white/95 dark:border-slate-700 dark:bg-slate-900/95",
          )}
        >
          <div className="flex h-16 items-center gap-3 px-4 lg:px-7">
            <button
              type="button"
              aria-label="Open navigation menu"
              onClick={() => setMobileSidebarOpen(true)}
              className="group relative grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground md:hidden"
            >
              <Warehouse className="size-4 transition-opacity duration-150 group-hover:opacity-0 group-focus-visible:opacity-0" />
              <Menu className="absolute size-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
            </button>
            <form
              onSubmit={handleSearchSubmit}
              className="relative hidden max-w-md flex-1 items-center sm:flex"
            >
              <button
                type="submit"
                aria-label="Search"

                className="absolute left-2.5 grid size-6 place-items-center rounded-lg text-muted-foreground hover:text-primary transition-colors cursor-pointer"
              >
                <Search className="size-4" />
              </button>
              <input
                ref={searchInputRef}
                suppressHydrationWarning
                type="text"
                inputMode="search"
                placeholder={
                  hasUserRole(user, "SUPPLIER") || path.startsWith("/supplier")
                    ? "Search ASN, vehicle number, status..."
                    : "Search ASN, truck no, vendor, gate entry…"
                }
                className="h-10 w-full rounded-xl border border-border bg-muted/60 pl-9 pr-16 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus:bg-card focus:ring-2 focus:ring-ring/40 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
                value={searchTerm}
                onChange={(e) => {
                  const val = e.target.value;
                  setSearchTerm(val);
                  onSearchChange?.(val);
                  window.dispatchEvent(new CustomEvent("app:search", { detail: val }));
                }}
                onFocus={() => {
                  if (searchTerm.length >= 1 || searchResults.length > 0) setShowSearch(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setShowSearch(false);
                  }
                }}
              />
              <div className="absolute right-2 flex items-center gap-1">
                {searchTerm && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                      setSearchTerm("");
                      setSearchResults([]);
                      setShowSearch(false);
                      window.dispatchEvent(new CustomEvent("app:search", { detail: "" }));
                      searchInputRef.current?.focus();
                    }}
                    className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    searchInputRef.current?.focus();
                    if (searchTerm.trim()) {
                      void executeSearch(searchTerm);
                    }
                  }}
                  aria-label="Search shortcut (⌘K or Ctrl+K)"

                  className="hidden rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground hover:border-slate-400 transition-colors cursor-pointer lg:block"
                >
                  {isSearching ? <Loader2 className="size-3 animate-spin" /> : "⌘K"}
                </button>
              </div>

              {showSearch && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowSearch(false)} />
                  <div className="absolute top-full left-0 mt-2 w-full min-w-[320px] max-h-[480px] overflow-y-auto z-50 rounded-2xl border border-border bg-card shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="p-2">
                      {searchResults.length > 0 ? (
                        <div className="space-y-1">
                          {searchResults.map((result) => (
                            <Link
                              key={`${result.type}-${result.id}`}
                              to={result.url}
                              onClick={() => {
                                setShowSearch(false);
                                setSearchTerm("");
                                window.dispatchEvent(
                                  new CustomEvent("app:search", { detail: result.title }),
                                );
                                if (result.type === "ASN") {
                                  window.dispatchEvent(
                                    new CustomEvent("app:open-asn", { detail: result }),
                                  );
                                }
                              }}
                              className="flex flex-col gap-0.5 rounded-xl px-4 py-2.5 text-left transition-colors hover:bg-accent"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-bold tracking-tight">
                                  {result.title}
                                </span>
                                <Badge
                                  variant="outline"
                                  className="text-[10px] font-black uppercase py-0 leading-tight border-primary/20 text-primary bg-primary-soft/30"
                                >
                                  {result.type.replace("_", " ")}
                                </Badge>
                              </div>
                              <span className="text-[11px] text-muted-foreground line-clamp-1">
                                {result.subtitle}
                              </span>
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
                          <Search className="mb-2 size-8 opacity-20" />
                          <p className="text-sm font-medium">No results found for "{searchTerm}"</p>
                          <p className="text-xs">
                            Try searching for a different ASN, vehicle number, or status
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </form>

            <div className="ml-auto flex items-center gap-1.5">
              <Link
                to="/notifications"
                aria-label="Notifications"
                className="relative grid size-10 place-items-center rounded-xl bg-transparent text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus:bg-transparent focus-visible:outline-none"
              >
                <Bell className="size-[18px]" />
                {unreadNotifications > 0 && (
                  <span className="absolute right-2 top-2 grid size-4 place-items-center rounded-full bg-destructive text-[9px] font-bold text-white">
                    {unreadNotifications}
                  </span>
                )}
              </Link>
              <div className="group relative ml-1 flex items-center gap-2.5 rounded-xl border border-border bg-card py-1.5 pl-1.5 pr-3 transition-colors hover:bg-accent/50">
                <span
                  suppressHydrationWarning
                  className="grid size-8 place-items-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground"
                >
                  {getUserInitials(user)}
                </span>
                <div className="hidden leading-tight lg:block">
                  <p suppressHydrationWarning className="text-xs font-semibold">
                    {getUserDisplayName(user)}
                  </p>
                  <p suppressHydrationWarning className="text-[10px] text-muted-foreground">
                    {getUserRoleLabel(user)}
                  </p>
                </div>
                <button
                  suppressHydrationWarning
                  onClick={handleLogout}
                  className="ml-2 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <LogOut className="size-4" />
                </button>
              </div>
            </div>
          </div>
        </header>

        {notificationAlert && (
          <div
            role="status"
            aria-live="polite"
            className="fixed right-5 top-20 z-[80] w-[min(380px,calc(100vw-2rem))] rounded-xl border border-primary/20 bg-card p-4 shadow-xl"
          >
            <div className="flex items-start gap-3">
              <Bell className="mt-0.5 size-5 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">{notificationAlert.title || "New notification"}</p>
                <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                  {notificationAlert.message ||
                    notificationAlert.body ||
                    "Open Notification Center to view this update."}
                </p>
                <Link
                  to="/notifications"
                  onClick={dismissAlert}
                  className="mt-2 inline-block text-xs font-semibold text-primary"
                >
                  View notifications
                </Link>
              </div>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={dismissAlert}
                className="text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </div>
          </div>
        )}
        <main
          className={cn(
            "page-enter flex-1 px-4 py-6 lg:px-7",
            isWarehouseWorkspace && "px-5 py-5 lg:px-8 lg:py-6",
          )}
        >
          <div
            className={cn(
              "mx-auto w-full max-w-[1360px]",
              isWarehouseWorkspace && "max-w-[1680px]",
            )}
          >
            {(title || subtitle || actions) && (
              <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                  {title && (
                    <h1 className="text-2xl font-semibold tracking-tight lg:text-[28px]">
                      {title}
                      {pageHelp[path] && (
                        <InformationTooltip help={pageHelp[path]} placement="title" />
                      )}
                    </h1>
                  )}
                  {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
                </div>
                {actions && (
                  <fieldset
                    disabled={isReadOnlyPage}
                    className="flex flex-wrap items-center gap-2 border-0 p-0"
                  >
                    {actions}
                  </fieldset>
                )}
              </div>
            )}
            {isReadOnlyPage && (
              <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
                Read-only access: you can view this page but cannot perform actions.
              </div>
            )}
            <fieldset disabled={isReadOnlyPage} className="min-w-0 border-0 p-0">
              {children}
            </fieldset>
          </div>
        </main>
      </div>
      <SecureAssistant />
    </div>
  );
}
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Waiting: "bg-warning-soft text-warning-foreground border-warning/30",
    Active: "bg-success-soft text-success border-success/30",
    Blocked: "bg-danger-soft text-destructive border-destructive/25",
    Approved: "bg-success-soft text-success border-success/30",
    APPROVED: "bg-success-soft text-success border-success/30",
    Draft: "bg-muted text-muted-foreground border-border",
    Submitted: "bg-primary-soft text-primary border-primary/25",
    "Pending Approval": "bg-warning-soft text-warning-foreground border-warning/30",
    "Pending Procurement": "bg-warning-soft text-warning-foreground border-warning/30",
    "Converted to RFQ": "bg-teal-soft text-teal border-teal/30",
    "RFQ Created": "bg-teal-soft text-teal border-teal/30",
    "PO Created": "bg-primary-soft text-primary border-primary/25",
    Fulfilled: "bg-success-soft text-success border-success/30",
    Closed: "bg-muted text-muted-foreground border-border",
    "Dock Assigned": "bg-teal-soft text-teal border-teal/30",
    Receiving: "bg-primary-soft text-primary border-primary/25",
    Completed: "bg-success-soft text-success border-success/30",
    Rejected: "bg-danger-soft text-destructive border-destructive/25",
    REJECTED: "bg-danger-soft text-destructive border-destructive/25",
    PO_VERIFIED: "bg-success-soft text-success border-success/30",
    UNSCHEDULED_ARRIVAL: "bg-warning-soft text-warning-foreground border-warning/30",
    AWAITING_DOCK: "bg-warning-soft text-warning-foreground border-warning/30",
    DOCK_ASSIGNED: "bg-teal-soft text-teal border-teal/30",
    MOVING_TO_DOCK: "bg-primary-soft text-primary border-primary/25",
    AT_DOCK: "bg-success-soft text-success border-success/30",
    UNLOADING_IN_PROGRESS: "bg-primary-soft text-primary border-primary/25",
    QUALITY_INSPECTION_REQUIRED: "bg-warning-soft text-warning border-warning/25",
    QUALITY_PASSED: "bg-success-soft text-success border-success/25",
    QUALITY_FAILED: "bg-destructive/10 text-destructive border-destructive/25",
    RECEIVING_COMPLETED: "bg-success-soft text-success border-success/25",
    GRN_DRAFT: "bg-warning-soft text-warning border-warning/25",
    GRN_POSTED: "bg-success-soft text-success border-success/25",
    PUTAWAY_PENDING: "bg-warning-soft text-warning border-warning/25",
    PUTAWAY_IN_PROGRESS: "bg-info-soft text-info border-info/25",
    PUTAWAY_COMPLETED: "bg-success-soft text-success border-success/25",
    EXIT_APPROVED: "bg-success-soft text-success border-success/25",
    GATE_EXIT_COMPLETED: "bg-success-soft text-success border-success/25",
    GATE_ENTRY_APPROVED: "bg-success-soft text-success border-success/30",
    FIELD_MISMATCH_DETECTED: "bg-danger-soft text-destructive border-destructive/25",
    Hold: "bg-muted text-muted-foreground border-border",
    Available: "bg-success-soft text-success border-success/30",
    Occupied: "bg-danger-soft text-destructive border-destructive/25",
    AVAILABLE: "bg-success-soft text-success border-success/30",
    OCCUPIED: "bg-danger-soft text-destructive border-destructive/25",
    RESERVED: "bg-warning-soft text-warning-foreground border-warning/30",
    Reserved: "bg-warning-soft text-warning-foreground border-warning/30",
    MAINTENANCE: "bg-slate-500/10 text-slate-600 border-slate-500/30 dark:text-slate-400",
    "Under Maintenance": "bg-slate-500/10 text-slate-600 border-slate-500/30 dark:text-slate-400",
    UNDER_MAINTENANCE: "bg-slate-500/10 text-slate-600 border-slate-500/30 dark:text-slate-400",
    Cleaning: "bg-muted text-muted-foreground border-border",
    SUBMITTED: "bg-primary-soft text-primary border-primary/25",
    DRAFT: "bg-muted text-muted-foreground border-border",
    ASN_SUBMITTED: "bg-primary-soft text-primary border-primary/25",
    IN_TRANSIT: "bg-teal-soft text-teal border-teal/30",
    PLACED: "bg-teal-soft text-teal border-teal/30",
    SENT: "bg-primary-soft text-primary border-primary/25",
    SHIPPED: "bg-teal-soft text-teal border-teal/30",
    DISPATCHED: "bg-teal-soft text-teal border-teal/30",
    STOCK_RESERVED: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30",
    PICKING_IN_PROGRESS: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
    PICKED: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
    PACKING_IN_PROGRESS:
      "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30",
    PACKED: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30",
    DRIVER_ALLOCATED: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30",
    VEHICLE_ALLOCATED: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30",
    ROUTE_ASSIGNED: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
    LOADING_STARTED: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    LOADING_VERIFIED: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    READY_FOR_GATE_EXIT:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    GATE_OUT: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    DELIVERED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    CLOSED: "bg-muted text-muted-foreground border-border",
    CANCELLED: "bg-destructive/15 text-destructive border-destructive/30",
    SENT_TO_ASSEMBLY:
      "bg-blue-600/15 text-blue-700 dark:text-blue-300 border-blue-500/30 font-bold",
    "SENT TO ASSEMBLY":
      "bg-blue-600/15 text-blue-700 dark:text-blue-300 border-blue-500/30 font-bold",
    IN_PROGRESS: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 font-bold",
    "IN PROGRESS":
      "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 font-bold",
    ASSEMBLY_IN_PROGRESS:
      "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 font-bold",
    "ASSEMBLY IN PROGRESS":
      "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 font-bold",
    SHORTAGE_DETECTED:
      "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30 font-bold",
    READY:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 font-bold",
    PENDING: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 font-bold",
    RETURNED: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
    DELAYED: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
  };
  const isLive = [
    "PO_VERIFIED",
    "APPROVED",
    "Receiving",
    "Active",
    "SENT_TO_ASSEMBLY",
    "IN_PROGRESS",
    "ASSEMBLY_IN_PROGRESS",
  ].includes(status);
  let displayLabel = status.replace(/_/g, " ");
  if (displayLabel.toUpperCase() === "OCCUPIED") {
    displayLabel = "AT DOCK";
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        "relative rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
        map[status] ?? map[displayLabel] ?? map["Hold"],
        isLive && "pl-5",
      )}
    >
      {isLive && (
        <span className="absolute left-2 top-1/2 flex size-1.5 -translate-y-1/2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75"></span>
          <span className="relative inline-flex size-1.5 rounded-full bg-current"></span>
        </span>
      )}
      {displayLabel}
    </Badge>
  );
}

function parseDockAllocationDetails(n: any) {
  const msg = n?.message || "";

  const gatePass =
    n?.gate_pass_number ||
    n?.gatePassNumber ||
    msg.match(/Gate Pass:\s*([^\n]+)/i)?.[1]?.trim() ||
    "N/A";
  const vehicle =
    n?.vehicle_number ||
    n?.vehicleNumber ||
    msg.match(/Vehicle:\s*([^\n]+)/i)?.[1]?.trim() ||
    "N/A";
  const driverName =
    n?.driver_name || n?.driverName || msg.match(/Driver:\s*([^\n]+)/i)?.[1]?.trim();
  const driverPhone =
    n?.driver_phone ||
    n?.driverPhone ||
    msg.match(/Driver Phone:\s*([^\n]+)/i)?.[1]?.trim() ||
    msg.match(/Phone:\s*([^\n]+)/i)?.[1]?.trim();
  const asnNumber = n?.asn_number || n?.asnNumber || msg.match(/ASN:\s*([^\n]+)/i)?.[1]?.trim();
  const poNumber = n?.po_number || n?.poNumber || msg.match(/PO:\s*([^\n]+)/i)?.[1]?.trim();

  const dockCode =
    n?.dock_code ||
    n?.dockCode ||
    msg.match(/Dock Code:\s*([^\n]+)/i)?.[1]?.trim() ||
    msg.match(/Proceed (?:directly )?to Dock\s*([^\n.]+)/i)?.[1]?.trim() ||
    "D-01";
  const dockName =
    n?.dock_name ||
    n?.dockName ||
    msg.match(/Dock Name:\s*([^\n]+)/i)?.[1]?.trim() ||
    `Inbound Dock ${dockCode}`;
  const dockLocation =
    n?.dock_location ||
    n?.dockLocation ||
    msg.match(/Location:\s*([^\n]+)/i)?.[1]?.trim() ||
    "Receiving Bay - A";
  const dockType =
    n?.dock_type || n?.dockType || msg.match(/Dock Type:\s*([^\n]+)/i)?.[1]?.trim() || "Inbound";
  const warehouseName =
    n?.warehouse_name ||
    n?.warehouseName ||
    msg.match(/Warehouse:\s*([^\n]+)/i)?.[1]?.trim() ||
    "Main Warehouse";

  const rawTime =
    n?.allocation_time ||
    n?.allocationTime ||
    msg.match(/Allocated At:\s*([^\n]+)/i)?.[1]?.trim() ||
    n?.created_at ||
    n?.createdAt;
  let allocatedAt = "N/A";
  if (rawTime) {
    const d = new Date(rawTime);
    if (!isNaN(d.getTime())) {
      // Keep SSR and browser output identical; locale/time-zone formatting
      // otherwise causes hydration mismatches (for example AM vs U).
      allocatedAt = d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
    } else {
      allocatedAt = String(rawTime);
    }
  }

  return {
    gatePass,
    vehicle,
    driverName: driverName && driverName !== "N/A" ? driverName : null,
    driverPhone: driverPhone && driverPhone !== "N/A" ? driverPhone : null,
    asnNumber: asnNumber && asnNumber !== "N/A" ? asnNumber : null,
    poNumber: poNumber && poNumber !== "N/A" ? poNumber : null,
    dockCode,
    dockName,
    dockLocation,
    dockType,
    warehouseName,
    allocatedAt,
  };
}

export function DockAllocationNotificationCard({ notification }: { notification: any }) {
  const details = parseDockAllocationDetails(notification);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-teal-500/30 bg-teal-500/5 p-5 shadow-sm space-y-4 font-sans text-foreground">
      <div className="absolute left-0 top-0 h-full w-1 bg-teal-600 dark:bg-teal-400" />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-teal-500/20 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400">
            <Warehouse className="size-5" />
          </div>
          <div>
            <h3 className="font-black text-base tracking-tight text-foreground uppercase">
              DOCK ALLOCATION CONFIRMED
            </h3>
            <p className="text-xs text-muted-foreground">Vehicle assigned & dock allocated</p>
          </div>
        </div>
        <Badge
          variant="outline"
          className="bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30 font-extrabold text-[11px] px-2.5 py-0.5 rounded-full"
        >
          Dock Allocated
        </Badge>
      </div>

      {/* Details Grid */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Vehicle Details */}
        <div className="space-y-2 rounded-xl bg-card/80 p-3.5 border border-border/50 text-xs shadow-2xs">
          <span className="text-[10px] font-black uppercase text-muted-foreground tracking-wider block border-b border-border/40 pb-1">
            Vehicle Details
          </span>
          <div className="space-y-1.5 pt-1 font-medium">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Gate Pass:</span>
              <span className="font-mono font-bold text-foreground">{details.gatePass}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Vehicle:</span>
              <span className="font-mono font-bold text-primary">{details.vehicle}</span>
            </div>
            {details.driverName && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Driver:</span>
                <span className="font-semibold text-foreground">{details.driverName}</span>
              </div>
            )}
            {details.driverPhone && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Driver Phone:</span>
                <span className="font-mono text-foreground">{details.driverPhone}</span>
              </div>
            )}
            {details.asnNumber && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">ASN:</span>
                <span className="font-mono font-semibold text-foreground">{details.asnNumber}</span>
              </div>
            )}
            {details.poNumber && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">PO:</span>
                <span className="font-mono font-semibold text-foreground">{details.poNumber}</span>
              </div>
            )}
          </div>
        </div>

        {/* Allocated Dock Details */}
        <div className="space-y-2 rounded-xl bg-card/80 p-3.5 border border-border/50 text-xs shadow-2xs">
          <span className="text-[10px] font-black uppercase text-muted-foreground tracking-wider block border-b border-border/40 pb-1">
            Allocated Dock Details
          </span>
          <div className="space-y-1.5 pt-1 font-medium">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Dock Code:</span>
              <span className="font-mono font-bold text-teal-600 dark:text-teal-400">
                {details.dockCode}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Dock Name:</span>
              <span className="font-semibold text-foreground">{details.dockName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Location:</span>
              <span className="text-foreground">{details.dockLocation}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Dock Type:</span>
              <span className="text-foreground">{details.dockType}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Warehouse:</span>
              <span className="text-foreground">{details.warehouseName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Allocated At:</span>
              <span className="text-foreground">{details.allocatedAt}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Instruction Banner */}
      <div className="rounded-xl border border-teal-500/20 bg-teal-500/10 p-3 text-xs flex items-center justify-between">
        <div>
          <span className="text-[10px] font-black uppercase tracking-wider block text-teal-700 dark:text-teal-300">
            Instruction
          </span>
          <p className="font-extrabold text-teal-900 dark:text-teal-100 mt-0.5">
            Proceed directly to Dock {details.dockCode}.
          </p>
        </div>
      </div>
    </div>
  );
}
