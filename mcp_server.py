#!/usr/bin/env python3
"""
PageIndex MCP Server - HTTP Streamable Transport
Provides collection management and retrieval tools via MCP protocol.
"""
import os
import json
import asyncio
from typing import Any
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.server.sse import SseServerTransport
from mcp.types import Tool, TextContent
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.responses import JSONResponse
import uvicorn

# Import PageIndex functions
from run_collection import (
    load_manifest, save_manifest, get_source_files, get_file_info,
    get_file_hash, ingest_file, MANIFEST_FILE
)
from run_retrieval import (
    load_collection, select_documents, tree_search, get_node_by_id
)
from pageindex.utils import ConfigLoader

server = Server("pageindex-mcp")

# Default configuration
DEFAULT_MODEL = os.getenv("PAGEINDEX_MODEL", "gpt-4o-2024-11-20")
COLLECTIONS_DIR = os.getenv("PAGEINDEX_COLLECTIONS_DIR", "./collections")


@server.list_tools()
async def list_tools() -> list[Tool]:
    """List available PageIndex tools."""
    return [
        Tool(
            name="collection_ingest",
            description="Ingest all documents from a source folder into a collection",
            inputSchema={
                "type": "object",
                "properties": {
                    "input_dir": {"type": "string", "description": "Source folder with PDF/Markdown files"},
                    "collection": {"type": "string", "description": "Collection name (created under COLLECTIONS_DIR)"},
                    "model": {"type": "string", "description": "LLM model to use", "default": DEFAULT_MODEL}
                },
                "required": ["input_dir", "collection"]
            }
        ),
        Tool(
            name="collection_sync",
            description="Sync a collection with its source folder (add new, update changed, remove deleted)",
            inputSchema={
                "type": "object",
                "properties": {
                    "input_dir": {"type": "string", "description": "Source folder with PDF/Markdown files"},
                    "collection": {"type": "string", "description": "Collection name"},
                    "model": {"type": "string", "description": "LLM model to use", "default": DEFAULT_MODEL}
                },
                "required": ["input_dir", "collection"]
            }
        ),
        Tool(
            name="collection_status",
            description="Get status of a collection including indexed documents and pending changes",
            inputSchema={
                "type": "object",
                "properties": {
                    "collection": {"type": "string", "description": "Collection name"},
                    "input_dir": {"type": "string", "description": "Optional: source folder to check for changes"}
                },
                "required": ["collection"]
            }
        ),
        Tool(
            name="collection_list",
            description="List all available collections",
            inputSchema={"type": "object", "properties": {}}
        ),
        Tool(
            name="retrieve",
            description="Query documents in a collection using reasoning-based retrieval",
            inputSchema={
                "type": "object",
                "properties": {
                    "collection": {"type": "string", "description": "Collection name to search"},
                    "query": {"type": "string", "description": "Search query"},
                    "mode": {"type": "string", "enum": ["select", "all"], "description": "select: LLM picks relevant docs, all: search all", "default": "select"},
                    "doc": {"type": "string", "description": "Optional: specific document ID to search"},
                    "model": {"type": "string", "description": "LLM model to use", "default": DEFAULT_MODEL}
                },
                "required": ["collection", "query"]
            }
        ),
        Tool(
            name="ingest_document",
            description="Ingest a single document into a collection",
            inputSchema={
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "Path to PDF or Markdown file"},
                    "collection": {"type": "string", "description": "Target collection name"},
                    "model": {"type": "string", "description": "LLM model to use", "default": DEFAULT_MODEL}
                },
                "required": ["file_path", "collection"]
            }
        )
    ]


def get_collection_path(collection: str) -> str:
    """Get full path for a collection."""
    return os.path.join(COLLECTIONS_DIR, collection)


