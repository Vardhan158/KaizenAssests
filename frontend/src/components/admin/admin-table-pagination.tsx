import { Button } from "@/components/ui/button";

type AdminTablePaginationProps = {
  page: number;
  total: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
  pageSize?: number;
};

export function AdminTablePagination({ page, total, onPageChange, itemLabel = "items", pageSize = 10 }: AdminTablePaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
      <span>Showing {start}–{end} of {total} {itemLabel}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" className="h-8" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</Button>
        <span className="min-w-16 text-center">Page {page} of {pageCount}</span>
        <Button size="sm" variant="outline" className="h-8" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>Next</Button>
      </div>
    </div>
  );
}
