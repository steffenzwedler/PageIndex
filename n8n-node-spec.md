# PageIndex n8n Node Specification

## Overview

A single n8n node that replaces typical RAG nodes with reasoning-based retrieval. Uses an **Operation** dropdown to select the desired action.

## Node Design

### Node Name
`PageIndex`

### Node Description
Reasoning-based RAG: collection management and retrieval without vector databases.

### Credentials
```typescript
{
  name: 'pageIndexApi',
  required: true,
  properties: [
    { name: 'apiKey', type: 'string', description: 'OpenAI or OpenRouter API key' },
    { name: 'baseUrl', type: 'string', default: '', description: 'Optional: OpenRouter base URL' },
    { name: 'mcpServerUrl', type: 'string', default: 'http://localhost:8000', description: 'PageIndex MCP server URL' }
  ]
}
```

## Operations (Dropdown)

### 1. Retrieve
**Primary use case** - Query a collection

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| collection | string | Yes | Collection name |
| query | string | Yes | Search query |
| mode | options | No | `select` (LLM picks docs) / `all` (search all) |
| document | string | No | Specific document ID |
| model | string | No | LLM model override |

**Output:**
```json
{
  "results": [
    {
      "doc_id": "Annual_Report_2023",
      "thinking": "...",
      "nodes": [
        {"node_id": "0005", "title": "Revenue", "pages": "12-15", "summary": "..."}
      ]
    }
  ]
}
```

### 2. Ingest Collection
**Batch ingest** - Create collection from folder

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| inputDir | string | Yes | Source folder path |
| collection | string | Yes | Collection name |
| model | string | No | LLM model |

**Output:**
```json
{
  "processed": ["doc1", "doc2"],
  "errors": []
}
```

### 3. Sync Collection
**Incremental update** - Add/update/remove changed files

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| inputDir | string | Yes | Source folder path |
| collection | string | Yes | Collection name |
| model | string | No | LLM model |

**Output:**
```json
{
  "added": ["new_doc"],
  "updated": ["modified_doc"],
  "removed": ["deleted_doc"],
  "errors": []
}
```

### 4. Collection Status
**Check state** - List documents and pending changes

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| collection | string | Yes | Collection name |
| inputDir | string | No | Source folder (to detect changes) |

**Output:**
```json
{
  "collection": "financial",
  "documents": ["doc1", "doc2"],
  "pending": {"new": [], "modified": [], "removed": []}
}
```

### 5. List Collections
**Discovery** - List all available collections

| Field | Type | Required | Description |
|-------|------|----------|-------------|

**Output:**
```json
{
  "collections": [
    {"name": "financial", "documents": 5, "updated": "2024-01-15T10:30:00"}
  ]
}
```

### 6. Ingest Single Document
**Single file** - Add one document to collection

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| filePath | string | Yes | Path to PDF/Markdown |
| collection | string | Yes | Collection name |
| model | string | No | LLM model |

**Output:**
```json
{
  "doc_id": "document_name",
  "status": "success"
}
```

## Comparison: PageIndex vs Traditional RAG Nodes

| Aspect | Traditional RAG | PageIndex |
|--------|-----------------|-----------|
| Indexing | Chunking + Embeddings | Hierarchical tree structure |
| Storage | Vector DB (Pinecone, etc.) | JSON files |
| Retrieval | Similarity search | LLM reasoning |
| Explainability | Low (vector similarity) | High (reasoning trace) |
| Setup | Complex (DB, embeddings) | Simple (files only) |

## Implementation Approach

### Option A: HTTP API Node
Call the MCP server via HTTP. Simple, works with Docker setup.

```typescript
// n8n execute method
async execute() {
  const operation = this.getNodeParameter('operation');
  const mcpUrl = credentials.mcpServerUrl;

  const response = await this.helpers.httpRequest({
    method: 'POST',
    url: `${mcpUrl}/call_tool`,
    body: { name: operation, arguments: params }
  });

  return [this.helpers.returnJsonArray(response)];
}
```

### Option B: Direct Python Execution
Use n8n's Python node or Code node to call PageIndex directly.

```javascript
// Code node
const { execSync } = require('child_process');
const result = execSync(`python run_retrieval.py --collection-dir ${collection} --query "${query}" --output json`);
return JSON.parse(result);
```

### Option C: Native TypeScript Node
Port core logic to TypeScript for native n8n node. Most work but best integration.

## Recommended: Option A (HTTP API)

**Reasons:**
1. Reuses existing Python code
2. Works with Docker Compose
3. Separates concerns (n8n = orchestration, PageIndex = RAG)
4. Easy to scale/update independently

## Example n8n Workflow

```
[Webhook] → [PageIndex: Retrieve] → [OpenAI: Generate Answer] → [Respond]
                    ↑
            collection: "financial"
            query: {{$json.question}}
            mode: "select"
```

## Docker Integration

Add to n8n's docker-compose.yml:
```yaml
services:
  n8n:
    environment:
      - PAGEINDEX_MCP_URL=http://pageindex-mcp:8000
    depends_on:
      - pageindex-mcp

  pageindex-mcp:
    image: pageindex-mcp:latest
    volumes:
      - ./collections:/data/collections
    environment:
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
```

## Conclusion

PageIndex can elegantly replace traditional RAG nodes by:
1. **Simpler architecture** - No vector DB needed
2. **Better accuracy** - Reasoning > similarity
3. **Single node** - All operations via dropdown
4. **Docker-ready** - Easy integration with n8n stack