class MockArgs:
    """Mock args object for reusing existing functions."""
    def __init__(self, model=DEFAULT_MODEL):
        self.model = model
        self.toc_check_pages = 20
        self.max_pages_per_node = 10
        self.max_tokens_per_node = 20000


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    """Handle tool calls."""

    if name == "collection_list":
        if not os.path.exists(COLLECTIONS_DIR):
            return [TextContent(type="text", text="No collections directory found")]
        collections = []
        for item in os.listdir(COLLECTIONS_DIR):
            path = os.path.join(COLLECTIONS_DIR, item)
            if os.path.isdir(path) and os.path.exists(os.path.join(path, MANIFEST_FILE)):
                manifest = load_manifest(path)
                collections.append({
                    "name": item,
                    "documents": len(manifest.get("files", {})),
                    "updated": manifest.get("updated_at", "Unknown")
                })
        return [TextContent(type="text", text=json.dumps(collections, indent=2))]

    elif name == "collection_status":
        collection_dir = get_collection_path(arguments["collection"])
        if not os.path.exists(collection_dir):
            return [TextContent(type="text", text=f"Collection not found: {arguments['collection']}")]

        manifest = load_manifest(collection_dir)
        result = {
            "collection": arguments["collection"],
            "created": manifest.get("created_at"),
            "updated": manifest.get("updated_at"),
            "documents": list(manifest.get("files", {}).keys())
        }

        input_dir = arguments.get("input_dir")
        if input_dir and os.path.isdir(input_dir):
            source_files = get_source_files(input_dir)
            result["pending"] = {
                "new": [f for f in source_files if f not in manifest.get("files", {})],
                "removed": [f for f in manifest.get("files", {}) if f not in source_files],
                "modified": []
            }
            for doc_id, filepath in source_files.items():
                if doc_id in manifest.get("files", {}):
                    if get_file_hash(filepath) != manifest["files"][doc_id].get("hash"):
                        result["pending"]["modified"].append(doc_id)

        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    elif name == "collection_ingest":
        input_dir = arguments["input_dir"]
        collection_dir = get_collection_path(arguments["collection"])
        model = arguments.get("model", DEFAULT_MODEL)

        if not os.path.isdir(input_dir):
            return [TextContent(type="text", text=f"Input directory not found: {input_dir}")]

        os.makedirs(collection_dir, exist_ok=True)
        source_files = get_source_files(input_dir)

        if not source_files:
            return [TextContent(type="text", text="No PDF or Markdown files found")]

        args = MockArgs(model)
        manifest = {"files": {}, "created_at": __import__("datetime").datetime.now().isoformat()}
        results = {"processed": [], "errors": []}

        for doc_id, filepath in source_files.items():
            try:
                ingest_file(filepath, collection_dir, args)
                manifest["files"][doc_id] = get_file_info(filepath)
                results["processed"].append(doc_id)
            except Exception as e:
                results["errors"].append({"doc_id": doc_id, "error": str(e)})

        save_manifest(collection_dir, manifest)
        return [TextContent(type="text", text=json.dumps(results, indent=2))]

    elif name == "collection_sync":
        input_dir = arguments["input_dir"]
        collection_dir = get_collection_path(arguments["collection"])
        model = arguments.get("model", DEFAULT_MODEL)

        if not os.path.isdir(input_dir):
            return [TextContent(type="text", text=f"Input directory not found: {input_dir}")]
        if not os.path.exists(collection_dir):
            return [TextContent(type="text", text=f"Collection not found: {arguments['collection']}")]

        manifest = load_manifest(collection_dir)
        source_files = get_source_files(input_dir)
        args = MockArgs(model)

        results = {"added": [], "updated": [], "removed": [], "errors": []}

        # Add new and update modified
        for doc_id, filepath in source_files.items():
            file_info = get_file_info(filepath)
            if doc_id not in manifest["files"]:
                try:
                    ingest_file(filepath, collection_dir, args)
                    manifest["files"][doc_id] = file_info
                    results["added"].append(doc_id)
                except Exception as e:
                    results["errors"].append({"doc_id": doc_id, "error": str(e)})
            elif manifest["files"][doc_id].get("hash") != file_info["hash"]:
                try:
                    ingest_file(filepath, collection_dir, args)
                    manifest["files"][doc_id] = file_info
                    results["updated"].append(doc_id)
                except Exception as e:
                    results["errors"].append({"doc_id": doc_id, "error": str(e)})

        # Remove deleted
        for doc_id in list(manifest["files"].keys()):
            if doc_id not in source_files:
                structure_file = os.path.join(collection_dir, f"{doc_id}_structure.json")
                if os.path.exists(structure_file):
                    os.remove(structure_file)
                del manifest["files"][doc_id]
                results["removed"].append(doc_id)

        save_manifest(collection_dir, manifest)
        return [TextContent(type="text", text=json.dumps(results, indent=2))]

    elif name == "retrieve":
        collection_dir = get_collection_path(arguments["collection"])
        query = arguments["query"]
        mode = arguments.get("mode", "select")
        doc_filter = arguments.get("doc")
        model = arguments.get("model", DEFAULT_MODEL)

        if not os.path.exists(collection_dir):
            return [TextContent(type="text", text=f"Collection not found: {arguments['collection']}")]

        documents = load_collection(collection_dir)
        if not documents:
            return [TextContent(type="text", text="No documents in collection")]

        # Filter documents
        if doc_filter:
            documents = [d for d in documents if d["_doc_id"] == doc_filter]
            if not documents:
                return [TextContent(type="text", text=f"Document not found: {doc_filter}")]
        elif mode == "select":
            selected_ids = select_documents(query, documents, model)
            documents = [d for d in documents if d["_doc_id"] in selected_ids]

        # Perform tree search
        results = []
        for doc in documents:
            result = tree_search(query, doc, model)
            # Add node details
            for node_id in result.get("node_ids", []):
                node = get_node_by_id(doc.get("structure", []), node_id)
                if node:
                    result.setdefault("nodes", []).append({
                        "node_id": node_id,
                        "title": node.get("title"),
                        "pages": f"{node.get('start_index', '?')}-{node.get('end_index', '?')}",
                        "summary": node.get("summary", "")[:500]
                    })
            results.append(result)

        return [TextContent(type="text", text=json.dumps(results, indent=2))]

    elif name == "ingest_document":
        file_path = arguments["file_path"]
        collection_dir = get_collection_path(arguments["collection"])
        model = arguments.get("model", DEFAULT_MODEL)

        if not os.path.isfile(file_path):
            return [TextContent(type="text", text=json.dumps({"error": f"File not found: {file_path}"}))]

        os.makedirs(collection_dir, exist_ok=True)
        manifest = load_manifest(collection_dir)
        args = MockArgs(model)

        doc_id = os.path.splitext(os.path.basename(file_path))[0]

        try:
            ingest_file(file_path, collection_dir, args)
            manifest["files"][doc_id] = get_file_info(file_path)
            save_manifest(collection_dir, manifest)
            return [TextContent(type="text", text=json.dumps({
                "doc_id": doc_id,
                "status": "success",
                "collection": arguments["collection"]
            }))]
        except Exception as e:
            return [TextContent(type="text", text=json.dumps({
                "doc_id": doc_id,
                "status": "error",
                "error": str(e)
            }))]

    return [TextContent(type="text", text=f"Unknown tool: {name}")]


