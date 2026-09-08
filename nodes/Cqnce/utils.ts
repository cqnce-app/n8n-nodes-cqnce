import type { IDataObject, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export const TERMINAL_STATUSES = new Set(['APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED']);

export interface CqnceCallbackBody extends IDataObject {
	requestId?: string;
	status?: string;
	event?: string;
	responses?: unknown[];
	timestamp?: string;
}

export function parseObject(
	value: unknown,
	fieldName: string,
	node: INode,
): Record<string, unknown> {
	if (value === undefined || value === null || value === '') return {};

	let parsed = value;
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value);
		} catch {
			throw new NodeOperationError(node, `${fieldName} must contain valid JSON`);
		}
	}

	if (typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new NodeOperationError(node, `${fieldName} must be a JSON object`);
	}

	return parsed as Record<string, unknown>;
}

export function parseAttachments(value: unknown, node: INode): Array<Record<string, unknown>> {
	if (value === undefined || value === null || value === '') return [];

	let parsed = value;
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value);
		} catch {
			throw new NodeOperationError(node, 'Attachments must contain valid JSON');
		}
	}

	if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'object' || entry === null)) {
		throw new NodeOperationError(node, 'Attachments must be a JSON array of objects');
	}

	return parsed as Array<Record<string, unknown>>;
}

export function normalizeStatus(value: unknown): string {
	return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function getLatestReason(responses: unknown): string | undefined {
	if (!Array.isArray(responses)) return undefined;

	for (let index = responses.length - 1; index >= 0; index--) {
		const response = responses[index];
		if (typeof response !== 'object' || response === null) continue;
		const reason = (response as Record<string, unknown>).reason;
		if (typeof reason === 'string' && reason.trim() !== '') return reason;
	}

	return undefined;
}

export function toHitlResponse(body: CqnceCallbackBody): IDataObject {
	return { data: toDecision(body) };
}

export function toDecision(body: CqnceCallbackBody): IDataObject {
	const status = normalizeStatus(body.status);
	if (!TERMINAL_STATUSES.has(status)) {
		throw new Error(`Cannot resume the workflow for non-terminal cQnce status: ${status || 'missing'}`);
	}

	return {
		approved: status === 'APPROVED',
		status,
		requestId: body.requestId,
		event: body.event,
		reason: getLatestReason(body.responses),
		responses: body.responses ?? [],
		respondedAt: body.timestamp ?? new Date().toISOString(),
	};
}
