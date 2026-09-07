import type {
	ICredentialDataDecryptedObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IWebhookFunctions,
} from 'n8n-workflow';

import { normalizeStatus, TERMINAL_STATUSES } from './utils.js';

export type RoutingMode = 'PARALLEL' | 'SERIAL' | 'MAJORITY' | 'CHAIN';

export interface SubmitRequestInput {
	payload: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	callbackUrl?: string;
	callbackMaxRetries?: number;
	routingMode?: RoutingMode;
	routingRuleId?: string;
	attachments?: Array<Record<string, unknown>>;
}

type RequestContext = Pick<IExecuteFunctions, 'helpers'> | Pick<IWebhookFunctions, 'helpers'>;

function getBaseUrl(credentials: ICredentialDataDecryptedObject): string {
	return String(credentials.baseUrl).replace(/\/+$/, '');
}

async function requestJson(
	context: RequestContext,
	credentials: ICredentialDataDecryptedObject,
	method: IHttpRequestMethods,
	path: string,
	body?: Record<string, unknown>,
	abortSignal?: AbortSignal,
): Promise<Record<string, unknown>> {
	const response = await context.helpers.httpRequest({
		method,
		url: `${getBaseUrl(credentials)}${path}`,
		headers: {
			'x-api-key': String(credentials.projectApiKey),
			...(body === undefined ? {} : { 'content-type': 'application/json' }),
		},
		...(body === undefined ? {} : { body }),
		json: true,
		abortSignal,
	});

	if (typeof response !== 'object' || response === null || Array.isArray(response)) {
		throw new Error('Invalid JSON response from cQnce');
	}
	return response as Record<string, unknown>;
}

export async function submitRequest(
	context: RequestContext,
	credentials: ICredentialDataDecryptedObject,
	input: SubmitRequestInput,
	abortSignal?: AbortSignal,
): Promise<string> {
	const response = await requestJson(
		context,
		credentials,
		'POST',
		'/v1/requests',
		input as unknown as Record<string, unknown>,
		abortSignal,
	);
	const requestId = response.requestId;
	if (typeof requestId !== 'string' || requestId.trim() === '') {
		throw new Error('Invalid cQnce response: missing requestId');
	}
	return requestId;
}

export function getRequest(
	context: RequestContext,
	credentials: ICredentialDataDecryptedObject,
	requestId: string,
): Promise<Record<string, unknown>> {
	return requestJson(
		context,
		credentials,
		'GET',
		`/v1/requests/${encodeURIComponent(requestId)}`,
	);
}

async function getRequestStatus(
	context: RequestContext,
	credentials: ICredentialDataDecryptedObject,
	requestId: string,
	abortSignal?: AbortSignal,
): Promise<Record<string, unknown>> {
	return await requestJson(
		context,
		credentials,
		'GET',
		`/v1/requests/${encodeURIComponent(requestId)}/status`,
		undefined,
		abortSignal,
	);
}

function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (abortSignal?.aborted) {
			reject(new Error('cQnce polling aborted'));
			return;
		}

		const onAbort = () => {
			clearTimeout(timeout);
			reject(new Error('cQnce polling aborted'));
		};
		const timeout = setTimeout(() => {
			abortSignal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		abortSignal?.addEventListener('abort', onAbort, { once: true });
	});
}

export async function pollUntilResolved(
	context: RequestContext,
	credentials: ICredentialDataDecryptedObject,
	requestId: string,
	options: { intervalMs: number; timeoutMs: number; abortSignal?: AbortSignal; maxErrors?: number },
): Promise<Record<string, unknown>> {
	const deadline = Date.now() + options.timeoutMs;
	const maxErrors = options.maxErrors ?? 5;
	let errorCount = 0;

	while (true) {
		if (options.abortSignal?.aborted) throw new Error('cQnce polling aborted');
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			throw new Error(`Request ${requestId} did not resolve within ${options.timeoutMs}ms`);
		}

		try {
			const response = await getRequestStatus(
				context,
				credentials,
				requestId,
				options.abortSignal,
			);
			errorCount = 0;
			if (TERMINAL_STATUSES.has(normalizeStatus(response.status))) return response;
		} catch (error) {
			errorCount++;
			if (errorCount >= maxErrors || options.abortSignal?.aborted) throw error;
		}

		await sleep(Math.min(options.intervalMs, remaining), options.abortSignal);
	}
}
