# PageIndex n8n Node Specification

## Overview

A single n8n community node for reasoning-based RAG. Uses **Operation** dropdown with dynamic fields per operation.

## Node Identity

- **Name:** `PageIndex`
- **Display Name:** `PageIndex`
- **Description:** Reasoning-based RAG without vector databases
- **Icon:** `file:pageindex.svg`
- **Group:** `['transform']`
- **Version:** `1`

## Credentials: `pageIndexApi`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `mcpServerUrl` | string | Yes | `http://localhost:8000` | PageIndex MCP server URL |
| `apiKey` | string | No | - | API key (passed to MCP server if needed) |

## Operations & Fields

### Operation: `retrieve`
**Description:** Query documents using reasoning-based retrieval

| Field | Display Name | Type | Required | Default | Description |
|-------|--------------|------|----------|---------|-------------|
| `collection` | Collection | string | Yes | - | Collection name to search |
| `query` | Query | string | Yes | - | Search query |
| `mode` | Mode | options | No | `select` | `select`: LLM picks docs, `all`: search all |
| `document` | Document ID | string | No | - | Specific document to search |
| `model` | Model | string | No | - | LLM model override |

### Operation: `ingestCollection`
**Description:** Ingest all documents from a folder into a collection

| Field | Display Name | Type | Required | Default | Description |
|-------|--------------|------|----------|---------|-------------|
| `inputDir` | Source Folder | string | Yes | - | Path to folder with PDF/Markdown files |
| `collection` | Collection | string | Yes | - | Collection name (will be created) |
| `model` | Model | string | No | - | LLM model for processing |

### Operation: `syncCollection`
**Description:** Sync collection with source folder (add/update/remove)

| Field | Display Name | Type | Required | Default | Description |
|-------|--------------|------|----------|---------|-------------|
| `inputDir` | Source Folder | string | Yes | - | Path to source folder |
| `collection` | Collection | string | Yes | - | Collection name |
| `model` | Model | string | No | - | LLM model for processing |

### Operation: `collectionStatus`
**Description:** Get collection status and pending changes

| Field | Display Name | Type | Required | Default | Description |
|-------|--------------|------|----------|---------|-------------|
| `collection` | Collection | string | Yes | - | Collection name |
| `inputDir` | Source Folder | string | No | - | Path to check for pending changes |

### Operation: `listCollections`
**Description:** List all available collections

*No additional fields required*

### Operation: `ingestDocument`
**Description:** Ingest a single document into a collection

| Field | Display Name | Type | Required | Default | Description |
|-------|--------------|------|----------|---------|-------------|
| `filePath` | File Path | string | Yes | - | Path to PDF or Markdown file |
| `collection` | Collection | string | Yes | - | Target collection name |
| `model` | Model | string | No | - | LLM model for processing |

## Output Schemas

### retrieve
```json
{
  "results": [{
    "doc_id": "string",
    "doc_name": "string",
    "thinking": "string",
    "nodes": [{
      "node_id": "string",
      "title": "string",
      "pages": "string",
      "summary": "string"
    }]
  }]
}
```

### ingestCollection / syncCollection
```json
{
  "processed": ["doc1", "doc2"],
  "added": ["doc3"],
  "updated": ["doc1"],
  "removed": ["doc4"],
  "errors": [{"doc_id": "x", "error": "message"}]
}
```

### collectionStatus
```json
{
  "collection": "name",
  "created": "ISO date",
  "updated": "ISO date",
  "documents": ["doc1", "doc2"],
  "pending": {
    "new": ["doc3"],
    "modified": ["doc1"],
    "removed": ["doc4"]
  }
}
```

### listCollections
```json
{
  "collections": [{
    "name": "string",
    "documents": 5,
    "updated": "ISO date"
  }]
}
```

### ingestDocument
```json
{
  "doc_id": "document_name",
  "status": "success",
  "collection": "name"
}
```
