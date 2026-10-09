import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Truck, Inbox, Loader2, FileText, AlertTriangle, Camera, X, Eye, ExternalLink, QrCode, CheckCircle2, PackageCheck, Layers, History } from "lucide-react";
import { AppShell, DockAllocationNotificationCard } from "@/components/wms/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { api, BUSINESS_API_URL } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { requireAuth, getUserInfo } from "@/lib/auth-utils";

export const Route = createFileRoute("/notifications")({
  beforeLoad: () => requireAuth(),
  component: Notifications,
});

export function extractGrnPayload(n: any) {
  if (!n) return null;
  let parsedJson: any = null;
  if (n.payload_json || n.payloadJson) {
    try {
      parsedJson = typeof (n.payload_json || n.payloadJson) === "string"
        ? JSON.parse(n.payload_json || n.payloadJson)
        : (n.payload_json || n.payloadJson);
    } catch (e) {
      console.warn("Could not parse payload_json:", e);
    }
  }

  const grnNumber = parsedJson?.grn_number || n.grn_number || n.grnNumber || (n.message ? (n.message.match(/GRN:\s*([^\s|\n]+)/i)?.[1] || n.message.match(/(GRN-[A-Za-z0-9-]+)/i)?.[1]) : null) || "";
  const poNumber = parsedJson?.po_number || n.po_number || n.poNumber || (n.message ? (n.message.match(/PO:\s*([^\s|\n]+)/i)?.[1] || n.message.match(/(PO-[A-Za-z0-9-]+)/i)?.[1]) : null) || "";
  const supplierName = parsedJson?.supplier_name || n.supplier_name || n.supplierName || (n.message ? n.message.match(/Supplier:\s*([^|\n]+)/i)?.[1]?.trim() : null) || "Supplier";
  const rawVeh = parsedJson?.vehicle_number || n.vehicle_number || n.vehicleNumber || (n.message ? n.message.match(/vehicle:\s*([^\s|\n,]+)/i)?.[1]?.trim() : null) || "";
  const vehicleNumber = rawVeh && rawVeh.toLowerCase() !== "vehicle" ? rawVeh : "";
  const warehouseName = parsedJson?.warehouse_name || n.warehouse_name || n.warehouseName || (n.message ? n.message.match(/Warehouse:\s*([^|\n]+)/i)?.[1]?.trim() : null) || "Main Warehouse";
  const dockCode = parsedJson?.dock_number || n.dock_code || n.dockCode || (n.message ? n.message.match(/Dock:\s*([^\s|\n]+)/i)?.[1]?.trim() : null) || "DOCK-01";
  const poStatus = parsedJson?.po_status || (n.title?.includes("Completed") ? "FULLY RECEIVED" : "PARTIALLY RECEIVED");

  const totals = parsedJson?.totals || {
    ordered_qty: 0,
    prev_accepted_qty: 0,
    current_received_qty: 0,
    current_good_qty: 0,
    current_damaged_qty: 0,
    pending_delivery_qty: 0,
    replacement_required_qty: 0,
    acceptable_qty_outstanding: 0,
  };

  const items = parsedJson?.items || [];

  return {
    raw: n,
    grnNumber,
    poNumber,
    supplierName,
    vehicleNumber,
    warehouseName,
    dockCode,
    poStatus,
    totals,
    items,
    receiptDate: parsedJson?.receipt_date || n.created_at,
    hasPayloadJson: Boolean(parsedJson),
  };
}

