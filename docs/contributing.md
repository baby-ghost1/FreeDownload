# Contributing

## Workflow

1. Inspect the repository and read `docs/architecture.md` before large changes.
2. Keep frontend and backend changes in separate commits when possible.
3. Run the full local gate before pushing:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

4. CI runs exactly the same sequence — a red pipeline blocks merge.

## Quality rules (contract §81–82)

- Strict TypeScript; `no-explicit-any` is an **error** in both workspaces.
  If `any` is unavoidable, justify it in the commit message.
- Small functions, single responsibility, clear module boundaries.
- Do not comment obvious code. Do comment security decisions, architectural
  decisions, non-obvious workarounds and source-specific behaviour.
- No secrets in source, config or logs. Secrets come from the environment.

## Stack boundaries

- Do not change major versions of the stack without a written justification in
  `docs/architecture.md`.
- Do not put media processing in Next.js.
- Do not add a new datastore, queue or microservice without an architecture
  note.
- All user-supplied URLs must go through the SSRF validator.

## npm workspaces

```bash
npm install                                  # root: installs all workspaces
npm run lint --workspace @freedownload/backend
npm run test  --workspace @freedownload/frontend
```

`package-lock.json` is committed. Prefer exact versions; Dependabot opens
weekly PRs for patch/minor updates and ignores major bumps (reviewed manually).

## Commits

- Imperative subject, ≤72 characters.
- Reference the phase or ticket where relevant, e.g.
  `Phase 2: session auth with Argon2id`.

## Adding a source adapter (Phase 4+)

1. Create `backend/src/downloader/adapters/<source>/`.
2. Implement `SourceAdapter` (`canHandle`, `analyze`, `getFormats`, `download`).
3. Add a row to `download_sources` (policy is data, not code).
4. Add unit tests with mocked HTTP — never hit live sources in CI.
5. Confirm one bad source cannot take down the worker loop.
