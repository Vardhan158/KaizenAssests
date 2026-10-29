import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { FgQrInput } from "./fg-qr-input";
import { toast } from "sonner";

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
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <h3 className="font-semibold">FG transport sections</h3>
      <p>
        {(() => {
          const count = sections.filter((s) => s.status === "DISPATCHED").length;
          return `${count === 8 ? "FULLY_DISPATCHED" : count ? "PARTIALLY_DISPATCHED" : "READY"} (${count}/8 dispatched)`;
        })()}
      </p>
      <FgQrInput
        value={scan}
        onChange={setScan}
        label="Verify section QR"
        inputId="section-verify"
      />
      <Button
        onClick={() =>
          toast[sections.some((s) => s.qr_identity === scan) ? "success" : "error"](
            sections.some((s) => s.qr_identity === scan)
              ? "Section identity verified"
              : "QR does not belong to this FG",
          )
        }
      >
        Verify
      </Button>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {sections.map((s) => (
          <div key={s.sub_id} className="rounded border p-2 text-sm">
            <p>{s.sub_id}</p>
            <p>{s.status}</p>
            <img src={images[s.sub_id]} alt={`QR ${s.sub_id}`} />
            <a href={images[s.sub_id]} download={`${s.sub_id}.png`}>
              Download
            </a>
            <Button
              variant="outline"
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
              Print
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function FgLoading() {
  const [visits, setVisits] = useState<any[]>([]);
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
  return (
    <section className="space-y-4 rounded-xl border p-4">
      <h2 className="text-lg font-semibold">FG Loading</h2>
      <p className="text-sm text-muted-foreground">Supplier vehicle registration → FG Gate Entry → Assembly loading → Gate Exit using the same Gate Pass. Vehicles appear here only after Gate Entry.</p>
      <Button variant="outline" onClick={() => void load()}>
        Refresh vehicles
      </Button>
      {error && <p role="alert">{error}</p>}
      {!error && !visits.length && <p>No arrived FG pickup vehicles.</p>}
      {visits.map((v) => (
        <div key={v.gate_pass_number} className="space-y-2 rounded border p-3">
          <p>
            {v.vehicle_number} · Gate Pass {v.gate_pass_number} · FG {v.main_fg_id || v.fg_id} ·{" "}
            {v.status}
          </p>
          <p>
            {v.dispatch_status} ({v.dispatched_sections}/8 dispatched)
          </p>
          {v.sections.map((s: any) => (
            <label key={s.sub_id} className="block">
              <input
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
          <FgQrInput
            value={currentScan[v.gate_pass_number] || ""}
            inputId={`load-${v.gate_pass_number}`}
            label="Scan selected section QRs (one per line)"
            onChange={(value) =>
              setCurrentScan((prev) => ({ ...prev, [v.gate_pass_number]: value }))
            }
          />
          <Button
            variant="outline"
            onClick={() => {
              const value = currentScan[v.gate_pass_number]?.trim();
              if (!value) return;
              setScans((prev) => ({
                ...prev,
                [v.gate_pass_number]:
                  (prev[v.gate_pass_number] ? `${prev[v.gate_pass_number]}\n` : "") + value,
              }));
              setCurrentScan((prev) => ({ ...prev, [v.gate_pass_number]: "" }));
            }}
          >
            Add verified scan
          </Button>
          <textarea
            aria-label="Verified section scans"
            value={scans[v.gate_pass_number] || ""}
            onChange={(e) =>
              setScans((prev) => ({ ...prev, [v.gate_pass_number]: e.target.value }))
            }
          />
          <Button
            disabled={busy || v.status !== "INSIDE_FACILITY"}
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
                toast.success("Loading confirmed; vehicle ready for Gate Exit");
                await load();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Loading failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirm loading and ready for Gate Exit
          </Button>
        </div>
      ))}
    </section>
  );
}
