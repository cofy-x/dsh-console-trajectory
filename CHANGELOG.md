# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0-alpha.0] - 2026-08-30

### Added

- Optional DSH bundle with the `/trajectory` command.
- Lazy loopback Viewer for the current canonical Session.
- Dedicated read-only browser shell with an adapted DSH trajectory presentation layer.
- Canonical Session snapshot and SSE event transport with exact in-process authorization.

### Changed

- Verify the plugin against DeepSeek Harness `0.1.2-alpha.1` with an explicit audited compatibility ceiling.
- Keep DSH and Cordis runtime packages as optional host-provided peers while retaining exact development versions for reproducible checks.
- Assemble streamed `tool-call-delta` events into the stable read-only View Model.
- Verify npm's default dist-tag resolves to the exact released plugin version.

### Fixed

- Mask authentication diagnostics before they reach the browser projection.
- Close live event streams and runtime subscribers across Session disposal, workspace switches, cancelled startup, and concurrent shutdown.
- Exclude source maps and repository-only artifacts from the npm package.
