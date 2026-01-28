import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class PageIndexApi implements ICredentialType {
	name = 'pageIndexApi';
	displayName = 'PageIndex API';
	documentationUrl = 'https://github.com/steffenzwedler/PageIndex';
	properties: INodeProperties[] = [
		{
			displayName: 'API Provider',
			name: 'provider',
			type: 'options',
			options: [
				{ name: 'OpenAI', value: 'openai' },
				{ name: 'OpenRouter', value: 'openrouter' },
				{ name: 'Custom (OpenAI-compatible)', value: 'custom' },
			],
			default: 'openai',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: '',
			placeholder: 'https://api.openai.com/v1',
			description: 'Only needed for Custom provider. OpenAI and OpenRouter URLs are set automatically.',
			displayOptions: {
				show: {
					provider: ['custom'],
				},
			},
		},
		{
			displayName: 'Model',
			name: 'model',
			type: 'string',
			default: 'gpt-4o-mini',
			description: 'Model to use for indexing and retrieval. For OpenRouter, use format: openai/gpt-4o-mini',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '={{"Bearer " + $credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.provider === "openrouter" ? "https://openrouter.ai/api/v1" : ($credentials.provider === "custom" ? $credentials.baseUrl : "https://api.openai.com/v1")}}',
			url: '/models',
			method: 'GET',
		},
	};
}
