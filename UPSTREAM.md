# Upstream Provenance

The standalone presentation layer is adapted from the earlier `LingAgentGroup/trajectory-viewer` extraction at commit `500076c0158f65e9c7eaf0f7df63c3b6f5c560b2`. That extraction copied the DeepSeek Harness trajectory UI and supporting primitives at commit `47f943859bef60e4160492346772ded9b24f765a` (MIT).

Copied and adapted source areas:

- `packages/client/ui-trajectory/src`
- the minimal UI primitives consumed by trajectory rendering
- the design token and theme styles consumed by those primitives

DSH Console Trajectory owns the host command, loopback server, Session allowlist, snapshot/SSE transport, browser shell, and local Session-to-View-Model projector. Upstream updates should be ported deliberately rather than copied wholesale, preserving this read-only boundary.
