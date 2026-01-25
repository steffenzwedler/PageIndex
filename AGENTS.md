# AGENTS.md - AI Assistant Knowledge Base

This file contains accumulated knowledge about the PageIndex project for AI assistants.

## Project Overview

PageIndex is a **vectorless, reasoning-based RAG (Retrieval-Augmented Generation) system**. It explicitly avoids traditional vector databases in favor of hierarchical tree index structures and LLM-driven reasoning.

## Storage Architecture

### No Traditional Database Backend

PageIndex **intentionally does not use databases or vector stores**. This is a core architectural decision.

| Aspect | Implementation |
|--------|----------------|
| **Storage Type** | File-based JSON |
| **Output Location** | `./results/` directory |
| **File Format** | Hierarchical JSON tree structures |
| **Naming Pattern** | `{document_name}_structure.json` |

### Why No Vector DB?

- Designed for **reasoning-based retrieval** instead of approximate vector similarity
- Prioritizes **transparency and simplicity**
- Uses **LLM reasoning** to navigate hierarchical document structures

## External Dependencies

### LLM Service (Only External Backend)

- **Provider**: OpenAI API or OpenRouter
- **Environment Variables**:
  - `CHATGPT_API_KEY` for OpenAI direct
  - `OPENROUTER_API_KEY` for OpenRouter (auto-detected, takes precedence)
- **Default Model**: `gpt-4o-2024-11-20`
- **Configurable**: Yes, via `--model` CLI parameter
- **OpenRouter Usage**: Use provider-prefixed model names, e.g., `openai/gpt-4o-mini`

### No Database Libraries

The project has no database drivers in `requirements.txt`:
- No vector stores (Pinecone, Weaviate, Milvus, Chroma, etc.)
- No SQL connectors
- No NoSQL drivers

## Supported Input Formats

- PDF files (.pdf) - Primary format
- Markdown files (.md, .markdown)
- BytesIO objects (programmatic access)

## CLI Usage for Collections

### Understanding Collections

A **collection** = one folder containing indexed documents about a related topic.

**One collection per topic** - if you have disjunct topics, create separate collections:

```
collections/
├── financial_reports/     # Query with: --collection-dir ./collections/financial_reports
├── legal_contracts/       # Query with: --collection-dir ./collections/legal_contracts
└── research_papers/       # Query with: --collection-dir ./collections/research_papers
```

**Why separate?**
- Faster retrieval (smaller search space)
- Better accuracy (LLM selects from related docs)
- Independent sync/maintenance per topic

### Batch Ingestion: Create Collection from Folder

Use `run_collection.py` to ingest an entire folder of PDFs/Markdown files:

```bash
# Ingest all PDFs from a folder into a collection
python run_collection.py \
  --input-dir ./source_pdfs/financial \
  --output-dir ./results/financial_reports \
  --ingest
```

This will:
- Process all `.pdf` and `.md` files in the input folder
- Create `*_structure.json` files in the output collection
- Create a `_collection_manifest.json` tracking file hashes

### Sync Collection: Incremental Updates

When source files change, use `--sync` instead of re-ingesting everything:

```bash
# Sync collection with source folder
python run_collection.py \
  --input-dir ./source_pdfs/financial \
  --output-dir ./results/financial_reports \
  --sync
```

This will:
- **Add** new PDFs that were added to the source folder
- **Update** PDFs that were modified (detected via file hash)
- **Remove** structure files for PDFs that were deleted from source

### Check Collection Status

```bash
# Show what's in the collection and pending changes
python run_collection.py \
  --input-dir ./source_pdfs/financial \
  --output-dir ./results/financial_reports \
  --status
```

Output example:
```
Collection: ./results/financial_reports
Created:    2024-01-15T10:30:00
Updated:    2024-01-20T14:22:00
Documents:  5

Indexed documents:
  - 10K_2023
      Source: /path/to/source_pdfs/financial/10K_2023.pdf
      Indexed: 2024-01-15T10:30:00
  - 10K_2024
      ...

Pending changes (run --sync to apply):
  [NEW] Q1_2024
  [MODIFIED] 10K_2024
  [DELETED] old_report
```

