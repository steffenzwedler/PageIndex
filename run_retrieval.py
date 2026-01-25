import argparse
import os
import json
import glob
from pageindex.utils import ChatGPT_API

def load_collection(collection_dir):
    """Load all document structures from a collection directory."""
    documents = []
    pattern = os.path.join(collection_dir, "*_structure.json")

    for filepath in glob.glob(pattern):
        with open(filepath, 'r', encoding='utf-8') as f:
            doc = json.load(f)
            doc['_filepath'] = filepath
            doc['_doc_id'] = os.path.basename(filepath).replace('_structure.json', '')
            documents.append(doc)

    return documents

def select_documents(query, documents, model):
    """Use LLM to select relevant documents based on descriptions."""
    if not documents:
        return []

    docs_info = []
    for doc in documents:
        docs_info.append({
            "doc_id": doc['_doc_id'],
            "doc_name": doc.get('doc_name', doc['_doc_id']),
            "doc_description": doc.get('doc_description', 'No description available')
        })

    prompt = f"""You are given a query and a list of documents with their descriptions.
Select the documents that are most likely to contain relevant information for the query.

Query: {query}

Documents:
{json.dumps(docs_info, indent=2)}

Reply in JSON format only:
{{
    "thinking": "<your reasoning for selection>",
    "selected_doc_ids": ["doc_id1", "doc_id2", ...]
}}

If no documents are relevant, return an empty list for selected_doc_ids.
"""

    response = ChatGPT_API(model, prompt)

    try:
        # Extract JSON from response
        response = response.strip()
        if response.startswith('```'):
            response = response.split('```')[1]
            if response.startswith('json'):
                response = response[4:]
        result = json.loads(response)
        return result.get('selected_doc_ids', [])
    except json.JSONDecodeError:
        print(f"Warning: Could not parse LLM response, returning all documents")
        return [doc['_doc_id'] for doc in documents]

def tree_search(query, document, model):
    """Perform tree search within a single document."""
    structure = document.get('structure', [])

    prompt = f"""You are given a query and the tree structure of a document.
Find all nodes that are likely to contain information relevant to the query.

Query: {query}

Document: {document.get('doc_name', 'Unknown')}
Document Description: {document.get('doc_description', 'No description')}

Tree Structure:
{json.dumps(structure, indent=2)}

Reply in JSON format only:
{{
    "thinking": "<your reasoning for selecting these nodes>",
    "node_list": ["node_id1", "node_id2", ...]
}}

Select the most specific nodes that contain the answer. If a parent node contains sub-nodes,
prefer selecting the specific sub-node rather than the parent.
"""

    response = ChatGPT_API(model, prompt)

    try:
        response = response.strip()
        if response.startswith('```'):
            response = response.split('```')[1]
            if response.startswith('json'):
                response = response[4:]
        result = json.loads(response)
        return {
            'doc_id': document['_doc_id'],
            'doc_name': document.get('doc_name', document['_doc_id']),
            'thinking': result.get('thinking', ''),
            'node_ids': result.get('node_list', [])
        }
    except json.JSONDecodeError:
        print(f"Warning: Could not parse tree search response for {document['_doc_id']}")
        return {
            'doc_id': document['_doc_id'],
            'doc_name': document.get('doc_name', document['_doc_id']),
            'thinking': 'Parse error',
            'node_ids': []
        }

def get_node_by_id(structure, node_id):
    """Recursively find a node by its ID in the tree structure."""
    for node in structure:
        if node.get('node_id') == node_id:
            return node
        if 'nodes' in node:
            found = get_node_by_id(node['nodes'], node_id)
            if found:
                return found
    return None

def format_results(results, documents):
    """Format the search results for display."""
    output = []
    doc_map = {doc['_doc_id']: doc for doc in documents}

    for result in results:
        doc = doc_map.get(result['doc_id'])
        if not doc:
            continue

        output.append(f"\n{'='*60}")
        output.append(f"Document: {result['doc_name']}")
        output.append(f"Reasoning: {result['thinking']}")
        output.append(f"Relevant nodes: {result['node_ids']}")

        for node_id in result['node_ids']:
            node = get_node_by_id(doc.get('structure', []), node_id)
            if node:
                output.append(f"\n  [{node_id}] {node.get('title', 'Untitled')}")
                output.append(f"    Pages: {node.get('start_index', '?')} - {node.get('end_index', '?')}")
                if node.get('summary'):
                    summary = node['summary'][:300] + '...' if len(node.get('summary', '')) > 300 else node.get('summary', '')
                    output.append(f"    Summary: {summary}")

    return '\n'.join(output)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Retrieve information from PageIndex collections')

    parser.add_argument('--collection-dir', type=str, required=True,
                      help='Directory containing the document collection (e.g., ./results/financial_reports)')
    parser.add_argument('--query', type=str, required=True,
                      help='The query to search for')
    parser.add_argument('--model', type=str, default='gpt-4o-2024-11-20',
                      help='Model to use for retrieval')
    parser.add_argument('--doc', type=str, default=None,
                      help='Specific document ID to search (skips document selection)')
    parser.add_argument('--mode', type=str, choices=['select', 'all'], default='select',
                      help='select: Use LLM to select relevant docs first. all: Search all docs in collection')
    parser.add_argument('--output', type=str, choices=['text', 'json'], default='text',
                      help='Output format')

    args = parser.parse_args()

    # Validate collection directory
    if not os.path.isdir(args.collection_dir):
        raise ValueError(f"Collection directory not found: {args.collection_dir}")

    # Load collection
    print(f"Loading collection from: {args.collection_dir}")
    documents = load_collection(args.collection_dir)

    if not documents:
        print(f"No documents found in collection (looking for *_structure.json files)")
        exit(1)

    print(f"Found {len(documents)} document(s)")

    # Determine which documents to search
    if args.doc:
        # Search specific document
        selected_docs = [doc for doc in documents if doc['_doc_id'] == args.doc]
        if not selected_docs:
            print(f"Document not found: {args.doc}")
            print(f"Available documents: {[doc['_doc_id'] for doc in documents]}")
            exit(1)
    elif args.mode == 'select':
        # Use LLM to select relevant documents
        print(f"Selecting relevant documents for query: {args.query}")
        selected_ids = select_documents(args.query, documents, args.model)
        print(f"Selected documents: {selected_ids}")
        selected_docs = [doc for doc in documents if doc['_doc_id'] in selected_ids]
    else:
        # Search all documents
        selected_docs = documents

    if not selected_docs:
        print("No relevant documents found for the query")
        exit(0)

    # Perform tree search on selected documents
    print(f"\nPerforming tree search on {len(selected_docs)} document(s)...")
    results = []
    for doc in selected_docs:
        print(f"  Searching: {doc['_doc_id']}")
        result = tree_search(args.query, doc, args.model)
        results.append(result)

    # Output results
    if args.output == 'json':
        print(json.dumps(results, indent=2))
    else:
        print(format_results(results, documents))
