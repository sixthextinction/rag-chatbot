const { gatherTopicData } = require('./search');
const { 
  initializeVectorStore, 
  storeTopicChunks, 
  searchSimilar, 
  getTopicChunks, 
  listTopics, 
  deleteTopic, 
  getVectorStats,
  cleanupOldTopics
} = require('./vectorstore');
const { 
  createOllamaClient, 
  checkModels, 
  generateEmbedding, 
  generateEmbeddings, 
  generateTechnicalBrief,
  testConnection, 
  getModelInfo,
  testGeneration
} = require('./ollama');
const { generateTopicId } = require('./utils');

// initialize the RAG pipeline
async function initializeRAG(config) {
  try {
    console.log('🚀 initializing RAG pipeline...');
    
    const ollama = createOllamaClient(config);
    
    // check ollama connection and models first
    await testConnection(ollama, config);
    await checkModels(ollama, config);
    await testGeneration(ollama, config);
    
    const vectorStore = await initializeVectorStore(config, ollama);
    
    console.log('✅ RAG pipeline initialized successfully');
    return { ollama, vectorStore, config };
  } catch (error) {
    console.error('❌ failed to initialize RAG pipeline:', error.message);
    throw error;
  }
}

// learn about a new topic by gathering and storing information
async function learnTopic(ragContext, topic) {
  const { ollama, vectorStore, config } = ragContext;
  
  try {
    const topicId = generateTopicId(topic);
    console.log(`\n📖 learning about: ${topic}`);

    // check if we already know about this topic
    const existingTopics = await listTopics(vectorStore);
    if (existingTopics.includes(topicId)) {
      console.log('🧠 I already know about this topic!');
      return { topicId, learned: false, cached: true };
    }

    // gather fresh information about the topic
    const topicData = await gatherTopicData(topic, config);
    
    if (topicData.chunks.length === 0) {
      throw new Error(`couldn't find useful information about: ${topic}`);
    }

    console.log(`📚 learned ${topicData.chunks.length} things about ${topic} from ${topicData.metadata.sources.length} sources`);

    // generate embeddings for all chunks
    const texts = topicData.chunks.map(chunk => chunk.content);
    const embeddings = await generateEmbeddings(ollama, config, texts);

    // store in vector database
    await storeTopicChunks(vectorStore, topicData.chunks, embeddings, topicId);

    // cleanup old topics if we have too many
    await cleanupOldTopics(vectorStore, 30);

    console.log('✅ topic learned successfully');
    return { 
      topicId, 
      learned: true,
      cached: topicData.cached,
      metadata: topicData.metadata
    };
  } catch (error) {
    console.error('❌ failed to learn topic:', error.message);
    throw error;
  }
}

// answer a question by generating a technical brief
async function askQuestion(ragContext, question, specificTopic = null) {
  const { ollama, vectorStore, config } = ragContext;
  
  try {
    console.log(`\n❓ technical question: ${question}`);

    // try to understand what topic the question is about
    const topic = specificTopic || extractTopicFromQuestion(question);
    console.log(`🎯 detected topic: ${topic}`);

    // learn about the topic if we haven't already
    const learningResult = await learnTopic(ragContext, topic);
    const topicId = learningResult.topicId;

    // generate embedding for the question
    const questionEmbedding = await generateEmbedding(ollama, config, question);

    // search for relevant information
    const relevantChunks = await searchSimilar(
      vectorStore,
      questionEmbedding, 
      config.brief.maxRetrievedChunks,
      topicId
    );

    if (relevantChunks.length === 0) {
      return {
        answer: "I couldn't find enough information to generate a technical brief. Please try a different or more specific question.",
        sources: [],
        confidence: 0,
        topic: topic
      };
    }

    // build context from relevant chunks
    const context = buildContext(relevantChunks, config);
    const sources = extractSources(relevantChunks);

    // generate technical brief
    const explanation = await generateTechnicalBrief(
      ollama,
      config,
      context, 
      question, 
      topic
    );

    console.log('✅ technical brief ready!');

    return {
      answer: explanation,
      sources: sources.slice(0, 5), // show more sources for technical briefs
      confidence: calculateConfidence(relevantChunks),
      topic: topic,
      learned_new: learningResult.learned
    };
  } catch (error) {
    console.error('❌ failed to answer question:', error.message);
    throw error;
  }
}

// get information about what topics we know
async function getKnowledgeStats(ragContext) {
  const { vectorStore, ollama, config } = ragContext;
  
  try {
    const vectorStats = await getVectorStats(vectorStore);
    const modelInfo = await getModelInfo(ollama, config);

    return {
      knowledge_base: {
        total_topics: vectorStats.total_topics,
        total_chunks: vectorStats.total_chunks,
        recent_topics: vectorStats.recent_topics,
        collection_name: vectorStats.collection_name
      },
      models: modelInfo,
      configuration: {
        max_search_results: config.brightData.maxResults,
        cache_expiry_days: config.cache.expiryDays,
        max_context_length: config.brief.maxContextLength
      }
    };
  } catch (error) {
    console.error('❌ failed to get knowledge stats:', error.message);
    throw error;
  }
}

