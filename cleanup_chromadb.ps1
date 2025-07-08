# PowerShell script to clean up the ChromaDB Docker container and data.

# Stop the running chromadb container.
Write-Host "Stopping ChromaDB container..."
docker stop chromadb | Out-Null

# Remove the chromadb container.
Write-Host "Removing ChromaDB container..."
docker rm chromadb | Out-Null

# Remove the data volume.
Write-Host "Removing ChromaDB data volume..."
docker volume rm chroma_data | Out-Null

Write-Host "✅ ChromaDB cleanup complete."

# Start a new ChromaDB container.
Write-Host "🚀 Starting new ChromaDB container..."
docker run -d --name chromadb -p 8000:8000 -v chroma_data:/chroma/chroma chromadb/chroma:latest

Write-Host "✅ New ChromaDB container started successfully." 