# HTTP Server for SSE transport
def create_sse_app():
    """Create Starlette app with SSE transport."""
    sse = SseServerTransport("/messages/")

    async def handle_sse(request):
        async with sse.connect_sse(request.scope, request.receive, request._send) as streams:
            await server.run(streams[0], streams[1], server.create_initialization_options())

    async def handle_messages(request):
        await sse.handle_post_message(request.scope, request.receive, request._send)

    async def health(request):
        return JSONResponse({"status": "ok", "server": "pageindex-mcp"})

    async def call_tool_http(request):
        """Direct HTTP endpoint for tool calls (for n8n integration)."""
        try:
            body = await request.json()
            tool_name = body.get("name")
            arguments = body.get("arguments", {})

            if not tool_name:
                return JSONResponse({"error": "Missing tool name"}, status_code=400)

            result = await call_tool(tool_name, arguments)

            # Extract text content
            if result and len(result) > 0:
                text = result[0].text
                try:
                    return JSONResponse(json.loads(text))
                except json.JSONDecodeError:
                    return JSONResponse({"result": text})

            return JSONResponse({"result": None})
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    async def list_tools_http(request):
        """List available tools."""
        tools = await list_tools()
        return JSONResponse([{"name": t.name, "description": t.description} for t in tools])

    return Starlette(
        routes=[
            Route("/health", health),
            Route("/tools", list_tools_http),
            Route("/call_tool", call_tool_http, methods=["POST"]),
            Route("/sse", handle_sse),
            Route("/messages/", handle_messages, methods=["POST"]),
        ]
    )


async def run_stdio():
    """Run server with stdio transport."""
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


def main():
    import argparse
    parser = argparse.ArgumentParser(description="PageIndex MCP Server")
    parser.add_argument("--transport", choices=["stdio", "sse"], default="stdio",
                       help="Transport mode: stdio (default) or sse (HTTP)")
    parser.add_argument("--host", default="0.0.0.0", help="Host for SSE server")
    parser.add_argument("--port", type=int, default=8000, help="Port for SSE server")
    args = parser.parse_args()

    if args.transport == "sse":
        app = create_sse_app()
        uvicorn.run(app, host=args.host, port=args.port)
    else:
        asyncio.run(run_stdio())


if __name__ == "__main__":
    main()
