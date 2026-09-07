import type { IExecuteFunctions, IWebhookFunctions } from 'n8n-workflow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CqnceApproval } from './CqnceApproval.node.js';

const baseParameters: Record<string, unknown> = {
	message: 'Approve order',
	action: 'Create order',
	target: 'order system',
	risk: 'An order will be created',
	deliveryMode: 'polling',
	routingMode: '',
	routingRuleId: '',
	pollingIntervalSeconds: 1,
	pollingTimeoutMinutes: 1,
	additionalPayload: '{}',
	metadata: '{}',
	attachments: '[]',
};

function executionContext(
	parameters: Record<string, unknown>,
	httpRequest: ReturnType<typeof vi.fn>,
): IExecuteFunctions {
	return {
		getInputData: () => [{ json: { orderId: 'order-42', amount: 99 } }],
		getCredentials: async () => ({
			baseUrl: 'https://api.cqnce.app',
			projectApiKey: 'project-key',
		}),
		getNodeParameter: (name: string) => parameters[name],
		getWorkflow: () => ({ id: 'workflow-1', name: 'Order workflow' }),
		getExecutionId: () => 'execution-1',
		getExecutionCancelSignal: () => undefined,
		helpers: { httpRequest },
		getNode: () => ({ name: 'Approval', type: 'cqnceApproval', typeVersion: 1, position: [0, 0] }),
	} as unknown as IExecuteFunctions;
}

describe('cQnce Approval node', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('exposes two named standard workflow outputs', () => {
		const description = new CqnceApproval().description;
		expect(description.outputs).toHaveLength(2);
		expect(description.outputNames).toEqual(['Approved', 'Rejected']);
		expect(description.properties.some((property) => property.name === 'operation')).toBe(false);
	});

	it.each([
		['APPROVED', 0, 1],
		['REJECTED', 1, 0],
	] as const)('routes %s to the expected output', async (status, selected, empty) => {
		const httpRequestMock = vi
			.fn()
			.mockResolvedValueOnce({ requestId: 'req-1' })
			.mockResolvedValueOnce({ requestId: 'req-1', status, responses: [] });

		const result = await new CqnceApproval().execute.call(
			executionContext({ ...baseParameters }, httpRequestMock),
		);

		expect(result[selected]).toHaveLength(1);
		expect(result[empty]).toHaveLength(0);
		expect(result[selected][0].json).toMatchObject({
			orderId: 'order-42',
			amount: 99,
			cqnce: { approved: status === 'APPROVED', status, requestId: 'req-1' },
		});
	});

	it('restores the submitted input and routes it when a callback resumes the workflow', async () => {
		const httpRequestMock = vi
			.fn()
			.mockResolvedValue({ payload: { input: { orderId: 'order-42', amount: 99 } } });
		const context = {
			getBodyData: () => ({ requestId: 'req-1', status: 'APPROVED', responses: [] }),
			getCredentials: async () => ({
				baseUrl: 'https://api.cqnce.app',
				projectApiKey: 'project-key',
			}),
			helpers: { httpRequest: httpRequestMock },
		} as unknown as IWebhookFunctions;

		const result = await new CqnceApproval().webhook.call(context);

		expect(result.workflowData?.[0]).toHaveLength(1);
		expect(result.workflowData?.[1]).toHaveLength(0);
		expect(result.workflowData?.[0]?.[0].json).toMatchObject({
			orderId: 'order-42',
			amount: 99,
			cqnce: { approved: true, status: 'APPROVED', requestId: 'req-1' },
		});
	});
});
