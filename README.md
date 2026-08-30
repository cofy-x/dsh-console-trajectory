# DSH Console Trajectory

An optional, local, read-only Trajectory Viewer for [DSH Console](https://github.com/cofy-x/dsh-console).

It opens the current canonical DSH Session in a dedicated browser surface. It does not start another Agent, duplicate the Session, expose a prompt box, or create a second DSH runtime.

The initial alpha is verified with DeepSeek Harness releases from the npm-default `0.1.1-rc.2` through the current source release `0.1.2-alpha.1`. Its compatibility ceiling advances only after each new DSH release passes API and host-integration review; DSH itself should continue to be installed normally, without a pinned install command.

## Install

```bash
dsh plugin --profile dsh-console add @cofy-x/dsh-console-trajectory
```

Start DSH Console and run:

```text
/trajectory
```

The command lazily binds a random port on `127.0.0.1` and opens the current Session. Browser refreshes reuse the same in-process Session snapshot, and later Session events stream into the page.

## Security boundary

- loopback-only listener
- exact in-memory allowlist populated by `/trajectory`
- read-only snapshot and event stream
- no credential transport, permissive CORS, model turn, or extra persistence

## Development

Requires Node.js 24 and pnpm 11.

```bash
pnpm install
pnpm check
```

Apache-2.0 covers project-owned code. Adapted DeepSeek Harness UI code remains MIT; see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) and [UPSTREAM.md](./UPSTREAM.md).
