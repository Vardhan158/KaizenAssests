import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowRight, Info, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function StatCard({
  label,
  value,
  delta,
  icon: Icon,
  tone = "primary",
  to,
  showArrow = false,
  compact = false,
  infoTooltip,
}: {
  label: string;
  value: string;
  delta?: string;
  icon: LucideIcon;
  tone?: "primary" | "teal" | "success" | "warning" | "danger";
  to?: string;
  showArrow?: boolean;
  compact?: boolean;
  infoTooltip?: string;
}) {
  const tones: Record<string, string> = {
    primary: "bg-primary-soft text-primary",
    teal: "bg-teal-soft text-teal",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning-foreground",
    danger: "bg-danger-soft text-destructive",
  };
  const cardContent = (
    <Card
      className={cn(
        "flex h-full flex-col gap-0 rounded-2xl border-border/70 shadow-soft transition-all duration-300 group-hover:-translate-y-0.5 group-hover:shadow-lift",
        compact ? "min-h-24 justify-center p-4" : "min-h-36 p-4",
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn("grid size-9 place-items-center rounded-xl", tones[tone])}>
          <Icon className="size-4" />
        </span>
        {to && showArrow && (
          <ArrowRight className="size-3 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
        )}
      </div>
      <p
        className={cn(
          "font-bold tracking-tight tabular-nums",
          compact ? "mt-2 text-xl" : "mt-3 text-2xl",
        )}
      >
        {value}
      </p>
      <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
        <p className="text-xs font-medium text-muted-foreground truncate">{label}</p>
        {infoTooltip && (
          <TooltipProvider>
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`Info: ${label}`}
                  className="inline-flex items-center justify-center rounded-full text-muted-foreground/60 hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring p-0.5 cursor-help transition-colors shrink-0"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  <Info className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                {infoTooltip}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      {!compact && (
        <p
          className={cn(
            "mt-1.5 min-h-4 text-[10px] font-semibold text-muted-foreground/80",
            !delta && "invisible",
          )}
          aria-hidden={!delta}
        >
          {delta || "No additional detail"}
        </p>
      )}
    </Card>
  );

  if (to) {
    return (
      <Link to={to} className="group block h-full">
        {cardContent}
      </Link>
    );
  }
  return <div className="group block h-full">{cardContent}</div>;
}

export function Field({
  label,
  value,
  mono,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="size-3 text-muted-foreground" />}
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      </div>
      <div className={cn("mt-1 truncate text-sm font-medium", mono && "font-mono tracking-tight")}>
        {value}
      </div>
    </div>
  );
}

export function SectionCard({
  title,
  description,
  icon: Icon,
  actions,
  children,
  className,
  infoTooltip,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  infoTooltip?: string;
}) {
  return (
    <Card className={cn("gap-0 rounded-2xl border-border/70 p-0 shadow-soft", className)}>
      <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-5 py-4">
        {Icon && (
          <span className="grid size-9 place-items-center rounded-xl bg-primary-soft text-primary">
            <Icon className="size-[18px]" />
          </span>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
            {infoTooltip && (
              <TooltipProvider>
                <Tooltip delayDuration={200}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Info: ${title}`}
                      className="inline-flex items-center justify-center rounded-full text-muted-foreground/60 hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring p-0.5 cursor-help transition-colors"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    >
                      <Info className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    {infoTooltip}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      <div className="p-5">{children}</div>
    </Card>
  );
}

export function Timeline({
  items,
}: {
  items: { time: string; title: string; detail: string; tone?: string }[];
}) {
  const tones: Record<string, string> = {
    primary: "bg-primary",
    teal: "bg-teal",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-destructive",
  };
  return (
    <ol className="relative space-y-5 border-l border-dashed border-border pl-6">
      {items.map((i, idx) => (
        <li key={idx} className="animate-fade-up" style={{ animationDelay: `${idx * 60}ms` }}>
          <span
            className={cn(
              "absolute -left-[5px] mt-1.5 size-2.5 rounded-full ring-4 ring-background",
              tones[i.tone ?? "primary"],
            )}
          />
          <div className="flex flex-wrap items-baseline gap-x-3">
            <p className="text-sm font-medium">{i.title}</p>
            <span className="font-mono text-[11px] text-muted-foreground">{i.time}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{i.detail}</p>
        </li>
      ))}
    </ol>
  );
}

export function StepRail({ current }: { current: number }) {
  const steps = [
    { n: 1, label: "Gate Entry", to: "/gate-entry" },
    { n: 2, label: "Vehicle", to: "/vehicle-verification" },
    { n: 3, label: "Driver", to: "/driver-verification" },
    { n: 4, label: "Vendor & PO", to: "/purchase-order" },
    { n: 5, label: "Accept", to: "/accept-arrival" },
    { n: 6, label: "Dock", to: "/dock-assignment" },
    { n: 7, label: "Dock Mgmt", to: "/dock-management" },
  ];
  return (
    <div className="mb-6 flex items-center gap-1 overflow-x-auto rounded-2xl border border-border/70 bg-card p-2 shadow-soft">
      {steps.map((s, i) => {
        const done = s.n < current;
        const active = s.n === current;
        return (
          <div key={s.n} className="flex shrink-0 items-center">
            <Link
              to={s.to}
              className={cn(
                "flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-colors",
                active && "bg-primary-soft text-primary",
                done && "text-success hover:bg-success-soft",
                !active && !done && "text-muted-foreground hover:bg-accent",
              )}
            >
              <span
                className={cn(
                  "grid size-5 place-items-center rounded-full text-[10px] font-semibold",
                  active && "bg-primary text-primary-foreground",
                  done && "bg-success text-success-foreground",
                  !active && !done && "bg-muted text-muted-foreground",
                )}
              >
                {done ? "✓" : s.n}
              </span>
              {s.label}
            </Link>
            {i < steps.length - 1 && <span className="mx-0.5 h-px w-4 bg-border" />}
          </div>
        );
      })}
    </div>
  );
}
