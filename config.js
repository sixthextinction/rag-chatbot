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
    maxResults: 8 // fewer results for simpler explanations
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
    collectionName: 'tech_brief_knowledge'
  },

  // search configuration for diverse topics
  search: {
    maxSearchQueries: 5, // multiple queries for comprehensive coverage
    searchTemplates: [
      // Core
      'what is {topic}?',
      '{topic} explained',
      '{topic} beginner guide',
      '{topic} definition',

      // Technicals
      '{topic} how does it work',
      '{topic} architecture',
      '{topic} use cases',

      // Examples
      '{topic} real world examples',
      'companies using {topic}',

      // Comparisons
      '{topic} vs alternatives',
      'alternatives to {topic}',

      // Opinions
      'is {topic} worth it?',
      '{topic} pros and cons',
      'reviews of {topic}',

      // News
      '{topic} latest news',
      '{topic} 2025 update'
    ]
  },

  // caching and performance settings
  cache: {
    dir: 'cache',
    expiryDays: 3 // shorter cache for fresh info
  },

  // request settings
  requests: {
    delayBetweenRequests: 800, // slightly faster for better UX
    maxRetries: 3
  },

  // technical brief generation settings
  brief: {
    maxContextLength: 8000, // larger context for detailed briefs
    chunkSize: 500,
    chunkOverlap: 50,
    maxRetrievedChunks: 10 // retrieve more chunks for comprehensive answers
  }
};

module.exports = CONFIG; 