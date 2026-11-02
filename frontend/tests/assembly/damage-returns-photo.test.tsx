import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: any) => ({ options }), useNavigate: () => vi.fn(), useSearch: () => ({}) }));
vi.mock("@/components/wms/app-shell", () => ({
  AppShell: ({ children }: any) => <main>{children}</main>,
  StatusBadge: ({ status }: any) => <span>{status}</span>,
}));
vi.mock("@/lib/auth-utils", () => ({ getUserInfo: () => ({ roles: ["SUPPLIER"] }) }));
vi.mock("@/lib/api-client", () => ({
  resolveMediaUrl: (path: string) => `https://example.test${path}`,
  api: { getDamageClaims: vi.fn().mockResolvedValue([
    { id: "claim-1", claim_number: "DC-001", status: "PENDING_RESPONSE", photos: [{ file_path: "/damage.jpg" }] },
  ]) },
}));
import { Route } from "@/routes/damage-claims";

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
beforeAll(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterAll(() => { HTMLElement.prototype.scrollIntoView = originalScrollIntoView; });

it("opens a damage-return photo and closes the preview with Escape and Close", async () => {
  const Page = Route.options.component as any;
  render(<Page />);
  const thumbnail = await screen.findByRole("button", { name: "View damage evidence 1 for DC-001" });
  fireEvent.click(thumbnail);
  expect(screen.getByRole("dialog", { name: "Damage Photo Evidence" })).toBeVisible();
  expect(screen.getByAltText("Enlarged damage evidence")).toHaveAttribute("src", "https://example.test/damage.jpg");
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(thumbnail);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByText("Your response *")).toBeVisible();
});

it("keeps response validation and both dropdown selections", async () => {
  const Page = Route.options.component as any;
  render(<Page />);
  await screen.findByRole("button", { name: "Submit Response" });
  fireEvent.click(screen.getByRole("button", { name: "Submit Response" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Select a response");
  const response = screen.getByRole("combobox", { name: "Your response *" });
  fireEvent.click(response);
  fireEvent.click(await screen.findByRole("option", { name: "Accept", exact: true }));
  expect(response).toHaveTextContent("Accept");
  fireEvent.click(screen.getByRole("button", { name: "Submit Response" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Select a resolution");
  const resolution = screen.getByRole("combobox", { name: "Resolution" });
  fireEvent.click(resolution);
  fireEvent.click(await screen.findByRole("option", { name: "Credit Note" }));
  expect(resolution).toHaveTextContent("Credit Note");
  fireEvent.click(response);
  fireEvent.click(await screen.findByRole("option", { name: "Select response" }));
  expect(response).toHaveTextContent("Select response");
});
