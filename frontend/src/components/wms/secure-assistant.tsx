import { useEffect, useMemo, useState } from "react";
import { Bot, ChevronRight, Search, Send, X } from "lucide-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { api } from "@/lib/api-client";
import { getUserInfo } from "@/lib/auth-utils";

const roleModules: Record<string, { label: string; links: { label: string; to: string }[] }> = {
  PROCUREMENT: {
    label: "Procurement",
    links: [
      { label: "Procurement dashboard", to: "/procurement-dashboard" },
      { label: "Suppliers", to: "/master-data" },
      { label: "Purchase orders", to: "/procurement/purchase-orders" },
      { label: "RFQs", to: "/procurement/rfqs" },
    ],
  },
  WAREHOUSE: {
    label: "Warehouse",
    links: [
      { label: "Warehouse dashboard", to: "/warehouse-dashboard" },
      { label: "Inventory", to: "/inventory" },
      { label: "Putaway tasks", to: "/putaway-tasks" },
      { label: "Dock management", to: "/dock-management" },
    ],
  },
  WAREHOUSE_MANAGER: {
    label: "Warehouse",
    links: [
      { label: "Warehouse dashboard", to: "/warehouse-dashboard" },
      { label: "Inventory", to: "/inventory" },
      { label: "Putaway tasks", to: "/putaway-tasks" },
      { label: "Dock management", to: "/dock-management" },
    ],
  },
  STORE_MANAGER: {
    label: "Store",
    links: [
      { label: "My store", to: "/my-store" },
      { label: "Inventory", to: "/inventory" },
      { label: "Putaway tasks", to: "/putaway-tasks" },
    ],
  },
  FINANCE: {
    label: "Finance",
    links: [
      { label: "Finance dashboard", to: "/finance-dashboard" },
      { label: "Reports", to: "/reports" },
    ],
  },
  ADMIN: {
    label: "Administration",
    links: [
      { label: "User management", to: "/admin/users" },
      { label: "Warehouse dashboard", to: "/warehouse-dashboard" },
      { label: "Procurement dashboard", to: "/procurement-dashboard" },
    ],
  },
};

function getModule() {
  const roles = getUserInfo()?.roles || [];
  return roles.map((role) => roleModules[role]).find(Boolean) || roleModules.WAREHOUSE;
}

export function SecureAssistant() {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const module = useMemo(getModule, [location.pathname]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      setSearchError("");
      return;
    }
    const timer = window.setTimeout(() => {
      setLoading(true);
      void api
        .globalSearch(query.trim())
        .then((data) => {
          setSearchError("");
          setResults(data.results || []);
        })
        .catch((error: Error) => {
          setResults([]);
          setSearchError(error.message || "Search is unavailable");
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  const go = (to: string) => {
    setOpen(false);
    setQuery("");
    void navigate({ to: to as any });
  };

  return (
    <>
      <button
        type="button"
        aria-label="Open KaizenX assistant"
        title="KaizenX Assistant"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105"
      >
        <Bot className="size-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/20" onClick={() => setOpen(false)}>
          <section
            role="dialog"
            aria-label="KaizenX Assistant"
            onClick={(event) => event.stopPropagation()}
            className="absolute bottom-5 right-5 flex h-[min(650px,calc(100vh-40px))] w-[min(420px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-border/60 bg-primary px-4 py-3 text-primary-foreground">
              <div className="flex items-center gap-2">
                <Bot className="size-5" />
                <div>
                  <p className="text-sm font-bold">KaizenX Assistant</p>
                  <p className="text-[11px] text-primary-foreground/75">{module.label} workspace</p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close assistant"
                onClick={() => setOpen(false)}
                className="grid size-8 place-items-center rounded-lg hover:bg-white/15"
              >
                <X className="size-4" />
              </button>
            </header>
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              <div className="rounded-xl bg-muted/40 p-3 text-sm text-foreground">
                I can search records and open pages available to your current role. Try a PO,
                supplier, ASN, material, or user name.
              </div>
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {module.label} shortcuts
                </p>
                <div className="grid gap-2">
                  {module.links.map((link) => (
                    <button
                      type="button"
                      key={link.to}
                      onClick={() => go(link.to)}
                      className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2 text-left text-sm hover:bg-muted/40"
                    >
                      <span>{link.label}</span>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              </div>
              {query.trim().length >= 2 && (
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Search results
                  </p>
                  {loading ? (
                    <p className="text-sm text-muted-foreground">Searching authorized records...</p>
                  ) : searchError ? (
                    <p className="text-sm text-destructive">{searchError}</p>
                  ) : results.length ? (
                    <div className="space-y-2">
                      {results.map((result) => (
                        <button
                          type="button"
                          key={`${result.type}-${result.id}`}
                          onClick={() => go(result.link)}
                          className="w-full rounded-xl border border-border/60 p-3 text-left hover:bg-muted/40"
                        >
                          <p className="text-sm font-semibold">{result.title}</p>
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                            {result.subtitle}
                          </p>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No authorized records found.</p>
                  )}
                </div>
              )}
            </div>
            <form
              className="border-t border-border/60 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (query.trim().length >= 2) {
                  setSearchError("");
                  setResults([]);
                  setLoading(true);
                  void api
                    .globalSearch(query.trim())
                    .then((data) => setResults(data.results || []))
                    .catch((error: Error) =>
                      setSearchError(error.message || "Search is unavailable"),
                    )
                    .finally(() => setLoading(false));
                }
              }}
            >
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  autoFocus
                  placeholder="Ask or search records..."
                  className="h-10 w-full rounded-xl border border-border bg-muted/40 pl-9 pr-10 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                />
                <button
                  type="submit"
                  aria-label="Search records"
                  className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Send className="size-4" />
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