function parseDamageNotificationMessage(msg?: string, notifObj?: any) {
  const payloadData = extractGrnPayload(notifObj);
  if (payloadData?.hasPayloadJson && payloadData.items.length > 0) {
    const damagedItems = payloadData.items.filter((it: any) => it.current_damaged_qty > 0);
    return {
      grnNumber: payloadData.grnNumber,
      poNumber: payloadData.poNumber,
      supplierName: payloadData.supplierName,
      warehouseName: payloadData.warehouseName,
      vehicleNumber: payloadData.vehicleNumber,
      reportedBy: "GRN Quality Inspector",
      customRemarks: payloadData.raw?.verification_notes || "",
      totals: payloadData.totals,
      items: (damagedItems.length > 0 ? damagedItems : payloadData.items).map((it: any) => ({
        material: `${it.item_code} (${it.material_name})`,
        itemCode: it.item_code,
        materialName: it.material_name,
        category: it.category,
        uom: it.uom,
        orderedQty: it.ordered_qty,
        prevAcceptedQty: it.prev_accepted_qty,
        currentReceivedQty: it.current_received_qty,
        currentGoodQty: it.current_good_qty,
        currentDamagedQty: it.current_damaged_qty,
        pendingDeliveryQty: it.pending_delivery_qty,
        replacementRequiredQty: it.replacement_required_qty,
        acceptableQtyOutstanding: it.acceptable_qty_outstanding,
        batchNumber: it.batch_number,
        standardQrRef: it.standard_qr_ref,
        damageLotNumber: it.damage_lot_number,
        quarantineQrRef: it.quarantine_qr_ref,
        reason: it.damage_reason || "Damaged / Rejected during inspection",
        photoCount: it.photo_count || (it.photos?.length || 0),
        photos: it.photos || [],
        quantity: `${it.current_damaged_qty > 0 ? it.current_damaged_qty : it.current_received_qty} ${it.uom}`,
      })),
    };
  }

  if (!msg) {
    return {
      grnNumber: notifObj?.grn_number || notifObj?.grnNumber || "",
      poNumber: notifObj?.po_number || notifObj?.poNumber || "",
      supplierName: notifObj?.supplier_name || notifObj?.supplierName || "Supplier",
      warehouseName: notifObj?.warehouse_name || notifObj?.warehouseName || "Main Warehouse",
      vehicleNumber: notifObj?.vehicle_number || notifObj?.vehicleNumber || "",
      reportedBy: "GRN Quality Inspector",
      customRemarks: "",
      items: [],
      totals: null,
    };
  }

  const grnMatch =
    msg.match(/GRN:\s*([^\s|\n]+)/i) ||
    msg.match(/for GRN\s+([^\s|\n]+)/i) ||
    msg.match(/GRN Number\s*[:\n]\s*([^\s|\n]+)/i) ||
    msg.match(/Ref:\s*(GRN-[A-Za-z0-9-]+)/i) ||
    msg.match(/(GRN-[A-Za-z0-9-]+)/i);

  const poMatch =
    msg.match(/PO:\s*([^\s|\n]+)/i) ||
    msg.match(/against PO\s+([^\s|\.\n]+)/i) ||
    msg.match(/PO Reference\s*[:\n]\s*([^\s|\n]+)/i) ||
    msg.match(/(PO-[A-Za-z0-9-]+)/i);

  const supplierMatch =
    msg.match(/Supplier:\s*([^|\n]+)/i) ||
    msg.match(/Supplier Name\s*[:\n]\s*([^|\n]+)/i);

  const warehouseMatch =
    msg.match(/Warehouse:\s*([^|\n]+)/i) ||
    msg.match(/Warehouse Name\s*[:\n]\s*([^|\n]+)/i);

  const remarksMatch =
    msg.match(/Inspector Remarks:\s*([^\n]+)/i) ||
    msg.match(/Remarks:\s*([^\n]+)/i);

  const items: { material: string; quantity: string; reason: string; itemCode?: string }[] = [];
  const lines = msg.split("\n");
  let inItems = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().includes("damaged items:") || trimmed.toLowerCase().includes("damaged materials") || trimmed.toLowerCase().includes("flagged") || trimmed.toLowerCase().includes("material breakdown:")) {
      inItems = true;
      continue;
    }
    if (inItems && (trimmed.startsWith("•") || trimmed.startsWith("-") || trimmed.startsWith("*") || /^\d+\./.test(trimmed))) {
      const cleanLine = trimmed.replace(/^[•\-*]|\d+\.\s*/, "").trim();
      const parts = cleanLine.split("|").map((p) => p.trim());
      let mat = parts[0] || "Material Item";
      if (mat.includes("undefined") || mat.includes("null")) {
        mat = "Damaged Material Item";
      }
      let qty = parts.find((p) => p.toLowerCase().startsWith("qty:") || p.toLowerCase().startsWith("damaged:") || p.toLowerCase().startsWith("rec:"))
        ?.replace(/^(qty|damaged|rec):\s*/i, "") || "1.0 Units";
      if (qty.includes("undefined") || qty.includes("null")) {
        qty = "1.0 Units";
      }
      const rsn = parts.find((p) => p.toLowerCase().startsWith("reason:"))
        ?.replace(/^reason:\s*/i, "") || (remarksMatch && remarksMatch[1] ? remarksMatch[1] : "Damaged / Rejected");
      
      const codeMatch = mat.match(/(MAT-[A-Za-z0-9-]+)/i);
      items.push({ material: mat, quantity: qty, reason: rsn, itemCode: codeMatch ? codeMatch[1] : undefined });
    }
  }

  const grnNumber = notifObj?.grn_number || notifObj?.grnNumber || (grnMatch && grnMatch[1] ? grnMatch[1] : (notifObj?.link?.match(/grn_id=([^&]+)/)?.[1] || ""));
  const poNumber = notifObj?.po_number || notifObj?.poNumber || (poMatch && poMatch[1] ? poMatch[1] : "");
  const supplierName = notifObj?.supplier_name || notifObj?.supplierName || (supplierMatch && supplierMatch[1] ? supplierMatch[1].trim() : "Supplier");
  const warehouseName = notifObj?.warehouse_name || notifObj?.warehouseName || (warehouseMatch && warehouseMatch[1] ? warehouseMatch[1].trim() : "Main Warehouse");

  return {
    grnNumber,
    poNumber,
    supplierName,
    warehouseName,
    vehicleNumber: notifObj?.vehicle_number || notifObj?.vehicleNumber || "",
    reportedBy: "GRN Quality Inspector",
    customRemarks: remarksMatch && remarksMatch[1] ? remarksMatch[1].trim() : "",
    items: items.length > 0 ? items : [{ material: "Damaged Material Item", quantity: "1.0 Units", reason: "Damaged during receiving inspection" }],
    totals: null,
  };
}

function parseGrnNotificationDetails(n: any) {
  if (!n) return null;
  const payloadData = extractGrnPayload(n);
  const msg = n.message || "";
  const title = n.title || "";

  let statusText = "Goods Receiving";
  if (title.toLowerCase().includes("draft")) statusText = "GRN Draft Created";
  else if (title.toLowerCase().includes("posted")) statusText = "GRN Posted";
  else if (title.toLowerCase().includes("required")) statusText = "Quality Inspection Required";
  else if (title.toLowerCase().includes("pass")) statusText = "Quality Inspection Passed";
  else if (title.toLowerCase().includes("fail") || title.toLowerCase().includes("damage")) statusText = "Quality Failed / Damaged";
  else if (title.toLowerCase().includes("completed")) statusText = "Receiving Completed";

  return {
    title,
    grnNumber: payloadData?.grnNumber,
    poNumber: payloadData?.poNumber,
    supplierName: payloadData?.supplierName,
    vehicleNumber: payloadData?.vehicleNumber,
    dockCode: payloadData?.dockCode,
    warehouseName: payloadData?.warehouseName,
    poStatus: payloadData?.poStatus,
    totals: payloadData?.totals,
    items: payloadData?.items,
    statusText,
    created_at: n.created_at || n.createdAt,
    message: msg,
    link: n.link,
    hasPayloadJson: payloadData?.hasPayloadJson,
  };
}

