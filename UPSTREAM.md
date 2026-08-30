# Upstream Provenance

The standalone presentation layer is adapted from the earlier `LingAgentGroup/trajectory-viewer` extraction at commit `500076c0158f65e9c7eaf0f7df63c3b6f5c560b2`. That extraction copied the DeepSeek Harness trajectory UI and supporting primitives at commit `47f943859bef60e4160492346772ded9b24f765a` (MIT).

Copied and adapted source areas:

- `packages/client/ui-trajectory/src`
- the minimal UI primitives consumed by trajectory rendering
- the design token and theme styles consumed by those primitives

DSH Console Trajectory owns the host command, loopback server, Session allowlist, snapshot/SSE transport, browser shell, and local Session-to-View-Model projector. Upstream updates should be ported deliberately rather than copied wholesale, preserving this read-only boundary.

## 0.1.2-alpha.1 audit

The current audit compares the pinned presentation source above with DeepSeek Harness `cd5ef8148158c3a752a658978873241fdf8e2bbc` (`dsh-v0.1.2-alpha.1`). The standalone plugin deliberately ports only changes that fit its existing host-owned Session and stable View Model:

- live `tool-call-delta` assembly, so partial tool calls update without inventing a second event model;
- authentication diagnostic masking before projection into browser-readable data;
- raw-event coverage for tool cards and current Session event contracts.

The following upstream work is intentionally not copied wholesale:

- Conversation/Chat/Trajectory ownership splits and localized projection stores, because the plugin has no second client Session owner;
- upstream Remote and Connection transport migrations, because this plugin reads only the host's `SessionQuery` service and in-process Session events;
- the upstream attachment cache and canonical image-reference resolver, because adopting its private client state would cross the read-only plugin boundary. Inline renderable image payloads remain supported; durable attachment references require a future official read service.

On each DSH release, repeat this comparison, update the package's `dsh.compatibility.maximumTested` only after host integration passes, and record newly selected or deferred ports here.
