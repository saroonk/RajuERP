# CLAUDE.md

## 1. Technology Stack

- **Frontend:** React, Vite, TypeScript, Tailwind CSS.
- **Routing:** React Router.
- **Icons:** Lucide React.
- **Charts:** Recharts.
- **Forms:** React Hook Form and Zod.
- **Backend:** Python, Django, Django REST Framework.
- **Database:** PostgreSQL.

Use compatible, stable dependencies. Keep the architecture modular, maintainable, and suitable for a production business application.

## 2. Current Task

The current task is to develop the React frontend using realistic mock data.

Build the interface, navigation, pages, forms, tables, charts, filters, and interactions required by the ERP specifications. The frontend must run independently without a backend.

Keep data types and service interfaces organized so they can later be connected to Django REST Framework APIs.

Do not implement backend functionality as part of the current frontend task.

## 3. Requirements

Read the three requirement images in the `reference/` directory. They contain the ERP feature list and scope clarifications.

Treat these images as the source of truth. Cover the specified features without inventing additional requirements.

The application must support the following business areas:

- Dashboard and business summaries.
- Product, brand, category, subcategory, unit, and packaging management.
- Batch-based inventory, stock movements, stock valuation, expiry tracking, and reconciliation.
- Purchase orders, goods receipts, suppliers, and supplier returns.
- Distributor and dealer management, pricing, credit limits, and distribution.
- Sales orders, invoices, dispatches, and batch allocation.
- GST calculations, billing, and reports.
- Sales returns, credit notes, debit notes, and returned-stock classification.
- Receivables, payables, payment allocation, and distributor ledgers.
- Expense management and operational income and expense summaries.
- Sales, inventory, purchase, distributor, profitability, and GST reports.
- User management, permissions, notifications, and audit history.
- Search, filters, pagination, and CSV exports where appropriate.

Use the reference images for the exact scope of each feature.

## 4. Frontend Architecture

Use a feature-based architecture.

Organize code into:

- `app/` — application initialization, routing, and providers.
- `components/` — reusable UI components, tables, forms, and feedback elements.
- `layouts/` — shared application layouts.
- `features/` — business modules and their pages, components, types, and services.
- `services/` — service interfaces and mock implementations.
- `hooks/` — reusable React hooks.
- `types/` — shared TypeScript types.
- `utils/` — formatting and utility functions.
- `styles/` — global styles and theme configuration.

Keep related functionality together. Avoid oversized components, duplicated logic, unnecessary abstractions, and excessive nesting.

Inspect the existing project structure before creating or moving files.

## 5. Design System

Use a professional black-and-white theme.

- White and light-neutral backgrounds.
- Black or near-black primary actions and navigation.
- Neutral gray borders, dividers, and secondary text.
- Restrained accent colors for charts, alerts, and status indicators.
- Consistent typography, spacing, sizing, and component styles.
- Responsive layouts for desktop, tablet, and mobile.

Create a consistent business-oriented interface with a sidebar, header, page titles, appropriate navigation, and reusable components.

Avoid unnecessary gradients, excessive animations, decorative sections, and inconsistent designs.

## 6. Mock Data and Services

Keep mock data separate from page components.

- Use TypeScript types for records and service responses.
- Use consistent identifiers and relationships across modules.
- Implement mock CRUD operations where appropriate.
- Ensure dashboard metrics and reports use consistent data.
- Simulate loading, empty, success, and error states where useful.
- Use realistic Indian business examples and INR formatting.
- Avoid real customer information and actual financial credentials.

Components must consume services rather than directly importing hardcoded record arrays.

Do not present simulated operations as real financial or inventory transactions.

## 7. Business Rules

- Track inventory through batch-level records and stock movements.
- Represent receipts, dispatches, returns, write-offs, and adjustments consistently.
- Returned stock must be classified as saleable, damaged, expired, or requiring inspection.
- Distinguish dispatched quantities from distributor-reported sales and remaining stock.
- Keep invoices, partial payments, payment allocations, credit/debit notes, and outstanding balances consistent.
- Use precise numeric types for monetary values and quantities where required.
- Do not introduce a full double-entry accounting system.
- GST return filing, e-invoicing, and e-way bill integration are outside the stated requirements.

These rules must be reflected in the frontend workflows and mock data where applicable.

## 8. Authentication and Permissions

Provide frontend authentication screens and mock role-aware navigation where required.

Support the initial roles described in the requirements, including administrator, accounts, and warehouse staff. Additional roles may be included where justified by the specified workflows.

Frontend permission checks are for interface behavior only. Real authentication and authorization must be enforced by the backend.

Do not introduce production credentials or claim that mock authentication provides actual security.

## 9. Coding Standards

- Use strict TypeScript and functional React components.
- Follow React best practices and use reusable components appropriately.
- Use accessible labels, semantic HTML, keyboard-friendly controls, and clear validation messages.
- Keep forms, tables, filters, and dialogs consistent across modules.
- Ensure navigation destinations and visible controls work as intended.
- Avoid unnecessary dependencies, unused code, and unrelated changes.
- Do not create placeholder pages or nonfunctional controls merely to make a feature appear complete.
- Do not add features outside the requirements without approval.

## 10. Development Workflow

Before changes:

1. Verify the current working directory.
2. Inspect relevant existing files.
3. Consult the requirements when necessary.
4. Identify the specific scope of the requested task.

After changes:

1. Run available build, type-check, lint, and relevant test commands.
2. Fix errors introduced by the changes.
3. Verify relevant interactions and responsive layouts.
4. Summarize completed work and any remaining limitations.

Preserve existing working functionality and avoid modifying unrelated files.
## 11. Frontend Commands

Run from `frontend/`: `npm run dev`, `npm run build` (type-check + build), `npm run lint`, `npm test` (a single file: `npx vitest run src/services/seed.test.ts`). The UI talks to data only through `src/services/index.ts`; the mock lives in `src/services/mock/` and its seed replays activity through the real business operations, so change rules in `ops.ts` rather than editing seed data.

## 12. Backend (Django) and Frontend Integration

The backend lives in `backend/` (Django 5, DRF, SQLite for development). Setup, structure and limitations are in `backend/README.md`; the endpoint and response contract is `backend/API.md`.

- Commands (from `backend/`, venv active): `python manage.py migrate`, `python manage.py seed_demo --password <pw>` (demo data replayed through the real services), `python manage.py runserver`, `python manage.py test` (single app: `python manage.py test apps.sales`).
- The frontend uses the HTTP services in `frontend/src/services/http/` by default; the in-memory mock is only used with `VITE_USE_MOCK=true` and by the unit tests. In development Vite proxies `/api` to `127.0.0.1:8000`, so session cookies and CSRF work same-origin.
- Business rules live in each app's `services.py` (one `transaction.atomic()` per operation; stock changes only via `apps/inventory/stock.py: post_movement`; totals and GST computed on the server with `Decimal`). When a rule changes, update the backend service, its tests, and (if the UI mirrors it) the frontend validation.
- Authorization is enforced by `apps/core/permissions.py` (role -> module matrix); every view must declare `permission_module`.
