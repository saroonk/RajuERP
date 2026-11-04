# RajuERP API contract

This is the contract between the Django backend (`backend/`) and the React frontend (`frontend/src/services`).
The frontend `Services` interface in `frontend/src/services/types.ts` and the row types in `frontend/src/types/*.ts` are
the authority for **response shapes**: every endpoint returns exactly the JSON shape of the matching TypeScript type
(camelCase keys; the backend renders snake_case Python dicts/serializers to camelCase automatically and parses
camelCase requests back to snake_case). `frontend/src/services/mock/{ops,selectors,services}.ts` are the executable
specification of the business rules (validation messages, status transitions, computed fields). Port them with
`Decimal`, not float.

## Conventions

- Base path `/api/`. Session cookie auth + CSRF (`X-CSRFToken` header on unsafe methods). Unauthenticated -> 401/403.
- **JSON numbers:** money/quantities are `Decimal`/int in Python and plain JSON numbers on the wire.
  **IDs** are integer primary keys on the wire; the frontend client converts `id` and every `*Id` key to strings.
  Requests may send ids as numbers or numeric strings.
- **Dates** `YYYY-MM-DD`; datetimes ISO 8601.
- **Lists are paginated**: `{count, next, previous, results}`; `?page=` and `?page_size=` (default 50, max 1000).
  Use `apps.core.pagination.paginated(view, request, rows, Serializer?)` for computed (non-queryset) rows.
  Queryset endpoints support `?search=`, `?ordering=` and `filterset_fields`.
  Report/aggregate endpoints (reports, dashboard, summary) return the full result object instead of pages.
- **Errors**: `{"message": "...", "errors": {field: [..]}}` with 400 (validation / `DomainError`), 401/403
  (auth/permission), 404, 409 (`ConflictError`, `ProtectedError`, `IntegrityError`). Never leak stack traces.
  Reuse the mock's human-readable messages for business-rule errors (the UI shows `message` in a toast).
- **Authorization**: every view declares `permission_module` (or `permission_modules = {action: module}`); see
  `apps/core/permissions.py`. GET needs "view", writes need "edit". `permission_module = None` = any signed-in user.
- **Writes**: all multi-record writes live in `apps/<app>/services.py` inside `transaction.atomic()`, call
  `apps.inventory.stock.lock_batches(...)` before checking stock, post stock only via
  `apps.inventory.stock.post_movement`, number documents with `apps.core.numbering.next_doc_no`, and record an
  `apps.core.audit.audit(...)` entry. Totals/tax are **computed on the server** (`apps.core.tax`), never read from the client.
- CSV: report endpoints accept `?export=csv` and return `apps.core.csv_export.csv_response(...)` with the same rows/figures as the JSON.

## Auth and administration (already implemented, see apps/users, apps/core)

| Method + path | Notes |
|---|---|
| GET `auth/csrf/` | sets CSRF cookie |
| POST `auth/login/` `{email,password}` | -> User `{id,name,email,role,active,lastLogin}` (401 on failure, throttled) |
| POST `auth/logout/`, GET `auth/me/` | |
| `admin/users/` CRUD (module admin) | `UserInput = {name,email,role,active,password?}` |
| GET/PUT `admin/permissions/` | GET -> `RolePermissions` matrix; PUT `{role,module,level}` -> matrix |
| GET `admin/audit/` | paginated `AuditEntry` |
| GET/PUT `admin/settings/` | `Settings` |
| GET/POST `admin/backups/` | list (unpaginated) / record simulated backup |

## Master data (module in parentheses; ModelViewSet + ModelSerializer, delete of a referenced row -> 409)

`brands/` `categories/` `units/` `unit-conversions/` `products/` (products) - `suppliers/` (purchases) -
`distributors/` `distributor-prices/` (distributors) - `expense-categories/` (expenses).
Shapes: `Brand, Category, Unit, UnitConversion, Product, Supplier, Distributor, DistributorPrice, ExpenseCategory`
from `frontend/src/types`. Business validation: unique SKU/names/codes, GSTIN format (`apps.core.serializers.validate_gstin`),
subcategory must belong to its category, price/GST/discount ranges, distributor `code` auto-generated when blank,
one price per distributor+product.

Also: GET `lookups/` (any signed-in user) -> `Lookups` (all arrays, unpaginated). GET `search/?q=` -> `SearchResult[]`
(only entities from modules the user may view).

