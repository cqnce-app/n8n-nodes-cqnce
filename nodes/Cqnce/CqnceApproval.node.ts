import type {
	IExecuteFunctions,
	IDataObject,
	IHookFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	getRequest,
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
	toDecision,
} from './utils.js';

const WAIT_INDEFINITELY = new Date('3000-01-01T00:00:00.000Z');

function asInputItem(value: unknown): IDataObject {
	if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
		return value as IDataObject;
	}
	return value === undefined ? {} : { input: value as string | number | boolean };
}

function routeDecision(input: IDataObject, decision: IDataObject): INodeExecutionData[][] {
	const item: INodeExecutionData = {
		json: { ...input, cqnce: decision },
		pairedItem: { item: 0 },
	};
	return decision.approved === true ? [[item], []] : [[], [item]];
}

export class CqnceApproval implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'cQnce Approval',
		name: 'cqnceApproval',
		icon: {
			light: 'file:cqnce.light.svg',
			dark: 'file:cqnce.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["deliveryMode"]}}',
		description: 'Wait for a cQnce decision and route the item to Approved or Rejected',
		usableAsTool: true,
		defaults: { name: 'cQnce Approval' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main, NodeConnectionTypes.Main],
		outputNames: ['Approved', 'Rejected'],
		credentials: [{ name: 'cqnceApi', required: true }],
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
				displayName: 'Message',
				name: 'message',
				type: 'string',
				typeOptions: { rows: 4 },
				default: 'Review and authorize this workflow action',
				required: true,
			},
			{
				displayName: 'Action',
				name: 'action',
				type: 'string',
				default: 'Execute an n8n workflow action',
				required: true,
			},
			{
				displayName: 'Target',
				name: 'target',
				type: 'string',
				default: 'n8n workflow',
				required: true,
			},
			{
				displayName: 'Risk',
				name: 'risk',
				type: 'string',
				typeOptions: { rows: 3 },
				default: 'If approved, the Approved branch runs. Otherwise, the Rejected branch runs.',
				required: true,
			},
			{
				displayName: 'Delivery Mode',
				name: 'deliveryMode',
				type: 'options',
				options: [
					{ name: 'Callback', value: 'callback' },
					{ name: 'Polling', value: 'polling' },
				],
				default: 'polling',
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
			},
			{
				displayName: 'Routing Rule ID',
				name: 'routingRuleId',
				type: 'string',
				default: '',
			},
			{
				displayName: 'Callback Retry Count',
				name: 'callbackMaxRetries',
				type: 'number',
				typeOptions: { minValue: 0, maxValue: 20 },
				default: 5,
				displayOptions: { show: { deliveryMode: ['callback'] } },
			},
			{
				displayName: 'Polling Interval (Seconds)',
				name: 'pollingIntervalSeconds',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 300 },
				default: 5,
				displayOptions: { show: { deliveryMode: ['polling'] } },
			},
			{
				displayName: 'Polling Timeout (Minutes)',
				name: 'pollingTimeoutMinutes',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 10080 },
				default: 30,
				displayOptions: { show: { deliveryMode: ['polling'] } },
			},
			{
				displayName: 'Additional Payload',
				name: 'additionalPayload',
				type: 'json',
				default: '{}',
			},
			{
				displayName: 'Metadata',
				name: 'metadata',
				type: 'json',
				default: '{}',
			},
			{
				displayName: 'Attachments',
				name: 'attachments',
				type: 'json',
				default: '[]',
			},
		],
	};

	// cQnce receives an n8n-signed resume URL per request. There is no persistent
	// third-party webhook registration to create, inspect, or remove.
	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		if (items.length !== 1) {
			throw new NodeOperationError(
				this.getNode(),
				`cQnce Approval expects exactly one input item, but received ${items.length}`,
			);
		}

		try {
			const credentials = await this.getCredentials('cqnceApi');
			const abortSignal = this.getExecutionCancelSignal();
			const deliveryMode = this.getNodeParameter('deliveryMode', 0) as 'callback' | 'polling';
			const routingMode = this.getNodeParameter('routingMode', 0) as RoutingMode | '';
			const routingRuleId = (this.getNodeParameter('routingRuleId', 0) as string).trim();
			const workflow = this.getWorkflow();
			const request: SubmitRequestInput = {
				payload: {
					...parseObject(
						this.getNodeParameter('additionalPayload', 0),
						'Additional Payload',
						this.getNode(),
					),
					action: this.getNodeParameter('action', 0) as string,
					target: this.getNodeParameter('target', 0) as string,
					reason: this.getNodeParameter('message', 0) as string,
					risk: this.getNodeParameter('risk', 0) as string,
					input: items[0].json,
				},
				metadata: {
					...parseObject(
						this.getNodeParameter('metadata', 0),
						'Metadata',
						this.getNode(),
					),
					integration: 'n8n',
					nodeType: 'approval',
					workflowId: workflow.id,
					workflowName: workflow.name,
					executionId: this.getExecutionId(),
					deliveryMode,
				},
			};
			if (routingMode) request.routingMode = routingMode;
			if (routingRuleId) request.routingRuleId = routingRuleId;
			const attachments = parseAttachments(
				this.getNodeParameter('attachments', 0),
				this.getNode(),
			);
			if (attachments.length > 0) request.attachments = attachments;
			if (deliveryMode === 'callback') {
				request.callbackUrl = this.getSignedResumeUrl();
				request.callbackMaxRetries = this.getNodeParameter('callbackMaxRetries', 0) as number;
			}

			const requestId = await submitRequest(this, credentials, request, abortSignal);
			if (deliveryMode === 'callback') {
				await this.putExecutionToWait(WAIT_INDEFINITELY);
				return [
					[
						{
							json: { ...items[0].json, cqnce: { requestId, status: 'PENDING' } },
							pairedItem: { item: 0 },
						},
					],
					[],
				];
			}

			const finalResult = await pollUntilResolved(this, credentials, requestId, {
				intervalMs: (this.getNodeParameter('pollingIntervalSeconds', 0) as number) * 1_000,
				timeoutMs: (this.getNodeParameter('pollingTimeoutMinutes', 0) as number) * 60_000,
				abortSignal,
			});
			const decision = toDecision({ requestId, ...finalResult } as CqnceCallbackBody);
			return routeDecision(items[0].json, decision);
		} catch (error) {
			throw new NodeOperationError(this.getNode(), error as Error);
		}
	}

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = this.getBodyData() as CqnceCallbackBody;
		const status = normalizeStatus(body.status);
		if (!TERMINAL_STATUSES.has(status)) {
			return { webhookResponse: { received: true, resumed: false, status: status || 'UNKNOWN' } };
		}

		let input: IDataObject = {};
		if (body.requestId) {
			const credentials = await this.getCredentials('cqnceApi');
			const request = await getRequest(this, credentials, body.requestId);
			const payload = request.payload as Record<string, unknown> | undefined;
			input = asInputItem(payload?.input);
		}

		return { workflowData: routeDecision(input, toDecision(body)) };
	}
}
