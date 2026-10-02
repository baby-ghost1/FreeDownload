# Frontend — `@freedownload/frontend`

Next.js 16 / React 19 / TypeScript / Tailwind CSS v4. Deployed to **Vercel**.

## Commands

Run from the repository root (recommended):

```bash
npm run dev       # turbo: frontend :3000 + backend :4000
npm run build
npm run lint
npm run typecheck
npm test
```

Or directly in this package: `npm run dev --workspace @freedownload/frontend`.

## Conventions

- App Router only; route groups per the contract (`(marketing)`, `(legal)`, `dashboard`, `admin`).
- No business logic in components — call the backend through `lib/api`.
- Design tokens live in `app/globals.css` (Tailwind v4 `@theme`, no `tailwind.config.ts`).
- Brand strings: `lib/constants/site.ts` (rename once to rebrand).
- Environment: only `NEXT_PUBLIC_*` vars (see root `.env.example`).

## Layout status

Phase 1 ships the application shell (layout, tokens, homepage placeholder).
Full routes and design system arrive in Phase 5.
