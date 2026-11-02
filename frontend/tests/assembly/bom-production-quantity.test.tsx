import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: any) => ({ options }), useNavigate: () => vi.fn(), useSearch: () => ({}) }));
vi.mock("@/components/wms/app-shell", () => ({ AppShell: ({ children, actions }: any) => <main>{actions}{children}</main> }));
vi.mock("@/lib/auth-utils", () => ({ requireRole: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client", () => ({ api: { getAssemblyMaterialRequests: vi.fn(), getAssemblyAvailableMaterials: vi.fn().mockResolvedValue([]), getAssemblyProducts: vi.fn(), getMaterialComponents: vi.fn(), getProductBOM: vi.fn(), createAssemblyMaterialRequest: vi.fn(), addProductBOMMaterial: vi.fn() } }));
import { Route } from "@/routes/assembly.material-requests";
import { api } from "@/lib/api-client";
const preview = (quantity: number) => ({ product_code: "FG-TEST", target_quantity: quantity, bom_number: "BOM-TEST", materials: [{ material_code: "MAT-100", material_name: "Pipe", quantity_per_unit: 100, required_quantity: quantity * 100, available_quantity: 100000, uom: "PCS" }] });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getAssemblyMaterialRequests).mockResolvedValue([]);
  vi.mocked(api.getAssemblyProducts).mockResolvedValue([{ id: "p1", product_code: "FG-TEST", product_name: "Test product" }] as any);
  vi.mocked(api.getMaterialComponents).mockResolvedValue([]);
  vi.mocked(api.getProductBOM).mockImplementation(async (_code, qty) => preview(qty!) as any);
  vi.mocked(api.createAssemblyMaterialRequest).mockResolvedValue({ request_number: "MR-TEST", product_name: "Test product", target_quantity: 100, uom: "PCS" } as any);
});
async function open() { const Page=Route.options.component as any; render(<Page />); fireEvent.click(await screen.findByRole("button",{name:"New Material Request"})); }
it("explains finished-product quantity and submits 100 without reverting to 10", async () => {
  await open(); expect(await screen.findByText("1000")).toBeInTheDocument();
  const input=screen.getByLabelText("Production Quantity (finished products) *");
  expect(screen.getByText(/Number of finished products to make/)).toBeInTheDocument();
  expect(screen.getByRole("columnheader",{name:"Qty per Product"})).toBeInTheDocument();
  fireEvent.change(input,{target:{value:"100"}}); expect(input).toHaveValue(100);
  expect(await screen.findByText("10000")).toBeInTheDocument();
  const submit=screen.getByRole("button",{name:"Submit Request to Warehouse"}); await waitFor(()=>expect(submit).toBeEnabled());
  fireEvent.click(submit);
  await waitFor(()=>expect(api.createAssemblyMaterialRequest).toHaveBeenCalledWith(expect.objectContaining({product_code:"FG-TEST",target_quantity:100})));
});
it("ignores a late response for the old production quantity", async () => {
  let resolveOld!: (value: any) => void;
  vi.mocked(api.getProductBOM).mockImplementation((_code,qty) => qty===10 ? new Promise(resolve=>{resolveOld=resolve;}) : Promise.resolve(preview(qty!) as any));
  await open(); await waitFor(()=>expect(resolveOld).toBeTypeOf("function"));
  fireEvent.change(screen.getByLabelText("Production Quantity (finished products) *"),{target:{value:"100"}});
  expect(await screen.findByText("10000")).toBeInTheDocument();
  await act(async()=>{resolveOld(preview(10));});
  expect(screen.getByText("10000")).toBeInTheDocument(); expect(screen.queryByText("1000")).not.toBeInTheDocument();
});

it("adds a material beside the preview and refreshes calculated requirements", async () => {
  vi.mocked(api.getAssemblyAvailableMaterials).mockResolvedValue([{ code:"MAT-ADD", material_code:"MAT-ADD", material_name:"Battery", available_quantity:1000, uom:"PCS" }] as any);
  vi.mocked(api.getMaterialComponents).mockResolvedValue([{code:"MAT-ADD",name:"Battery",uom:"PCS"}] as any);
  vi.mocked(api.addProductBOMMaterial).mockResolvedValue({material_code:"MAT-ADD",quantity_per_unit:2,uom:"PCS"});
  await open();await screen.findByText("1000");
  fireEvent.click(screen.getByRole("button",{name:"Add Material"}));
  expect(screen.getByRole("button",{name:"Submit Request to Warehouse"})).toBeDisabled();
  const material = screen.getByLabelText("Raw Material");
  await waitFor(() => expect(material).toBeEnabled());
  await screen.findByRole("option", { name: /MAT-ADD/ });
  fireEvent.change(material,{target:{value:"MAT-ADD"}});
  fireEvent.change(screen.getByLabelText("Qty per Product"),{target:{value:"2"}});
  vi.mocked(api.getProductBOM).mockImplementation(async (_code,qty) => ({...preview(qty!),materials:[...preview(qty!).materials,{material_code:"MAT-ADD",material_name:"Battery",quantity_per_unit:2,required_quantity:qty!*2,available_quantity:1000,uom:"PCS"}]} as any));
  fireEvent.click(screen.getByRole("button",{name:"Save Material"}));
  await waitFor(()=>expect(api.addProductBOMMaterial).toHaveBeenCalledWith("FG-TEST",{material_code:"MAT-ADD",quantity_per_unit:2}));
  expect(await screen.findByText("MAT-ADD")).toBeInTheDocument();expect(screen.getByText("20")).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"Save Material"})).not.toBeInTheDocument();
});
