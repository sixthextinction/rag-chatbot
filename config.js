const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const CONFIG = {
  // bright Data SERP API configuration
  brightData: {
    customerId: process.env.BRIGHT_DATA_CUSTOMER_ID,
    zone: process.env.BRIGHT_DATA_ZONE,
    password: process.env.BRIGHT_DATA_PASSWORD,
    proxyHost: 'brd.superproxy.io',
    proxyPort: 33335,
    maxResults: 10 // more results for comprehensive topic research
  },

  // ollama configuration for local LLM
  ollama: {
    host: 'http://localhost:11434',
    generationModel: 'gemma3:1b',
    embeddingModel: 'nomic-embed-text:latest'
  },

  // chromadb configuration
  vectorDb: {
    path: './chroma_db',
    baseCollectionName: 'topic_knowledge' // will append topic name
  },

  // search configuration for comprehensive topic research
  search: {
    maxSearchQueries: 8, // comprehensive research queries
    searchTemplates: [
      // fundamental understanding
      'what is {topic}?',
      '{topic} explained simply',
      '{topic} definition and overview',
      '{topic} beginner guide',

      // technical details
      '{topic} how it works',
      '{topic} architecture details',
      '{topic} technical specifications',
      '{topic} implementation guide',

      // practical applications
      '{topic} use cases examples',
      '{topic} real world applications',
      'companies using {topic}',
      '{topic} best practices',

      // comparisons and context
      '{topic} vs alternatives',
      '{topic} advantages disadvantages',
      'alternatives to {topic}',
      '{topic} comparison',

      // current information
      '{topic} latest news 2025',
      '{topic} recent updates',
      '{topic} current state',
      '{topic} future outlook'
    ]
  },

  // caching settings
  cache: {
    dir: 'cache',
    expiryDays: 2 // fresh data for current topics
  },

  // request settings
  requests: {
    delayBetweenRequests: 1000, // respectful rate limiting
    maxRetries: 3
  },

  // RAG settings
  rag: {
    chunkSize: 400, // optimal chunk size for semantic coherence
    chunkOverlap: 50,
    maxRetrievedChunks: 8, // balance between context and token limits
    maxContextLength: 6000 // context window for generation
  },

  // chatbot interaction settings
  chat: {
    maxHistoryLength: 10, // keep recent conversation context
    systemPrompt: `You are a helpful AI assistant that answers questions about specific topics using provided context. 
Always base your answers on the given context. If the context doesn't contain enough information to answer the question, 
say "I don't have enough information in my knowledge base to answer that question." Be concise but informative.`
  }
};

module.exports = CONFIG; 