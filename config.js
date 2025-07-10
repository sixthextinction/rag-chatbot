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
    generationModel: 'gemma3:4b',
    embeddingModel: 'nomic-embed-text:latest'
  },

  // chromadb configuration
  vectorDb: {
    path: './chroma_db',
    baseCollectionName: 'topic_knowledge' // will append topic name
  },

  // search configuration for comprehensive topic research
  search: {
    maxSearchQueries: 8, // that should be enough for each

    // these are only really useful for technical things 
    // TODO: add more for other things too
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
    expiryDays: 2 // 2 days should ensure fresh data for current topics
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
    allowModelKnowledge: true // should the model be allowed to answer using its own knowledge if context doesnt contain the answer?
  },

  // warning system settings
  warnings: {
    lowSimilarityThreshold: 0.4, // warn if all chunks have similarity below this threshold
    topicMismatchThreshold: 0.3, // warn if question doesn't semantically match topic
    enableTopicMismatchWarning: true, // enable/disable topic mismatch warnings
    enableSimilarityWarning: true // enable/disable similarity warnings
  }
};

module.exports = CONFIG; 