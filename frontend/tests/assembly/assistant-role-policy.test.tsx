import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SecureAssistant } from "@/components/wms/secure-assistant";

const mocks = vi.hoisted(() => ({
  user: { roles: ["CUSTOM"] },
  capabilities: vi.fn(),
  chat: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/lib/auth-utils", () => ({ getUserInfo: () => mocks.user }));
vi.mock("@/lib/api-client", () => ({ api: {
  assistantCapabilities: mocks.capabilities,
  assistantChat: mocks.chat,
} }));
vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: "/inventory" }),
  useNavigate: () => mocks.navigate,
}));

beforeEach(() => {
  mocks.user.roles = ["CUSTOM"];
  Element.prototype.scrollIntoView = vi.fn();
  mocks.capabilities.mockResolvedValue({ role: "CUSTOM", categories: [], suggestions: ["What can you do?"], read_only: true });
});

it("uses authenticated server suggestions and does not offer warehouse links to an unknown role", async () => {
  render(<SecureAssistant />);
  fireEvent.click(screen.getByRole("button", { name: "Open KaizenAssests assistant" }));
  await waitFor(() => expect(mocks.capabilities).toHaveBeenCalledOnce());
  expect(await screen.findByRole("button", { name: /What can you do/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Warehouse dashboard" })).toBeNull();
});

it("replaces local suggestions with the server role policy", async () => {
  mocks.user.roles = ["GATE_SECURITY"];
  mocks.capabilities.mockResolvedValue({ role: "GATE_SECURITY", categories: ["docks"], suggestions: ["Show occupied docks"], read_only: true });
  render(<SecureAssistant />);
  fireEvent.click(screen.getByRole("button", { name: "Open KaizenAssests assistant" }));
  expect(await screen.findByRole("button", { name: /Show occupied docks/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Show available inventory/ })).toBeNull();
});
