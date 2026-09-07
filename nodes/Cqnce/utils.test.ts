import { describe, expect, it } from 'vitest';

import { getLatestReason, parseAttachments, parseObject, toHitlResponse } from './utils.js';

describe('cQnce node utilities', () => {
	it('parses JSON objects', () => {
		expect(parseObject('{"ticket":"OPS-42"}', 'Metadata')).toEqual({ ticket: 'OPS-42' });
	});

	it('rejects non-object JSON', () => {
		expect(() => parseObject('[]', 'Metadata')).toThrow('Metadata must be a JSON object');
	});

	it('parses attachments', () => {
		expect(parseAttachments('[{"name":"evidence.txt"}]')).toEqual([
			{ name: 'evidence.txt' },
		]);
	});

	it('maps approval callbacks to the n8n HITL response contract', () => {
		expect(
			toHitlResponse({
				requestId: 'req-1',
				status: 'APPROVED',
				event: 'request.approved',
				responses: [],
				timestamp: '2026-09-04T10:00:00.000Z',
			}),
		).toEqual({
			data: {
				approved: true,
				status: 'APPROVED',
				requestId: 'req-1',
				event: 'request.approved',
				reason: undefined,
				responses: [],
				respondedAt: '2026-09-04T10:00:00.000Z',
			},
		});
	});

	it.each(['REJECTED', 'EXPIRED', 'CANCELLED'])('maps %s to a denied response', (status) => {
		expect(toHitlResponse({ status }).data).toMatchObject({ approved: false, status });
	});

	it('does not resume for non-terminal callbacks', () => {
		expect(() => toHitlResponse({ status: 'PENDING' })).toThrow('non-terminal');
	});

	it('returns the most recent non-empty reviewer reason', () => {
		expect(
			getLatestReason([{ reason: 'first' }, { reason: '' }, { reason: 'final decision' }]),
		).toBe('final decision');
	});
});
