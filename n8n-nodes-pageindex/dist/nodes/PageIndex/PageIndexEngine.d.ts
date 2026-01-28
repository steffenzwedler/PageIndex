/// <reference types="node" />
/// <reference types="node" />
export interface TreeNode {
    title: string;
    node_id: string;
    start_index: number;
    end_index: number;
    summary?: string;
    nodes?: TreeNode[];
}
export interface DocumentTree {
    doc_name: string;
    doc_description?: string;
    structure: TreeNode[];
}
export interface CollectionManifest {
    files: Record<string, {
        hash: string;
        indexed_at: string;
    }>;
    created_at: string;
    updated_at?: string;
}
export interface CollectionData {
    manifest: CollectionManifest;
    documents: Record<string, DocumentTree>;
}
export interface RetrievalResult {
    doc_id: string;
    doc_name: string;
    thinking: string;
    node_ids: string[];
    nodes: {
        node_id: string;
        title: string;
        pages: string;
        summary: string;
    }[];
}
export interface LLMConfig {
    apiKey: string;
    baseUrl?: string;
    model: string;
}
export declare function countTokens(text: string): number;
export declare function extractPdfPages(buffer: Buffer): Promise<string[]>;
export declare function ingestPdf(buffer: Buffer, docName: string, config: LLMConfig): Promise<DocumentTree>;
export declare function ingestMarkdown(content: string, docName: string): DocumentTree;
export declare function ingestMarkdownWithSummaries(content: string, docName: string, config: LLMConfig): Promise<DocumentTree>;
export declare function selectDocuments(query: string, documents: Record<string, DocumentTree>, config: LLMConfig): Promise<string[]>;
export declare function treeSearch(query: string, doc: DocumentTree, config: LLMConfig): Promise<{
    thinking: string;
    node_ids: string[];
}>;
export declare function findNodeById(nodes: TreeNode[], nodeId: string): TreeNode | null;
export declare function retrieve(query: string, documents: Record<string, DocumentTree>, config: LLMConfig, mode?: 'select' | 'all', docFilter?: string): Promise<RetrievalResult[]>;
export declare function simpleHash(content: string): string;
