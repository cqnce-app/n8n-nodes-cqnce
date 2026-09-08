/* eslint-disable @n8n/community-nodes/webhook-lifecycle-complete -- cQnce receives a signed, per-request n8n resume URL; there is no persistent third-party webhook to register or delete. */
import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	pollUntilResolved,
	type RoutingMode,
	submitRequest,
	type SubmitRequestInput,
} from './transport.js';

import {
	type CqnceCallbackBody,
	normalizeStatus,
	parseAttachments,
	parseObject,
	TERMINAL_STATUSES,
	toHitlResponse,
} from './utils.js';

const WAIT_INDEFINITELY = new Date('3000-01-01T00:00:00.000Z');

export class Cqnce implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'cQnce',
		name: 'cqnce',
		icon: {
			light: 'file:cqnce.light.svg',
			dark: 'file:cqnce.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] === "sendAndWait" ? "Human authorization" : ""}}',
		description: 'Pause a workflow and request human authorization through cQnce',
		usableAsTool: true,
		defaults: { name: 'cQnce Human Review' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'cqnceApi', required: true }],
		codex: {
			categories: ['HITL'],
			subcategories: { HITL: ['Human in the Loop'] },
		},
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: '={{$nodeId}}',
				restartWebhook: true,
				isFullPath: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Send and Wait for Authorization',
						value: 'sendAndWait',
						description: 'Send an authorization request to cQnce and resume after a final decision',
						action: 'Send and wait for authorization',
					},
				],
				default: 'sendAndWait',
			},
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				typeOptions: { rows: 4 },
				default: 'Review and authorize this action',
				required: true,
				description: 'Explanation shown to the human reviewer',
			},
			{
				displayName: 'Action',
				name: 'action',
				type: 'string',
				default: 'Execute an n8n action',
				required: true,
				description: 'Concise description of the action being authorized',
			},
			{
				displayName: 'Target',
				name: 'target',
				type: 'string',
				default: 'n8n workflow',
				required: true,
				description: 'Exact resource or system affected by the action',
			},
			{
				displayName: 'Risk',
				name: 'risk',
				type: 'string',
				typeOptions: { rows: 3 },
				default: 'If approved, the connected action will run. If rejected, it will not run.',
				required: true,
			},
			{
				displayName: 'Delivery Mode',
				name: 'deliveryMode',
				type: 'options',
				options: [
					{
						name: 'Callback',
						value: 'callback',
						description: 'Wait without occupying a worker and resume through an inbound callback',
					},
					{
						name: 'Polling',
						value: 'polling',
						description: 'Poll cQnce using outbound requests when n8n cannot receive callbacks',
					},
				],
				default: 'callback',
			},
			{
				displayName: 'Routing Mode',
				name: 'routingMode',
				type: 'options',
				options: [
					{ name: 'Chain', value: 'CHAIN' },
					{ name: 'Majority', value: 'MAJORITY' },
					{ name: 'Parallel', value: 'PARALLEL' },
					{ name: 'Serial', value: 'SERIAL' },
					{ name: 'Use Project Routing Rules', value: '' },
				],
				default: '',
				description: 'Optionally override the routing mode selected by cQnce',
			},
			{
				displayName: 'Routing Rule ID',
				name: 'routingRuleId',
				type: 'string',
				default: '',
				description: 'Optionally select a cQnce routing rule directly',
			},
			{
				displayName: 'Callback Retry Count',
				name: 'callbackMaxRetries',
				type: 'number',
				typeOptions: { minValue: 0, maxValue: 20 },
				default: 5,
				description: 'Number of callback retries after the first delivery attempt',
				displayOptions: { show: { deliveryMode: ['callback'] } },
			},
			{
				displayName: 'Polling Interval (Seconds)',
				name: 'pollingIntervalSeconds',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 300 },
				default: 5,
				description: 'Seconds between cQnce status requests',
				displayOptions: { show: { deliveryMode: ['polling'] } },
			},
			{
				displayName: 'Polling Timeout (Minutes)',
				name: 'pollingTimeoutMinutes',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 10080 },
				default: 30,
				description: 'Maximum time to wait before failing the execution closed',
				displayOptions: { show: { deliveryMode: ['polling'] } },
			},
			{
				displayName: 'Additional Payload',
				name: 'additionalPayload',
				type: 'json',
				default: '{}',
				description: 'Additional fields merged into the cQnce request payload',
			},
			{
				displayName: 'Metadata',
				name: 'metadata',
				type: 'json',
				default: '{}',
				description: 'Additional cQnce request metadata',
			},
			{
				displayName: 'Attachments',
				name: 'attachments',
				type: 'json',
				default: '[]',
				description: 'Optional cQnce attachments as a JSON array of attachment objects',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		if (items.length !== 1) {
			throw new NodeOperationError(
				this.getNode(),
				`cQnce Send and Wait expects exactly one input item, but received ${items.length}`,
			);
		}

		try {
			const credentials = await this.getCredentials('cqnceApi');
			const abortSignal = this.getExecutionCancelSignal();

			const message = this.getNodeParameter('message', 0) as string;
			const action = this.getNodeParameter('action', 0) as string;
			const target = this.getNodeParameter('target', 0) as string;
			const risk = this.getNodeParameter('risk', 0) as string;
			const deliveryMode = this.getNodeParameter('deliveryMode', 0) as 'callback' | 'polling';
			const routingMode = this.getNodeParameter('routingMode', 0) as RoutingMode | '';
			const routingRuleId = (this.getNodeParameter('routingRuleId', 0) as string).trim();
			const additionalPayload = parseObject(
				this.getNodeParameter('additionalPayload', 0),
				'Additional Payload',
				this.getNode(),
			);
			const customMetadata = parseObject(
				this.getNodeParameter('metadata', 0),
				'Metadata',
				this.getNode(),
			);
			const attachments = parseAttachments(
				this.getNodeParameter('attachments', 0),
				this.getNode(),
			);
			const workflow = this.getWorkflow();
			const input = items[0].json.toolParameters ?? items[0].json;

			const request: SubmitRequestInput = {
				payload: {
					...additionalPayload,
					action,
					target,
					reason: message,
					risk,
					input,
				},
				metadata: {
					...customMetadata,
					integration: 'n8n',
					workflowId: workflow.id,
					workflowName: workflow.name,
					executionId: this.getExecutionId(),
					toolCallId: items[0].json.toolCallId,
					deliveryMode,
				},
			};

			if (routingMode) request.routingMode = routingMode;
			if (routingRuleId) request.routingRuleId = routingRuleId;
			if (attachments.length > 0) request.attachments = attachments;
			if (deliveryMode === 'callback') {
				request.callbackUrl = this.getSignedResumeUrl();
				request.callbackMaxRetries = this.getNodeParameter('callbackMaxRetries', 0) as number;
			}

			const requestId = await submitRequest(this, credentials, request, abortSignal);

			if (deliveryMode === 'polling') {
				const intervalMs =
					(this.getNodeParameter('pollingIntervalSeconds', 0) as number) * 1_000;
				const timeoutMs =
					(this.getNodeParameter('pollingTimeoutMinutes', 0) as number) * 60_000;
				const finalResult = await pollUntilResolved(this, credentials, requestId, {
					intervalMs,
					timeoutMs,
					abortSignal,
				});
				const callbackBody = { requestId, ...finalResult } as CqnceCallbackBody;

				return [[{ json: toHitlResponse(callbackBody), pairedItem: { item: 0 } }]];
			}

			await this.putExecutionToWait(WAIT_INDEFINITELY);

			return [
				[
					{
						json: {
							...items[0].json,
							cqnce: { requestId, status: 'PENDING' },
						} as IDataObject,
						pairedItem: { item: 0 },
					},
				],
			];
		} catch (error) {
			throw new NodeOperationError(this.getNode(), error as Error);
		}
	}

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = this.getBodyData() as IDataObject;
		const status = normalizeStatus(body.status);

		// CHAIN routing emits progress callbacks. Acknowledge them without resuming n8n.
		if (!TERMINAL_STATUSES.has(status)) {
			return {
				webhookResponse: {
					received: true,
					resumed: false,
					status: status || 'UNKNOWN',
				},
			};
		}

		return {
			workflowData: [[{ json: toHitlResponse(body), pairedItem: { item: 0 } }]],
		};
	}
}
