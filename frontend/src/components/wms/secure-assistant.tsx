import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  Boxes,
  Building2,
  ChevronRight,
  ClipboardList,
  LayoutDashboard,
  Loader2,
  PackageCheck,
  RotateCcw,
  Send,
  Settings,
  ShieldCheck,
  Truck,
  X,
} from "lucide-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { api, type AssistantChatMessage } from "@/lib/api-client";
import { getUserInfo } from "@/lib/auth-utils";

const defaultSuggestedQuestions = [
  "Show today’s inbound arrivals",
  "Show available inventory",
  "Show pending putaway tasks",
  "Explain the GRN workflow",
  "How does FIFO picking work?",
  "Explain damaged material claims",
  "Show active assembly orders",
  "Show dispatch status",
  "How many zones, bins, and docks are configured?",
];

const roleSuggestedQuestions: Record<string, string[]> = {
  ADMIN: ["Show today's inbound arrivals", "Show available inventory", "Show active assembly orders", "Show dispatch status", "What can you do?"],
  WAREHOUSE: ["Show available inventory", "Show pending putaway tasks", "Show today's inbound arrivals", "Where is material MAT-001?", "How many zones, bins, and docks are configured?"],
  GATE_SECURITY: ["Show today's inbound arrivals", "Show the vehicle queue", "Which docks are available?", "Show dispatches ready for gate out", "Explain vehicle check-in and check-out"],
  GRN: ["Show arrivals waiting for receiving", "Show open purchase orders", "Explain the GRN workflow", "Show pending putaway tasks", "Explain damaged material handling"],
  STORE_MANAGER: ["Show available inventory", "Show pending putaway tasks", "Where is material MAT-001?", "Explain FIFO picking", "Show warehouse zones and bins"],
  ASSEMBLY_MANAGER: ["Show active assembly orders", "Show material availability", "Explain material requests", "Show production progress", "Explain finished goods handover"],
  DISPATCH_MANAGER: ["Show dispatch status", "Show outbound orders", "Explain picking and packing", "Explain loading and gate out", "Show available inventory"],
  SUPPLIER: ["Show my purchase orders", "Show my inbound ASN status", "Explain ASN creation", "Explain damaged material claims", "Explain finished goods pickup"],
};

const roleAliases: Record<string, string> = {
  SUPERUSER: "ADMIN", SUPER_ADMIN: "ADMIN", ADMIN_OFFICER: "ADMIN",
  WAREHOUSE_MANAGER: "WAREHOUSE", STORE_KEEPER: "STORE_MANAGER",
  STORE_OPERATOR: "STORE_MANAGER", ASSEMBLY: "ASSEMBLY_MANAGER",
  DISPATCH: "DISPATCH_MANAGER",
};

function getSuggestedQuestions() {
  const roles = getUserInfo()?.roles || [];
  for (const rawRole of roles) {
    const role = rawRole.toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
    const suggestions = roleSuggestedQuestions[role] || roleSuggestedQuestions[roleAliases[role]];
    if (suggestions) return suggestions;
  }
  return defaultSuggestedQuestions;
}

