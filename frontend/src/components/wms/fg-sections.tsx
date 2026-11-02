import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { FgQrInput } from "./fg-qr-input";
import { toast } from "sonner";
import {
  CheckCircle2,
  Download,
  Printer,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Truck,
  X,
} from "lucide-react";

const EMPTY_SECTIONS: any[] = [];

export function FgSections({ sections = EMPTY_SECTIONS }: { sections?: any[] }) {
  const [images, setImages] = useState<Record<string, string>>({});
  const [scan, setScan] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all(sections.map(async (s) => [s.sub_id, await QRCode.toDataURL(s.qr_identity)])).then(
      (rows) => {
        if (active) setImages(Object.fromEntries(rows));
      },
    );
    return () => {
      active = false;
    };
  }, [sections]);
  if (!sections.length) return null;
  const dispatchedCount = sections.filter((section) => section.status === "DISPATCHED").length;
  const sectionStatus =
    dispatchedCount === 8 ? "FULLY DISPATCHED" : dispatchedCount ? "PARTIALLY DISPATCHED" : "READY";
  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card">
      <div className="flex flex-col gap-3 border-b bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            <QrCode className="size-4 text-primary" />
            FG transport sections
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Verify and manage the unique QR label for each transport section.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
            {sectionStatus}
          </span>
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            {dispatchedCount}/8 dispatched
          </span>
        </div>
      </div>

      <div className="space-y-5 p-5">
        <div className="rounded-xl border border-border/70 bg-muted/10 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4 text-primary" />
            Verify section QR
          </div>
          <div className="grid items-end gap-3 lg:grid-cols-[minmax(0,1fr)_110px]">
            <FgQrInput
              value={scan}
              onChange={setScan}
              label="Scan or enter the section QR identity"
              inputId="section-verify"
            />
            <Button
              className="h-11 rounded-xl"
              disabled={!scan.trim()}
              onClick={() =>
                toast[sections.some((s) => s.qr_identity === scan.trim()) ? "success" : "error"](
                  sections.some((s) => s.qr_identity === scan.trim())
                    ? "Section identity verified"
                    : "QR does not belong to this FG",
                )
              }
            >
              Verify
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {sections.map((s) => (
            <div
              key={s.sub_id}
              className="flex min-w-0 flex-col rounded-xl border border-border/70 bg-background p-4 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="truncate font-mono text-sm font-semibold text-foreground">
                  {s.sub_id}
                </p>
                <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                  {s.status}
                </span>
              </div>
              <div className="my-4 flex flex-1 items-center justify-center rounded-xl border bg-white p-3">
                {images[s.sub_id] ? (
                  <img
                    className="aspect-square w-full max-w-52 object-contain"
                    src={images[s.sub_id]}
                    alt={`QR ${s.sub_id}`}
                  />
                ) : (
                  <div className="aspect-square w-full max-w-52 animate-pulse rounded-lg bg-muted" />
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <a
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-input bg-background px-3 text-xs font-medium hover:bg-muted"
                  href={images[s.sub_id]}
                  download={`${s.sub_id}.png`}
                >
                  <Download className="size-3.5" /> Download
                </a>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 rounded-xl gap-1.5 text-xs"
                  onClick={() => {
                    const w = window.open("", "_blank");
                    if (w) {
                      const img = w.document.createElement("img");
                      img.src = images[s.sub_id] || "";
                      const title = w.document.createElement("p");
                      title.textContent = s.sub_id;
                      w.document.body.append(title, img);
                      img.onload = () => w.print();
                    }
                  }}
                >
                  <Printer className="size-3.5" /> Print
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FgLoading() {
  const [visits, setVisits] = useState<any[]>([]);
  const [loadingQrImages, setLoadingQrImages] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [currentScan, setCurrentScan] = useState<Record<string, string>>({});
  const [scans, setScans] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const load = () =>
    api
      .getFgLoading()
      .then((rows) => {
        setVisits(rows);
        setError("");
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    let active = true;
    const sections = visits.flatMap((visit) => visit.sections || []);
    Promise.all(
      sections.map(async (section: any) => [
        section.sub_id,
        await QRCode.toDataURL(section.qr_identity, { width: 320, margin: 2 }),
      ]),
    ).then((rows) => {
      if (active) setLoadingQrImages(Object.fromEntries(rows));
    });
    return () => {
      active = false;
    };
  }, [visits]);
  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
      <div className="flex flex-col gap-3 border-b border-border/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Truck className="size-5 text-primary" />
            FG loading
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Supplier vehicle registration → FG Gate Entry → Assembly loading → Gate Exit using the same Gate Pass. Vehicles appear here only after Gate Entry.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-2 rounded-xl"
          onClick={() => void load()}
        >
          <RefreshCw className="size-4" /> Refresh vehicles
        </Button>
      </div>
      <div className="space-y-5 p-5">
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {!error && !visits.length && (
          <div className="flex min-h-20 items-center justify-center gap-3 rounded-xl border border-dashed bg-muted/20 px-4 text-sm text-muted-foreground">
            <Truck className="size-5 opacity-60" />
            No arrived FG pickup vehicles.
          </div>
        )}
        {visits.map((v) => (
          <div
            key={v.gate_pass_number}
            className="space-y-6 overflow-hidden rounded-2xl border border-border/70 bg-background p-5 shadow-sm"
          >
            <p className="rounded-xl border bg-muted/20 p-4 font-semibold">
              {v.vehicle_number} · Gate Pass {v.gate_pass_number} · FG {v.main_fg_id || v.fg_id} ·{" "}
              {v.status}
            </p>
            <p className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              {v.dispatch_status} ({v.dispatched_sections}/8 dispatched)
            </p>
            {v.status === "READY_FOR_GATE_EXIT" && (
              <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
                <div>
                  <p className="text-sm font-semibold">Loading confirmed</p>
                  <p className="mt-1 text-xs text-emerald-800">
                    This vehicle is ready for Gate Security to verify the loaded section QR codes
                    and complete Gate Exit.
                  </p>
                </div>
              </div>
            )}
            <div>
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold">
                    {v.status === "INSIDE_FACILITY"
                      ? "Select transport sections"
                      : "Transport sections"}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {v.status === "INSIDE_FACILITY"
                      ? "Choose each section that will be loaded onto this vehicle."
                      : "Review the sections assigned to this finished good."}
                  </p>
                </div>
                {v.status === "INSIDE_FACILITY" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-fit rounded-xl"
                    disabled={
                      busy || !v.sections.some((section: any) => section.status === "AVAILABLE")
                    }
                    onClick={() =>
                      setSelected((prev) => ({
                        ...prev,
                        [v.gate_pass_number]: v.sections
                          .filter((section: any) => section.status === "AVAILABLE")
                          .map((section: any) => section.sub_id),
                      }))
                    }
                  >
                    Select all available
                  </Button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {v.sections.map((s: any) => (
                  <label
                    key={s.sub_id}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/30 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
                  >
                    <input
                      className="size-4 accent-primary"
                      type="checkbox"
                      disabled={s.status !== "AVAILABLE" || busy || v.status !== "INSIDE_FACILITY"}
                      checked={(selected[v.gate_pass_number] || []).includes(s.sub_id)}
                      onChange={(e) =>
                        setSelected((prev) => ({
                          ...prev,
                          [v.gate_pass_number]: e.target.checked
                            ? [...(prev[v.gate_pass_number] || []), s.sub_id]
                            : (prev[v.gate_pass_number] || []).filter((x) => x !== s.sub_id),
                        }))
                      }
                    />{" "}
                    {s.sub_id} · {s.status}
                  </label>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                {v.sections.map((section: any) => (
                  <a
                    key={`qr-${section.sub_id}`}
                    className="inline-flex h-9 items-center gap-2 rounded-xl border bg-background px-3 text-xs font-medium transition-colors hover:bg-muted"
                    href={loadingQrImages[section.sub_id] || undefined}
                    download={`${section.sub_id}-QR.png`}
                    aria-disabled={!loadingQrImages[section.sub_id]}
                    onClick={(event) => {
                      if (!loadingQrImages[section.sub_id]) event.preventDefault();
                    }}
                  >
                    <Download className="size-3.5" /> {section.sub_id} QR
                  </a>
                ))}
              </div>
            </div>
            {v.status === "INSIDE_FACILITY" && (
              <div className="rounded-2xl border bg-muted/10 p-4">
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <ShieldCheck className="size-4 text-primary" />
                      Verify selected section QR codes
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Scan each selected section once. Matching scans are added automatically.
                    </p>
                  </div>
                  <span className="w-fit rounded-full border bg-background px-3 py-1 text-xs font-semibold tabular-nums">
                    {(scans[v.gate_pass_number] || "").split("\n").filter(Boolean).length} /{" "}
                    {(selected[v.gate_pass_number] || []).length} verified
                  </span>
                </div>
                <div className="grid items-end gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <FgQrInput
                    value={currentScan[v.gate_pass_number] || ""}
                    inputId={`load-${v.gate_pass_number}`}
                    label="Scan or upload a selected section QR"
                    onChange={(value) => {
                      setCurrentScan((prev) => ({ ...prev, [v.gate_pass_number]: value }));
                      const normalized = value.trim();
                      const matchedSection = v.sections.find(
                        (section: any) => section.qr_identity === normalized,
                      );
                      if (!matchedSection) return;
                      if (!(selected[v.gate_pass_number] || []).includes(matchedSection.sub_id)) {
                        toast.error(`Select ${matchedSection.sub_id} before scanning its QR`);
                        return;
                      }
                      const existingScans = (scans[v.gate_pass_number] || "").split("\n");
                      if (existingScans.includes(normalized)) {
                        toast.error(`${matchedSection.sub_id} QR is already verified`);
                        return;
                      }
                      setScans((prev) => ({
                        ...prev,
                        [v.gate_pass_number]:
                          (prev[v.gate_pass_number] ? `${prev[v.gate_pass_number]}\n` : "") +
                          normalized,
                      }));
                      setCurrentScan((prev) => ({ ...prev, [v.gate_pass_number]: "" }));
                      toast.success(`${matchedSection.sub_id} QR verified`);
                    }}
                  />
                  <Button
                    variant="outline"
                    className="h-11 rounded-xl px-5"
                    disabled={!currentScan[v.gate_pass_number]?.trim() || busy}
                    onClick={() => {
                      const value = currentScan[v.gate_pass_number]?.trim();
                      if (!value) return;
                      const matchedSection = v.sections.find(
                        (section: any) => section.qr_identity === value,
                      );
                      if (!matchedSection) {
                        toast.error("This QR does not belong to the selected finished good");
                        return;
                      }
                      if (!(selected[v.gate_pass_number] || []).includes(matchedSection.sub_id)) {
                        toast.error(`Select ${matchedSection.sub_id} before verifying its QR`);
                        return;
                      }
                      const existingScans = (scans[v.gate_pass_number] || "").split("\n");
                      if (existingScans.includes(value)) {
                        toast.error(`${matchedSection.sub_id} QR is already verified`);
                        return;
                      }
                      setScans((prev) => ({
                        ...prev,
                        [v.gate_pass_number]:
                          (prev[v.gate_pass_number] ? `${prev[v.gate_pass_number]}\n` : "") + value,
                      }));
                      setCurrentScan((prev) => ({ ...prev, [v.gate_pass_number]: "" }));
                    }}
                  >
                    Verify entered QR
                  </Button>
                </div>
                <div className="mt-4">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Verified sections
                  </p>
                  {(scans[v.gate_pass_number] || "").split("\n").filter(Boolean).length ? (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {(scans[v.gate_pass_number] || "")
                        .split("\n")
                        .filter(Boolean)
                        .map((identity) => {
                          const section = v.sections.find(
                            (item: any) => item.qr_identity === identity,
                          );
                          return (
                            <div
                              key={identity}
                              className="flex min-w-0 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-900"
                            >
                              <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-mono text-xs font-semibold">
                                  {section?.sub_id || "Verified section"}
                                </p>
                                <p className="mt-0.5 truncate text-[10px] text-emerald-700">
                                  QR matched
                                </p>
                              </div>
                              <button
                                type="button"
                                className="rounded-md p-1 text-emerald-700 hover:bg-emerald-100"
                                aria-label={`Remove ${section?.sub_id || "verified QR"}`}
                                onClick={() =>
                                  setScans((prev) => ({
                                    ...prev,
                                    [v.gate_pass_number]: (prev[v.gate_pass_number] || "")
                                      .split("\n")
                                      .filter((item) => item && item !== identity)
                                      .join("\n"),
                                  }))
                                }
                              >
                                <X className="size-3.5" />
                              </button>
                            </div>
                          );
                        })}
                    </div>
                  ) : (
                    <div className="flex min-h-20 items-center justify-center rounded-xl border border-dashed bg-background px-4 text-center text-xs text-muted-foreground">
                      No section QR has been verified yet.
                    </div>
                  )}
                </div>
              </div>
            )}
            {v.status === "INSIDE_FACILITY" && (
              <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  Every selected section must have one matching verified QR.
                </p>
                <Button
                  className="h-11 shrink-0 rounded-xl px-6"
                  disabled={
                    busy ||
                    v.status !== "INSIDE_FACILITY" ||
                    !(selected[v.gate_pass_number] || []).length ||
                    (scans[v.gate_pass_number] || "").split("\n").filter(Boolean).length !==
                      (selected[v.gate_pass_number] || []).length
                  }
                  onClick={async () => {
                    const ids = (scans[v.gate_pass_number] || "")
                      .split("\n")
                      .map((x) => x.trim())
                      .filter(Boolean);
                    const chosen = selected[v.gate_pass_number] || [];
                    if (
                      !chosen.length ||
                      ids.length !== chosen.length ||
                      !chosen.every((id) =>
                        ids.includes(v.sections.find((s: any) => s.sub_id === id).qr_identity),
                      )
                    ) {
                      toast.error("Scan each selected section exactly once");
                      return;
                    }
                    setBusy(true);
                    try {
                      await api.confirmFgLoading(v.gate_pass_number, ids);
                      toast.success("Loading confirmed; sent to Gate Exit", {
                        description: `Gate Security can now process gate pass ${v.gate_pass_number}.`,
                      });
                      await load();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Loading failed");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Confirming loading…" : "Confirm loading & ready for Gate Exit"}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
