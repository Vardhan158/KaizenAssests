import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getFgLoading: vi.fn(),
  confirmFgLoading: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ api: mocks }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,section") },
}));
vi.mock("@/components/wms/fg-qr-input", () => ({
  FgQrInput: ({ value, onChange, label }: any) => (
    <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
import { FgLoading, FgSections } from "@/components/wms/fg-sections";
const sections = Array.from({ length: 8 }, (_, i) => ({
  sub_id: `FG-0001-S0${i + 1}`,
  qr_identity: `unique-${i + 1}`,
  status: "AVAILABLE",
}));

describe("FG transport sections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFgLoading.mockResolvedValue([
      {
        gate_pass_number: "ABC123",
        vehicle_number: "KA02AH2755",
        fg_id: "fg-1",
        status: "INSIDE_FACILITY",
        sections,
        dispatched_sections: 0,
        dispatch_status: "READY",
      },
    ]);
    mocks.confirmFgLoading.mockResolvedValue({ status: "READY_FOR_GATE_EXIT" });
  });
  it("renders eight QR labels and verifies exact section identity", async () => {
    render(<FgSections sections={sections} />);
    expect(await screen.findAllByRole("img")).toHaveLength(8);
    await waitFor(() =>
      expect(screen.getAllByRole("link", { name: "Download" })[0]).toHaveAttribute(
        "href",
        "data:image/png;base64,section",
      ),
    );
    fireEvent.change(screen.getByLabelText("Scan or enter the section QR identity"), { target: { value: "unique-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(mocks.success).toHaveBeenCalledWith("Section identity verified");
    fireEvent.change(screen.getByLabelText("Scan or enter the section QR identity"), {
      target: { value: "material-qr" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(mocks.error).toHaveBeenCalled();
  });
  it("shows a migration blocker without claiming the vehicle queue is empty", async () => {
    mocks.getFgLoading.mockRejectedValue(new Error("FG section workflow requires database migrations through 20261037_fg_section_numbering"));
    render(<FgLoading />);
    expect(await screen.findByRole("alert")).toHaveTextContent("20261037_fg_section_numbering");
    expect(screen.queryByText("No arrived FG pickup vehicles.")).not.toBeInTheDocument();
    expect(mocks.confirmFgLoading).not.toHaveBeenCalled();
  });
  it("requires the QR for each selected section before confirming loading", async () => {
    render(<FgLoading />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /FG-0001-S01/ }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm loading/ }));
    expect(mocks.confirmFgLoading).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Scan or upload a selected section QR"), {
      target: { value: "unique-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Confirm loading/ }));
    await waitFor(() =>
      expect(mocks.confirmFgLoading).toHaveBeenCalledWith("ABC123", ["unique-1"]),
    );
  });
});