### Collection Manifest

Each collection has a `_collection_manifest.json` that tracks:
- File paths and hashes (for change detection)
- When each file was indexed
- Collection creation/update timestamps

### Single File Ingestion (Original Method)

Use `--output-dir` to ingest documents into separate collection folders:

```bash
# Create a "financial_reports" collection
python run_pageindex.py --pdf_path 10K_2023.pdf --output-dir ./results/financial_reports
python run_pageindex.py --pdf_path 10K_2024.pdf --output-dir ./results/financial_reports

# Create a "legal_documents" collection
python run_pageindex.py --pdf_path contract_A.pdf --output-dir ./results/legal_documents

# Create a "research_papers" collection
python run_pageindex.py --md_path paper.md --output-dir ./results/research_papers
```

**Result:**
```
results/
├── financial_reports/
│   ├── 10K_2023_structure.json
│   └── 10K_2024_structure.json
├── legal_documents/
│   └── contract_A_structure.json
└── research_papers/
    └── paper_structure.json
```

### Retrieval: Query a Collection

Use `run_retrieval.py` to search within a collection:

```bash
# Search with automatic document selection (recommended)
python run_retrieval.py \
  --collection-dir ./results/financial_reports \
  --query "What was the revenue growth year-over-year?"

# Search ALL documents in a collection (no selection)
python run_retrieval.py \
  --collection-dir ./results/financial_reports \
  --query "What are the risk factors?" \
  --mode all

# Search a SPECIFIC document in a collection
python run_retrieval.py \
  --collection-dir ./results/financial_reports \
  --query "What is the CEO's message?" \
  --doc 10K_2024

# Output as JSON (for programmatic use)
python run_retrieval.py \
  --collection-dir ./results/financial_reports \
  --query "Revenue breakdown" \
  --output json
```

### Retrieval Arguments

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `--collection-dir` | Yes | - | Path to collection folder |
| `--query` | Yes | - | Search query |
| `--model` | No | gpt-4o-2024-11-20 | LLM model to use |
| `--mode` | No | select | `select`: LLM picks relevant docs first. `all`: Search all docs |
| `--doc` | No | - | Search specific document ID (skips selection) |
| `--output` | No | text | `text`: Human readable. `json`: Machine readable |

### Collection Management Arguments (run_collection.py)

| Argument | Required | Description |
|----------|----------|-------------|
| `--input-dir` | For ingest/sync | Source folder with PDF/Markdown files |
| `--output-dir` | Yes | Collection output directory |
| `--ingest` | Action | Full re-index of all source files |
| `--sync` | Action | Incremental update (add/update/remove) |
| `--status` | Action | Show collection status and pending changes |
| `--model` | No | LLM model (default: gpt-4o-2024-11-20) |

## Configuration

Main config file: `pageindex/config.yaml`

Key settings:
- `model`: LLM model to use
- `toc_check_page_num`: Pages to check for table of contents
- `max_page_num_each_node`: Maximum pages per tree node
- `max_token_num_each_node`: Maximum tokens per tree node
- `if_add_node_id`: Include node IDs in output
- `if_add_node_summary`: Include summaries in output

## Directory Structure

- `./results/` - Output JSON tree structures
- `./logs/` - JSON-formatted logs
- `./pageindex/` - Main source code
- `./tests/` - Test files and sample results

## Tree Structure Format

PageIndex stores **one JSON file per document** - there's no multi-document collection at the storage level.

### Abstract Structure

