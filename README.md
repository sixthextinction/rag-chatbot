# 🎉 ELI5 RAG Chatbot

**Ask Me Like I'm 5** - A RAG chatbot that explains any topic in simple terms using fresh web information!

## 🌟 What Makes This Special?

- **Fresh Information**: Searches the web for up-to-date information
- **Kid-Friendly Explanations**: Makes complex topics super simple to understand  
- **Any Topic**: Works with topics not in the AI's training data
- **RAG Pipeline**: Retrieval-Augmented Generation with ChromaDB vector storage
- **Interactive CLI**: Fun and easy to use interface

## 🚀 Quick Start

### 1. Prerequisites

Make sure you have these installed:
- **Node.js** (v18 or higher)
- **Ollama** (for local AI models)
- **Bright Data account** (for web search)

### 2. Install Ollama Models

```bash
# start Ollama service
ollama serve

# in another terminal, download required models
ollama pull gemma3:4b
ollama pull nomic-embed-text:latest
```

### 3. Setup Project

```bash
# clone or create the project
cd rag-chatbot

# install dependencies
npm install

# setup environment
cp env.example .env
# edit .env with your Bright Data credentials
```

### 4. Get Bright Data Credentials

1. Sign up at [brightdata.com](https://brightdata.com)
2. Create a SERP API zone
3. Add credentials to your `.env` file:

```env
BRIGHT_DATA_CUSTOMER_ID=your_customer_id
BRIGHT_DATA_ZONE=your_zone  
BRIGHT_DATA_PASSWORD=your_password
```

### 5. Run the Chatbot

```bash
npm start
```

## 🎯 How It Works

Operates on the principle of Retrieval-Augmented Generation (RAG), combining information retrieval with AI-powered text generation to provide easy-to-understand answers.

The chatbot's workflow begins when a user asks a question. The system first identifies the core topic of the query. It then initiates its retrieval phase by searching the web for fresh information using Bright Data's SERP API. To ensure comprehensive coverage, it dynamically creates multiple search queries from predefined templates (e.g., "topic explained simple," "topic beginner guide"). The search results are cached locally to speed up future requests on the same topic.

Once web content is retrieved, it is broken down into smaller, manageable chunks of text. These chunks are then converted into numerical representations, called embeddings, using a local nomic-embed-text model running via Ollama. These embeddings are stored and indexed in a ChromaDB vector database, creating a persistent knowledge base for the chatbot.

When generating an answer, the user's question is also converted into an embedding. The system queries the ChromaDB database to find the most semantically relevant text chunks from its knowledge base. This retrieved context, along with the original question, is then passed to a gemma3:1b language model, also running on Ollama. A specialized prompt instructs the model to act as a friendly teacher, ensuring the final output is simple, concise, and avoids technical jargon.

The user interacts with the chatbot through a simple command-line interface, which displays the generated explanation, the sources used, and a confidence score. The application also includes commands to view statistics about its knowledge base, list the topics it has learned about, and instruct it to "forget" previously learned topics, providing a complete and interactive user experience.

## 🎮 Special Commands

- `/help` - Show help message
- `/stats` - View knowledge statistics  
- `/topics` - List all topics you've learned
- `/forget <topic>` - Remove a topic from memory
- `/quit` - Exit the chatbot

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────┐    ┌─────────────────┐
│   Web Search    │───▶│   Chunking   │───▶│   Embeddings    │
│  (Bright Data)  │    │  & Parsing   │    │   (Ollama)      │
└─────────────────┘    └──────────────┘    └─────────────────┘
                                                     │
┌─────────────────┐    ┌──────────────┐              ▼
│  ELI5 Response  │◀───│   Retrieval  │    ┌─────────────────┐
│   (Gemma 3)     │    │ (Similarity) │    │   ChromaDB      │
└─────────────────┘    └──────────────┘    │ Vector Storage  │
                                           └─────────────────┘
```

## 📁 Project Structure

```
rag-chatbot/
├── main.js          # interactive CLI interface
├── rag.js           # main RAG pipeline logic
├── search.js        # web search and data gathering
├── vectorstore.js   # ChromaDB vector operations
├── ollama.js        # Ollama client and ELI5 generation
├── config.js        # configuration settings
├── package.json     # dependencies
├── env.example      # environment template
└── README.md        # this file!
```

## ⚙️ Configuration

Edit `config.js` to customize:

- **Search templates**: Different query patterns for comprehensive coverage
- **Chunk settings**: Size and overlap for text processing  
- **Cache duration**: How long to keep search results
- **Model settings**: Ollama model configurations

## 🔧 Troubleshooting

**Models not found?**
```bash
ollama pull gemma3:4b
ollama pull nomic-embed-text:latest
```

**Ollama connection failed?**
```bash
ollama serve
```

**Search not working?**
- Check your Bright Data credentials in `.env`
- Verify your account has SERP API access

**ChromaDB issues?**
- Delete `chroma_db/` folder to reset vector database
- Restart the application

## 🎨 Customization Ideas

- Try other Ollama models like `llama3` or `mistral`
- Focus on specific domains (science, technology, etc.)
- Add text-to-speech for audio explanations
- Build a web UI instead of CLI

## 📝 License

MIT License - feel free to use and modify!

## 🎉 Have Fun!

This chatbot is designed to make learning fun and accessible. Ask about anything you're curious about - from "How do computers work?" to "What are black holes?" and get explanations that actually make sense!

Keep being curious! 🌟 