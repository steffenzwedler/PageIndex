"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.simpleHash = exports.retrieve = exports.findNodeById = exports.treeSearch = exports.selectDocuments = exports.ingestMarkdownWithSummaries = exports.ingestMarkdown = exports.ingestPdf = exports.extractPdfPages = exports.countTokens = void 0;
/**
 * PageIndex Engine - TypeScript port of the core PageIndex logic.
 * Builds hierarchical tree structures from documents and performs
 * reasoning-based retrieval using LLM tree search.
 */
const gpt_tokenizer_1 = require("gpt-tokenizer");
const openai_1 = __importDefault(require("openai"));
// ── Token Counting ─────────────────────────────────────────────────
function countTokens(text) {
    if (!text)
        return 0;
    return (0, gpt_tokenizer_1.encode)(text).length;
}
exports.countTokens = countTokens;
// ── LLM Calls ──────────────────────────────────────────────────────
async function callLLM(config, prompt) {
    const clientOpts = { apiKey: config.apiKey };
    if (config.baseUrl)
        clientOpts.baseURL = config.baseUrl;
    const client = new openai_1.default(clientOpts);
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            const response = await client.chat.completions.create({
                model: config.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0,
            });
            return response.choices[0]?.message?.content?.trim() ?? '';
        }
        catch (e) {
            if (attempt < 4) {
                await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            }
            else {
                throw e;
            }
        }
    }
    return '';
}
function parseJsonResponse(response) {
    let cleaned = response.trim();
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.split('```')[1];
        if (cleaned.startsWith('json'))
            cleaned = cleaned.slice(4);
    }
    return JSON.parse(cleaned);
}
function parseMarkdownToTree(markdown) {
    const lines = markdown.split('\n');
    const root = { title: 'Document', level: 0, content: '', children: [] };
    const stack = [root];
    let currentContent = [];
    for (const line of lines) {
        const match = line.match(/^(#{1,6})\s+(.+)/);
        if (match) {
            // Flush content to current node
            if (stack.length > 0) {
                stack[stack.length - 1].content += currentContent.join('\n');
                currentContent = [];
            }
            const level = match[1].length;
            const title = match[2].trim();
            const node = { title, level, content: '', children: [] };
            // Find parent: pop stack until we find a node with lower level
            while (stack.length > 1 && stack[stack.length - 1].level >= level) {
                stack.pop();
            }
            stack[stack.length - 1].children.push(node);
            stack.push(node);
        }
        else {
            currentContent.push(line);
        }
    }
    // Flush remaining content
    if (stack.length > 0) {
        stack[stack.length - 1].content += currentContent.join('\n');
    }
    return root;
}
let nodeIdCounter = 0;
function mdNodeToTreeNode(node) {
    const results = [];
    for (const child of node.children) {
        const treeNode = {
            title: child.title,
            node_id: String(nodeIdCounter++).padStart(4, '0'),
            start_index: 0,
            end_index: 0,
        };
        if (child.children.length > 0) {
            treeNode.nodes = mdNodeToTreeNode(child);
        }
        results.push(treeNode);
    }
    return results;
}
// ── PDF → Pages ────────────────────────────────────────────────────
async function extractPdfPages(buffer) {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    // pdf-parse returns full text; we split by form feeds if present
    const text = data.text;
    const pages = text.split('\f').filter((p) => p.trim().length > 0);
    // If no form feeds, treat as single page
    if (pages.length === 0)
        return [text];
    return pages;
}
exports.extractPdfPages = extractPdfPages;
// ── Tree Building from PDF ─────────────────────────────────────────
async function buildTreeFromPages(pages, config, maxTokensPerNode) {
    // Group pages with their text
    const pageTexts = pages.map((text, i) => ({
        pageNum: i + 1,
        text,
        tokens: countTokens(text),
    }));
    // Build page groups respecting token limits
    const fullText = pageTexts.map((p) => `--- Page ${p.pageNum} ---\n${p.text}`).join('\n');
    const prompt = `You are given the text content of a document. Your task is to generate a hierarchical "table of contents" tree structure for this document.

Each node in the tree should have:
- "title": A descriptive section title
- "start_index": The starting page number (1-based)
- "end_index": The ending page number (1-based)
- "nodes": An array of child nodes (subsections), if any

Total pages: ${pages.length}

Document text:
${fullText.slice(0, maxTokensPerNode * 3)}

Reply in JSON format only:
{
  "structure": [
    {
      "title": "Section Title",
      "start_index": 1,
      "end_index": 5,
      "nodes": [
        {
          "title": "Subsection",
          "start_index": 1,
          "end_index": 3
        }
      ]
    }
  ]
}`;
    const response = await callLLM(config, prompt);
    const parsed = parseJsonResponse(response);
    // Assign node IDs
    let idCounter = 0;
    function assignIds(nodes) {
        return nodes.map((n) => {
            const node = {
                title: n.title,
                node_id: String(idCounter++).padStart(4, '0'),
                start_index: n.start_index ?? 0,
                end_index: n.end_index ?? 0,
            };
            if (n.nodes && n.nodes.length > 0) {
                node.nodes = assignIds(n.nodes);
            }
            return node;
        });
    }
    return assignIds(parsed.structure || []);
}
// ── Summary Generation ─────────────────────────────────────────────
async function generateSummaries(tree, pages, config) {
    for (const node of tree) {
        const startIdx = Math.max(0, (node.start_index || 1) - 1);
        const endIdx = Math.min(pages.length, node.end_index || node.start_index || 1);
        const nodeText = pages.slice(startIdx, endIdx).join('\n').slice(0, 8000);
        const prompt = `Summarize the following section of a document in 2-4 sentences.

Section: "${node.title}"
Pages: ${node.start_index} to ${node.end_index}

Text:
${nodeText}

Provide a concise summary:`;
        node.summary = await callLLM(config, prompt);
        if (node.nodes) {
            await generateSummaries(node.nodes, pages, config);
        }
    }
}
// ── Document Description ───────────────────────────────────────────
async function generateDescription(structure, config) {
    const titles = flattenTitles(structure);
    const prompt = `Based on this document's table of contents, generate a one-sentence description of what this document is about.

Table of contents:
${titles.join('\n')}

One-sentence description:`;
    return callLLM(config, prompt);
}
function flattenTitles(nodes, indent = '') {
    const titles = [];
    for (const node of nodes) {
        titles.push(`${indent}${node.title}`);
        if (node.nodes) {
            titles.push(...flattenTitles(node.nodes, indent + '  '));
        }
    }
    return titles;
}
// ── Public API: Ingest Document ────────────────────────────────────
async function ingestPdf(buffer, docName, config) {
    const pages = await extractPdfPages(buffer);
    const structure = await buildTreeFromPages(pages, config, 20000);
    await generateSummaries(structure, pages, config);
    const description = await generateDescription(structure, config);
    return {
        doc_name: docName,
        doc_description: description,
        structure,
    };
}
exports.ingestPdf = ingestPdf;
function ingestMarkdown(content, docName) {
    nodeIdCounter = 0;
    const mdTree = parseMarkdownToTree(content);
    const structure = mdNodeToTreeNode(mdTree);
    return {
        doc_name: docName,
        structure,
    };
}
exports.ingestMarkdown = ingestMarkdown;
async function ingestMarkdownWithSummaries(content, docName, config) {
    nodeIdCounter = 0;
    const mdTree = parseMarkdownToTree(content);
    const structure = mdNodeToTreeNode(mdTree);
    // Use the markdown sections as "pages" for summary generation
    const sections = content.split(/(?=^#{1,6}\s)/m);
    await generateSummaries(structure, sections, config);
    const description = await generateDescription(structure, config);
    return {
        doc_name: docName,
        doc_description: description,
        structure,
    };
}
exports.ingestMarkdownWithSummaries = ingestMarkdownWithSummaries;
// ── Public API: Retrieval ──────────────────────────────────────────
async function selectDocuments(query, documents, config) {
    const docsInfo = Object.entries(documents).map(([id, doc]) => ({
        doc_id: id,
        doc_name: doc.doc_name,
        doc_description: doc.doc_description || 'No description',
    }));
    const prompt = `You are given a query and a list of documents with descriptions.
Select documents most likely to contain relevant information.

Query: ${query}

Documents:
${JSON.stringify(docsInfo, null, 2)}

Reply in JSON format only:
{
  "thinking": "<your reasoning>",
  "selected_doc_ids": ["doc_id1", "doc_id2"]
}`;
    const response = await callLLM(config, prompt);
    const parsed = parseJsonResponse(response);
    return parsed.selected_doc_ids || [];
}
exports.selectDocuments = selectDocuments;
async function treeSearch(query, doc, config) {
    const prompt = `You are given a query and the tree structure of a document.
Find all nodes likely to contain information relevant to the query.

Query: ${query}

Document: ${doc.doc_name}
Description: ${doc.doc_description || 'No description'}

Tree Structure:
${JSON.stringify(doc.structure, null, 2)}

Reply in JSON format only:
{
  "thinking": "<your reasoning>",
  "node_list": ["node_id1", "node_id2"]
}

Select the most specific nodes.`;
    const response = await callLLM(config, prompt);
    const parsed = parseJsonResponse(response);
    return {
        thinking: parsed.thinking || '',
        node_ids: parsed.node_list || [],
    };
}
exports.treeSearch = treeSearch;
function findNodeById(nodes, nodeId) {
    for (const node of nodes) {
        if (node.node_id === nodeId)
            return node;
        if (node.nodes) {
            const found = findNodeById(node.nodes, nodeId);
            if (found)
                return found;
        }
    }
    return null;
}
exports.findNodeById = findNodeById;
async function retrieve(query, documents, config, mode = 'select', docFilter) {
    let targetDocs;
    if (docFilter) {
        const doc = documents[docFilter];
        if (!doc)
            throw new Error(`Document not found: ${docFilter}`);
        targetDocs = [[docFilter, doc]];
    }
    else if (mode === 'select') {
        const selectedIds = await selectDocuments(query, documents, config);
        targetDocs = Object.entries(documents).filter(([id]) => selectedIds.includes(id));
    }
    else {
        targetDocs = Object.entries(documents);
    }
    const results = [];
    for (const [docId, doc] of targetDocs) {
        const searchResult = await treeSearch(query, doc, config);
        const nodes = searchResult.node_ids
            .map((nodeId) => {
            const node = findNodeById(doc.structure, nodeId);
            if (!node)
                return null;
            return {
                node_id: nodeId,
                title: node.title,
                pages: `${node.start_index}-${node.end_index}`,
                summary: (node.summary || '').slice(0, 500),
            };
        })
            .filter(Boolean);
        results.push({
            doc_id: docId,
            doc_name: doc.doc_name,
            thinking: searchResult.thinking,
            node_ids: searchResult.node_ids,
            nodes,
        });
    }
    return results;
}
exports.retrieve = retrieve;
// ── Hashing (for sync) ─────────────────────────────────────────────
function simpleHash(content) {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
}
exports.simpleHash = simpleHash;
