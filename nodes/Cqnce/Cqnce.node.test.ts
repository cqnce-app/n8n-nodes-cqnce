import type { IExecuteFunctions, IWebhookFunctions } from 'n8n-workflow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Cqnce } from './Cqnce.node.js';

describe('cQnce node', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('has the shape n8n uses to generate a Human Review tool', () => {
		const description = new Cqnce().description;
		const operation = description.properties.find((property) => property.name === 'operation');

		expect(description.name.endsWith('Tool')).toBe(false);
		expect(description.webhooks).toHaveLength(1);
		expect(operation?.type).toBe('options');
		expect(operation?.options).toEqual(
			expect.arrayContaining([expect.objectContaining({ value: 'sendAndWait' })]),
		);
	});

	it('returns the nested approval result consumed by n8n HITL', async () => {
		const context = {
			getBodyData: () => ({
				requestId: 'req-1',
				status: 'APPROVED',
				event: 'request.approved',
				responses: [],
			}),
		} as unknown as IWebhookFunctions;

		const result = await new Cqnce().webhook.call(context);

		expect(result.workflowData?.[0]?.[0]?.json).toMatchObject({
			data: { approved: true, requestId: 'req-1', status: 'APPROVED' },
		});
	});

	it('acknowledges chain progress without resuming the waiting execution', async () => {
		const context = {
			getBodyData: () => ({ status: 'PENDING', event: 'chain.step_approved' }),
		} as unknown as IWebhookFunctions;

		const result = await new Cqnce().webhook.call(context);

		expect(result.workflowData).toBeUndefined();
		expect(result.webhookResponse).toEqual({
			received: true,
			resumed: false,
			status: 'PENDING',
		});
	});

	it('submits through the SDK with the signed n8n resume URL and then waits', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ requestId: 'req-sdk-1' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		);
		vi.stubGlobal('fetch', fetchMock);
		const waitMock = vi.fn().mockResolvedValue(undefined);
		const parameters: Record<string, unknown> = {
			message: 'Deploy release 42',
			action: 'Deploy',
			target: 'production',
			risk: 'Customer traffic may be affected',
			deliveryMode: 'callback',
			routingMode: 'SERIAL',
			routingRuleId: 'rule-1',
			callbackMaxRetries: 5,
			additionalPayload: '{}',
			metadata: '{"ticket":"OPS-42"}',
			attachments: '[]',
		};
		const context = {
			getInputData: () => [{ json: { toolParameters: { version: 42 }, toolCallId: 'call-1' } }],
			getCredentials: async () => ({
				baseUrl: 'https://api.cqnce.app',
				projectApiKey: 'project-key',
			}),
			getNodeParameter: (name: string) => parameters[name],
			getWorkflow: () => ({ id: 'workflow-1', name: 'Release workflow' }),
			getExecutionId: () => 'execution-1',
			getSignedResumeUrl: () => 'https://n8n.example/webhook-waiting/node?signature=signed',
			putExecutionToWait: waitMock,
			getNode: () => ({ name: 'cQnce', type: 'cqnce', typeVersion: 1, position: [0, 0] }),
		} as unknown as IExecuteFunctions;

		const result = await new Cqnce().execute.call(context);

		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
		const requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
		expect(url.toString()).toBe('https://api.cqnce.app/v1/requests');
		expect(init.headers).toEqual(expect.any(Headers));
		expect((init.headers as Headers).get('x-api-key')).toBe('project-key');
		expect(requestBody).toMatchObject({
			callbackUrl: 'https://n8n.example/webhook-waiting/node?signature=signed',
			routingMode: 'SERIAL',
			routingRuleId: 'rule-1',
			metadata: { ticket: 'OPS-42', executionId: 'execution-1', toolCallId: 'call-1' },
			payload: { action: 'Deploy', target: 'production', input: { version: 42 } },
		});
		expect(waitMock).toHaveBeenCalledOnce();
		expect(result[0][0].json.cqnce).toEqual({ requestId: 'req-sdk-1', status: 'PENDING' });
	});

	it('polls cQnce without creating an inbound callback URL', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ requestId: 'req-poll-1' }), { status: 200 }),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						requestId: 'req-poll-1',
						status: 'APPROVED',
						responses: [],
					}),
					{ status: 200 },
				),
			);
		vi.stubGlobal('fetch', fetchMock);
		const resumeUrlMock = vi.fn(() => {
			throw new Error('Polling must not request a resume URL');
		});
		const waitMock = vi.fn();
		const parameters: Record<string, unknown> = {
			message: 'Approve a private deployment',
			action: 'Deploy',
			target: 'private environment',
			risk: 'Deployment changes the running application',
			deliveryMode: 'polling',
			routingMode: '',
			routingRuleId: '',
			pollingIntervalSeconds: 5,
			pollingTimeoutMinutes: 30,
			additionalPayload: '{}',
			metadata: '{}',
			attachments: '[]',
		};
		const context = {
			getInputData: () => [{ json: { toolParameters: { release: 42 } } }],
			getCredentials: async () => ({
				baseUrl: 'https://api.cqnce.app',
				projectApiKey: 'project-key',
			}),
			getNodeParameter: (name: string) => parameters[name],
			getWorkflow: () => ({ id: 'workflow-1', name: 'Private deployment' }),
			getExecutionId: () => 'execution-2',
			getSignedResumeUrl: resumeUrlMock,
			putExecutionToWait: waitMock,
			getNode: () => ({ name: 'cQnce', type: 'cqnce', typeVersion: 1, position: [0, 0] }),
		} as unknown as IExecuteFunctions;

		const result = await new Cqnce().execute.call(context);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		const [, submitInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
		const requestBody = JSON.parse(String(submitInit.body)) as Record<string, unknown>;
		expect(requestBody).not.toHaveProperty('callbackUrl');
		expect(requestBody).not.toHaveProperty('callbackMaxRetries');
		expect(resumeUrlMock).not.toHaveBeenCalled();
		expect(waitMock).not.toHaveBeenCalled();
		expect(result[0][0].json).toMatchObject({
			data: { approved: true, requestId: 'req-poll-1', status: 'APPROVED' },
		});
	});
});
