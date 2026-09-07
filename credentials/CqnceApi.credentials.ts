import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class CqnceApi implements ICredentialType {
	name = 'cqnceApi';

	displayName = 'cQnce API';

	icon = 'file:../nodes/Cqnce/cqnce.svg' as const;

	documentationUrl = 'https://github.com/cqnce-app/n8n-nodes-cqnce#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.cqnce.app',
			required: true,
			description: 'Base URL of the cQnce API, without a trailing slash',
		},
		{
			displayName: 'Project API Key',
			name: 'projectApiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-api-key': '={{$credentials.projectApiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}',
			url: '/v1/requests',
			method: 'GET',
			qs: { limit: 1 },
		},
	};
}
