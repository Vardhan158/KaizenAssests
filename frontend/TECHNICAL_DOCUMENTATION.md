# AMS/WMS Frontend — Technical Documentation

## 1. Scope

The `frontend` directory contains the KaizenX browser application for warehouse, gate-security, procurement, supplier, and finance users. It provides dashboards and guided workflows over the FastAPI business service.

Routes under `src/routes` define screens; `src/lib/api-client.ts` is the central backend integration.

## 2. Stack

| Concern            | Technology                                    |
| ------------------ | --------------------------------------------- |
| UI/runtime         | React 19, TypeScript 5.8, TanStack Start      |
| Routing/data       | TanStack Router file routes, TanStack Query 5 |
| Server/build       | Vite 8, Nitro                                 |
| Styling/components | Tailwind CSS 4, Radix UI, local primitives    |
| Supporting UI      | Lucide, Sonner, Recharts                      |
| Codes/OCR          | QRCode, JsBarcode, Tesseract.js               |
| Quality            | ESLint, typescript-eslint, Prettier           |

## 3. Runtime and source architecture

```text
Browser -> TanStack route -> AppShell/page -> central fetch API client -> :8000
   |              |              |
   |              |              +-> component state/effects
   |              +-> QueryClient context
   +-> localStorage: auth_token, user_info, selected drafts/workflow data
```

```text
src/
├── routes/                    file-based pages/nested layouts
├── components/ui/             reusable Radix/custom primitives
├── components/wms/            AppShell and domain components
├── lib/api-client.ts          backend HTTP operations
├── lib/auth-utils.ts          auth and role guards
├── lib/wms-data.ts            static/local domain data
├── router.tsx                 Router + QueryClient
├── routes/__root.tsx          HTML shell, providers, global guards/errors
├── routeTree.gen.ts           generated; never hand-edit
├── server.ts / start.ts       TanStack Start/Nitro entries
└── styles.css                 Tailwind/theme/global styles
```

`router.tsx` builds the QueryClient and Router. `__root.tsx` supplies metadata, CSS, auth redirect, Query provider, outlet, toaster, and root error/not-found UI. Most authenticated pages use `components/wms/app-shell.tsx` for role navigation, user identity, notifications, search, and logout.

## 4. Roles and navigation

| Role                    | Home and navigation                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `WAREHOUSE` / operators | `/warehouse-dashboard`: inventory, putaway, requests, arrivals, exit, docks, receiving, reports |
| `PROCUREMENT`           | `/procurement-dashboard`: suppliers, requests, RFQs, quotations, POs, ASNs                      |
| `SUPPLIER`              | `/supplier-dashboard`: quotations and ASN creation                                              |
| `FINANCE`               | `/finance-dashboard`: pending approvals and reports                                             |
| `GATE_SECURITY`         | `/gate-dashboard`: gate entry, arrivals, exit                                                   |
| `ADMIN`                 | general/fallback behavior                                                                       |

`requireRole` redirects users without a required role to their role home. Client guards control UX only; the backend must enforce authorization.

## 5. Route catalog

### Shared

| Route                   | Purpose                             |
| ----------------------- | ----------------------------------- |
| `/login`, `/`           | login and role-aware entry redirect |
| `/notifications`        | role and arrival notifications      |
| `/settings`, `/reports` | settings and reporting surfaces     |

### Gate and warehouse

| Route                                                     | Purpose                                      |
| --------------------------------------------------------- | -------------------------------------------- |
| `/gate-dashboard`, `/gate-entry`                          | gate metrics and entry capture               |
| `/driver-verification`, `/vehicle-verification`           | verification steps                           |
| `/accept-arrival`, `/arrival-success`, `/dock-assignment` | arrival workflow steps                       |
| `/warehouse-dashboard`                                    | warehouse dashboard                          |
| `/dock-management`                                        | dock allocation and administration          |
| `/warehouse/stores`                                       | Store Master, zones & bins hierarchy         |
| `/my-store`                                               | operational store portal                     |
| `/receiving`, `/grn`                                      | unload/check/complete receiving and post GRN |
| `/inventory`, `/putaway-tasks`                            | stock/location views and putaway execution   |
| `/vehicle-exit`                                           | warehouse approval and gate exit             |
| `/warehouse/material-requests`                            | create/edit material requests                |

### Procurement, supplier, and finance

