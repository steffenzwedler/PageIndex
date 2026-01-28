import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	type LLMConfig,
	type DocumentTree,
	type CollectionData,
	type CollectionManifest,
	ingestPdf,
	ingestMarkdown,
	ingestMarkdownWithSummaries,
	retrieve,
	simpleHash,
} from './PageIndexEngine';

// Storage key prefix for collections
const STORAGE_PREFIX = 'pageindex_collection_';

function getCollectionKey(collectionName: string): string {
	return `${STORAGE_PREFIX}${collectionName}`;
}

export class PageIndex implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PageIndex',
		name: 'pageIndex',
		icon: 'file:pageindex.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Reasoning-based RAG without vector databases. Uses hierarchical tree search.',
		defaults: {
			name: 'PageIndex',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'pageIndexApi',
				required: true,
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
						name: 'Retrieve',
						value: 'retrieve',
						description: 'Query the collection using reasoning-based tree search',
						action: 'Retrieve from collection',
					},
					{
						name: 'Ingest Document',
						value: 'ingestDocument',
						description: 'Index a single document (PDF or Markdown)',
						action: 'Ingest a document',
					},
					{
						name: 'Ingest Collection',
						value: 'ingestCollection',
						description: 'Index multiple documents from binary inputs',
						action: 'Ingest collection',
					},
					{
						name: 'Sync Collection',
						value: 'syncCollection',
						description: 'Update collection: add new, update changed, remove deleted',
						action: 'Sync collection',
					},
					{
						name: 'Collection Status',
						value: 'collectionStatus',
						description: 'Show indexed documents and their status',
						action: 'Get collection status',
					},
					{
						name: 'List Collections',
						value: 'listCollections',
						description: 'List all available collections',
						action: 'List collections',
					},
					{
						name: 'Delete Collection',
						value: 'deleteCollection',
						description: 'Delete a collection and all its indexed documents',
						action: 'Delete collection',
					},
				],
				default: 'retrieve',
			},

			// === Retrieve Operation ===
			{
				displayName: 'Collection Name',
				name: 'collectionName',
				type: 'string',
				default: 'default',
				required: true,
				displayOptions: {
					show: {
						operation: ['retrieve', 'ingestDocument', 'ingestCollection', 'syncCollection', 'collectionStatus', 'deleteCollection'],
					},
				},
				description: 'Name of the collection to use',
			},
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['retrieve'],
					},
				},
				description: 'The query to search for in the collection',
			},
			{
				displayName: 'Search Mode',
				name: 'searchMode',
				type: 'options',
				options: [
					{ name: 'Select Best Documents', value: 'select', description: 'LLM selects most relevant documents first' },
					{ name: 'Search All Documents', value: 'all', description: 'Search through all documents in collection' },
				],
				default: 'select',
				displayOptions: {
					show: {
						operation: ['retrieve'],
					},
				},
			},
			{
				displayName: 'Filter Document',
				name: 'filterDocument',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['retrieve'],
					},
				},
				description: 'Optional: limit search to a specific document ID',
			},

			// === Ingest Document Operation ===
			{
				displayName: 'Document Name',
				name: 'documentName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['ingestDocument'],
					},
				},
				description: 'Name/ID for the document (used for retrieval)',
			},
			{
				displayName: 'Input Type',
				name: 'inputType',
				type: 'options',
				options: [
					{ name: 'Binary (PDF/File)', value: 'binary' },
					{ name: 'Text (Markdown)', value: 'text' },
				],
				default: 'binary',
				displayOptions: {
					show: {
						operation: ['ingestDocument'],
					},
				},
			},
			{
				displayName: 'Binary Property',
				name: 'binaryProperty',
				type: 'string',
				default: 'data',
				displayOptions: {
					show: {
						operation: ['ingestDocument', 'ingestCollection', 'syncCollection'],
						inputType: ['binary'],
					},
				},
				description: 'Name of the binary property containing the file',
			},
			{
				displayName: 'Markdown Content',
				name: 'markdownContent',
				type: 'string',
				typeOptions: {
					rows: 10,
				},
				default: '',
				displayOptions: {
					show: {
						operation: ['ingestDocument'],
						inputType: ['text'],
					},
				},
				description: 'Markdown content to index',
			},
			{
				displayName: 'Generate Summaries',
				name: 'generateSummaries',
				type: 'boolean',
				default: true,
				displayOptions: {
					show: {
						operation: ['ingestDocument', 'ingestCollection', 'syncCollection'],
					},
				},
				description: 'Whether to generate LLM summaries for each section (improves retrieval but uses more API calls)',
			},

			// === Sync Operation ===
			{
				displayName: 'Document Name Field',
				name: 'documentNameField',
				type: 'string',
				default: 'fileName',
				displayOptions: {
					show: {
						operation: ['ingestCollection', 'syncCollection'],
					},
				},
				description: 'JSON field containing the document name (for batch operations)',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const operation = this.getNodeParameter('operation', 0) as string;

		// Get credentials
		const credentials = await this.getCredentials('pageIndexApi');
		const provider = credentials.provider as string;
		const apiKey = credentials.apiKey as string;
		const model = credentials.model as string;

		let baseUrl: string | undefined;
		if (provider === 'openrouter') {
			baseUrl = 'https://openrouter.ai/api/v1';
		} else if (provider === 'custom') {
			baseUrl = credentials.baseUrl as string;
		}

		const llmConfig: LLMConfig = { apiKey, baseUrl, model };

		// Get workflow static data for persistent storage
		const staticData = this.getWorkflowStaticData('node');

		// Helper functions for storage
		const getCollection = (name: string): CollectionData | null => {
			const key = getCollectionKey(name);
			const data = staticData[key] as CollectionData | undefined;
			return data || null;
		};

		const saveCollection = (name: string, data: CollectionData): void => {
			const key = getCollectionKey(name);
			staticData[key] = data;
		};

		const deleteCollectionData = (name: string): boolean => {
			const key = getCollectionKey(name);
			if (staticData[key]) {
				delete staticData[key];
				return true;
			}
			return false;
		};

		const listAllCollections = (): string[] => {
			return Object.keys(staticData)
				.filter(key => key.startsWith(STORAGE_PREFIX))
				.map(key => key.slice(STORAGE_PREFIX.length));
		};

		const createEmptyCollection = (): CollectionData => ({
			manifest: {
				files: {},
				created_at: new Date().toISOString(),
			},
			documents: {},
		});

		try {
			if (operation === 'listCollections') {
				const collections = listAllCollections();
				const collectionInfo = collections.map(name => {
					const col = getCollection(name);
					return {
						name,
						documentCount: col ? Object.keys(col.documents).length : 0,
						createdAt: col?.manifest.created_at,
						updatedAt: col?.manifest.updated_at,
					};
				});

				returnData.push({
					json: {
						collections: collectionInfo,
						count: collections.length,
					},
				});
			} else if (operation === 'collectionStatus') {
				const collectionName = this.getNodeParameter('collectionName', 0) as string;
				const collection = getCollection(collectionName);

				if (!collection) {
					returnData.push({
						json: {
							exists: false,
							collectionName,
							message: 'Collection does not exist',
						},
					});
				} else {
					const documents = Object.entries(collection.documents).map(([id, doc]) => ({
						id,
						name: doc.doc_name,
						description: doc.doc_description,
						sectionCount: doc.structure.length,
						indexedAt: collection.manifest.files[id]?.indexed_at,
					}));

					returnData.push({
						json: {
							exists: true,
							collectionName,
							documentCount: documents.length,
							documents,
							createdAt: collection.manifest.created_at,
							updatedAt: collection.manifest.updated_at,
						},
					});
				}
			} else if (operation === 'deleteCollection') {
				const collectionName = this.getNodeParameter('collectionName', 0) as string;
				const deleted = deleteCollectionData(collectionName);

				returnData.push({
					json: {
						success: deleted,
						collectionName,
						message: deleted ? 'Collection deleted' : 'Collection did not exist',
					},
				});
			} else if (operation === 'retrieve') {
				const collectionName = this.getNodeParameter('collectionName', 0) as string;
				const query = this.getNodeParameter('query', 0) as string;
				const searchMode = this.getNodeParameter('searchMode', 0) as 'select' | 'all';
				const filterDocument = this.getNodeParameter('filterDocument', 0, '') as string;

				const collection = getCollection(collectionName);
				if (!collection || Object.keys(collection.documents).length === 0) {
					throw new NodeOperationError(
						this.getNode(),
						`Collection "${collectionName}" is empty or does not exist`,
					);
				}

				const results = await retrieve(
					query,
					collection.documents,
					llmConfig,
					searchMode,
					filterDocument || undefined,
				);

				returnData.push({
					json: {
						query,
						collectionName,
						results,
					},
				});
			} else if (operation === 'ingestDocument') {
				const collectionName = this.getNodeParameter('collectionName', 0) as string;
				const documentName = this.getNodeParameter('documentName', 0) as string;
				const inputType = this.getNodeParameter('inputType', 0) as string;
				const generateSummaries = this.getNodeParameter('generateSummaries', 0) as boolean;

				let collection = getCollection(collectionName) || createEmptyCollection();
				let docTree: DocumentTree;
				let contentHash: string;

				if (inputType === 'binary') {
					const binaryProperty = this.getNodeParameter('binaryProperty', 0) as string;
					const binaryData = this.helpers.assertBinaryData(0, binaryProperty);
					const buffer = await this.helpers.getBinaryDataBuffer(0, binaryProperty);

					const isPdf = binaryData.mimeType === 'application/pdf' ||
						binaryData.fileName?.toLowerCase().endsWith('.pdf');

					if (isPdf) {
						docTree = await ingestPdf(buffer, documentName, llmConfig);
					} else {
						// Treat as markdown/text
						const content = buffer.toString('utf-8');
						contentHash = simpleHash(content);
						if (generateSummaries) {
							docTree = await ingestMarkdownWithSummaries(content, documentName, llmConfig);
						} else {
							docTree = ingestMarkdown(content, documentName);
						}
					}
					contentHash = simpleHash(buffer.toString('base64').slice(0, 10000));
				} else {
					const markdownContent = this.getNodeParameter('markdownContent', 0) as string;
					contentHash = simpleHash(markdownContent);
					if (generateSummaries) {
						docTree = await ingestMarkdownWithSummaries(markdownContent, documentName, llmConfig);
					} else {
						docTree = ingestMarkdown(markdownContent, documentName);
					}
				}

				// Store the document
				collection.documents[documentName] = docTree;
				collection.manifest.files[documentName] = {
					hash: contentHash!,
					indexed_at: new Date().toISOString(),
				};
				collection.manifest.updated_at = new Date().toISOString();

				saveCollection(collectionName, collection);

				returnData.push({
					json: {
						success: true,
						collectionName,
						documentName,
						sectionCount: docTree.structure.length,
						description: docTree.doc_description,
					},
				});
			} else if (operation === 'ingestCollection' || operation === 'syncCollection') {
				const collectionName = this.getNodeParameter('collectionName', 0) as string;
				const binaryProperty = this.getNodeParameter('binaryProperty', 0) as string;
				const documentNameField = this.getNodeParameter('documentNameField', 0) as string;
				const generateSummaries = this.getNodeParameter('generateSummaries', 0) as boolean;

				let collection = getCollection(collectionName) || createEmptyCollection();
				const results: IDataObject[] = [];

				// Track which documents we've seen (for sync)
				const seenDocuments = new Set<string>();

				for (let i = 0; i < items.length; i++) {
					const item = items[i];
					const documentName = (item.json[documentNameField] as string) ||
						item.binary?.[binaryProperty]?.fileName ||
						`document_${i}`;

					seenDocuments.add(documentName);

					try {
						const binaryData = this.helpers.assertBinaryData(i, binaryProperty);
						const buffer = await this.helpers.getBinaryDataBuffer(i, binaryProperty);
						const contentHash = simpleHash(buffer.toString('base64').slice(0, 10000));

						// For sync: check if document changed
						if (operation === 'syncCollection') {
							const existingHash = collection.manifest.files[documentName]?.hash;
							if (existingHash === contentHash) {
								results.push({
									documentName,
									action: 'skipped',
									reason: 'unchanged',
								});
								continue;
							}
						}

						const isPdf = binaryData.mimeType === 'application/pdf' ||
							binaryData.fileName?.toLowerCase().endsWith('.pdf');

						let docTree: DocumentTree;
						if (isPdf) {
							docTree = await ingestPdf(buffer, documentName, llmConfig);
						} else {
							const content = buffer.toString('utf-8');
							if (generateSummaries) {
								docTree = await ingestMarkdownWithSummaries(content, documentName, llmConfig);
							} else {
								docTree = ingestMarkdown(content, documentName);
							}
						}

						collection.documents[documentName] = docTree;
						collection.manifest.files[documentName] = {
							hash: contentHash,
							indexed_at: new Date().toISOString(),
						};

						results.push({
							documentName,
							action: collection.documents[documentName] ? 'updated' : 'added',
							sectionCount: docTree.structure.length,
						});
					} catch (error) {
						results.push({
							documentName,
							action: 'error',
							error: (error as Error).message,
						});
					}
				}

				// For sync: remove documents no longer present
				if (operation === 'syncCollection') {
					for (const docId of Object.keys(collection.documents)) {
						if (!seenDocuments.has(docId)) {
							delete collection.documents[docId];
							delete collection.manifest.files[docId];
							results.push({
								documentName: docId,
								action: 'removed',
							});
						}
					}
				}

				collection.manifest.updated_at = new Date().toISOString();
				saveCollection(collectionName, collection);

				returnData.push({
					json: {
						success: true,
						collectionName,
						operation,
						documentCount: Object.keys(collection.documents).length,
						results,
					},
				});
			}
		} catch (error) {
			if (this.continueOnFail()) {
				returnData.push({
					json: {
						error: (error as Error).message,
					},
				});
			} else {
				throw error;
			}
		}

		return [returnData];
	}
}