const roleModules: Record<string, { label: string; links: { label: string; to: string }[] }> = {
  WAREHOUSE: {
    label: "Warehouse",
    links: [
      { label: "Warehouse dashboard", to: "/warehouse-dashboard" },
      { label: "Inventory", to: "/inventory" },
      { label: "Putaway tasks", to: "/putaway-tasks" },
      { label: "Zones & bins", to: "/inventory?tab=locations" },
      { label: "Dock management", to: "/dock-management" },
    ],
  },
  WAREHOUSE_MANAGER: {
    label: "Warehouse",
    links: [
      { label: "Warehouse dashboard", to: "/warehouse-dashboard" },
      { label: "Inventory", to: "/inventory" },
      { label: "Putaway tasks", to: "/putaway-tasks" },
      { label: "Zones & bins", to: "/inventory?tab=locations" },
      { label: "Dock management", to: "/dock-management" },
    ],
  },
  STORE_MANAGER: {
    label: "Store",
    links: [
      { label: "My store", to: "/my-store" },
      { label: "Inventory", to: "/inventory" },
      { label: "Putaway tasks", to: "/putaway-tasks" },
    ],
  },
  ADMIN: {
    label: "Administration",
    links: [
      { label: "Admin dashboard", to: "/admin" },
      { label: "User management", to: "/admin/users" },
      { label: "Suppliers", to: "/admin/suppliers" },
      { label: "Inventory", to: "/inventory" },
    ],
  },
  SUPPLIER: {
    label: "Supplier",
    links: [
      { label: "Supplier dashboard", to: "/supplier-dashboard" },
      { label: "ASN management", to: "/supplier/asns" },
      { label: "FG dispatch requests", to: "/supplier/dispatch" },
      { label: "Damage claims", to: "/damage-claims" },
    ],
  },
  GATE_SECURITY: {
    label: "Gate Security",
    links: [
      { label: "Gate dashboard", to: "/gate-dashboard" },
      { label: "Vehicle entry & exit", to: "/vehicle-queue" },
      { label: "FG pickup entry & exit", to: "/gate/finished-goods-pickup" },
    ],
  },
  GRN: {
    label: "GRN / Receiving",
    links: [
      { label: "GRN dashboard", to: "/grn?tab=dashboard" },
      { label: "Create GRN", to: "/grn?tab=wizard" },
      { label: "GRN history", to: "/grn?tab=records" },
      { label: "Dock management", to: "/dock-management" },
    ],
  },
  ASSEMBLY_MANAGER: {
    label: "Assembly",
    links: [
      { label: "Assembly dashboard", to: "/assembly-dashboard" },
      { label: "Material requests", to: "/assembly/material-requests" },
      { label: "Production", to: "/assembly/production" },
      { label: "Quality check", to: "/assembly/quality" },
    ],
  },
  DISPATCH_MANAGER: {
    label: "Dispatch",
    links: [
      { label: "Dispatch orders", to: "/dispatch-orders" },
      { label: "Picking & packing", to: "/dispatch-picking-packing" },
      { label: "Loading", to: "/dispatch-loading" },
      { label: "Gate out", to: "/dispatch-gate-out" },
    ],
  },
};

function getModule() {
  const roles = getUserInfo()?.roles || [];
  const aliases: Record<string, string> = {
    SUPERUSER: "ADMIN",
    SUPER_ADMIN: "ADMIN",
    GATE_OPERATOR: "GATE_SECURITY",
    GRN_MANAGER: "GRN",
    RECEIVING: "GRN",
    ASSEMBLY: "ASSEMBLY_MANAGER",
    DISPATCH: "DISPATCH_MANAGER",
    STORE_KEEPER: "STORE_MANAGER",
  };
  return (
    roles.map((role) => roleModules[role] || roleModules[aliases[role]]).find(Boolean) ||
    roleModules.WAREHOUSE
  );
}

function getShortcutIcon(label: string) {
  if (/dashboard/i.test(label)) return LayoutDashboard;
  if (/inventory|material/i.test(label)) return Boxes;
  if (/putaway/i.test(label)) return PackageCheck;
  if (/dock|inbound/i.test(label)) return Truck;
  if (/zone|bin|store/i.test(label)) return Building2;
  if (/setting/i.test(label)) return Settings;
  if (/request/i.test(label)) return ClipboardList;
  return Boxes;
}

