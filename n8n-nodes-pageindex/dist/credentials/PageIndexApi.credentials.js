"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PageIndexApi = void 0;
class PageIndexApi {
    constructor() {
        this.name = 'pageIndexApi';
        this.displayName = 'PageIndex API';
        this.documentationUrl = 'https://github.com/steffenzwedler/PageIndex';
        this.properties = [
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
        this.authenticate = {
            type: 'generic',
            properties: {
                headers: {
                    Authorization: '={{"Bearer " + $credentials.apiKey}}',
                },
            },
        };
        this.test = {
            request: {
                baseURL: '={{$credentials.provider === "openrouter" ? "https://openrouter.ai/api/v1" : ($credentials.provider === "custom" ? $credentials.baseUrl : "https://api.openai.com/v1")}}',
                url: '/models',
                method: 'GET',
            },
        };
    }
}
exports.PageIndexApi = PageIndexApi;
