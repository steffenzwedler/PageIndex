# n8n-nodes-pageindex

Self-contained reasoning-based RAG node for n8n. No vector database, no external server required.

## What is PageIndex?

PageIndex is a reasoning-based retrieval system that uses hierarchical tree structures instead of vector embeddings. An LLM navigates through document sections using their titles and summaries to find relevant content.

## Features

- **No Vector DB Required**: Uses LLM reasoning over hierarchical indexes
- **Self-Contained**: All data stored in n8n's workflow static data
- **PDF & Markdown Support**: Ingest documents in PDF or Markdown format
- **Collection Management**: Organize documents into named collections
- **Incremental Sync**: Update collections efficiently (add/update/remove)

## Operations

| Operation | Description |
|-----------|-------------|
| **Retrieve** | Query a collection using reasoning-based tree search |
| **Ingest Document** | Index a single PDF or Markdown document |
| **Ingest Collection** | Batch index multiple documents |
| **Sync Collection** | Update collection: add new, update changed, remove deleted |
| **Collection Status** | Show indexed documents and their metadata |
| **List Collections** | List all available collections |
| **Delete Collection** | Remove a collection and all its documents |

## Credentials

Configure an OpenAI-compatible API:
- **OpenAI**: Use your OpenAI API key
- **OpenRouter**: Use OpenRouter for access to multiple models
- **Custom**: Any OpenAI-compatible endpoint

## Usage Example

### 1. Ingest Documents
Connect a "Read Binary Files" node to PageIndex with operation "Ingest Collection".

### 2. Query the Collection
Use operation "Retrieve" with your query. The node returns:
- Relevant document sections with summaries
- The LLM's reasoning for why sections were selected
- Page ranges for each match

## Installation

### Via n8n Community Nodes
1. Go to **Settings** > **Community Nodes**
2. Select **Install**
3. Enter `n8n-nodes-pageindex`
4. Click **Install**

### Manual Installation
```bash
npm install n8n-nodes-pageindex
```

## How It Works

1. **Indexing**: Documents are parsed into a hierarchical tree structure with titles, page ranges, and optional LLM-generated summaries
2. **Document Selection**: Given a query, the LLM selects relevant documents based on their descriptions
3. **Tree Search**: The LLM navigates the tree structure to find the most relevant sections
4. **Results**: Returns matching sections with their metadata and the reasoning process

## License

MIT
