import { createFileRoute } from "@tanstack/react-router";
import { Building2, Loader2, PackageCheck, Search, Truck, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/wms/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api-client";
import { requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/admin_/suppliers")({
  beforeLoad: () => requireRole(["ADMIN", "SUPERUSER", "SUPER_ADMIN"]),
  component: AdminSuppliersPage,
});

type SupplierSummary = {
  id: string;
  supplier_code?: string;
  supplier_name: string;
  registered_company_name: string;
  username?: string;
  vendor_type?: string;
  industry?: string;
  category?: string[];
  main_materials?: string[];
  gstin?: string;
  status: string;
  rating: number;
  performance_score: number;
  asn_count: number;
  dispatch_count: number;
};

function AdminSuppliersPage() {
  const [suppliers, setSuppliers] = useState<SupplierSummary[]>([]);
  const [selected, setSelected] = useState<SupplierSummary | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api
      .getAdminSuppliers()
      .then(setSuppliers)
      .catch((error: Error) => toast.error(error.message || "Unable to load suppliers"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return suppliers;
    return suppliers.filter((supplier) =>
      [
        supplier.supplier_name,
        supplier.registered_company_name,
        supplier.supplier_code,
        supplier.username,
        supplier.industry,
      ].some((value) => value?.toLowerCase().includes(term)),
    );
  }, [search, suppliers]);

  const activeCount = suppliers.filter(
    (supplier) => supplier.status?.toLowerCase() === "active",
  ).length;
  const totalAsns = suppliers.reduce((total, supplier) => total + supplier.asn_count, 0);
  const totalDispatches = suppliers.reduce((total, supplier) => total + supplier.dispatch_count, 0);

  return (
    <AppShell title="Suppliers" subtitle="Overview of all registered suppliers">
      <div className="space-y-6 p-4 md:p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Total suppliers", suppliers.length, Users],
            ["Active suppliers", activeCount, Building2],
            ["Total ASNs", totalAsns, Truck],
            ["FG dispatch requests", totalDispatches, PackageCheck],
          ].map(([label, value, Icon]) => (
            <Card key={String(label)}>
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <p className="text-sm text-muted-foreground">{label as string}</p>
                  <p className="mt-1 text-3xl font-bold">{value as number}</p>
                </div>
                <Icon className="text-primary" />
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>All suppliers</CardTitle>
            <label className="relative block w-full sm:w-72">
              <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search suppliers..."
                className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm"
              />
            </label>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="animate-spin" />
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filtered.map((supplier) => (
                  <button
                    key={supplier.id}
                    type="button"
                    onClick={() => setSelected(supplier)}
                    className="rounded-xl border p-4 text-left transition hover:border-primary hover:bg-muted/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{supplier.registered_company_name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {supplier.supplier_code || "No supplier code"}
                        </p>
                      </div>
                      <Badge variant="outline">{supplier.status}</Badge>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-muted-foreground">ASNs</span>
                        <p className="font-semibold">{supplier.asn_count}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Dispatches</span>
                        <p className="font-semibold">{supplier.dispatch_count}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {!loading && !filtered.length && (
              <p className="py-12 text-center text-muted-foreground">No suppliers found.</p>
            )}
          </CardContent>
        </Card>

        <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{selected?.registered_company_name}</DialogTitle>
            </DialogHeader>
            {selected && (
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  ["Supplier name", selected.supplier_name],
                  ["Supplier code", selected.supplier_code || "—"],
                  ["Username", selected.username || "—"],
                  ["Status", selected.status],
                  ["Vendor type", selected.vendor_type || "—"],
                  ["Industry", selected.industry || "—"],
                  ["GSTIN", selected.gstin || "—"],
                  ["Rating", selected.rating || "—"],
                  ["Performance score", selected.performance_score || "—"],
                  ["ASNs", selected.asn_count],
                  ["FG dispatch requests", selected.dispatch_count],
                  ["Materials", selected.main_materials?.join(", ") || "—"],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 font-medium">{value}</p>
                  </div>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
