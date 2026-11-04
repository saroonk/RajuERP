# RajuERP frontend

React + Vite + TypeScript + Tailwind CSS. It talks to the Django REST API in `../backend` (see `../backend/API.md`),
or runs on in-memory demo data when mock mode is enabled.

```
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build
npm run lint
npm test           # unit tests (mock demo data integrity, HTTP client)
```

## Running against the backend (default)

1. Start the backend (see `../backend/README.md`): `python manage.py runserver` on `http://127.0.0.1:8000`.
2. Start the frontend: `npm run dev`. The Vite dev server proxies `/api` to `http://127.0.0.1:8000`
   (`vite.config.ts`), so the browser sees one origin and the HttpOnly session cookie and CSRF cookie work without
   loosening any security setting.
3. Sign in with an account created on the backend (`python manage.py createsuperuser`, or the demo accounts from
   `python manage.py seed_demo` if available).

Configuration (`.env.local`, see `.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_URL` | `/api` | API base URL. Use an absolute URL only if the API is served from another origin and the backend `CORS_ALLOWED_ORIGINS` / `CSRF_TRUSTED_ORIGINS` allow it. |
| `VITE_USE_MOCK` | `false` | `true` runs the UI on in-memory demo data (no backend): any password works for the demo users. Intended for tests and offline demos only. |

Request failures are shown as toasts with the server's message. The app never falls back to fake data when the API fails,
and a `401` from any call returns you to the sign-in screen.

## Structure
- `src/services/types.ts` – the `Services` contract every page depends on. `src/services/index.ts` picks the implementation.
- `src/services/http/` – API client (`client.ts`: CSRF, id normalisation, pagination, error mapping) and the HTTP implementation by area.
- `src/services/mock/` – in-memory implementation and demo-data seed (mock mode and tests).
- `src/features/<area>/pages` – screens; `src/app/routes.tsx` lists every route and the permission module that guards it.
- `src/components` – shared UI (DataTable, ResourcePage, Modal, forms, charts).
- Frontend permission checks only shape the interface; the backend enforces authorization.
