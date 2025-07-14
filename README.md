# RAG Chatbot

A tutorial-scale, fully local RAG-based chatbot built with Gemma 3 via Ollama + Bright Data SERP API + Chroma. This researches topics comprehensively and then answers questions using retrieval-augmented generation. The system operates in two distinct phases: **Topic Ingestion** and **Chat Mode**.

## Results

### Before vs After

<p>
  <img src="https://github.com/sixthextinction/rag-chatbot/blob/main/before.png" alt="Before RAG" width="45%" />
  <img src="https://github.com/sixthextinction/rag-chatbot/blob/main/after.png" alt="After RAG" width="45%" />
</p>


## Features

- **Two-Phase Operation**: Research topics first, then engage in Q&A
- **Comprehensive Topic Research**: Uses 20+ search templates for thorough coverage via Bright Data SERP
- **Local LLM Integration**: Powered by Ollama with Gemma models
- **Vector Database Storage**: ChromaDB for efficient similarity search
- **Intelligent Caching**: Reduces API calls and improves performance
- **Topic Management**: Switch between different research topics
- **Conversation History**: Maintains context during Q&A sessions

## Prerequisites

1. **Node.js** 
2. **Ollama** installed and running locally 
3. **ChromaDB** (automatically handled by the chromadb package) + Docker (get this yourself)
4. **Bright Data SERP API** credentials

### Required Ollama Models

The system will automatically attempt to pull these models if missing:
- `gemma3:4b-it-qat` (text generation)
- `nomic-embed-text:latest` (embeddings)

## Installation

1. **Clone or navigate to the project directory**:
   ```bash
   cd rag-chatbot
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   ```bash
   cp env.example .env
   ```
   
   Edit `.env` with your Bright Data credentials:
   ```
   BRIGHT_DATA_CUSTOMER_ID=your_customer_id
   BRIGHT_DATA_ZONE=your_zone_name
   BRIGHT_DATA_PASSWORD=your_zone_password
   ```

4. **Start Ollama** (if not already running):
   ```bash
   ollama serve
   ```

## Usage

### Starting the Chatbot

```bash
npm start
# or
node main.js
```

### Phase 1: Topic Ingestion

When you first start the chatbot, you'll be in **Topic Ingestion Mode**. Here you can:

1. **Research a new topic** by simply typing the topic name:
   ```
   enter topic to research (or command): ZLUDA
   ```

2. The system will:
   - Generate 20+ targeted search queries
   - Fetch comprehensive data using Bright Data SERP API
   - Process and chunk the content
   - Generate embeddings using local models
   - Store everything in ChromaDB

3. Once research is complete, you'll automatically switch to Chat Mode.

### Phase 2: Chat Mode

In **Chat Mode**, you can ask any questions about the researched topic:

```
[ZLUDA] your question: What is ZLUDA and how does it work?
```

The system will:
- Find the most relevant knowledge chunks
- Generate a contextual answer using the local LLM
- Provide source citations
- Maintain conversation history

## Commands

### Available Commands

- **`list`**: Show all available topics in the knowledge base
- **`stats <topic>`**: Display statistics for a specific topic
- **`switch <topic>`**: Switch to Q&A mode for an existing topic
- **`clear`**: Clear conversation history
- **`back`**: Return to topic selection mode (when in chat)
- **`quit`** or **`exit`**: Exit the chatbot

## Configuration

The system is highly configurable through `config.js`:

### Search Configuration
- **Search Templates**: 20+ predefined query patterns for comprehensive research
- **Results per Query**: Number of search results to fetch
- **Request Delays**: Rate limiting between API calls

### RAG Settings
- **Chunk Size**: Optimal size for text chunks (default: 400 tokens)
- **Context Length**: Maximum context for LLM generation
- **Retrieved Chunks**: Number of chunks to use for answering

### Caching
- **Cache Directory**: Local cache storage location
- **Expiry Time**: How long to keep cached search results

## Project Structure

```
rag-chatbot/
├── main.js           # Main application and interaction loop
├── config.js         # System configuration
├── ollama.js         # Ollama client for local LLM
├── search.js         # Bright Data SERP API integration
├── vectorstore.js    # ChromaDB vector database operations
├── rag.js           # RAG system for Q&A
├── cache.js         # Caching functionality
├── utils.js         # Utility functions
├── package.json     # Dependencies and scripts
├── .gitignore       # Git ignore patterns
├── env.example      # Environment variables template
└── README.md        # This file
```

## How It Works

### Topic Research Process

1. **Query Generation**: Uses predefined templates to create comprehensive search queries
2. **Data Fetching**: Retrieves search results via Bright Data SERP API
3. **Content Processing**: Extracts and chunks relevant information
4. **Embedding Generation**: Creates vector embeddings using local models
5. **Storage**: Stores chunks in topic-specific ChromaDB collections

### Question Answering Process

1. **Query Embedding**: Converts user question to vector representation
2. **Similarity Search**: Finds most relevant chunks from the knowledge base
3. **Context Building**: Assembles retrieved chunks into coherent context
4. **Answer Generation**: Uses local LLM to generate response based on context
5. **Source Attribution**: Provides citations for transparency

## Other Features

### Topic Management
- Each topic gets its own ChromaDB collection
- Easy switching between different research areas
- Persistent storage of all researched topics

### Intelligent Caching
- Search results are cached to reduce API calls
- Configurable expiry times
- Automatic cleanup of expired cache files

### Conversation Context
- Maintains recent conversation history
- Uses context for better follow-up responses
- Conversation history per topic

## Troubleshooting

### Common Issues

1. **Ollama Connection Failed**
   - Ensure Ollama is running: `ollama serve`
   - Check if models are available: `ollama list`

2. **Missing Models**
   - The system will automatically attempt to pull missing models
   - Manually pull: `ollama pull gemma3:1b` and `ollama pull nomic-embed-text`

3. **Search API Errors**
   - Verify Bright Data credentials in `.env`
   - Check internet connectivity
   - Ensure proxy credentials are correct

4. **ChromaDB Issues**
   - ChromaDB runs automatically with the Node.js client
   - Clear database: delete the `chroma_db` directory
   - **Complete ChromaDB Reset**: Use the provided PowerShell script for a full reset:
     ```powershell
     .\cleanup_chromadb.ps1
     ```
     This script will:
     - Stop the running ChromaDB Docker container
     - Remove the container and its data volume
     - Start a fresh ChromaDB container with clean data
     - Useful when you need to completely reset your vector database

### Performance Tips

- **Chunk Size**: Adjust based on your use case (smaller = more precise, larger = more context)
- **Cache Expiry**: Longer expiry reduces API calls but may use stale data
- **Search Templates**: Customize templates for your specific domain

## System Requirements

- The models need about 4.5-5 GB of free space
- Gemma 3 can run on a single consumer-tier dGPU
- Gemma 3 4B IT QAT and ChromaDB running together should use about 6 GB VRAM at peak


## License

MIT License - see the original project for license details.

---

