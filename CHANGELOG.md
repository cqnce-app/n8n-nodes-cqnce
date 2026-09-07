# Changelog

## 0.1.0 - 2026-09-04

- Add cQnce API credentials.
- Add send-and-wait authorization through `@cqnce/sdk`.
- Add n8n Human Review/HITL compatibility.
- Add callback mapping for approved, rejected, expired, cancelled, and chain-progress events.
- Add outbound-only polling mode for n8n instances that cannot receive callbacks.
- Load the ESM cQnce SDK dynamically from the CommonJS format required by n8n community nodes.
