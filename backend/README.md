# RajuERP backend

Django 5 + Django REST Framework, SQLite for development (models are PostgreSQL-compatible: `DecimalField` money, no
SQLite-specific SQL). The React frontend in `../frontend` talks to it through `/api/`.
The endpoint list and response contract are in [API.md](API.md); interactive docs are served at `/api/docs/` when running.

## Run it locally

All commands from `backend/`.

```bash
# 1. Virtual environment
python -m venv .venv
.venv\Scripts\activate            # Windows (PowerShell / cmd)
# source .venv/bin/activate       # macOS / Linux / Git Bash on Unix

# 2. Dependencies
pip install -r requirements.txt

# 3. Configuration
copy .env.example .env            # cp .env.example .env on macOS/Linux
# edit .env: set DJANGO_SECRET_KEY (generate one with the command inside .env.example). Never commit .env.

# 4. Database
python manage.py migrate

# 5. Administrator account (role: admin)
python manage.py createsuperuser

# 6. Optional: demo data (about five months of realistic activity replayed through the real business logic)
python manage.py seed_demo --password "choose-a-demo-password"      # add --flush to reset demo data

# 7. Start the API
python manage.py runserver        # http://127.0.0.1:8000
```

Frontend (second terminal): `cd ../frontend && npm install && npm run dev`, open http://localhost:5173.
In development Vite proxies `/api` to `http://127.0.0.1:8000`, so the browser sees one origin and the session cookie
and CSRF protection work without loosening anything. To point the frontend elsewhere set `VITE_API_URL` in
`frontend/.env` (see `frontend/.env.example`).

Run the tests: `python manage.py test` (all apps) or e.g. `python manage.py test apps.sales`.

## Structure

```
config/            settings, root urls
apps/core/         shared: audit log, settings, document numbering, GST/money helpers, permissions, error format, CSV export
apps/users/        custom User (email login, roles), role -> module permission matrix, auth endpoints
apps/catalog/      brands, categories, units + conversions, products
apps/parties/      suppliers, distributors/dealers, distributor prices
apps/inventory/    batches, append-only stock ledger, valuation, alerts, write-offs, reconciliation
apps/purchasing/   purchase orders, goods receipts, supplier returns, supplier payments
apps/distribution/ orders, dispatches (batch allocation), distributor-reported stock
apps/sales/        invoices + GST, sales returns, credit/debit notes
apps/finance/      payments + invoice allocations, receivables, ledger, expenses, summaries
apps/reports/      dashboard, reports (+CSV), lookups, global search
```

Each app keeps `models.py`, `serializers.py`, `views.py`, `urls.py`, `services.py` (business rules, one transaction per
operation) and `tests/`. Views stay thin; rules live in the services.

## Security notes

- Real authentication: Django users, hashed passwords, session cookie (HttpOnly) with CSRF protection; login is rate limited
  and does not reveal whether an email exists.
- Authorization is enforced on the server for every endpoint through the role/module matrix (`apps/core/permissions.py`).
  The frontend hides menus only as a convenience.
- CORS allows only `CORS_ALLOWED_ORIGINS`; secrets come from the environment (`DJANGO_SECRET_KEY`); with
  `DJANGO_DEBUG=False` secure cookies/HSTS/SSL redirect are enabled and a missing secret key stops start-up.
- Money, prices and tax are `Decimal` end to end; invoice totals and GST are always computed on the server.

## Known limitations

- **Concurrency:** stock and number-sequence rows are locked with `select_for_update`, which has no effect on SQLite
  (SQLite serialises writers instead). Concurrent-stock protection must be re-verified on PostgreSQL before production use.
- **Backups:** the "Run backup" action only records an event; real database backups belong to the deployment.
- **Lists:** every list endpoint is paginated and supports `search` / `ordering` / filters. The current UI downloads all
  pages (page size up to 1000) and filters/sorts them in the browser, so very large datasets would need the tables moved
  to server-side paging.
- GST return filing, e-invoicing and e-way bill integration, and a double-entry ledger are out of scope.
