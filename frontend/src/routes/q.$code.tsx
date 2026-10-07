import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Clock, AlertTriangle, ArrowRight, ShieldCheck, Warehouse } from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/q/$code")({
  component: ShortLinkResolver,
});

function ShortLinkResolver() {
  const { code } = Route.useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [isExpired, setIsExpired] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const resolveLink = async () => {
      if (!code) {
        if (isMounted) {
          setIsExpired(false);
          setErrorMessage("No quotation access code provided.");
          setLoading(false);
        }
        return;
      }

      try {
        const authData = await api.magicLogin(code);
        if (!isMounted) return;

        toast.success("Quotation link verified!");
        const target = authData?.rfq_id
          ? `/submit-quotation?rfqId=${authData.rfq_id}`
          : "/supplier-dashboard";

        setTimeout(() => {
          navigate({ to: target as any });
        }, 250);
      } catch (err: any) {
        if (!isMounted) return;
        console.error("Failed to resolve quotation link:", err);
        const raw = err?.message || err?.detail || "";
        const expired = raw.toLowerCase().includes("expired") || err?.status === 410;
        setIsExpired(expired);
        setErrorMessage(
          expired
            ? "This quotation invitation link has expired after 24 hours. For security, please contact the procurement team to request a new link."
            : (raw || "Invalid or unknown quotation access link.")
        );
        setLoading(false);
      }
    };

    void resolveLink();

    return () => {
      isMounted = false;
    };
  }, [code]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center shadow-2xl space-y-4">
          <div className="inline-flex size-14 rounded-2xl bg-blue-600/20 text-blue-400 items-center justify-center ring-8 ring-blue-500/10">
            <Loader2 className="size-7 animate-spin" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white tracking-tight">Verifying Quotation Link...</h2>
            <p className="text-sm text-slate-400">Authenticating your access code and loading your quotation form.</p>
          </div>
          <div className="pt-2 flex items-center justify-center gap-2 text-xs text-slate-500">
            <ShieldCheck className="size-4 text-emerald-400" />
            <span>24-Hour Secure Direct Access</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl space-y-6">
        <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
          <div className="flex size-10 items-center justify-center rounded-xl bg-blue-600 text-white font-black text-sm">
            <Warehouse className="size-5" />
          </div>
          <div>
            <div className="font-bold text-white text-base leading-none">KaizenX</div>
            <div className="text-xs text-slate-400 mt-1">Supplier Commercial Portal</div>
          </div>
        </div>

        <div className="space-y-3 text-center">
          <div className={`inline-flex size-14 rounded-2xl items-center justify-center ring-8 ${
            isExpired ? "bg-amber-500/20 text-amber-400 ring-amber-500/10" : "bg-rose-500/20 text-rose-400 ring-rose-500/10"
          }`}>
            {isExpired ? <Clock className="size-7" /> : <AlertTriangle className="size-7" />}
          </div>
          <h2 className="text-xl font-bold text-white">
            {isExpired ? "Quotation Link Expired" : "Access Link Error"}
          </h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            {errorMessage}
          </p>
        </div>

        {isExpired && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-300 leading-relaxed">
            For security purposes, quotation links automatically expire <strong>24 hours</strong> after issuance.
          </div>
        )}

        <div className="space-y-2 pt-2">
          <Button asChild className="w-full bg-blue-600 hover:bg-blue-500 font-semibold rounded-xl text-white">
            <Link to="/login">
              Return to Login <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