## Inventory (module `inventory`; alerts need `dashboard`)

| Method + path | Maps to / returns |
|---|---|
| GET `inventory/stock-by-product/` | `ProductStock` (paginated) - `inventory.selectors.product_stock_rows` |
| GET `inventory/batches/`, GET `inventory/batches/{id}/` | `BatchStock` rows (paginated; filters `product`, `search`); detail = raw `Batch` |
| GET `inventory/movements/` | `MovementRow` (paginated; filters `batch,product,type,bucket,date_from,date_to,search`) |
| GET `inventory/valuation/?method=fifo\|weighted_average` | `ValuationRow` (paginated) |
| GET `inventory/alerts/` | `AlertSummary` (module dashboard) |
| GET/POST `inventory/write-offs/` | `WriteOff & {lineCount,totalQty}`; POST `WriteOffInput` |
| GET/POST `inventory/reconciliations/`, GET/DELETE `{id}/`, POST `{id}/approve/` | `Reconciliation & {totalVariance}` |
| GET `inventory/suggest-allocation/?productId&qty&date&exclude=batchId:qty,...` | `BatchAllocation[]` |
| GET `inventory/dispatchable-batches/?productId&date` | `BatchStock[]` (paginated) |

## Purchasing

`purchasing/orders/` (module purchases): list/create/retrieve/update/destroy -> `PurchaseOrderRow`; POST `{id}/set-status/ {status}`.
`purchasing/receipts/` list/create/retrieve -> `GoodsReceiptRow` (POST `GRNInput`: creates batches, posts receipt movements, updates PO status).
`purchasing/returns/` list/create/retrieve -> `SupplierReturnRow` (`SupplierReturnInput`).
`purchasing/payments/` list/create -> `SupplierPaymentRow`, `purchasing/outstanding/` -> `SupplierOutstanding[]` (module **payables**).

## Distribution (module `distribution`)

`distribution/orders/` CRUD -> `DistributionOrderRow` (`OrderInput`), POST `{id}/confirm/`, `{id}/cancel/`.
`distribution/dispatches/` list/create/retrieve -> `DispatchRow` (`DispatchInput`: allocates batches, posts dispatch movements, updates order status).
GET `distribution/stock/` -> `DistributorStockRow[]`; `distribution/stock-reports/` list (`DistributorStockReportRow`) /
POST (`DistributorReportInput`, upserts by distributor+product+period) / DELETE `{id}/`; POST `distribution/stock-reports/import/ {rows: string[][]}` -> `ImportResult`.

## Sales (module `sales`)

`sales/invoices/` list/retrieve -> `InvoiceRow`; POST `{dispatchId, date}` creates the invoice from a dispatch (server computes lines, GST, due date, number; one invoice per dispatch);
GET `sales/invoices/uninvoiced-dispatches/` -> `DispatchRow[]`.
`sales/notes/` list/create -> `NoteRow` (`NoteInput`). `sales/returns/` list/create/retrieve -> `SalesReturnRow` (`SalesReturnInput`);
GET `sales/returns/returnable-lines/?invoiceId`; POST `sales/returns/{id}/reclassify/ {lineIndex,to,note}`.

## Finance and receivables (modules `receivables`, `expenses`)

GET `finance/balances/` -> `DistributorBalance` (paginated); GET `finance/ledger/?distributorId=` -> `LedgerEntry[]`;
GET `finance/open-invoices/?distributorId=` -> `InvoiceRow[]`; GET `finance/suggest-allocations/?distributorId&amount` -> `AllocationSuggestion[]`;
`finance/payments/` list/create/retrieve -> `PaymentRow` (`PaymentInput`), POST `{id}/allocate/ {allocations}`;
`finance/expenses/` CRUD -> `ExpenseRow`; GET `finance/summary/?from&to` -> `IncomeExpenseSummary`.

## Reports and dashboard (module `reports`; dashboard needs `dashboard`)

GET `reports/{sales-profitability,brands,products,distributors,purchase-register,sales-register,gst-summary}/?from&to[&export=csv]`
-> `SalesProfitReport`, `BrandReportRow[]`, `ProductPerfRow[]`, `DistributorPerfRow[]`, `PurchaseRegisterRow[]`, `SalesRegisterRow[]`, `GstSummary`.
GET `dashboard/` -> `DashboardSummary`.
