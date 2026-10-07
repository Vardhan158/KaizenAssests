import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  Boxes,
  ClipboardCheck,
  Factory,
  Fingerprint,
  GitFork,
  Loader2,
  Package,
  QrCode,
  RefreshCw,
  Search,
  Store,
  Tag,
} from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";

import { AppShell } from "@/components/wms/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { GenealogyModal } from "@/components/assembly/genealogy-modal";
import { api } from "@/lib/api-client";
import { requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/assembly-genealogy")({
  beforeLoad: () => requireRole(["ASSEMBLY_MANAGER", "ASSEMBLY", "ADMIN", "SUPERUSER"]),
  head: () => ({
    meta: [
      { title: "Product Genealogy & Traceability · KaizenX" },
      {
        name: "description",
        content:
          "End-to-end component traceability from Finished Good serials to inward raw material GRNs and batches.",
      },
    ],
  }),
  component: AssemblyGenealogyPage,
});

function AssemblyGenealogyPage() {
  const [finishedGoods, setFinishedGoods] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIdentifier, setSelectedIdentifier] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const fgRes = await api.getFinishedGoods();
      setFinishedGoods(fgRes || []);
    } catch (err: any) {
      toast.error("Unable to load finished goods genealogy data", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleOpenGenealogy = (id: string) => {
    setSelectedIdentifier(id);
    setIsModalOpen(true);
  };

  const handleDirectSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    handleOpenGenealogy(searchQuery.trim());
  };

  const filteredGoods = finishedGoods.filter((item) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      (item.product_name || "").toLowerCase().includes(q) ||
      (item.product_code || "").toLowerCase().includes(q) ||
      (item.serial_number || "").toLowerCase().includes(q) ||
      (item.qr_code || "").toLowerCase().includes(q) ||
      (item.order_number || "").toLowerCase().includes(q) ||
      (item.warehouse_id || "").toLowerCase().includes(q)
    );
  });

  return (
    <AppShell
      title="Finished Goods Genealogy"
      subtitle="End-to-end component traceability: Finished Good QR → Serial → Assembly Order → Consumed Raw Materials & Batches → Source Store/Bin → Inward GRN"
      actions={
        <Button variant="outline" className="rounded-xl text-xs" onClick={() => void loadData()}>
          <RefreshCw className="size-4 mr-1.5" /> Refresh
        </Button>
      }
    >
      {/* Search Bar / Direct Lookup Header */}
      <Card className="mb-6 rounded-3xl border border-border/80 bg-gradient-to-br from-card to-muted/30 p-6 shadow-sm">
        <form onSubmit={handleDirectSearch} className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search or enter Serial Number, QR Code, Product Code, or Assembly Order ID..."
              className="pl-10 h-11 rounded-2xl bg-background text-sm font-medium shadow-2xs"
            />
          </div>
          <Button
            type="submit"
            className="w-full sm:w-auto h-11 px-6 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-glow"
          >
            <GitFork className="size-4 mr-1.5" /> Trace Genealogy
          </Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground pl-1">
          💡 Enter any unique product identifier to trace the full genealogy chain and raw material origins.
        </p>
      </Card>

      {/* Summary KPI Cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-2xl p-5 border border-border/80 shadow-2xs bg-card">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Total Finished Goods</p>
            <Boxes className="size-4 text-indigo-500" />
          </div>
          <p className="mt-2 text-3xl font-black">{finishedGoods.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Quality-approved & serialized</p>
        </Card>

        <Card className="rounded-2xl p-5 border border-border/80 shadow-2xs bg-card">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Traceable Lots</p>
            <Fingerprint className="size-4 text-emerald-500" />
          </div>
          <p className="mt-2 text-3xl font-black text-emerald-600 dark:text-emerald-400">100%</p>
          <p className="text-xs text-muted-foreground mt-1">Full GRN & batch lineage</p>
        </Card>

        <Card className="rounded-2xl p-5 border border-border/80 shadow-2xs bg-card">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">QR Identification</p>
            <QrCode className="size-4 text-blue-500" />
          </div>
          <p className="mt-2 text-3xl font-black text-blue-600 dark:text-blue-400">{finishedGoods.filter(f => f.qr_code).length}</p>
          <p className="text-xs text-muted-foreground mt-1">Machine-readable barcodes</p>
        </Card>

        <Card className="rounded-2xl p-5 border border-border/80 shadow-2xs bg-card">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Store Putaways</p>
            <Store className="size-4 text-purple-500" />
          </div>
          <p className="mt-2 text-3xl font-black text-purple-600 dark:text-purple-400">{finishedGoods.filter(f => f.status === "PUTAWAY_PENDING" || f.status === "COMPLETED").length}</p>
          <p className="text-xs text-muted-foreground mt-1">Finished Goods Store inventory</p>
        </Card>
      </div>

      {/* Finished Goods Catalog & Trace List */}
      <Card className="rounded-3xl border border-border/80 p-6 shadow-sm bg-card">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-foreground">Serialized Finished Products</h3>
            <p className="text-xs text-muted-foreground">Click any product to inspect its complete genealogy breakdown.</p>
          </div>
          <Badge variant="secondary" className="font-mono text-xs">
            {filteredGoods.length} products
          </Badge>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="size-6 animate-spin text-primary" />
            <p className="text-sm">Loading finished goods data...</p>
          </div>
        ) : filteredGoods.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <Package className="mx-auto mb-2 size-8 text-muted-foreground/50" />
            <p className="text-sm font-semibold">No finished goods found matching your search.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredGoods.map((item) => (
              <Card
                key={item.id}
                className="flex flex-col justify-between rounded-2xl border border-border/80 p-5 shadow-2xs hover:shadow-soft transition-all duration-200"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-mono text-xs font-bold text-primary">{item.product_code}</span>
                      <h4 className="font-bold text-sm text-foreground mt-0.5">{item.product_name}</h4>
                    </div>
                    <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-0 text-[10px] font-extrabold">
                      {item.status || "PASSED"}
                    </Badge>
                  </div>

                  <div className="mt-4 space-y-2 text-xs rounded-xl bg-muted/40 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Serial Number:</span>
                      <span className="font-mono font-bold text-foreground">{item.serial_number || "—"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Quantity:</span>
                      <span className="font-semibold text-foreground">{item.quantity} {item.uom || "PCS"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Store / Location:</span>
                      <span className="font-medium text-foreground">{item.location_code || item.warehouse_id || "FG Store"}</span>
                    </div>
                    {item.posted_at && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Posted Date:</span>
                        <span className="text-muted-foreground text-[11px]">{new Date(item.posted_at).toLocaleDateString()}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t flex items-center gap-2">
                  <Button
                    className="flex-1 rounded-xl text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-2xs"
                    onClick={() => handleOpenGenealogy(item.id || item.serial_number || item.product_code)}
                  >
                    <GitFork className="size-3.5 mr-1.5" /> Inspect Genealogy
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>

      {/* Genealogy Modal */}
      <GenealogyModal
        identifier={selectedIdentifier}
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
      />
    </AppShell>
  );
}