function getShortcutTone(label: string) {
  if (/dashboard/i.test(label)) return "bg-blue-100 text-blue-700 group-hover:bg-blue-200";
  if (/inventory|material/i.test(label))
    return "bg-emerald-100 text-emerald-700 group-hover:bg-emerald-200";
  if (/putaway/i.test(label)) return "bg-amber-100 text-amber-700 group-hover:bg-amber-200";
  if (/dock|inbound/i.test(label)) return "bg-orange-100 text-orange-700 group-hover:bg-orange-200";
  if (/zone|bin|store/i.test(label))
    return "bg-indigo-100 text-indigo-700 group-hover:bg-indigo-200";
  if (/setting/i.test(label)) return "bg-slate-200 text-slate-700 group-hover:bg-slate-300";
  return "bg-violet-100 text-violet-700 group-hover:bg-violet-200";
}

export function SecureAssistant() {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const module = useMemo(getModule, [location.pathname]);
  const suggestedQuestions = useMemo(getSuggestedQuestions, [location.pathname]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (open) {
      scrollToBottom();
    }
  }, [open, messages, loading, error]);

  const go = (to: string) => {
    setOpen(false);
    void navigate({ to: to as any });
  };

  const handleSend = async (messageToSend?: string, customHistory?: AssistantChatMessage[]) => {
    const text = (messageToSend ?? query).trim();
    if (!text || loading) return;

    setError(null);
    const history = customHistory ?? messages;
    const newMessages: AssistantChatMessage[] = [...history, { role: "user", content: text }];
    setMessages(newMessages);
    if (!messageToSend) {
      setQuery("");
    }
    setLoading(true);

    try {
      const response = await api.assistantChat(text, history);
      setMessages([...newMessages, { role: "assistant", content: response.reply }]);
    } catch (err: any) {
      const errorMsg =
        err?.message ||
        "The assistant service is currently unavailable. Please verify your connection or try again.";
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const retryLast = () => {
    if (messages.length === 0) return;
    const lastUserIdx = [...messages].reverse().findIndex((m) => m.role === "user");
    if (lastUserIdx === -1) return;
    const actualIdx = messages.length - 1 - lastUserIdx;
    const lastUserMsg = messages[actualIdx];
    const prevHistory = messages.slice(0, actualIdx);
    void handleSend(lastUserMsg.content, prevHistory);
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
    setQuery("");
  };

  return (
    <>
      <button
        type="button"
        suppressHydrationWarning
        aria-label="Open KaizenAssests assistant"
        title="KaizenAssests Assistant"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-lg shadow-blue-900/20 transition duration-200 hover:-translate-y-0.5 hover:shadow-xl"
      >
        <Bot className="size-5" />
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/25 backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
        >
          <section
            role="dialog"
            aria-label="KaizenAssests Assistant"
            onClick={(event) => event.stopPropagation()}
            className="absolute bottom-4 right-4 flex h-[min(690px,calc(100vh-32px))] w-[min(440px,calc(100vw-32px))] flex-col overflow-hidden rounded-[26px] border border-blue-100 bg-white shadow-[0_24px_80px_-24px_rgba(15,23,42,0.45)]"
          >
            <header className="flex items-center justify-between border-b border-white/15 bg-gradient-to-r from-blue-700 via-blue-600 to-indigo-700 px-4 py-3.5 text-white">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl border border-white/20 bg-white/15 shadow-inner">
                  <Bot className="size-5" />
                </span>
                <div>
                  <p className="text-sm font-bold tracking-tight">KaizenAssests Assistant</p>
                  <p className="flex items-center gap-1.5 text-[11px] text-blue-100">
                    <span className="size-1.5 rounded-full bg-emerald-300" />
                    {module.label} workspace · Read-only help
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    type="button"
                    aria-label="Clear chat history"
                    title="Clear chat history"
                    onClick={clearChat}
                    className="grid size-8 place-items-center rounded-lg text-white transition-colors hover:bg-white/15"
                  >
                    <RotateCcw className="size-4" />
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Close assistant"
                  onClick={() => setOpen(false)}
                  className="grid size-8 place-items-center rounded-lg text-white transition-colors hover:bg-white/15"
                >
                  <X className="size-4" />
                </button>
              </div>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto bg-gradient-to-b from-slate-50/90 via-white to-blue-50/30 p-4 text-sm">
              {messages.length === 0 ? (
                <div className="space-y-5">
                  <div className="relative overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-4 shadow-sm">
                    <div
                      aria-hidden="true"
                      className="absolute -right-8 -top-8 size-28 rounded-full bg-blue-100/60"
                    />
                    <div className="relative flex items-start gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-900/20">
                        <Bot className="size-4" />
                      </span>
                      <div>
                        <p className="font-semibold tracking-tight text-slate-900">
                          How can I help?
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-600">
                          Ask about stock, zones and bins, receiving, putaway, assembly, or
                          dispatch. I can look up records you’re allowed to see and explain common
                          workflows.
                        </p>
                      </div>
                    </div>
                    <div className="relative mt-3 flex items-center gap-1.5 text-[11px] font-medium text-blue-800">
                      <ShieldCheck className="size-3.5" /> Permission-aware · Read-only
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                      Try asking
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {suggestedQuestions.map((suggestion) => (
                        <button
                          type="button"
                          key={suggestion}
                          onClick={() => void handleSend(suggestion)}
                          disabled={loading}
                          className="rounded-full border border-blue-100 bg-white px-3 py-1.5 text-left text-[11px] font-medium text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800 disabled:opacity-50"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2.5 flex items-center justify-between">
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                        {module.label} shortcuts
                      </p>
                      <span className="text-[11px] text-slate-400">Quick access</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {module.links.map((link) => {
                        const Icon = getShortcutIcon(link.label);
                        const tone = getShortcutTone(link.label);
                        return (
                          <button
                            type="button"
                            key={link.to}
                            onClick={() => go(link.to)}
                            className="group flex min-h-[72px] items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 text-left shadow-sm transition duration-150 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
                          >
                            <span className="flex min-w-0 items-center gap-2.5">
                              <span
                                className={`grid size-9 shrink-0 place-items-center rounded-lg transition-colors ${tone}`}
                              >
                                <Icon className="size-4" />
                              </span>
                              <span className="text-xs font-semibold leading-snug text-slate-700">
                                {link.label}
                              </span>
                            </span>
                            <ChevronRight className="size-3.5 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-blue-600" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((msg, index) => (
                    <div
                      key={index}
                      className={`flex flex-col ${
                        msg.role === "user" ? "items-end" : "items-start"
                      }`}
                    >
                      <div
                        className={`rounded-2xl px-3.5 py-2.5 max-w-[88%] text-sm whitespace-pre-wrap break-words leading-relaxed ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground rounded-br-xs shadow-xs"
                            : "bg-white text-slate-800 border border-slate-200/80 rounded-bl-xs shadow-sm"
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 border border-border/40 rounded-xl px-3 py-2 w-fit">
                      <Loader2 className="size-3.5 animate-spin text-primary" />
                      <span>Checking operations guidance and authorized records...</span>
                    </div>
                  )}
                  {error && (
                    <div className="flex flex-col gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="size-4 shrink-0 mt-0.5" />
                        <span>{error}</span>
                      </div>
                      <button
                        type="button"
                        onClick={retryLast}
                        className="self-end rounded-md bg-destructive/20 px-2.5 py-1 font-semibold text-destructive hover:bg-destructive/30 transition-colors"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            <form
              className="border-t border-slate-200/80 bg-white p-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (query.trim() && !loading) {
                  void handleSend();
                }
              }}
            >
              <div className="relative flex items-center">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  disabled={loading}
                  autoFocus
                  placeholder="Ask about stock, zones, bins, or tasks..."
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-3.5 pr-11 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!query.trim() || loading}
                  aria-label="Send message"
                  className="absolute right-2 grid size-8 place-items-center rounded-lg text-blue-600 transition-colors hover:bg-blue-100 hover:text-blue-800 disabled:opacity-35"
                >
                  <Send className="size-4" />
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
