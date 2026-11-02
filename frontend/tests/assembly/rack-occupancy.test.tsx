import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RackOccupancyCards } from "@/components/wms/rack-occupancy-cards";
import { api } from "@/lib/api-client";
import QRCode from "qrcode";
vi.mock("@/lib/api-client", () => ({ api: {
  getRackMaterials: vi.fn(), updateRackCapacity: vi.fn(), emptyRack: vi.fn(), moveRackMaterial: vi.fn(), getRackHistory: vi.fn(), deleteRack: vi.fn(),
} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,cmFjaw==") } }));
const rack = { id: "rack1", rack_code: "RACK-001", maximum_capacity: 80, occupied_quantity: 60, available_capacity: 20, occupancy_percentage: 75, occupancy_status: "Partially Occupied" };
const bin = { id: "bin1", zone_id: "zone1", rack: "RACK-001", bin_code: "ZONE-001-BIN-001", qr_identifier: "QR-ZONE-001-BIN-001", rack_capacity: rack };
const updated = vi.fn(); const add = vi.fn();
function page() { return render(<RackOccupancyCards bins={[bin]} allBins={[bin]} onAddMaterial={add} onUpdated={updated} />); }
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getRackHistory).mockResolvedValue([]);
  vi.mocked(api.getRackMaterials).mockResolvedValue({ ...rack, materials: [{ balance_id: "bal1", material_name: "Steel", material_code: "MAT-001", batch_number: "BATCH-1", quantity: 60, uom: "PCS", material_qr: "QR-BATCH-1", rack_qr: bin.qr_identifier }] });
});
it("shows persisted occupancy and an accessible progress bar", () => {
  page(); expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");
  expect(screen.getByText("Partially Occupied")).toBeInTheDocument(); expect(screen.getByText("20 PCS")).toBeInTheDocument();
});
it("opens existing putaway workflow through Add Material", () => { page(); fireEvent.click(screen.getByRole("button", { name: "Add Material" })); expect(add).toHaveBeenCalledOnce(); });
it("loads batch quantities and saved QR references from backend", async () => {
  page(); fireEvent.click(screen.getByRole("button", { name: "View Details" }));
  expect(await screen.findByText("BATCH-1")).toBeInTheDocument(); expect(screen.getByText("QR-BATCH-1")).toBeInTheDocument();
  expect(api.getRackMaterials).toHaveBeenCalledWith("zone1", "rack1");
});
it("prevents reducing capacity below real occupancy", async () => {
  page(); fireEvent.click(screen.getByRole("button", { name: "View Details" }));
  await screen.findByText("BATCH-1"); fireEvent.click(screen.getByRole("button", { name: "Edit Capacity" }));
  expect(screen.queryByLabelText(/Reason/)).not.toBeInTheDocument();
  const input = await screen.findByLabelText(/Maximum Capacity/); fireEvent.change(input, { target: { value: "50" } });
 fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Maximum capacity cannot be less than current occupancy"); expect(api.updateRackCapacity).not.toHaveBeenCalled();
});


it("does not duplicate racks with multiple legacy bins", () => {
  render(<RackOccupancyCards bins={[bin, { ...bin, id: "bin2" }]} allBins={[bin]} onAddMaterial={add} onUpdated={updated} />);
  expect(screen.getAllByRole("progressbar")).toHaveLength(1);
});

