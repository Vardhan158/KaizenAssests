import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

export function ModulePlaceholder({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <Card className="items-center gap-0 rounded-2xl border-dashed p-16 text-center shadow-none">
      <span className="grid size-16 place-items-center rounded-2xl bg-primary-soft text-primary">
        <Icon className="size-7" />
      </span>
      <p className="mt-5 text-base font-semibold">{title}</p>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button variant="outline" className="rounded-xl" asChild>
          <Link to="/warehouse-dashboard">Back to dashboard</Link>
        </Button>
        <Button className="rounded-xl shadow-glow" asChild>
          <Link to="/notifications">Go to arrivals</Link>
        </Button>
      </div>
    </Card>
  );
}
