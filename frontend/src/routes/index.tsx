import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { ArrowRight, CheckCircle2, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getDefaultRouteForUser, getUserInfo, isAuthenticated } from "@/lib/auth-utils";
import logoUrl from "@/assets/Logo.png";

// Keep the landing page's first paint independent from the heavy Three.js/WebGL
// journey. The interactive scene is loaded after the lightweight page shell.
const WarehouseJourney = lazy(() => import("@/components/journey/WarehouseJourney").then((module) => ({
  default: module.WarehouseJourney,
})));

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const navigate = useNavigate();
  const loggedIn = isAuthenticated();
  const userInfo = getUserInfo();
  const [isDarkMode, setIsDarkMode] = useState(false);

  const goToDashboard = () => {
    if (loggedIn) {
      navigate({ to: getDefaultRouteForUser(userInfo) as any });
    } else {
      navigate({ to: "/login" });
    }
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className={`relative min-h-screen font-sans transition-colors duration-300 ${isDarkMode ? "bg-slate-950 text-white selection:bg-cyan-500 selection:text-white" : "bg-white text-slate-900 selection:bg-cyan-600 selection:text-white"}`}>
      {/* Top Floating Glass Header */}
      <header className={`fixed top-0 left-0 right-0 z-50 border-b backdrop-blur-xl transition-colors duration-300 ${isDarkMode ? "border-white/10 bg-slate-950/75" : "border-slate-200 bg-white/80"}`}>
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <button
            type="button"
            onClick={goToDashboard}
            className="flex items-center gap-3.5 text-left group cursor-pointer focus:outline-none"
          >
            <div className="relative flex items-center justify-center h-11 px-3.5 rounded-2xl bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-indigo-500/10 border border-cyan-500/30 backdrop-blur-md shadow-[0_0_20px_rgba(6,182,212,0.25)] transition-all duration-300 group-hover:scale-105 group-hover:border-cyan-400/60 group-hover:shadow-[0_0_30px_rgba(6,182,212,0.5)]">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-sm -z-10" />
              <img
                src={logoUrl}
                alt="Kaizentrix Logo"
                className="h-8 w-auto object-contain drop-shadow-[0_2px_8px_rgba(6,182,212,0.45)]"
              />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="text-base font-black tracking-wider uppercase bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 dark:from-cyan-300 dark:via-blue-400 dark:to-indigo-300 bg-clip-text text-transparent">
                  KaizenX
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/15 border border-cyan-500/30 px-2 py-0.5 text-[9px] font-mono font-bold text-cyan-600 dark:text-cyan-300">
                  <span className="size-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  3D OS
                </span>
              </div>
              <span className="text-[10px] font-mono tracking-widest text-slate-500 dark:text-slate-400 uppercase font-bold mt-0.5">
                Kaizentrix Logistics OS
              </span>
            </div>
          </button>

          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              onClick={() => navigate({ to: "/login" })}
              className={`text-xs font-bold ${isDarkMode ? "text-white hover:bg-white/10" : "text-slate-700 hover:bg-slate-100"}`}
            >
              Sign In
            </Button>
            <Button
              onClick={goToDashboard}
              className="bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_20px_rgba(6,182,212,0.4)] rounded-xl text-xs font-black px-5 tracking-wider uppercase"
            >
              {loggedIn ? "Dashboard" : "Launch App"} <ArrowRight className="size-3.5 ml-1.5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main 3D Continuous Scroll-Controlled Warehouse Journey */}
      <main className="w-full">
        <Suspense
          fallback={
            <section className="relative flex h-screen w-full items-center justify-center overflow-hidden bg-slate-950">
              <div className="text-center">
                <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">
                  Loading logistics journey…
                </p>
              </div>
            </section>
          }
        >
          <WarehouseJourney />
        </Suspense>

        {/* Final Lifecycle Completion Screen */}
        <section
          id="journey-complete-screen"
          className={`relative min-h-screen w-full flex flex-col items-center justify-center px-6 py-32 text-center border-t transition-colors duration-300 ${isDarkMode ? "bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 border-white/10 text-white" : "bg-gradient-to-b from-slate-50 via-white to-slate-50 border-slate-200 text-slate-900"}`}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(6,182,212,0.18),transparent_70%)]" />
          <div className="relative z-10 max-w-4xl mx-auto space-y-8">
            <Badge className={`px-5 py-2 text-sm font-bold uppercase tracking-widest ${isDarkMode ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300" : "border-cyan-600/30 bg-cyan-50 text-cyan-700"}`}>
              <CheckCircle2 className="size-4 inline mr-2 text-cyan-600 dark:text-cyan-400" />
              Full Warehouse Lifecycle Complete
            </Badge>

            <h2 className={`text-4xl sm:text-7xl font-black tracking-tight ${isDarkMode ? "text-white" : "text-slate-950"}`}>
              EVERY MOVEMENT TRACKED
            </h2>

            <p className="text-xl sm:text-2xl font-bold text-cyan-600 dark:text-cyan-400 font-mono">
              Every material accounted for. Every operation connected.
            </p>

            <p className={`text-base max-w-2xl mx-auto leading-relaxed ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
              From security gate arrival and dock manifest inspection to automated forklift putaway, live inventory ledgers, robotic assembly, dispatch consolidation, and vehicle exit clearance.
            </p>

            <div className="pt-6 flex flex-wrap justify-center gap-4">
              <Button
                size="lg"
                onClick={goToDashboard}
                className="bg-cyan-600 hover:bg-cyan-500 text-white font-black rounded-2xl px-8 h-14 shadow-[0_0_25px_rgba(6,182,212,0.5)] text-base tracking-wider uppercase"
              >
                Enter WMS Dashboard <ArrowRight className="size-5 ml-2" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={scrollToTop}
                className={`font-bold rounded-2xl px-8 h-14 text-base ${isDarkMode ? "border-white/20 bg-white/5 text-white hover:bg-white/10" : "border-slate-300 bg-slate-100 text-slate-800 hover:bg-slate-200"}`}
              >
                Replay 3D Journey
              </Button>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className={`border-t py-10 text-center text-xs transition-colors duration-300 relative z-10 ${isDarkMode ? "border-white/10 bg-slate-950 text-slate-500" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
        <div className="mx-auto max-w-7xl px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© 2026 Kaizentrix Global Solutions. KaizenX Enterprise Logistics OS.</p>
          <p className="font-mono text-cyan-600 dark:text-cyan-500/60">Continuous 3D Logistics Lifecycle • Gate to Exit</p>
        </div>
      </footer>
    </div>
  );
}
