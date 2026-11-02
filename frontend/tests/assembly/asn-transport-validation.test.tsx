import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  isValidAsnVehicleNumber, normalizeAsnVehicleNumber,
  isValidAsnDriverName, isValidAsnDriverMobileNumber, sanitizeAsnDriverName,
} from "@/lib/input-validation";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: any) => ({ options }),
  useSearch: () => ({}),
}));
vi.mock("@/components/wms/app-shell", () => ({ AppShell: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/lib/auth-utils", () => ({ getUserInfo: () => ({ username: "supplier", supplierId: "sup-1" }) }));
vi.mock("@/lib/api-client", () => ({ api: {
  getAsns: vi.fn().mockResolvedValue([]), getDrivers: vi.fn().mockResolvedValue([]),
  getMaterials: vi.fn().mockResolvedValue([]), getSupplier: vi.fn().mockResolvedValue({ supplier_name: "Supplier" }),
  getNextAsnNumber: vi.fn().mockResolvedValue({ asnNumber: "ASN-TEST-001" }),
} }));
import { Route } from "@/routes/supplier.asns.new";

describe("ASN transport validation", () => {
  it.each(["KA02AH2755", "KA-02-AH-2755", "KA 02 AH 2755", "TN09AB1234", "22BH1234AA", "ka02ah2755"])("accepts %s", (value) => {
    expect(isValidAsnVehicleNumber(value)).toBe(true);
  });
  it.each(["", "123456", "KA02AH275", "KA@02AH2755", "22BH1234A"])("rejects invalid plate %s", (value) => {
    expect(isValidAsnVehicleNumber(value)).toBe(false);
  });
  it("normalizes separators and case", () => expect(normalizeAsnVehicleNumber("ka-02 ah-2755")).toBe("KA02AH2755"));
  it.each(["Kavya", "R. Kumar", "D'Souza", "Anne-Marie", "A".repeat(100)])("accepts name %s", (value) => {
    expect(isValidAsnDriverName(value)).toBe(true);
  });
  it.each(["", "A", "1234", "Ram2", "....", "Ram@Kumar", "A".repeat(101)])("rejects name %s", (value) => {
    expect(isValidAsnDriverName(value)).toBe(false);
  });
  it("removes digits and unsupported characters from driver names", () => {
    expect(sanitizeAsnDriverName("Ravi123 Kumar5")).toBe("Ravi Kumar");
    expect(sanitizeAsnDriverName("Ravi@Kumar")).toBe("RaviKumar");
  });
  it.each(["", "1234567890", "987654321", "98765432100", "98765a43210", "+919876543210"])("rejects contact %s", (value) => {
    expect(isValidAsnDriverMobileNumber(value)).toBe(false);
  });
  it("accepts an Indian mobile", () => expect(isValidAsnDriverMobileNumber("9876543210")).toBe(true));

  it("shows only one Add Vehicle & Driver button in the assignment modal", async () => {
    const Page = Route.options.component as any;
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: /create asn/i }));
    await screen.findByLabelText("Vehicle Number *");
    expect(screen.getAllByRole("button", { name: "Add Vehicle & Driver" })).toHaveLength(1);
  });

  it("does not allow digits in the driver name field", async () => {
    const Page = Route.options.component as any;
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: /create asn/i }));
    const driver = await screen.findByLabelText("Driver Name *");
    fireEvent.change(driver, { target: { value: "Ravi123 Kumar5" } });
    expect(driver).toHaveValue("Ravi Kumar");
  });

  it("shows inline errors and preserves transport details through Details and Back", async () => {
    const Page = Route.options.component as any;
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: /create asn/i }));
    const dialog = screen.getByRole("dialog");
    const vehicle = await within(dialog).findByLabelText("Vehicle Number *");
    const driver = within(dialog).getByLabelText("Driver Name *");
    const contact = within(dialog).getByLabelText("Driver Contact *");
    const next = within(dialog).getByRole("button", { name: "Next" });
    expect(next).toBeDisabled();
    fireEvent.change(driver, { target: { value: "123" } });
    fireEvent.blur(driver);
    expect(screen.getByText("Driver name is required.")).toBeVisible();
    fireEvent.change(vehicle, { target: { value: "ka-02-ah-2755" } });
    fireEvent.change(driver, { target: { value: "R. D'Souza" } });
    fireEvent.change(contact, { target: { value: "987654321" } });
    fireEvent.blur(contact);
    expect(next).toBeDisabled();
    expect(screen.getByText(/10-digit Indian mobile/)).toBeVisible();
    fireEvent.change(contact, { target: { value: "abc98765-432100xyz" } });
    expect(contact).toHaveValue("9876543210");
    expect(contact).toHaveAttribute("maxlength", "10");
    expect(next).toBeEnabled();
    fireEvent.click(next);
    await waitFor(() => expect(screen.getByText("KA02AH2755")).toBeVisible());
    expect(screen.getByText("R. D'Souza")).toBeVisible();
    expect(screen.getByText("9876543210")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByLabelText("Vehicle Number *")).toHaveValue("KA02AH2755");
    expect(screen.getByLabelText("Driver Name *")).toHaveValue("R. D'Souza");
    expect(screen.getByLabelText("Driver Contact *")).toHaveValue("9876543210");
  });
});
