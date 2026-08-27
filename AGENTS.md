# AGENTS.md

## Project Direction

DSH Console Trajectory is an optional DSH plugin bundle. Keep the terminal product independent and keep this package focused on a local, read-only browser projection of canonical DSH Sessions.

## Architecture Rules

- Use official DSH Session services and canonical event types at the host boundary.
- Do not create a second Agent, resume a duplicate Session, or introduce separate persistence.
- Keep `/trajectory` model-inert: no prompt submission and no Agent turn.
- Bind browser services to loopback only and start them lazily.
- Keep React components behind a small Viewer-specific presentation boundary.
- Do not modify DeepSeek Harness to support this package.
- Keep the browser projection behind a stable local View Model. Vendored DSH trajectory UI source must retain exact provenance and MIT notices; do not depend on private DSH client state or internal localStorage keys.
- Treat command, server, browser launcher, and client shell lifecycles as independently testable seams.

## Change Discipline

- Preserve Node.js 24, TypeScript ESM, and pnpm 11 compatibility.
- Add or update focused tests for lifecycle, cancellation, security, and Session projection behavior.
- Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `npm pack --dry-run` before release changes.
- Keep public package contents limited to runtime artifacts, the DSH patch, documentation, licenses, and notices.