| Route                                                                         | Purpose                             |
| ----------------------------------------------------------------------------- | ----------------------------------- |
| `/procurement-dashboard`                                                      | metrics, alerts, supplier/PO search |
| `/master-data`, `/new-supplier`, `/supplier/$supplierId`                      | supplier list/onboarding/detail     |
| `/procurement/material-requests`, `/procurement/new-rfq`, `/procurement/rfqs` | sourcing inputs and RFQs            |
| `/procurement/quotations`                                                     | compare/evaluate/select quotations  |
| `/procurement/purchase-orders`, `/purchase-order`                             | PO list/detail/PDF/send             |
| `/procurement/asns`, `/procurement/asns/$asnId`                               | ASN list/detail                     |
| `/supplier-dashboard`, `/submit-quotation`, `/supplier/asns/new`              | supplier portal workflows           |
| `/finance-dashboard`, `/finance/approvals`                                    | finance overview and approval list  |
| `/finance/approvals/$approvalId`, `/finance/approvals/compare/$rfqId`         | approval detail/comparison          |

## 6. Backend integration

The native-fetch client:

- uses `http://<browser-hostname>:8000`, or a hard-coded LocalTunnel backend for `loca.lt`;
- attaches `auth_token` as a Bearer token (or a local mock token when absent);
- sets JSON content type, parses JSON, and normalizes FastAPI validation errors;
- has specialized multipart upload and PDF/blob download methods.

It covers gate/dock/receiving/exit, storage/putaway, GRN/returns, suppliers/reference data, material requests/stock, RFQs, quotations, POs/approvals, ASNs, notifications, and search.

No general `VITE_*` API base exists. Production must preserve the host/port convention or move this to environment/reverse-proxy configuration.

## 7. Authentication

Login currently follows:

1. `supplier_*` usernames call supplier login.
2. Other names call the business-service development login.
3. Failure creates a mock role/token based on username text.

`auth_token` and `{token, username, roles, supplierId?, mustChangePassword?}` in `user_info` are stored in localStorage. The root redirects unauthenticated users to `/login`; pages apply `requireAuth`/`requireRole`; logout removes both keys.

Mock login is development-only. localStorage tokens are XSS-accessible, browser guards are not authorization, and production needs the real auth-service login/refresh/logout flow.

## 8. State, UI, and errors

TanStack Query is globally available, but current pages primarily load through effects and local state, so loading/error/refetch logic is page-specific. localStorage also persists ASN drafts; router search/navigation state links some gate steps. `wms-data.ts` and route constants provide local/static data where backend coverage is incomplete.

New server state should use typed TanStack Query hooks, stable keys, invalidation, and cancellation. Reduce `any` at API boundaries with generated/shared OpenAPI types.

UI primitives under `components/ui` wrap Radix behavior and Tailwind classes. `components/wms/primitives.tsx` adds domain presentation. `AppShell` supplies desktop sidebar/header and mobile bottom navigation. The root has error and 404 boundaries; API errors become JavaScript `Error`s and routes generally display inline feedback or Sonner toasts.

Camera/OCR/QR/barcode functions require real device permission and responsive testing. Supplier onboarding directly calls an external postal PIN-code service, creating availability and privacy dependencies.

## 9. Development and verification

```powershell
cd D:\ams-wms-platform\frontend
npm install
npm run dev       # http://localhost:8080
npm run build     # production build
npm run build:dev
npm run preview
npm run lint
npm run format    # writes formatting changes
```

The backend is expected on port 8000. Never edit `src/routeTree.gen.ts`; the router plugin generates it.

There is no automated frontend test suite today. Minimum verification is:

```powershell
npm run lint
npm run build
```

Manually test login/logout, role redirects, changed API failures, direct refresh, desktop/mobile layout, and camera/file permissions. Recommended additions: Vitest/Testing Library, MSW contract tests, and Playwright for procurement-to-arrival and gate-to-putaway journeys.

## 10. Adding a feature

1. Add a typed method/DTO in `api-client.ts`.
2. Add the file route and appropriate `beforeLoad` role guard.
3. Reuse UI/WMS primitives and use TanStack Query for reusable server state.
4. Add the role navigation item in `app-shell.tsx` if required.
5. Cover loading, empty, error, permission, and mobile states.
6. Run lint/build and add tests; do not edit the generated route tree.

## 11. Known risks and production checklist

- API URL and LocalTunnel behavior are embedded in source; make the base deploy-time configurable.
- Remove development login, mock token fallback, and default mock authorization header.
- Replace API and page `any` types with OpenAPI-generated/shared contracts.
- Consolidate server state on TanStack Query and split large pages/API client by domain.
- Add automated unit, contract, accessibility, and end-to-end tests in CI.
- Replace local/static placeholders where production data is expected.
- Implement a secure token/session lifecycle and CSP/XSS hardening.
- Define upload limits/types, camera/OCR consent, and external-service privacy behavior.
- Audit all route guards, responsive states, and error handling; never log tokens, documents, credentials, or personal data.
