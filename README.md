# n8n-nodes-cqnce

An [n8n](https://n8n.io/) community node for human-in-the-loop authorization with
[cQnce](https://cqnce.app/).

The node sends an authorization request through n8n's native HTTP client, pauses the n8n
execution, and supplies n8n's signed resume URL as the request callback. When cQnce reports a
terminal decision, the execution resumes with the HITL response expected by n8n. A polling mode is
also available when cQnce cannot reach the n8n instance.

## Features

- Appears as **cQnce** in n8n's **Human review** action picker on n8n versions that support
  generated HITL tools.
- Uses n8n's native HTTP client and has no runtime dependencies.
- Supports project routing rules, explicit routing modes, metadata, and attachments.
- Treats `APPROVED` as approval and `REJECTED`, `EXPIRED`, or `CANCELLED` as denial.
- Acknowledges intermediate `CHAIN` callbacks without resuming the workflow.
- Uses n8n's signed, execution-specific resume URL. No public callback secret has to be stored in
  the workflow.
- Supports outbound-only polling for private n8n installations that cannot receive callbacks.
- Includes a standalone **cQnce Approval** node with **Approved** and **Rejected** outputs for
  standard workflows that do not use an AI Agent.

## Installation

Install `n8n-nodes-cqnce` from **Settings → Community Nodes** in n8n, or install it in a self-hosted
n8n installation:

```bash
npm install n8n-nodes-cqnce
```

Restart n8n after installation.

## Credentials

Create a **cQnce API** credential in n8n and provide:

- **Base URL**: `https://api.cqnce.app` by default, or the URL of a self-hosted cQnce instance.
- **Project API Key**: the API key of the cQnce project that owns the routing rules and reviewers.

## Use as AI Agent Human Review

1. Add an n8n **AI Agent** and connect the tool that must be protected.
2. Enable human review for that tool.
3. In **Human review**, choose **cQnce**.
4. Configure the action, target, risk, routing options, and cQnce credentials.
5. Choose **Callback** or **Polling** as the delivery mode and activate the workflow.

n8n generates the internal `cqnceHitlTool` variant from this node because it exposes a webhook and
the `sendAndWait` operation. Approval runs the protected tool; any other terminal cQnce decision
prevents it from running.

## Use in a standard workflow

Add **cQnce Approval** between the step that prepares the proposed action and the action itself.
Connect its **Approved** output to the protected action and its **Rejected** output to a notification,
audit, or cancellation branch. The node accepts exactly one input item, sends that JSON object as
the request input, waits for a terminal decision, and returns the original fields plus a `cqnce`
decision object on the selected branch.

## Delivery modes

### Callback

Callback is the default and recommended mode. It suspends the execution without occupying an n8n
worker. The n8n instance must expose its signed waiting-webhook URL to cQnce.

### Polling

Polling needs only outbound HTTPS access from n8n to cQnce. The node omits `callbackUrl`, submits the
request, and polls its status through n8n's native HTTP client until it becomes terminal. Configure the interval
and timeout in the node.

Polling keeps the n8n execution and its worker active. Use it for relatively short human-review
windows and ensure that the n8n execution timeout is longer than the node's polling timeout. If the
polling timeout is reached, the node fails closed and the protected tool is not executed.

## Callback and signature model

The callback URL is produced by n8n's `getSignedResumeUrl()`. Its n8n signature binds the URL to the
waiting execution and is validated by n8n when cQnce calls it. The URL must be treated as a secret
capability and must not be logged or copied into output data.

Per-request callback HMAC signing by cQnce is not required for this integration: n8n authenticates
the unique resume URL itself. Support for an additional cQnce HMAC signature can be added when the
cQnce API supports signing per-request callback URLs.

## Development

Requires Node.js 20.15 or newer.

```bash
npm install
npm test
npm run lint
npm run build
```

Run `npm run dev` to load the package in a local n8n development instance.

## Publishing

The GitHub Actions workflow publishes the package when a GitHub Release is published. Before the
first release:

1. Create an npm automation or granular access token with permission to publish
   `n8n-nodes-cqnce`.
2. Add it to the GitHub repository as an Actions secret named `NPM_TOKEN`.
3. Create the `npm` environment in GitHub if you want environment protection or manual approval.
4. Commit the desired version in `package.json` and create a release whose tag is exactly that
   version prefixed with `v`, for example `v0.1.0`.

The publish workflow verifies the tag, installs from the lockfile, runs lint, tests and build, then
publishes the public npm package with provenance. Pull requests and pushes to `main` run the same
quality checks without publishing.

## License

[MIT](LICENSE)