function Notifications() {
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [userRole, setUserRole] = useState("WAREHOUSE");
  const [markingAllRead, setMarkingAllRead] = useState(false);

  // Modal State for Damaged Goods Details
  const [showDamageModal, setShowDamageModal] = useState(false);
  const [selectedDamageNotif, setSelectedDamageNotif] = useState<any | null>(null);
  const [enlargedPhoto, setEnlargedPhoto] = useState<string | null>(null);
  const [damageGrnData, setDamageGrnData] = useState<any | null>(null);
  const [poDamageRecord, setPoDamageRecord] = useState<any | null>(null);
  const [damageLoading, setDamageLoading] = useState(false);

  // Modal State for GRN & Quality Notification Details
  const [showGrnModal, setShowGrnModal] = useState(false);
  const [selectedGrnNotif, setSelectedGrnNotif] = useState<any | null>(null);

  useEffect(() => {
    const parsedUser = getUserInfo();
    const roles = parsedUser?.roles || [];
    const username = String(parsedUser?.username || "").toLowerCase();
    const role = roles.includes("SUPPLIER")
      ? "SUPPLIER"
      : roles.includes("FINANCE")
        ? "FINANCE"
          : roles.includes("PROCUREMENT")
            ? "PROCUREMENT"
          : roles.includes("GATE_SECURITY")
            ? "GATE_SECURITY"
          : roles.includes("ASSEMBLY") || roles.includes("ASSEMBLY_MANAGER") || roles.includes("ASSEMBLY_OPERATOR")
            ? "ASSEMBLY_MANAGER"
          : roles.includes("DISPATCH") ||
              roles.includes("DISPATCH_MANAGER") ||
              username === "dispatch" ||
              username.includes("dispatch")
            ? "DISPATCH"
            : roles.includes("GRN") ||
                roles.includes("GRN_MANAGER") ||
                roles.includes("OPERATIONS_MANAGER") ||
                roles.includes("OPERATIONS") ||
                roles.includes("RECEIVING") ||
                username === "grn" ||
                username.includes("grn")
              ? "GRN"
              : "WAREHOUSE";
    setUserRole(role);
    void fetchData(role, false);
    const unsubscribe = api.subscribeNotifications(role, () => void fetchData(role, true));
    const refresh = () => void fetchData(role, true);
    window.addEventListener("focus", refresh);
    window.addEventListener("notifications:refresh", refresh);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("notifications:refresh", refresh);
    };
  }, []);

  // Fetch full GRN damage data and PO damaged goods when damage notification is selected
  useEffect(() => {
    if (!selectedDamageNotif) {
      setDamageGrnData(null);
      setPoDamageRecord(null);
      return;
    }
    let isMounted = true;
    const loadDamageData = async () => {
      try {
        setDamageLoading(true);
        const parsed = parseDamageNotificationMessage(selectedDamageNotif.message, selectedDamageNotif);
        let targetGrnId = selectedDamageNotif.grn_id || selectedDamageNotif.grn_number || parsed.grnNumber;
        if (selectedDamageNotif.link) {
          const match = selectedDamageNotif.link.match(/grn_id=([^&]+)/);
          if (match && match[1]) targetGrnId = match[1];
        }
        const targetPoNumber = selectedDamageNotif.po_number || selectedDamageNotif.poNumber || parsed.poNumber;

        let grnData: any = null;
        if (targetGrnId) {
          try {
            grnData = await api.getGrn(targetGrnId);
          } catch (e) {
            console.warn("Could not fetch GRN details for damage photos", e);
          }
        }

        let poDmg: any = null;
        if (targetPoNumber) {
          try {
            poDmg = await api.getPoDamagedGoods(targetPoNumber);
          } catch (e) {
            console.warn("Could not fetch PO damaged goods for", targetPoNumber, e);
          }
        }

        if (isMounted) {
          setDamageGrnData(grnData);
          setPoDamageRecord(poDmg);
        }
      } catch (err) {
        console.warn("Could not fetch full damage details", err);
      } finally {
        if (isMounted) setDamageLoading(false);
      }
    };
    void loadDamageData();
    return () => {
      isMounted = false;
    };
  }, [selectedDamageNotif]);

  const fetchData = async (role: string, quiet = false) => {
    try {
      if (!quiet) setLoading(true);
      if (role === "WAREHOUSE") {
        const [arrivalData, workflowData] = await Promise.all([
          api.getArrivalNotifications(),
          api.getNotifications("WAREHOUSE"),
        ]);
        const arrivals = (Array.isArray(arrivalData) ? arrivalData : []).map((n: any) => ({
          id: n?.id,
          title: "Arrival Notification",
          message:
            n?.message ||
            `Truck ${n?.vehicleNumber || n?.vehicle_number || "not assigned"} from ${n?.supplierName || n?.supplier_name || "supplier not available"} is arriving.`,
          created_at:
            n?.createdAt || n?.created_at || n?.expectedArrivalTime || n?.expected_arrival_time,
          type: "arrival",
          is_read: (n?.status || "").toUpperCase() === "ACKNOWLEDGED",
          po_number: n?.poNumber || n?.po_number,
          supplier_name: n?.supplierName || n?.supplier_name,
        }));
        const workflows = Array.isArray(workflowData) ? workflowData : [];
        setNotifications(
          [...workflows, ...arrivals].sort(
            (a: any, b: any) =>
              new Date(b.created_at || b.createdAt || 0).getTime() -
              new Date(a.created_at || a.createdAt || 0).getTime(),
          ),
        );
      } else {
        const data = await api.getNotifications(role);
        setNotifications(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      if (!quiet) console.warn("Failed to fetch notifications", error);
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  const handleMarkAllRead = async () => {
    if (markingAllRead || !notifications.some((notification) => !notification.is_read)) return;
    setMarkingAllRead(true);
    try {
      if (userRole === "WAREHOUSE") {
        await Promise.all([
          api.markAllNotificationsRead(userRole),
          api.markAllArrivalNotificationsRead(),
        ]);
      } else {
        await api.markAllNotificationsRead(userRole);
      }
      setNotifications((current) => current.map((notification) => ({ ...notification, is_read: true })));
      toast.success("All notifications marked as read");
    } catch (error) {
      toast.error("Unable to mark all notifications as read", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setMarkingAllRead(false);
    }
  };

  const handleOpenNotificationDetails = (n: any) => {
    // Some older notification records contain the shared warehouse dashboard
    // as their target. Keep procurement users in their own dashboard context.
    const notificationLink =
      userRole === "PROCUREMENT" &&
      ["/warehouse-dashboard", "/receiving"].includes(String(n.link || ""))
        ? "/procurement-dashboard"
        : n.link;
    const isGrnLinked = String(n.link || "").startsWith("/grn");
    const isDockAllocation =
      userRole !== "GRN" &&
      !isGrnLinked &&
      (n.title?.toUpperCase().includes("DOCK ALLOCAT") ||
        n.title?.toUpperCase().includes("DOCK CONFIRMED"));

    const isDamage =
      n.title?.toLowerCase().includes("damage") ||
      n.message?.toLowerCase().includes("damage") ||
      n.type === "damaged_goods";

    const isGrnOrQuality =
      n.title?.toLowerCase().includes("grn") ||
      n.title?.toLowerCase().includes("quality") ||
      n.title?.toLowerCase().includes("receiving") ||
      n.message?.toLowerCase().includes("grn") ||
      n.message?.toLowerCase().includes("inspection");

    if (isGrnLinked) {
      window.location.href = n.link;
    } else if (isDamage) {
      setSelectedDamageNotif(n);
      setShowDamageModal(true);
    } else if (isGrnOrQuality) {
      setSelectedGrnNotif(n);
      setShowGrnModal(true);
    } else if (isDockAllocation) {
      // Dock allocation card is rendered directly on page
    } else if (
      notificationLink &&
      (userRole === "PROCUREMENT" || !["/warehouse-dashboard", "/receiving"].includes(notificationLink))
    ) {
      window.location.href = notificationLink;
    } else {
      setSelectedGrnNotif(n);
      setShowGrnModal(true);
    }
  };

  const damageDetails = selectedDamageNotif
    ? parseDamageNotificationMessage(selectedDamageNotif.message, selectedDamageNotif)
    : null;

  const grnDetails = selectedGrnNotif
    ? parseGrnNotificationDetails(selectedGrnNotif)
    : null;

  const getPhotosForMaterial = (matString: string, itemCode?: string) => {
    const cleanMat = (matString || "").toLowerCase();
    const cleanCode = (itemCode || "").toLowerCase();

    // 1. First check GRN lines damage_evidence matching code or name
    if (damageGrnData?.lines && Array.isArray(damageGrnData.lines)) {
      const matchedLine = damageGrnData.lines.find((l: any) => {
        const code = (l.itemCode || l.item_code || "").toLowerCase();
        const name = (l.materialName || l.material_name || "").toLowerCase();
        return (
          (cleanCode && code && (code === cleanCode || cleanCode.includes(code) || code.includes(cleanCode))) ||
          (code && cleanMat.includes(code)) ||
          (name && cleanMat.includes(name))
        );
      });
      const lineEvidence = matchedLine?.damageEvidence || matchedLine?.damage_evidence;
      if (Array.isArray(lineEvidence) && lineEvidence.length > 0) {
        return lineEvidence.map((ev: any) => ({
          evidenceId: ev.evidenceId || ev.evidence_id || ev.id,
          fileName: ev.fileName || ev.file_name || "damage_photo.jpg",
          filePath: ev.filePath || ev.file_path || ev.url || "",
        }));
      }
    }

    // 2. Check PO Damaged Goods record materials
    const poMaterials = poDamageRecord?.materials || damageGrnData?.materials;
    if (Array.isArray(poMaterials)) {
      const matchedMat = poMaterials.find((m: any) => {
        const code = (m.item_code || m.itemCode || "").toLowerCase();
        const name = (m.material_name || m.materialName || "").toLowerCase();
        return (
          (cleanCode && code && (code === cleanCode || cleanCode.includes(code) || code.includes(cleanCode))) ||
          (code && cleanMat.includes(code)) ||
          (name && cleanMat.includes(name))
        );
      });
      if (matchedMat?.photos && Array.isArray(matchedMat.photos) && matchedMat.photos.length > 0) {
        return matchedMat.photos.map((p: any) => ({
          evidenceId: p.id,
          fileName: p.file_name || "damage_photo.jpg",
          filePath: p.url,
        }));
      }
    }

    // 3. Global fallback: Check all evidence photos on the GRN or PO
    if (damageGrnData?.lines && Array.isArray(damageGrnData.lines)) {
      const allEv = damageGrnData.lines.flatMap(
        (l: any) => l.damageEvidence || l.damage_evidence || []
      );
      if (allEv.length > 0) {
        return allEv.map((e: any) => ({
          evidenceId: e.evidenceId || e.evidence_id || e.id,
          fileName: e.fileName || e.file_name || "damage_photo.jpg",
          filePath: e.filePath || e.file_path || e.url || "",
        }));
      }
    }

    if (poDamageRecord?.materials && Array.isArray(poDamageRecord.materials)) {
      const allPoPhotos = poDamageRecord.materials.flatMap((m: any) => m.photos || []);
      if (allPoPhotos.length > 0) {
        return allPoPhotos.map((p: any) => ({
          evidenceId: p.id,
          fileName: p.file_name || "damage_photo.jpg",
          filePath: p.url,
        }));
      }
    }

    return [];
  };

  return (
    <AppShell
      title="Notification centre"
      subtitle="Stay updated with procurement and supply chain alerts"
      actions={
        <Button
          variant="outline"
          className="rounded-xl"
          onClick={() => void handleMarkAllRead()}
          disabled={markingAllRead || !notifications.some((notification) => !notification.is_read)}
        >
          <CheckCircle2 className="mr-2 size-4" />
          {markingAllRead ? "Marking…" : "Mark all as read"}
        </Button>
      }
    >
      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : notifications.length === 0 ? (
        <Card className="items-center gap-2 rounded-2xl border-dashed p-14 text-center shadow-none">
          <span className="grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
            <Inbox className="size-6" />
          </span>
          <p className="mt-2 text-sm font-semibold">Nothing in this queue</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Your notification history is empty.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4">
          {notifications.map((n) => {
            const isGrnLinked = String(n.link || "").startsWith("/grn");
            const isDockAllocation =
              userRole !== "GRN" &&
              !isGrnLinked &&
              (n.title?.toUpperCase().includes("DOCK ALLOCAT") ||
                n.title?.toUpperCase().includes("DOCK CONFIRMED"));

            if (isDockAllocation) {
              return <DockAllocationNotificationCard key={n.id} notification={n} />;
            }

            const isDamage =
              n.title?.toLowerCase().includes("damage") ||
              n.message?.toLowerCase().includes("damage") ||
              n.notification_type === "GRN_DAMAGE_RECORDED";

            const payloadData = extractGrnPayload(n);
            const totals = payloadData?.totals;
            const hasTotals = totals && totals.ordered_qty > 0;
            const notificationDate = n.created_at || n.createdAt || payloadData?.receiptDate;

            return (
              <Card
                key={n.id}
                onClick={() => handleOpenNotificationDetails(n)}
                className={cn(
                  "relative overflow-hidden border-border/50 p-5 cursor-pointer hover:border-primary/40 transition-all space-y-4",
                  !n.is_read && "bg-primary-soft/5 border-primary/20",
                  isDamage && "border-rose-500/30 bg-rose-500/5 hover:border-rose-500/60",
                )}
              >
                {!n.is_read && (
                  <div
                    className={cn(
                      "absolute left-0 top-0 h-full w-1",
                      isDamage ? "bg-rose-600" : "bg-primary",
                    )}
                  />
                )}

                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      "grid size-12 shrink-0 place-items-center rounded-2xl",
                      isDamage
                        ? "bg-rose-500/10 text-rose-600"
                        : n.title?.includes("Approved") || n.title?.includes("Completed")
                          ? "bg-success-soft text-success"
                          : n.title?.includes("Rejected")
                            ? "bg-destructive-soft text-destructive"
                            : "bg-primary-soft text-primary",
                    )}
                  >
                    {isDamage ? (
                      <AlertTriangle className="size-6" />
                    ) : n.type === "arrival" ? (
                      <Truck className="size-6" />
                    ) : (
                      <FileText className="size-6" />
                    )}
                  </div>

                  <div className="flex-1 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <h3
                          className={cn(
                            "font-bold text-foreground text-sm",
                            isDamage && "text-rose-700 font-extrabold flex items-center gap-1.5",
                          )}
                        >
                          {n.title}
                        </h3>
                        {(() => {
                          const titleUpper = String(n.title || "").toUpperCase();
                          const msgUpper = String(n.message || "").toUpperCase();
                          let badgeText = "PROCUREMENT ALERT";
                          let badgeColor = "bg-slate-100 text-slate-800 border-slate-300";

                          if (isDamage || titleUpper.includes("DAMAGE") || msgUpper.includes("DAMAGE")) {
                            badgeText = "DAMAGE & REPLACEMENT REQUIRED";
                            badgeColor = "bg-rose-100 text-rose-800 border-rose-300";
                          } else if (titleUpper.includes("GATE OUT") || titleUpper.includes("GATE EXIT")) {
                            badgeText = "GATE OUT APPROVED";
                            badgeColor = "bg-emerald-100 text-emerald-800 border-emerald-300";
                          } else if (titleUpper.includes("IN TRANSIT")) {
                            badgeText = "IN TRANSIT";
                            badgeColor = "bg-blue-100 text-blue-800 border-blue-300";
                          } else if (titleUpper.includes("DELIVERY COMPLETED") || titleUpper.includes("DELIVERED")) {
                            badgeText = "DELIVERED";
                            badgeColor = "bg-emerald-100 text-emerald-800 border-emerald-300";
                          } else if (titleUpper.includes("LOADING")) {
                            badgeText = "LOADING VERIFIED";
                            badgeColor = "bg-amber-100 text-amber-800 border-amber-300";
                          } else if (titleUpper.includes("PICKING") || titleUpper.includes("PACKING")) {
                            badgeText = "PICK & PACK";
                            badgeColor = "bg-indigo-100 text-indigo-800 border-indigo-300";
                          } else if (titleUpper.includes("TRANSPORT") || titleUpper.includes("DRIVER") || titleUpper.includes("VEHICLE")) {
                            badgeText = "FLEET ALLOCATION";
                            badgeColor = "bg-cyan-100 text-cyan-800 border-cyan-300";
                          } else if (titleUpper.includes("DISPATCH")) {
                            badgeText = "DISPATCH ORDER";
                            badgeColor = "bg-blue-100 text-blue-800 border-blue-300";
                          } else if (titleUpper.includes("ASN") || titleUpper.includes("SHIPMENT")) {
                            badgeText = "SHIPMENT DISPATCHED";
                            badgeColor = "bg-blue-100 text-blue-800 border-blue-300";
                          } else if (titleUpper.includes("PO APPROVED") || titleUpper.includes("APPROVED BY FINANCE")) {
                            badgeText = "PO APPROVED";
                            badgeColor = "bg-emerald-100 text-emerald-800 border-emerald-300";
                          } else if (titleUpper.includes("PO PROPOSAL") || titleUpper.includes("PURCHASE ORDER") || titleUpper.includes("PO ")) {
                            badgeText = "PURCHASE ORDER";
                            badgeColor = "bg-indigo-100 text-indigo-800 border-indigo-300";
                          } else if (titleUpper.includes("SUPPLIER")) {
                            badgeText = "SUPPLIER UPDATE";
                            badgeColor = "bg-teal-100 text-teal-800 border-teal-300";
                          } else if (titleUpper.includes("RFQ")) {
                            badgeText = "RFQ ALERT";
                            badgeColor = "bg-purple-100 text-purple-800 border-purple-300";
                          } else if (titleUpper.includes("QUOTATION")) {
                            badgeText = "QUOTATION";
                            badgeColor = "bg-amber-100 text-amber-800 border-amber-300";
                          } else if (titleUpper.includes("FINISHED GOODS") || titleUpper.includes("MATERIAL REQUEST") || titleUpper.includes("REQUISITION")) {
                            badgeText = "REQUISITION";
                            badgeColor = "bg-sky-100 text-sky-800 border-sky-300";
                          } else if (payloadData?.poStatus === "FULLY_RECEIVED" || titleUpper.includes("RECEIVING COMPLETED")) {
                            badgeText = "FULLY RECEIVED";
                            badgeColor = "bg-emerald-100 text-emerald-800 border-emerald-300";
                          } else if (payloadData?.poStatus === "PARTIALLY_RECEIVED" || titleUpper.includes("GRN")) {
                            badgeText = "GRN RECORDED";
                            badgeColor = "bg-blue-100 text-blue-800 border-blue-300";
                          }

                          return (
                            <span className={cn("px-2 py-0.5 rounded text-[10px] font-extrabold border", badgeColor)}>
                              {badgeText}
                            </span>
                          );
                        })()}
                      </div>
                      <span className="text-[10px] text-muted-foreground font-medium">
                        {notificationDate && !Number.isNaN(new Date(notificationDate).getTime())
                          ? new Date(notificationDate).toLocaleString()
                          : "Date unavailable"}
                      </span>
                    </div>

                    {/* METADATA BADGES */}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {payloadData?.poNumber && (
                        <span className="px-2.5 py-0.5 rounded-md bg-muted font-mono font-bold text-foreground">
                          PO: {payloadData.poNumber}
                        </span>
                      )}
                      {payloadData?.grnNumber && (
                        <span className="px-2.5 py-0.5 rounded-md bg-primary/10 text-primary font-mono font-bold">
                          GRN: {payloadData.grnNumber}
                        </span>
                      )}
                      {payloadData?.supplierName && (
                        <span className="px-2.5 py-0.5 rounded-md bg-muted font-bold text-foreground">
                          Supplier: {payloadData.supplierName}
                        </span>
                      )}
                      {payloadData?.vehicleNumber && payloadData.vehicleNumber !== "Vehicle" && (
                        <span className="px-2.5 py-0.5 rounded-md bg-muted text-muted-foreground font-mono">
                          Vehicle: {payloadData.vehicleNumber}
                        </span>
                      )}
                    </div>

                    {/* BALANCE SUMMARY KPI PILLS */}
                    {hasTotals && (
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 rounded-xl border border-border/60 bg-background/80 p-3 text-xs">
                        <div className="space-y-0.5">
                          <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                            This Vehicle Received
                          </span>
                          <span className="font-mono font-bold text-foreground block">
                            {totals.current_received_qty} ({totals.current_good_qty} Good / <span className="text-rose-600">{totals.current_damaged_qty} Dmg</span>)
                          </span>
                        </div>

                        <div className="space-y-0.5">
                          <span className="text-[10px] uppercase font-bold text-amber-600 block">
                            Pending Delivery Qty
                          </span>
                          <span className="font-mono font-extrabold text-amber-600 block">
                            {totals.pending_delivery_qty} units
                          </span>
                        </div>

                        <div className="space-y-0.5">
                          <span className="text-[10px] uppercase font-bold text-rose-600 block">
                            Replacement Required
                          </span>
                          <span className="font-mono font-extrabold text-rose-600 block">
                            {totals.replacement_required_qty} units
                          </span>
                        </div>

                        <div className="space-y-0.5">
                          <span className="text-[10px] uppercase font-bold text-primary block">
                            Acceptable Outstanding
                          </span>
                          <span className="font-mono font-extrabold text-primary block">
                            {totals.acceptable_qty_outstanding} units
                          </span>
                        </div>
                      </div>
                    )}

                    {!hasTotals && (
                      <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
                        {n.message}
                      </p>
                    )}

                    {/* CARD FOOTER ACTION LINKS */}
                    <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-border/40">
                      <Button
                        size="sm"
                        variant={isDamage ? "default" : "outline"}
                        className={cn(
                          "rounded-xl text-xs font-bold h-8 px-4",
                          isDamage && "bg-rose-600 hover:bg-rose-700 text-white shadow-sm",
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenNotificationDetails(n);
                        }}
                      >
                        <Layers className="mr-1.5 size-3.5" /> View Breakdown & Details
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ✨ DAMAGED GOODS & PROCUREMENT RECEIPT DETAILS MODAL (POPUP) */}
      <Dialog open={showDamageModal} onOpenChange={setShowDamageModal}>
        <DialogContent className="max-w-4xl rounded-3xl p-6 space-y-6 max-h-[90vh] overflow-y-auto border shadow-2xl">
          {/* HEADER */}
          <DialogHeader className="border-b pb-4 flex flex-row items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-full text-xs font-black bg-rose-500/10 text-rose-700 border border-rose-500/20 flex items-center gap-1.5 uppercase tracking-wider">
                  <AlertTriangle className="size-3.5" /> Damaged Goods Evidence & Balance Report
                </span>
                <span className="px-2.5 py-0.5 rounded-md font-mono text-xs font-bold bg-muted text-foreground">
                  Ref: {damageDetails?.grnNumber}
                </span>
              </div>
              <DialogTitle className="text-xl font-black text-foreground mt-2">
                {selectedDamageNotif?.title || "Damaged Goods Reported"}
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Reported Date & Time:{" "}
                <b className="text-foreground">
                  {selectedDamageNotif?.created_at
                    ? new Date(selectedDamageNotif.created_at).toLocaleString()
                    : new Date().toLocaleString()}
                </b>
              </p>
            </div>
          </DialogHeader>

          {/* GENERAL DETAILS GRID */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 bg-muted/30 rounded-2xl p-4 border text-xs font-sans">
            <div className="space-y-0.5">
              <span className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">
                GRN Number
              </span>
              <span className="font-mono text-sm font-black text-primary block">
                {damageDetails?.grnNumber}
              </span>
            </div>

            <div className="space-y-0.5">
              <span className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">
                PO Reference
              </span>
              <span className="font-mono text-sm font-bold text-foreground block">
                {damageDetails?.poNumber}
              </span>
            </div>

            <div className="space-y-0.5">
              <span className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">
                Supplier Name
              </span>
              <span className="text-xs font-bold text-foreground block">
                {damageDetails?.supplierName}
              </span>
            </div>

            <div className="space-y-0.5">
              <span className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">
                Warehouse / Vehicle
              </span>
              <span className="text-xs font-bold text-foreground block">
                {damageDetails?.warehouseName} ({damageDetails?.vehicleNumber || "Vehicle"})
              </span>
            </div>
          </div>

          {/* BALANCE SUMMARY CARDS IN MODAL */}
          {damageDetails?.totals && (
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-xl border bg-muted/20 p-3">
                <span className="text-[10px] font-bold uppercase text-muted-foreground block">Total PO Ordered</span>
                <span className="font-mono text-lg font-black text-foreground">{damageDetails.totals.ordered_qty}</span>
              </div>
              <div className="rounded-xl border border-amber-300 bg-amber-500/10 p-3">
                <span className="text-[10px] font-bold uppercase text-amber-800 block">Pending Delivery Qty</span>
                <span className="font-mono text-lg font-black text-amber-700">{damageDetails.totals.pending_delivery_qty}</span>
              </div>
              <div className="rounded-xl border border-rose-300 bg-rose-500/10 p-3">
                <span className="text-[10px] font-bold uppercase text-rose-800 block">Replacement Required</span>
                <span className="font-mono text-lg font-black text-rose-700">{damageDetails.totals.replacement_required_qty}</span>
              </div>
              <div className="rounded-xl border border-primary/30 bg-primary-soft/10 p-3">
                <span className="text-[10px] font-bold uppercase text-primary block">Acceptable Outstanding</span>
                <span className="font-mono text-lg font-black text-primary">{damageDetails.totals.acceptable_qty_outstanding}</span>
              </div>
            </div>
          )}

          {/* INSPECTOR CUSTOM REMARKS IF PRESENT */}
          {damageDetails?.customRemarks && (
            <div className="rounded-2xl border border-amber-300 bg-amber-500/10 p-3.5 text-xs text-amber-900">
              <span className="font-black uppercase tracking-wider block text-[10px] text-amber-700">
                Inspector Custom Remarks & Instructions
              </span>
              <p className="font-medium mt-1 leading-relaxed">{damageDetails.customRemarks}</p>
            </div>
          )}

          {/* DAMAGED MATERIAL DETAILS & PHOTO EVIDENCE */}
          <div className="space-y-4">
            <h4 className="text-xs font-black uppercase text-foreground tracking-wider flex items-center justify-between">
              <span>Material Breakdown, Quarantine Lots & Photo Evidence</span>
              <span className="text-[10px] font-bold text-rose-600 bg-rose-500/10 px-2.5 py-0.5 rounded-full border border-rose-500/20">
                {damageDetails?.items.length || 0} Material Line(s)
              </span>
            </h4>

            <div className="space-y-4">
              {damageDetails?.items.map((item: any, idx: number) => {
                const photosToRender = (item.photos && Array.isArray(item.photos) && item.photos.length > 0)
                  ? item.photos.map((p: string, pIdx: number) => ({
                      evidenceId: `ev_${idx}_${pIdx}`,
                      fileName: `damage_evidence_${pIdx + 1}.jpg`,
                      filePath: p,
                    }))
                  : getPhotosForMaterial(item.material, item.itemCode);

                return (
                  <div key={idx} className="rounded-2xl border border-border/80 bg-card p-4 space-y-3 shadow-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
                      <div>
                        <span className="font-bold text-foreground text-sm block">
                          {item.material}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-medium">
                          Category: {item.category || "Raw Materials"} • Reason: <b className="text-rose-600">{item.reason}</b>
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {item.damageLotNumber && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-100 text-rose-800 border border-rose-300">
                            Lot: {item.damageLotNumber}
                          </span>
                        )}
                        {item.quarantineQrRef && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-muted text-foreground border">
                            <QrCode className="inline size-3 mr-1" />{item.quarantineQrRef}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* MATERIAL METRICS ROW */}
                    {item.orderedQty !== undefined && (
                      <div className="grid gap-2 sm:grid-cols-5 text-xs bg-muted/20 p-2.5 rounded-xl">
                        <div>
                          <span className="text-[10px] text-muted-foreground block">PO Qty</span>
                          <span className="font-bold">{item.orderedQty} {item.uom}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground block">Delivered</span>
                          <span className="font-bold">{item.currentReceivedQty} ({item.currentGoodQty} Good / <span className="text-rose-600">{item.currentDamagedQty} Dmg</span>)</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-amber-600 block">Pending Delivery</span>
                          <span className="font-bold text-amber-600">{item.pendingDeliveryQty} {item.uom}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-rose-600 block">Replacement Req.</span>
                          <span className="font-bold text-rose-600">{item.replacementRequiredQty} {item.uom}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-primary block">Acceptable Out.</span>
                          <span className="font-bold text-primary">{item.acceptableQtyOutstanding} {item.uom}</span>
                        </div>
                      </div>
                    )}

                    {/* PHOTO GALLERY */}
                    <div>
                      <span className="text-[10px] font-bold uppercase text-muted-foreground block mb-2">
                        Attached Photographic Proof ({photosToRender.length})
                      </span>
                      {photosToRender.length > 0 ? (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                          {photosToRender.map((photo: any, pIdx: number) => {
                            const filePath = photo.filePath || photo.file_path || "";
                            const fileName = photo.fileName || photo.file_name || `damage_photo_${pIdx + 1}.jpg`;
                            const fullUrl = filePath.startsWith("http") || filePath.startsWith("data:")
                              ? filePath
                              : `${BUSINESS_API_URL}${filePath.startsWith("/") ? "" : "/"}${filePath}`;

                            return (
                              <div
                                key={pIdx}
                                className="group relative cursor-pointer overflow-hidden rounded-xl border bg-muted/30 shadow-xs hover:border-rose-400 hover:shadow-md transition-all"
                                onClick={() => setEnlargedPhoto(fullUrl)}
                              >
                                <div className="aspect-4/3 w-full overflow-hidden bg-black/5 flex items-center justify-center">
                                  <img
                                    src={fullUrl}
                                    alt={fileName}
                                    className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                                    onError={(e) => {
                                      const target = e.target as HTMLImageElement;
                                      target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24' fill='none' stroke='%23e11d48' stroke-width='2'%3E%3Crect width='18' height='18' x='3' y='3' rx='2' ry='2'/%3E%3Ccircle cx='9' cy='9' r='2'/%3E%3Cpath d='m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'/%3E%3C/svg%3E";
                                    }}
                                  />
                                </div>
                                <div className="absolute inset-0 bg-rose-950/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white p-2 text-center gap-1">
                                  <Eye className="size-5 text-rose-200" />
                                  <span className="text-[10px] font-bold">View Picture</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 p-3 bg-muted/20 rounded-xl border border-dashed text-xs text-muted-foreground">
                          <Camera className="size-4 text-muted-foreground/50 shrink-0" />
                          <span>No photo evidence uploaded for this material during receiving inspection.</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* FOOTER */}
          <DialogFooter className="pt-4 border-t flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {damageDetails?.poNumber && (
                <Button
                  variant="outline"
                  className="rounded-xl font-bold text-xs"
                  onClick={() => {
                    setShowDamageModal(false);
                    window.location.href = `/purchase-order?po_number=${damageDetails.poNumber}`;
                  }}
                >
                  <ExternalLink className="mr-1.5 size-3.5" /> View Purchase Order ({damageDetails.poNumber})
                </Button>
              )}
              <Button
                variant="outline"
                className="rounded-xl font-bold text-xs"
                onClick={() => {
                  setShowDamageModal(false);
                  window.location.href = `/grn?tab=records`;
                }}
              >
                <FileText className="mr-1.5 size-3.5" /> Open GRN Console
              </Button>
            </div>

            <Button
              variant="default"
              className="rounded-xl font-bold px-6 text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={() => setShowDamageModal(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ✨ GRN & QUALITY NOTIFICATION DETAILS MODAL */}
      <Dialog open={showGrnModal} onOpenChange={setShowGrnModal}>
        <DialogContent className="max-w-4xl rounded-3xl p-6 space-y-6 max-h-[90vh] overflow-y-auto border shadow-2xl">
          {/* HEADER */}
          <DialogHeader className="border-b pb-4 flex flex-row items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-full text-xs font-black bg-primary/10 text-primary border border-primary/20 flex items-center gap-1.5 uppercase tracking-wider">
                  <FileText className="size-3.5" /> {grnDetails?.statusText || "GRN Details"}
                </span>
                {grnDetails?.grnNumber && (
                  <span className="px-2.5 py-0.5 rounded-md font-mono text-xs font-bold bg-muted text-foreground">
                    {grnDetails.grnNumber}
                  </span>
                )}
              </div>
              <DialogTitle className="text-xl font-black text-foreground mt-2">
                {selectedGrnNotif?.title || "GRN Notification Details"}
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Date & Time:{" "}
                <b className="text-foreground">
                  {selectedGrnNotif?.created_at
                    ? new Date(selectedGrnNotif.created_at).toLocaleString()
                    : new Date().toLocaleString()}
                </b>
              </p>
            </div>
          </DialogHeader>

          {/* DETAILS GRID */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 bg-muted/30 rounded-2xl p-4 border text-xs font-sans">
            {grnDetails?.grnNumber && (
              <div className="space-y-0.5">
                <span className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">
                  GRN Number
                </span>
                <span className="font-mono text-sm font-black text-primary block">
                  {grnDetails.grnNumber}
                </span>
              </div>
            )}

            {grnDetails?.poNumber && (
              <div className="space-y-0.5">
                <span className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">
                  PO Reference
                </span>
                <span className="font-mono text-sm font-bold text-foreground block">
                  {grnDetails.poNumber}
                </span>
              </div>
            )}

            {grnDetails?.supplierName && (
              <div className="space-y-0.5">
                <span className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">
                  Supplier Name
                </span>
                <span className="text-xs font-bold text-foreground block">
                  {grnDetails.supplierName}
                </span>
              </div>
            )}

            {grnDetails?.vehicleNumber && (
              <div className="space-y-0.5">
                <span className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider block">
                  Vehicle Number
                </span>
                <span className="font-mono text-xs font-bold text-foreground block">
                  {grnDetails.vehicleNumber}
                </span>
              </div>
            )}
          </div>

          {/* BALANCES KPI GRID IF PRESENT */}
          {grnDetails?.totals && (
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-xl border bg-muted/20 p-3">
                <span className="text-[10px] font-bold uppercase text-muted-foreground block">Total PO Ordered</span>
                <span className="font-mono text-lg font-black text-foreground">{grnDetails.totals.ordered_qty}</span>
              </div>
              <div className="rounded-xl border border-amber-300 bg-amber-500/10 p-3">
                <span className="text-[10px] font-bold uppercase text-amber-800 block">Pending Delivery Qty</span>
                <span className="font-mono text-lg font-black text-amber-700">{grnDetails.totals.pending_delivery_qty}</span>
              </div>
              <div className="rounded-xl border border-rose-300 bg-rose-500/10 p-3">
                <span className="text-[10px] font-bold uppercase text-rose-800 block">Replacement Required</span>
                <span className="font-mono text-lg font-black text-rose-700">{grnDetails.totals.replacement_required_qty}</span>
              </div>
              <div className="rounded-xl border border-primary/30 bg-primary-soft/10 p-3">
                <span className="text-[10px] font-bold uppercase text-primary block">Acceptable Outstanding</span>
                <span className="font-mono text-lg font-black text-primary">{grnDetails.totals.acceptable_qty_outstanding}</span>
              </div>
            </div>
          )}

          {/* MATERIAL LEVEL BREAKDOWN TABLE */}
          {grnDetails?.items && grnDetails.items.length > 0 && (
            <div className="space-y-2">
              <span className="text-[10px] font-black uppercase text-muted-foreground tracking-wider block">
                Material Reconciliation Breakdown ({grnDetails.items.length} items)
              </span>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/50 font-bold text-muted-foreground border-b uppercase">
                    <tr>
                      <th className="p-2.5">Material</th>
                      <th className="p-2.5 text-right">Ordered</th>
                      <th className="p-2.5 text-right">Received (Good / Dmg)</th>
                      <th className="p-2.5 text-right text-amber-600">Pending Delivery</th>
                      <th className="p-2.5 text-right text-rose-600">Replacement Req.</th>
                      <th className="p-2.5 text-right text-primary">Acceptable Out.</th>
                      <th className="p-2.5">Batch / QR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y font-medium">
                    {grnDetails.items.map((it: any, iIdx: number) => (
                      <tr key={iIdx} className="hover:bg-muted/10">
                        <td className="p-2.5">
                          <span className="font-bold text-foreground block">{it.material_name || it.item_code}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">{it.item_code}</span>
                        </td>
                        <td className="p-2.5 text-right font-bold">{it.ordered_qty} {it.uom}</td>
                        <td className="p-2.5 text-right">
                          <span className="font-bold text-success">{it.current_good_qty}</span> / <span className="font-bold text-destructive">{it.current_damaged_qty}</span>
                        </td>
                        <td className="p-2.5 text-right font-mono font-bold text-amber-600">{it.pending_delivery_qty}</td>
                        <td className="p-2.5 text-right font-mono font-bold text-rose-600">{it.replacement_required_qty}</td>
                        <td className="p-2.5 text-right font-mono font-bold text-primary">{it.acceptable_qty_outstanding}</td>
                        <td className="p-2.5 font-mono text-[10px]">
                          <div>Batch: {it.batch_number || "N/A"}</div>
                          {it.standard_qr_ref && <div className="text-teal-600">QR: {it.standard_qr_ref}</div>}
                          {it.quarantine_qr_ref && <div className="text-rose-600">Quarantine QR: {it.quarantine_qr_ref}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* MESSAGE BODY (FALLBACK / REMARKS) */}
          {(!grnDetails?.items || grnDetails.items.length === 0) && (
            <div className="rounded-2xl border bg-card p-4 space-y-1">
              <span className="text-[10px] font-black uppercase text-muted-foreground tracking-wider block">
                Notification Message
              </span>
              <p className="text-sm font-medium text-foreground whitespace-pre-line leading-relaxed">
                {selectedGrnNotif?.message}
              </p>
            </div>
          )}

          {/* FOOTER */}
          <DialogFooter className="pt-4 border-t flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {grnDetails?.poNumber && (
                <Button
                  variant="outline"
                  className="rounded-xl font-bold text-xs"
                  onClick={() => {
                    setShowGrnModal(false);
                    window.location.href = `/purchase-order?po_number=${grnDetails.poNumber}`;
                  }}
                >
                  <ExternalLink className="mr-1.5 size-3.5" /> View Purchase Order ({grnDetails.poNumber})
                </Button>
              )}
              <Button
                variant="outline"
                className="rounded-xl font-bold text-xs"
                onClick={() => {
                  setShowGrnModal(false);
                  window.location.href = "/grn?tab=records";
                }}
              >
                <FileText className="mr-1.5 size-3.5" /> Open GRN Records
              </Button>
            </div>

            <Button
              variant="default"
              className="rounded-xl font-bold text-xs px-6 bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={() => setShowGrnModal(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ENLARGED PHOTO LIGHTBOX MODAL IF CLICKED */}
      {enlargedPhoto && (
        <Dialog open={!!enlargedPhoto} onOpenChange={() => setEnlargedPhoto(null)}>
          <DialogContent className="max-w-2xl rounded-2xl p-4 bg-black/95 text-white border-none">
            <div className="flex justify-between items-center pb-2 border-b border-white/20">
              <span className="text-xs font-bold uppercase tracking-wider text-rose-400">
                Damage Photo Evidence
              </span>
              <button
                onClick={() => setEnlargedPhoto(null)}
                className="text-white/70 hover:text-white"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="mt-3 overflow-hidden rounded-xl bg-black flex items-center justify-center max-h-[70vh]">
              <img src={enlargedPhoto} alt="Enlarged damage evidence" className="max-h-[70vh] object-contain" />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </AppShell>
  );
}