```
Collection (directory: ./results/)
│
├── Document_A_structure.json
│   {
│     "doc_name": "Document_A.pdf",
│     "doc_description": "Summary of the entire document...",
│     "structure": [
│       ├── Section 1 (pages 1-5)
│       │   ├── title, node_id, summary
│       │   ├── start_index: 1, end_index: 5
│       │   └── nodes: [
│       │       ├── Subsection 1.1 (pages 1-2)
│       │       │   └── nodes: [
│       │       │       └── Sub-subsection 1.1.1 (page 1)
│       │       │   ]
│       │       └── Subsection 1.2 (pages 3-5)
│       │   ]
│       │
│       ├── Section 2 (pages 6-12)
│       │   └── nodes: [...]
│       │
│       └── Section 3 (pages 13-20)
│           └── nodes: [...]
│     ]
│   }
│
├── Document_B_structure.json
│   └── (same structure)
│
└── Document_C_structure.json
    └── (same structure)
```

### Node Schema

Each node in the tree contains:

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Section/subsection title |
| `node_id` | string | Unique ID (e.g., "0001", "0002") |
| `start_index` | int | Starting page number |
| `end_index` | int | Ending page number |
| `summary` | string | LLM-generated summary of the section |
| `nodes` | array | Child nodes (subsections), can be nested infinitely |

### Document Root Schema

Each document JSON file contains:

| Field | Type | Description |
|-------|------|-------------|
| `doc_name` | string | Original filename (e.g., "report.pdf") |
| `doc_description` | string | LLM-generated summary of entire document |
| `structure` | array | Top-level sections (each is a node) |

### Key Characteristics

- **No collection-level index** - each document is independent
- **Unlimited nesting depth** - subsections can have sub-subsections
- **Page-based boundaries** - sections defined by page ranges
- **LLM reasoning** navigates this tree during retrieval (not vector similarity)

## Multi-Document Collection Strategies

PageIndex is a **single-document deep reasoning tool**. It does NOT have built-in collection management. Instead, it provides three external strategies you implement yourself.

### Strategy 1: Description-Based (Simple)

**Best for**: Small collections, diverse topics
**External dependency**: None (just LLM)

```
Query → LLM matches against doc descriptions → Selected doc_ids → Tree search
```

**Workflow**:
1. Generate PageIndex tree for each document
2. LLM generates one-sentence description per document
3. For queries, LLM matches query against descriptions
4. Retrieve selected documents by `doc_id`
5. Perform tree search within selected documents

### Strategy 2: Metadata + SQL (Structured)

**Best for**: Well-categorized documents (financial reports, legal docs)
**External dependency**: SQL database

```
Query → LLM generates SQL → Database returns doc_ids → Tree search
```

**Workflow**:
1. Generate PageIndex tree → get `doc_id`
2. Store documents with metadata in SQL table (company, year, type, etc.)
3. LLM converts natural language to SQL query
4. SQL returns relevant `doc_id`s
5. Perform tree search within selected documents

### Strategy 3: Semantic + Vector DB (Hybrid)

**Best for**: Large collections, similar topics
**External dependency**: Vector database

```
Query → Vector similarity on chunks → Score documents → Tree search
```

**Workflow**:
1. Chunk documents and create vector embeddings (external)
2. Store vectors with `doc_id` in vector database
3. Vector search returns top-K relevant chunks
4. Score documents: `DocScore = (1/√(N+1)) × Σ ChunkScore(n)`
5. Select highest-scoring documents
6. Perform PageIndex tree search for precise retrieval

### Strategy Comparison

| Strategy | Collection Size | Setup Complexity | Speed | Best Use Case |
|----------|-----------------|------------------|-------|---------------|
| Description | Small (<50 docs) | Low | Fast | Diverse topics |
| Metadata/SQL | Medium | Medium | Fast | Categorized docs |
| Semantic | Large (1000+) | Medium | Medium | Similar topics |

### Tree Search Pattern (Single Document)

```python
prompt = f"""
You are given a query and the tree structure of a document.
Find all nodes likely to contain the answer.

Query: {query}
Document tree structure: {PageIndex_Tree}

Reply in JSON format:
{{
    "thinking": <reasoning>,
    "node_list": [node_id1, node_id2, ...]
}}
"""
```
