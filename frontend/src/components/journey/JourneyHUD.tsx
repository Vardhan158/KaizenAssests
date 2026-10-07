import type { JourneyStage } from "./data/journeyStages";

interface JourneyHUDProps {
  stages: JourneyStage[];
  activeIndex: number;
  scrollProgress: number;
  overviewProgress?: number;
  onSelectStage: (index: number) => void;
  onToggleTopView?: () => void;
}

export function JourneyHUD({
  stages,
  activeIndex,
  scrollProgress,
  overviewProgress = 1,
  onSelectStage,
  onToggleTopView,
}: JourneyHUDProps) {
  const currentStage = stages[activeIndex] || stages[0];
  const stageCount = stages.length;
  const isTopView = overviewProgress < 0.75;

  return (
    <nav
      aria-label="3D Journey Stage Navigation"
      className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center select-none pointer-events-auto"
    >
      {/* 1. Stage Number & Title Indicator */}
      <div className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-widest text-slate-300 mb-2">
        {onToggleTopView && (
          <button
            type="button"
            onClick={onToggleTopView}
            className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all cursor-pointer ${
              isTopView
                ? "bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.4)]"
                : "bg-white/5 border-white/15 text-slate-400 hover:text-white hover:border-white/30"
            }`}
            title={isTopView ? "Return to Gate Entry view" : "View warehouse front full view"}
          >
            {isTopView ? "Gate View ↓" : "Front View ↑"}
          </button>
        )}
        <span className="font-black text-cyan-400">
          {currentStage.number} / 0{stageCount}
        </span>
        <span className="text-white/30">•</span>
        <span className="font-bold text-white tracking-wider">
          {currentStage.title}
        </span>
      </div>

      {/* 2. Interactive Rail with Cyan Pip */}
      <div className="relative w-52 sm:w-68 h-6 flex items-center justify-between cursor-pointer group">
        {/* Base Rail */}
        <div className="absolute left-0 right-0 h-[2px] bg-white/15 rounded-full" />

        {/* Progress Fill */}
        <div
          className="absolute left-0 h-[2px] bg-gradient-to-r from-cyan-400 to-teal-300 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${(activeIndex / (stageCount - 1)) * 100}%` }}
        />

        {/* 7 Stage Landmark Tick Targets */}
        {stages.map((stage, idx) => {
          const isCurrent = idx === activeIndex;
          const isPassed = idx < activeIndex;

          return (
            <button
              key={stage.id}
              type="button"
              onClick={() => onSelectStage(idx)}
              className="relative z-10 size-4 flex items-center justify-center focus:outline-none group/node"
              aria-label={`Jump to stage ${stage.number}: ${stage.title}`}
            >
              <span
                className={`block rounded-full transition-all duration-300 ${
                  isCurrent
                    ? "size-3 bg-white border-2 border-cyan-400 shadow-[0_0_12px_#22d3ee] scale-125"
                    : isPassed
                    ? "size-1.5 bg-cyan-400/80 group-hover/node:scale-125"
                    : "size-1.5 bg-white/30 group-hover/node:bg-white/60 group-hover/node:scale-125"
                }`}
              />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
