import { ArrowRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import type { JourneyStage } from "./data/journeyStages";

interface DetailReaderProps {
  stages: JourneyStage[];
  activeIndex: number;
}

export function DetailReader({ stages, activeIndex }: DetailReaderProps) {
  return (
    <div className="absolute inset-0 pointer-events-none z-30 flex items-center justify-between px-6 sm:px-12 lg:px-24">
      {stages.map((stage, idx) => {
        const isActive = idx === activeIndex;
        const isLeft = stage.alignment === "left";
        const isPast = idx < activeIndex;

        return (
          <div
            key={stage.id}
            className={`absolute top-1/2 -translate-y-1/2 w-full max-w-lg lg:max-w-xl transition-all duration-700 ease-out will-change-transform ${
              isLeft ? "left-6 sm:left-12 lg:left-24" : "right-6 sm:right-12 lg:right-24"
            } ${
              isActive
                ? "opacity-100 translate-x-0 pointer-events-auto"
                : isPast
                ? isLeft
                  ? "opacity-0 -translate-x-16 pointer-events-none"
                  : "opacity-0 translate-x-16 pointer-events-none"
                : isLeft
                ? "opacity-0 -translate-x-12 pointer-events-none"
                : "opacity-0 translate-x-12 pointer-events-none"
            }`}
          >
            {/* 1. Chapter Eyebrow & Number */}
            <div className="flex items-center gap-3 mb-2">
              <span className="font-mono text-xs uppercase tracking-widest text-cyan-400 font-bold">
                {stage.number} / {stage.chapter}
              </span>
              <span className="h-px w-10 bg-cyan-400/40" />
            </div>

            {/* 2. Large Editorial Stage Title (No Box / No Card) */}
            <h2 className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight text-white leading-[1.04] select-none filter drop-shadow-[0_2px_14px_rgba(0,0,0,0.9)]">
              {stage.title}
            </h2>

            {/* 3. Core Headline Philosophy */}
            <p className="mt-3 text-lg sm:text-xl font-medium text-teal-300 font-mono tracking-tight drop-shadow">
              "{stage.headline}"
            </p>

            {/* 4. Descriptive Summary */}
            <p className="mt-4 text-sm sm:text-base text-slate-200 leading-relaxed font-normal max-w-md drop-shadow">
              {stage.description}
            </p>

            {/* 5. In-Scene Floating Augmented Telemetry */}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {stage.telemetry.map((t) => (
                <div
                  key={t.label}
                  className="px-2.5 py-1 rounded bg-slate-900/80 border border-cyan-500/25 text-[10px] font-mono text-slate-300 backdrop-blur-sm"
                >
                  <span className="text-slate-400 mr-1.5">{t.label}:</span>
                  <strong className="text-cyan-300 font-bold">{t.value}</strong>
                </div>
              ))}
            </div>

            {/* 6. Metrics Text Row (Strictly No Metric Cards) */}
            <div className="mt-7 pt-5 border-t border-white/15 grid grid-cols-3 gap-5 max-w-md">
              {stage.metrics.map((m) => (
                <div key={m.label} className="space-y-0.5">
                  <p className="font-mono text-lg sm:text-2xl font-black text-white tracking-tight drop-shadow">
                    {m.value}
                  </p>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400 leading-tight">
                    {m.label}
                  </p>
                </div>
              ))}
            </div>

            {/* 7. Action Button linking directly to authentic existing route */}
            <div className="mt-8 flex items-center gap-4">
              <Link to={stage.route as any} className="focus:outline-none">
                <Button className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono font-bold text-xs uppercase tracking-widest px-8 h-12 rounded-xl shadow-[0_0_24px_rgba(6,182,212,0.45)] hover:shadow-[0_0_36px_rgba(6,182,212,0.65)] transition-all group cursor-pointer">
                  {stage.actionLabel}
                  <ArrowRight className="size-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
