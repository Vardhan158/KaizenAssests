import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AssemblyRequisitionsPanel } from "@/components/wms/assembly-requisitions-panel";
import { api } from "@/lib/api-client";

vi.mock("@/lib/api-client", () => ({ api: {
  getAssemblyRequisitions: vi.fn().mockResolvedValue([{
    id: "req-1", requisition_number: "AR-001", status: "PENDING_WAREHOUSE_APPROVAL", items: [],
  }]),
  getAssemblyMaterialRequests: vi.fn().mockResolvedValue([]), getWarehouses: vi.fn().mockResolvedValue([]),
  approveAssemblyMaterialRequest: vi.fn().mockResolvedValue({}),
  rejectAssemblyMaterialRequest: vi.fn().mockResolvedValue({}),
  rejectAssemblyRequisition: vi.fn().mockResolvedValue({}),
} }));

it("refreshes the picking queue after approving a requisition on the same page", async () => {
  const refreshPicking = vi.fn();
  render(<AssemblyRequisitionsPanel onUpdated={refreshPicking} />);
  fireEvent.click(await screen.findByRole("button", { name: "Approve Request" }));
  await waitFor(() => expect(api.approveAssemblyMaterialRequest).toHaveBeenCalledWith("req-1"));
  await waitFor(() => expect(refreshPicking).toHaveBeenCalledOnce());
  expect(screen.getByRole("region", { name: "Assembly requisitions" })).toBeVisible();
});

it("keeps legacy requests visible alongside assembly requisitions", async () => {
  vi.mocked(api.getAssemblyMaterialRequests).mockResolvedValueOnce([{
    id: "legacy-1", request_number: "MR-001", status: "COMPLETED", items: [],
  }]);
  render(<AssemblyRequisitionsPanel />);
  expect(await screen.findByText("MR-001")).toBeVisible();
  expect(screen.getByText("AR-001")).toBeVisible();
});

it("rejects an Assembly material request through the material request endpoint", async () => {
  const prompt = vi.spyOn(window, "prompt").mockReturnValue("Insufficient stock");
  const updated = vi.fn();
  render(<AssemblyRequisitionsPanel onUpdated={updated} />);
  fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
  await waitFor(() => expect(api.rejectAssemblyMaterialRequest).toHaveBeenCalledWith("req-1", "Insufficient stock"));
  expect(api.rejectAssemblyRequisition).not.toHaveBeenCalled();
  await waitFor(() => expect(updated).toHaveBeenCalledOnce());
  prompt.mockRestore();
});

it("keeps the dedicated rejection endpoint for warehouse requisitions", async () => {
  vi.mocked(api.getAssemblyRequisitions).mockResolvedValueOnce([{
    id: "ar-2", requisition_number: "AR-002", status: "SUBMITTED", items: [],
  }]);
  const prompt = vi.spyOn(window, "prompt").mockReturnValue("Incorrect request");
  render(<AssemblyRequisitionsPanel />);
  fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
  await waitFor(() => expect(api.rejectAssemblyRequisition).toHaveBeenCalledWith("ar-2", "Incorrect request"));
  prompt.mockRestore();
});