it("offers deletion but disables it while the rack is occupied", () => {
  page(); const card = screen.getByRole("article", { name: "Rack RACK-001" });
  expect(within(card).getAllByRole("button").map(b => b.textContent)).toEqual(["Add Material", "View Details", "Delete Rack"]);
  expect(within(card).getByRole("button", { name: "Delete Rack" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Edit Capacity" })).not.toBeInTheDocument();
});
it("confirms deletion of an empty rack and refreshes the cards", async () => {
  const emptyBin = { ...bin, rack_capacity: { ...rack, occupied_quantity: 0, available_capacity: 80, occupancy_percentage: 0, occupancy_status: "Empty" } };
  vi.mocked(api.deleteRack).mockResolvedValue({ deleted: true });
  render(<RackOccupancyCards bins={[emptyBin]} allBins={[emptyBin]} onAddMaterial={add} onUpdated={updated} />);
  fireEvent.click(screen.getByRole("button", { name: "Delete Rack" }));
  expect(api.deleteRack).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete Rack" }));
  await waitFor(() => expect(api.deleteRack).toHaveBeenCalledWith("zone1", "rack1"));
  await waitFor(() => expect(updated).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
});
it("shows rack, zone, materials, QR and transaction history together", async () => {
  vi.mocked(api.getRackHistory).mockResolvedValue([{ id: 1, quantity_delta: 60, reason: "Putaway MAT-001 / BATCH-1", actor: "Warehouse Manager", created_at: "2026-10-21T10:00:00Z" }]);
  render(<RackOccupancyCards bins={[{ ...bin, position: "SHELF-001" }]} allBins={[bin]} zone={{ zone_code: "ZONE-001", zone_name: "Raw Materials" }} onAddMaterial={add} onUpdated={updated} />);
  fireEvent.click(screen.getByRole("button", { name: "View Details" }));
  expect(await screen.findByText("BATCH-1")).toBeInTheDocument();
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("SHELF-001")).toBeInTheDocument(); expect(within(dialog).getByText("Raw Materials")).toBeInTheDocument();
  expect(await within(dialog).findByText("Putaway MAT-001 / BATCH-1")).toBeInTheDocument();
  for (const name of ["Edit Capacity", "View QR", "Download QR", "Print QR"]) expect(within(dialog).getByRole("button", { name })).toBeInTheDocument();
});
it("warns about unconfigured capacity without invented occupancy", async () => {
  render(<RackOccupancyCards bins={[{ ...bin, rack_capacity: undefined }]} allBins={[bin]} onAddMaterial={add} onUpdated={updated} />);
  expect(screen.getByText("Capacity unavailable")).toBeInTheDocument(); expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add Material" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "View Details" }));
  expect((await screen.findAllByRole("alert")).map(a => a.textContent).join(" ")).toContain("Rack capacity is unavailable or not configured");
  expect(screen.queryByText("Rack is empty.", { exact: false })).not.toBeInTheDocument(); expect(api.getRackMaterials).not.toHaveBeenCalled();
});
it("does not report a failed inventory request as an empty rack", async () => {
  vi.mocked(api.getRackMaterials).mockRejectedValueOnce(new Error("Unable to load rack inventory"));
  page(); fireEvent.click(screen.getByRole("button", { name: "View Details" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load rack inventory");
  expect(screen.queryByText("Rack is empty.", { exact: false })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit Capacity" })).toBeDisabled();
});
it("reports unavailable history separately from available inventory", async () => {
  vi.mocked(api.getRackHistory).mockRejectedValueOnce(new Error("History could not be loaded"));
  page(); fireEvent.click(screen.getByRole("button", { name: "View Details" }));
  expect(await screen.findByText("BATCH-1")).toBeInTheDocument(); expect(await screen.findByRole("alert")).toHaveTextContent("History could not be loaded");
  expect(screen.queryByText("No rack transactions have been recorded.")).not.toBeInTheDocument();
});
it("downloads the persisted rack QR and expands its preview inside details", async () => {
  let link: HTMLAnchorElement | undefined;
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function(this: HTMLAnchorElement) { link = this; });
  page(); fireEvent.click(screen.getByRole("button", { name: "View Details" }));
  const view = await screen.findByRole("button", { name: "View QR" }); await waitFor(() => expect(view).toBeEnabled());
  fireEvent.click(view); expect(view).toHaveAttribute("aria-expanded", "true");
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(QRCode.toDataURL).toHaveBeenCalledWith(bin.qr_identifier, expect.any(Object));
  fireEvent.click(screen.getByRole("button", { name: "Download QR" }));
  expect(link?.download).toBe("RACK-001-ZONE-001-BIN-001.png"); expect(link?.href).toBe("data:image/png;base64,cmFjaw=="); click.mockRestore();
});
it("prints the same QR only after the print image loads", async () => {
  const doc = document.implementation.createHTMLDocument(); const popup = { document: doc, focus: vi.fn(), print: vi.fn(), close: vi.fn() };
  const open = vi.spyOn(window, "open").mockReturnValue(popup as any);
  page(); fireEvent.click(screen.getByRole("button", { name: "View Details" }));
  const print = await screen.findByRole("button", { name: "Print QR" }); await waitFor(() => expect(print).toBeEnabled()); fireEvent.click(print);
  expect(doc.body.textContent).toContain(bin.qr_identifier); expect(popup.print).not.toHaveBeenCalled();
  doc.querySelector("img")!.dispatchEvent(new Event("load")); expect(popup.print).toHaveBeenCalledOnce(); open.mockRestore();
});
it("returns to refreshed details after saving without closing the modal", async () => {
  vi.mocked(api.updateRackCapacity).mockResolvedValue({});
  page(); fireEvent.click(screen.getByRole("button", { name: "View Details" })); await screen.findByText("BATCH-1");
  fireEvent.click(screen.getByRole("button", { name: "Edit Capacity" }));
  fireEvent.change(screen.getByLabelText(/Maximum Capacity/), { target: { value: "100" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(api.getRackMaterials).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("BATCH-1")).toBeInTheDocument(); expect(screen.getByRole("dialog")).toBeVisible(); expect(updated).toHaveBeenCalled();
});

it("treats missing capacity numbers as unavailable rather than zero", () => {
  render(<RackOccupancyCards bins={[{ ...bin, rack_capacity: { ...rack, occupied_quantity: null as any } }]} allBins={[bin]} onAddMaterial={add} onUpdated={updated} />);
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument(); expect(screen.getByText("Capacity unavailable")).toBeInTheDocument(); expect(screen.queryByText("0 PCS")).not.toBeInTheDocument();
});

it("returns to details instead of offering to repeat a saved stock operation when card refresh fails", async () => {
  vi.mocked(api.updateRackCapacity).mockResolvedValue({}); updated.mockRejectedValueOnce(new Error("Refresh unavailable"));
  page(); fireEvent.click(screen.getByRole("button", { name: "View Details" })); await screen.findByText("BATCH-1"); fireEvent.click(screen.getByRole("button", { name: "Edit Capacity" }));
  fireEvent.change(screen.getByLabelText(/Maximum Capacity/), { target: { value: "100" } }); fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(api.getRackMaterials).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("BATCH-1")).toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument(); expect(api.updateRackCapacity).toHaveBeenCalledOnce();
});

it("keeps only Edit Capacity in rack management", async () => {
  page(); fireEvent.click(screen.getByRole("button", { name: "View Details" }));
  await screen.findByText("BATCH-1");
  const management=screen.getByRole("region",{name:"Rack management"});
  expect(within(management).getAllByRole("button")).toHaveLength(1);
  expect(within(management).getByRole("button",{name:"Edit Capacity"})).toBeEnabled();
  for(const name of ["Pick / Remove","Transfer","Empty Rack"]) expect(screen.queryByRole("button",{name})).not.toBeInTheDocument();
});
