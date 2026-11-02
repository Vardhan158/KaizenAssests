import * as React from "react";
import { createFileRoute, redirect, useNavigate, useSearch } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Box,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Truck,
  UserRound,
  BarChart3,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import {
  getDefaultRouteForUser,
  getSafeRedirectPath,
  getUserInfo,
  isAuthenticated,
} from "@/lib/auth-utils";
import hero from "@/assets/login-warehouse.png";

export const Route = createFileRoute("/login")({
  beforeLoad: () => {
    if (typeof window !== "undefined" && isAuthenticated())
      throw redirect({ to: getDefaultRouteForUser(getUserInfo()) as any });
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as any;
  const redirectPath = getSafeRedirectPath(search.redirect || search.next);
  const magicToken = search.token;
  const [employeeId, setEmployeeId] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [rememberMe, setRememberMe] = React.useState(false);
  const [linkError, setLinkError] = React.useState<string | null>(null);
  const [verifyingMagicLink, setVerifyingMagicLink] = React.useState(false);
  React.useEffect(() => {
    if (!magicToken || isLoading || verifyingMagicLink) return;
    (async () => {
      setIsLoading(true);
      setVerifyingMagicLink(true);
      try {
        let data: any;
        if (magicToken.includes(".") || !magicToken.includes(":"))
          data = await api.magicLogin(magicToken);
        else {
          try {
            const [u, p] = atob(magicToken).split(":");
            data = await api.login(u, p);
          } catch {
            data = await api.magicLogin(magicToken);
          }
        }
        toast.success("Access link verified!");
        navigate({
          to: (data?.rfq_id
            ? `/submit-quotation?rfqId=${data.rfq_id}`
            : redirectPath || "/supplier-dashboard") as any,
        });
      } catch (e: any) {
        const msg = e?.message || "This access link is invalid or expired.";
        setLinkError(msg);
        toast.error(msg);
      } finally {
        setIsLoading(false);
        setVerifyingMagicLink(false);
      }
    })();
  }, [magicToken]);
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmployeeId = employeeId.trim();
    if (!normalizedEmployeeId || !password.trim()) {
      return toast.error("Please enter both Employee ID and password");
    }
    if (normalizedEmployeeId.length > 100 || password.length > 128) {
      return toast.error("Employee ID or password exceeds the allowed length");
    }
    setIsLoading(true);
    try {
      const data = await api.login(normalizedEmployeeId, password, rememberMe);
      toast.success(`Welcome back, ${data.username}!`);
      const target = new URL(redirectPath || getDefaultRouteForUser(data), window.location.origin);
      navigate({
        to: target.pathname as any,
        search: Object.fromEntries(target.searchParams) as any,
        hash: target.hash,
      });
    } catch (e: any) {
      toast.error(e.message || "Login failed. Please check your credentials.");
    } finally {
      setIsLoading(false);
    }
  };
  return (
    <main
      className="relative isolate block min-h-svh overflow-hidden bg-[#eef5fd] px-5 pt-7 pb-10 font-[Inter,Arial,sans-serif] text-[#03113b] min-[1000px]:min-h-[max(100svh,47.65vw)] min-[1000px]:p-0 before:pointer-events-none before:absolute before:top-[-35%] before:left-[29%] before:hidden before:h-[150%] before:w-[40%] before:rotate-[24deg] before:rounded-[48%] before:border-[24px] before:border-[#e8f3ff66] before:shadow-[-2px_2px_#85b9ff66] before:content-[''] min-[1000px]:before:block"
      style={{
        backgroundImage: `url(${hero})`,
        backgroundPosition: "center",
        backgroundSize: "cover",
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,#f7faffea_0%,#f1f6ffcf_23%,#e8f3ff78_34%,transparent_45%),linear-gradient(112deg,transparent_56%,#edf4ffb8_66%,#f5f8ffd0_100%)]" />
      <section className="static z-10 min-h-0 p-0">
        <header className="relative flex items-center gap-2.5 min-[1000px]:absolute min-[1000px]:top-[4%] min-[1000px]:left-[4%] min-[1000px]:gap-[.7vw]">
          <div className="text-[#1268ff] [&_svg]:size-11 [&_svg]:stroke-[2.3] min-[1000px]:[&_svg]:size-[2.7vw]">
            <Warehouse aria-hidden="true" />
          </div>
          <div>
            <div className="text-[26px] leading-[1.15] font-black tracking-[-.06vw] min-[1000px]:text-[1.6vw]">
              KaizenAssets
            </div>
            <div className="mt-[.25vw] ml-0.5 text-[9px] font-bold tracking-[3px] text-[#637694] min-[1000px]:text-[.6vw] min-[1000px]:tracking-[.2vw]">
              INDUSTRIAL SYSTEMS
            </div>
          </div>
        </header>
        <div className="relative mt-[38px] mb-[30px] max-w-[550px] min-[1000px]:absolute min-[1000px]:top-[15.8%] min-[1000px]:left-[4.6%] min-[1000px]:m-0 min-[1000px]:max-w-[33vw]">
          <p className="text-[10px] leading-[1.2] font-bold tracking-[2px] text-[#627696] min-[1000px]:text-[.76vw] min-[1000px]:tracking-[.18vw]">
            INTEGRATED WAREHOUSE OPERATIONS
          </p>
          <h1 className="mt-4 text-[46px] leading-[1.01] font-black tracking-[-1.5px] text-[#00113c] min-[1000px]:mt-[1.15vw] min-[1000px]:text-[3.85vw] min-[1000px]:tracking-[-.13vw]">
            Warehouse
            <br />
            Management
            <br />
            <span className="text-[#1d70f4]">Simplified.</span>
          </h1>
          <p className="mt-[18px] text-base leading-[1.34] text-[#65799b] min-[1000px]:mt-[1.3vw] min-[1000px]:w-[29vw] min-[1000px]:text-[1.14vw]">
            Real-time inventory tracking, intelligent dock management, and seamless supply chain
            workflows — all in one platform.
          </p>
          <div className="mt-6 flex w-full max-w-[460px] justify-between min-[1000px]:mt-[1.65vw] min-[1000px]:w-[28vw] min-[1000px]:max-w-[550px]">
            {[
              [Box, "Real-time", "Inventory"],
              [Truck, "Dock", "Management"],
              [BarChart3, "Operational", "Insights"],
              [ShieldCheck, "Secure &", "Reliable"],
            ].map(([Icon, a, b]: any) => (
              <div className="w-16 text-center min-[1000px]:w-[4.2vw]" key={a}>
                <div className="mx-auto flex size-[58px] items-center justify-center rounded-xl border border-[#c9dcf8] bg-[#e6efffe8] text-[#1168ed] shadow-sm [&_svg]:size-[30px] [&_svg]:stroke-[2.5] min-[1000px]:size-[4.1vw] min-[1000px]:rounded-[.9vw] min-[1000px]:[&_svg]:size-[2.15vw]">
                  <Icon size={34} />
                </div>
                <div className="mx-[-8px] mt-[9px] text-xs leading-[1.3] font-semibold min-[1000px]:mx-[-.8vw] min-[1000px]:mt-[.75vw] min-[1000px]:text-[.88vw]">
                  {a}
                  <br />
                  {b}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="absolute bottom-0 left-0 hidden h-[24%] w-[31%] pt-[4.8vw] pl-[4.3vw] text-[.69vw] leading-[1.9] font-bold tracking-[.28vw] text-[#b5d5ff] min-[1000px]:block before:absolute before:inset-0 before:-z-10 before:bg-[linear-gradient(115deg,#1970ee,#3289ff)] before:content-[''] before:[clip-path:polygon(0_0,86%_48%,93%_59%,96%_73%,100%_100%,0_100%)]">
          BUILDING
          <br />A MORE EFFICIENT
          <br />
          SUPPLY CHAIN FUTURE
        </div>
      </section>
      <section className="relative z-10 mx-auto block w-full max-w-[580px] min-[1000px]:absolute min-[1000px]:top-[10.15%] min-[1000px]:right-[3%] min-[1000px]:m-0 min-[1000px]:w-[38%] min-[1000px]:max-w-none">
        <div className="mb-3 flex flex-wrap items-center justify-end gap-x-4 gap-y-2 min-[1000px]:absolute min-[1000px]:right-0 min-[1000px]:bottom-full min-[1000px]:w-full">
          <div className="hidden items-center gap-[.8vw] text-[.67vw] font-semibold tracking-[.07vw] whitespace-nowrap text-[#607391] min-[1000px]:flex">
            PEOPLE&nbsp; | &nbsp;PROCESS&nbsp; | &nbsp;PRODUCTIVITY{" "}
            <span className="h-0.5 w-[2.4vw] bg-[#0d214d]" />
          </div>
          <button
            type="button"
            onClick={() => navigate({ to: "/" })}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[10px] border border-[#DFE7F0] bg-white px-4 text-sm font-semibold text-[#064B87] transition-colors hover:border-[#B3C8D9] hover:bg-[#EAF3FC] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0866B1]"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back to Home
          </button>
          </div>
        <div className="relative w-full rounded-3xl bg-[linear-gradient(145deg,#fff,#f6f9fe)] px-6 py-[30px] shadow-[0_1.4vw_3vw_#4785e029] min-[1000px]:min-h-[40.7vw] min-[1000px]:rounded-[1.3vw] min-[1000px]:pt-[2.8vw] min-[1000px]:pr-[3.2vw] min-[1000px]:pb-[1.9vw] min-[1000px]:pl-[4.4vw] before:pointer-events-none before:absolute before:top-0 before:right-0 before:h-[65px] before:w-[75px] before:rounded-tr-3xl before:bg-[#eaf2ff] before:content-[''] before:[clip-path:polygon(0_0,100%_0,100%_100%)] min-[1000px]:before:h-[6vw] min-[1000px]:before:w-[6.9vw] min-[1000px]:before:rounded-tr-[1.3vw] [&_input:focus-visible]:outline-2 [&_input:focus-visible]:outline-offset-[3px] [&_input:focus-visible]:outline-[#3180ff] [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-[3px] [&_button:focus-visible]:outline-[#3180ff]">
          <p className="text-xs leading-[1.2] font-bold tracking-[3px] text-[#1168ed] min-[1000px]:text-[.8vw] min-[1000px]:tracking-[.18vw]">
            WELCOME BACK
          </p>
          <h2 className="my-3 text-[32px] leading-[1.2] font-[850] tracking-[-1px] min-[1000px]:mt-[.8vw] min-[1000px]:mb-[.6vw] min-[1000px]:text-[2.1vw] min-[1000px]:tracking-[-.06vw]">
            Staff Login
          </h2>
          <p className="m-0 text-[15px] leading-[1.35] text-[#65789b] max-[999px]:[&_br]:hidden min-[1000px]:text-[.96vw]">
            Enter your credentials to access the KaizenAssets
            <br />
            management console.
          </p>
          {verifyingMagicLink && (
            <div className="mt-5 flex items-center gap-2 text-sm text-[#1168ed]">
              <Loader2 className="animate-spin" size={18} />
              Verifying secure access link...
            </div>
          )}
          {linkError && (
            <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{linkError}</p>
          )}
          <form onSubmit={handleLogin} className="mt-7 space-y-5 min-[1000px]:mt-[1.95vw]">
            <label className="mb-5 block text-sm leading-[1.3] font-semibold min-[1000px]:mb-[1.15vw] min-[1000px]:text-[.94vw]">
              Employee ID / Username
              <div className="border-[#c9ddff]! shadow-[0_0_3px_1px_#c9ddff]! mt-2 flex h-[50px] items-center rounded-[10px] border border-[#dae4f3] bg-[#e8f1ff] px-3 shadow-[0_1px_2px_#123b7220] min-[1000px]:mt-[.4vw] min-[1000px]:h-[2.9vw] min-[1000px]:rounded-[.7vw] min-[1000px]:px-[.85vw] [&_svg]:size-[21px] [&_svg]:shrink-0 min-[1000px]:[&_svg]:size-[1.25vw]">
                <UserRound size={22} />
                <input
                  className="ml-3 h-full min-w-0 w-full bg-transparent text-base font-normal outline-none placeholder:text-[#101725] placeholder:opacity-100 min-[1000px]:text-[.98vw]"
                  value={employeeId}
                  maxLength={100}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  placeholder="supplier"
                  required
                />
              </div>
            </label>
            <label className="mb-5 block text-sm leading-[1.3] font-semibold min-[1000px]:mb-[1.15vw] min-[1000px]:text-[.94vw]">
              <span className="flex justify-between">
                Password{" "}
                <button
                  type="button"
                  onClick={() =>
                    toast.info("Please contact your IT administrator to reset your password.")
                  }
                  className="text-[13px] font-normal text-[#1168ed] min-[1000px]:text-[.86vw]"
                >
                  Forgot password?
                </button>
              </span>
              <div className="mt-2 flex h-[50px] items-center rounded-[10px] border border-[#dae4f3] bg-[#e8f1ff] px-3 shadow-[0_1px_2px_#123b7220] min-[1000px]:mt-[.4vw] min-[1000px]:h-[2.9vw] min-[1000px]:rounded-[.7vw] min-[1000px]:px-[.85vw] [&_svg]:size-[21px] [&_svg]:shrink-0 min-[1000px]:[&_svg]:size-[1.25vw]">
                <LockKeyhole size={22} />
                <input
                  className="ml-3 h-full min-w-0 w-full bg-transparent text-base font-normal outline-none placeholder:text-[#101725] placeholder:opacity-100 min-[1000px]:text-[.98vw]"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  maxLength={128}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <Eye size={20} /> : <EyeOff size={20} />}
                </button>
              </div>
            </label>
            <label className="my-5 flex items-center gap-[9px] text-sm text-[#61718e] min-[1000px]:mt-[1.05vw] min-[1000px]:mb-[1.2vw] min-[1000px]:gap-[.55vw] min-[1000px]:text-[.9vw]">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="m-0 size-5 accent-[#1168ed] min-[1000px]:size-[1.2vw]"
              />
              Remember me on this device
            </label>
            <button
              disabled={isLoading}
              className="relative flex h-[54px] w-full items-center justify-center rounded-xl bg-[linear-gradient(160deg,#278eff,#0763ff_65%,#0545c0)] text-xl font-bold text-white shadow-[0_2px_3px_#1057b533] disabled:opacity-60 min-[1000px]:h-[3.1vw] min-[1000px]:rounded-[.8vw] min-[1000px]:text-[1.2vw] [&_svg]:w-[22px] min-[1000px]:[&_svg]:w-[1.3vw]"
            >
              {isLoading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="absolute right-5" size={24} />
                </>
              )}
            </button>
          </form>
          <p className="mt-7 text-center text-[10px] text-[#5d6f8d] min-[1000px]:mt-[1.85vw] min-[1000px]:text-[.72vw] min-[1000px]:whitespace-nowrap">
            <ShieldCheck className="mr-1 inline" size={15} />
            Use your assigned credentials to access your workspace.
          </p>
          <p className="mt-3 text-center text-[11px] text-[#1168ed] min-[1000px]:mt-[.65vw] min-[1000px]:text-[.72vw]">
            Terms of Service&nbsp; | &nbsp;Privacy Policy
          </p>
        </div>
      </section>
    </main>
  );
}
