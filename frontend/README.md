# Frontend — `@freedownload/frontend`

Next.js 16 / React 19 / TypeScript / Tailwind CSS v4. Deployed to **Vercel**.

## Commands

Run from the repository root (recommended):

```bash
npm run dev        # turbo: frontend :3000 + backend :4000
npm run build
npm run lint
npm run typecheck
npm test           # vitest unit tests (tests/unit)
npm run test:e2e   # playwright e2e (tests/e2e) — also available as npm run e2e here
```

Or directly in this package: `npm run dev --workspace @freedownload/frontend`.

## E2E

`playwright.config.ts` boots `next dev` itself and every backend call is
intercepted in-process by `tests/e2e/api-mock.ts` — no API, network or
fixtures required. Two projects run all specs: `desktop` (Desktop Chrome) and
`mobile` (Pixel 7 viewport/touch). Browser install (once per machine):

```bash
npx playwright install chromium
```

## Conventions

- App Router; routes: `/` (landing), `/download`, `/downloads`,
  `/downloads/[id]`, `/login`, `/register`, `/forgot-password`,
  `/reset-password`, `/verify-email`, `/privacy`, `/terms`.
- No business logic in components — call the backend through `lib/api`.
- Design tokens live in `app/globals.css` (Tailwind v4 `@theme`, no
  `tailwind.config.ts`); UI kit lives in `components/ui/`.
- Session state: `lib/session.tsx` (`useSession`), probed against `GET /me`.
- Brand strings: `lib/constants/site.ts` (rename once to rebrand).
- Environment: only `NEXT_PUBLIC_*` vars (see root `.env.example`).
- Typed routes are enabled (`typedRoutes: true`) — `href`/`router.push`
  take literal `Route` values; run `next build`/`next dev` once after adding
  a route so `.next/types/routes.d.ts` picks it up.
