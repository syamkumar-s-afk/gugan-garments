# Gugan Fashions E-Commerce (PRD-Based MVP)

This workspace contains a full-stack implementation inspired by the provided PRD (`v2.0.0 Free Stack Edition`):

- Completely separated User Access and Admin Access
- User auth flow at `/` (login/signup -> shopping interface)
- Hidden admin auth flow only at `/admin.com`
- Role enforcement in backend (`user`, `admin`) for all protected APIs
- Product management (create/list/update/archive)
- Variant and stock management
- Discount engine (percentage/fixed + final price calculation)
- Order management with lifecycle transitions
- Dashboard KPIs, top products, low-stock alerts, status chart
- Storefront preview page using active catalog products
- Health endpoint for anti-sleep monitoring (`/api/v1/health`)

## Tech Stack

- Frontend: React + Vite + TypeScript + Recharts
- Backend: Node.js + Express + JWT + Zod
- Persistence (local dev): JSON file (`backend/data/store.json`)

## Demo Credentials

- User: `user@guganfashions.com` / `user1234`
- Admin: `admin@guganfashions.com` / `admin123`

## Access URLs

- Public/user app: `http://localhost:5173/`
- Admin login (hidden route): `http://localhost:5173/admin.com`

## Run Locally

### 1) Backend

```bash
cd backend
npm install
npm run dev
```

Backend runs on `http://localhost:4000`.

### 2) Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`.

## Build Frontend

```bash
cd frontend
npm run build
```

## API Notes

Base URL: `http://localhost:4000/api/v1`

Key endpoints:

- `POST /auth/user/signup`
- `POST /auth/user/login`
- `POST /auth/admin/login`
- `GET /products`
- `POST /products`
- `PATCH /products/:id/price`
- `POST /products/:id/discounts`
- `GET /orders`
- `PATCH /orders/:id/status`
- `GET /dashboard/kpis`
- `GET /storefront/products`
- `GET /health`

## PRD Alignment

Implemented strongly:

- FR-01 to FR-05 (login/logout/reset stub/roles)
- FR-07 to FR-12 (core catalog + variants)
- FR-15 to FR-17, FR-19, FR-20 (pricing/discount core)
- FR-21 to FR-24, FR-26 (orders + lifecycle + notes)
- FR-27 to FR-30 (dashboard widgets)

Partially stubbed (for easy swap to free cloud stack in next phase):

- Supabase Auth/DB/Storage integrations
- Upstash caching layer
- Resend transactional email delivery
- Audit log persistence in relational schema

The current structure is ready to replace JSON persistence with Supabase/PostgreSQL and to deploy frontend/backend independently (Vercel + Render), as defined in your PRD.