// forget about a specific topic
async function forgetTopic(ragContext, topic) {
  const { vectorStore } = ragContext;
  
  try {
    const topicId = generateTopicId(topic);
    const result = await deleteTopic(vectorStore, topicId);
    console.log(`🧠💨 forgot about: ${topic}`);
    return result;
  } catch (error) {
    console.error('❌ failed to forget topic:', error.message);
    throw error;
  }
}

// list all topics we know about
async function listKnownTopics(ragContext) {
  const { vectorStore } = ragContext;
  
  try {
    const topicIds = await listTopics(vectorStore);
    const topics = topicIds.map(id => parseTopicId(id));
    
    console.log(`🧠 I know about ${topics.length} topics`);
    return topics;
  } catch (error) {
    console.error('❌ failed to list topics:', error.message);
    throw error;
  }
}

// helper functions
function parseTopicId(topicId) {
  return topicId.replace(/_/g, ' ');
}

function extractTopicFromQuestion(question) {
  // simple topic extraction - in practice, you might want something more sophisticated
  const words = question.toLowerCase()
    .replace(/[?!.]/g, '')
    .replace(/what is|how does|explain|tell me about|what are/g, '')
    .trim();
  
  // try to find key topic words
  const topicIndicators = [
    'apple intelligence', 'artificial intelligence', 'machine learning',
    'quantum computing', 'blockchain', 'cryptocurrency', 'climate change',
    'space exploration', 'renewable energy', 'genetic engineering'
  ];
  
  for (const indicator of topicIndicators) {
    if (words.includes(indicator)) {
      return indicator;
    }
  }
  
  // fallback: use first few meaningful words
  const meaningfulWords = words.split(' ')
    .filter(word => word.length > 3 && !['what', 'does', 'work', 'like'].includes(word))
    .slice(0, 3)
    .join(' ');
    
  return meaningfulWords || words.split(' ').slice(0, 3).join(' ');
}

function buildContext(relevantChunks, config) {
  // build context for generating a technical brief
  let context = '';
  const addedSources = new Set();
  
  for (const chunk of relevantChunks) {
    const chunkSource = chunk.metadata.source || 'Unknown Source';
    const sourceIdentifier = chunk.metadata.url || chunkSource;

    // to avoid redundancy, add source info only once
    if (!addedSources.has(sourceIdentifier)) {
      context += `Source: ${chunkSource}\n`;
      addedSources.add(sourceIdentifier);
    }
    
    context += `Content: ${chunk.content}\n\n`;
    
    if (context.length > config.brief.maxContextLength) {
      context = context.substring(0, config.brief.maxContextLength);
      break;
    }
  }
  
  return context;
}

function extractSources(relevantChunks) {
  const sources = [];
  const seen = new Set();

  for (const chunk of relevantChunks) {
    const sourceName = chunk.metadata?.source || 'unknown';
    const source = {
      name: sourceName,
      url: chunk.metadata?.url || null,
      title: chunk.metadata?.title || sourceName
    };

    const key = `${source.name}-${source.url}`;
    if (!seen.has(key)) {
      sources.push(source);
      seen.add(key);
    }
  }

  return sources;
}

function calculateConfidence(relevantChunks) {
  if (relevantChunks.length === 0) return 0;

  // calculate confidence based on:
  // 1. number of sources
  // 2. similarity scores
  // 3. source quality
  
  const avgDistance = relevantChunks.reduce((sum, chunk) => sum + chunk.distance, 0) / relevantChunks.length;
  const similarity = Math.max(0, 1 - avgDistance);
  
  // boost confidence for well-known sources
  const qualitySources = relevantChunks.filter(chunk => 
    chunk.metadata && chunk.metadata.source && 
    ['wikipedia', 'britannica', 'science', 'nature', 'bbc', 'npr', 'mit', 'stanford'].some(site => 
      chunk.metadata.source.includes(site)
    )
  ).length;

  const qualityBoost = Math.min(qualitySources * 0.15, 0.4);
  const sourceCountBoost = Math.min(relevantChunks.length * 0.1, 0.3);
  
  return Math.min(Math.round((similarity + qualityBoost + sourceCountBoost) * 100), 100);
}

module.exports = {
  initializeRAG,
  askQuestion,
  learnTopic,
  getKnowledgeStats,
  forgetTopic,
  listKnownTopics
}; 