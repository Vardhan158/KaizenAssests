import { useState } from "react";
import { CircleHelp, Lightbulb, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const steps = [
  {
    title: "Request materials",
    page: "Material Requests",
    description:
      "Choose the product, enter how many you want to produce, and select the required date.",
  },
  {
    title: "Receive from Warehouse",
    page: "Material Requests",
    description:
      "After Warehouse issues the materials, count them and confirm the actual quantity received. Resolve shortages before starting.",
  },
  {
    title: "Start production",
    page: "Production",
    description:
      "Open an order that is ready, start work, and record the actual finished quantity.",
  },
  {
    title: "Complete the quality check",
    page: "Quality Check",
    description:
      "An authorized inspector enters their name and inspection results. Passed, rejected, rework and held quantities must equal the produced quantity.",
  },
  {
    title: "Check available finished goods",
    page: "Finished Goods Records",
    description:
      "QC-passed goods appear here. Check available stock, batch details and the batch QR label.",
  },
  {
    title: "Prepare the supplier pickup",
    page: "FG Dispatch",
    description:
      "Open the request marked Next to Process. Verify pickup details and allocate stock. Scan the allocated batch QR, confirm picking and enter packing details.",
    note: "After Gate Entry, verify the supplier vehicle and driver, scan and load the goods. Gate Security completes Gate Exit.",
  },
];

export function AssemblyWorkflowHelp() {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl gap-1.5 text-xs text-primary"
          title="View the Assembly workflow"
        >
          <CircleHelp className="size-4" aria-hidden="true" />
          Assembly Guide
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={10}
        aria-labelledby="assembly-workflow-title"
        className="flex max-h-[min(80dvh,var(--radix-popover-content-available-height))] w-[480px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border-border/70 p-0 shadow-xl"
      >
        <div className="flex shrink-0 items-start gap-3 border-b bg-muted/30 p-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <CircleHelp className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 id="assembly-workflow-title" className="text-sm font-semibold">
              How Assembly works
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Follow the workflow from materials to dispatch.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 rounded-full text-muted-foreground"
            aria-label="Close workflow guide"
            onClick={() => setOpen(false)}
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4">
          <ol aria-label="Assembly workflow steps" className="space-y-3">
            {steps.map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1 border-b border-border/60 pb-3">
                  <h4 className="text-sm font-semibold leading-5">{step.title}</h4>
                  <p className="mt-0.5 text-[11px] font-medium text-primary">{step.page}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {step.description}
                  </p>
                  {step.note && (
                    <p className="mt-2 rounded-lg bg-muted/50 p-2 text-xs leading-relaxed text-muted-foreground">
                      {step.note}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <details className="mt-4 rounded-xl border border-amber-200/60 bg-amber-50/50 p-3 dark:border-amber-800/40 dark:bg-amber-950/20">
            <summary className="cursor-pointer text-xs font-semibold text-foreground">
              <Lightbulb className="mr-1.5 inline size-3.5 text-amber-600" aria-hidden="true" />
              Useful reminders
            </summary>
            <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
              <li>Check Needs Attention for shortages and blocked orders.</li>
              <li>Supplier pickup quantity can differ from the production quantity.</li>
              <li>
                Scan the batch allocated to the request, even if another batch has the same product.
              </li>
              <li>Reserved stock is held for a pickup. Stock is deducted only at Gate Exit.</li>
            </ul>
          </details>
        </div>
      </PopoverContent>
    </Popover>
  );
}
