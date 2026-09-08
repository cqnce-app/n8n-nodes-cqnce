# Changelog

## 0.1.3 - 2026-09-08

- Restore polling compatibility with n8n versions that do not export `sleepWithAbort`.
- Keep polling responsive to execution cancellation by racing the portable `sleep` helper with the abort signal.

## 0.1.2 - 2026-09-08

- Declare the complete n8n webhook lifecycle for signed per-request resume URLs.

## 0.1.1 - 2026-09-08

- Align local linting with the current n8n community-package scanner.
- Add the package author email required for verification.
- Preserve paired-item metadata across approval outputs.
- Use n8n-native operation errors and abortable polling sleep.
- Document why signed per-request resume webhooks have no external lifecycle to manage.

## 0.1.0 - 2026-09-04

- Publish the package under the `@cqnce/n8n-nodes-cqnce` npm scope.
- Add cQnce API credentials.
- Add send-and-wait authorization through n8n's native HTTP client.
- Add n8n Human Review/HITL compatibility.
- Add callback mapping for approved, rejected, expired, cancelled, and chain-progress events.
- Add outbound-only polling mode for n8n instances that cannot receive callbacks.
- Ship with no runtime dependencies for compatibility with n8n community-node verification.
