FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir mcp starlette uvicorn sse-starlette

# Copy application code
COPY pageindex/ ./pageindex/
COPY run_pageindex.py run_collection.py run_retrieval.py mcp_server.py ./

# Create directories for data
RUN mkdir -p /data/collections /data/sources

# Environment variables
ENV PAGEINDEX_COLLECTIONS_DIR=/data/collections
ENV PYTHONUNBUFFERED=1

# Expose port for SSE transport
EXPOSE 8000

# Default command: run MCP server with SSE transport
CMD ["python", "mcp_server.py", "--transport", "sse", "--host", "0.0.0.0", "--port", "8000"]
