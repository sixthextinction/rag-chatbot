const { searchTopicChunks, topicExists } = require('./vectorstore');
const { sanitizeInput } = require('./utils');

// RAG state - holds current topic and conversation history
// way cleaner than a class since this is really just orchestrating other modules
function createRAGState() {
  return {
    currentTopic: null,
    currentTopicId: null,
    conversationHistory: []
  };
}

// set the current topic for the conversation
async function setTopic(state, vectorContext, topicId) {
  const exists = await topicExists(vectorContext, topicId);
  console.log(`It ${exists ? 'does.' : 'does not.'}`);

  if (!exists) {
    throw new Error(`Topic "${topicId}" not found in knowledge base`);
  }

  state.currentTopic = topicId;
  state.currentTopicId = topicId;
  state.conversationHistory = []; // reset conversation history for new topic

  console.log(`Setting current topic to: ${topicId}`);
  return true;
}

// answer a question using RAG
async function answerQuestion(state, vectorContext, ollama, config, question) {
  if (!state.currentTopicId) {
    throw new Error('No topic set. Please set a topic first.');
  }

  const sanitizedQuestion = sanitizeInput(question);
  if (!sanitizedQuestion.trim()) {
    throw new Error('Question cannot be empty');
  }

  try {
    // retrieve relevant chunks
    const relevantChunks = await retrieveRelevantChunks(vectorContext, state.currentTopicId, sanitizedQuestion, config);

    // allow model to answer using its own knowledge if allowModelKnowledge is true
    if (relevantChunks.length === 0 && config.chat.allowModelKnowledge) {
      const answer = await generateAnswer(ollama, config, sanitizedQuestion, [], state);

      addToHistory(state, 'user', sanitizedQuestion);
      addToHistory(state, 'assistant', answer.answer);

      return {
        answer: answer.answer,
        sources: [],
        chunks_used: 0,
        topic: state.currentTopicId,
        context_used: []
      };
    }

    // fallback if hybrid mode is off
    if (relevantChunks.length === 0) {
      return {
        answer: "I don't have enough information in my knowledge base to answer that question.",
        sources: [],
        chunks_used: 0,
        topic: state.currentTopicId
      };
    }

    // generate answer using retrieved context
    const answer = await generateAnswer(ollama, config, sanitizedQuestion, relevantChunks, state);

    // add to conversation history
    addToHistory(state, 'user', sanitizedQuestion);
    addToHistory(state, 'assistant', answer.answer);

    return {
      answer: answer.answer,
      sources: extractSources(relevantChunks),
      chunks_used: relevantChunks.length,
      topic: state.currentTopicId,
      context_used: relevantChunks.map(chunk => ({
        content: chunk.content.substring(0, 100) + '...',
        source: chunk.metadata.source,
        type: chunk.metadata.type
      }))
    };

  } catch (error) {
    console.error('❌ failed to answer question:', error.message);
    throw error;
  }
}

// check for warning conditions about relevance and topic matching
async function checkWarningConditions(vectorContext, currentTopicId, question, chunks, config) {
  try {
    // warning 1: check if all chunks have low similarity scores
    if (config.warnings.enableSimilarityWarning && chunks.length > 0) {
      // convert distance to similarity (chromadb uses cosine distance: similarity = 1 - distance)
      const similarities = chunks.map(chunk => 1 - chunk.distance);
      
      if (similarities.every(similarity => similarity < config.warnings.lowSimilarityThreshold)) {
        const maxSimilarity = Math.max(...similarities);
        console.warn(`[⚠️] Retrieved chunks may not be relevant to the question. Highest similarity: ${maxSimilarity.toFixed(3)}. Consider broadening the scope or rephrasing the question.`);
      }
    }

    // warning 2: check if question intent doesn't semantically match the topic
    if (config.warnings.enableTopicMismatchWarning) {
      await checkTopicMismatch(vectorContext, currentTopicId, question, config);
    }
  } catch (error) {
    console.error('❌ warning check failed:', error.message);
    // don't throw - warnings should not break the flow
  }
}

// check if the question semantically matches the current topic
async function checkTopicMismatch(vectorContext, currentTopicId, question, config) {
  try {
    // create a simple topic description query to compare against
    const topicQuery = `what is ${currentTopicId.replace(/_/g, ' ')}`;
    
    // get embeddings for both the question and the topic
    const questionEmbedding = await vectorContext.embeddingFunction.generate([question]);
    const topicEmbedding = await vectorContext.embeddingFunction.generate([topicQuery]);
    
    // calculate cosine similarity between question and topic embeddings
    const similarity = calculateCosineSimilarity(questionEmbedding[0], topicEmbedding[0]);
    
    if (similarity < config.warnings.topicMismatchThreshold) {
      console.warn(`[⚠️] Question intent may not match the current topic "${currentTopicId}". Similarity: ${similarity.toFixed(3)}. Consider switching topics or rephrasing the question.`);
    }
  } catch (error) {
    console.error('❌ topic mismatch check failed:', error.message);
    // don't throw - this is just a warning
  }
}

// calculate cosine similarity between two vectors
function calculateCosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) {
    throw new Error('vectors must have the same length');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  
  if (normA === 0 || normB === 0) {
    return 0;
  }
  
  return dotProduct / (normA * normB);
}

// retrieve relevant chunks for the question
async function retrieveRelevantChunks(vectorContext, currentTopicId, question, config) {
  try {
    const chunks = await searchTopicChunks(
      vectorContext,
      currentTopicId,
      question,
      config.rag.maxRetrievedChunks
    );

    // filter out chunks that are too similar (basic deduplication)
    const uniqueChunks = deduplicateChunks(chunks);

    // check for warning conditions
    await checkWarningConditions(vectorContext, currentTopicId, question, uniqueChunks, config);

    console.log(`retrieved ${uniqueChunks.length} relevant chunks`);
    return uniqueChunks;
  } catch (error) {
    console.error('❌ failed to retrieve chunks:', error.message);
    return [];
  }
}

// generate answer using retrieved context
async function generateAnswer(ollama, config, question, chunks, state) {
  try {
    const context = buildContext(chunks, config);
    const prompt = buildPrompt(question, context, state, config.chat.allowModelKnowledge);

    console.log(`generating answer using ${chunks.length} chunks...`);

    // choose system prompt dynamically
    const hybridPrompt = `You are a helpful AI assistant that answers user questions.

Use the context provided **if it's helpful**. If the context is unrelated or missing the answer, feel free to use your own knowledge.

Clearly prefer context when it's available and relevant — otherwise, use internal knowledge to answer accurately.

Be concise and informative.`;



const strictPrompt = `You are a helpful AI assistant.

Only answer questions using the provided context. If the context doesn't contain enough information, say:
"I don't have enough information in my knowledge base to answer that question."

Do not use your internal knowledge, even if you know the answer.`;


    const systemPrompt = config.chat.allowModelKnowledge ? hybridPrompt : strictPrompt;

    const response = await ollama.chat({
      system: systemPrompt,
      prompt: prompt,
      temperature: 0.2, // more creative
      num_predict: 1024 // think more
    });

    return {
      answer: response.message.content.trim(),
      tokens_used: response.eval_count || 0,
      generation_time: response.total_duration || 0
    };
  } catch (error) {
    console.error('❌ failed to generate answer:', error.message);
    throw error;
  }
}


// build context from retrieved chunks
function buildContext(chunks, config) {
  let context = '';
  let currentLength = 0;
  const maxLength = config.rag.maxContextLength;

  // prioritize chunks by relevance (distance) and type
  const sortedChunks = chunks.sort((a, b) => {
    // knowledge graph chunks get highest priority
    if (a.metadata.type === 'knowledge_graph' && b.metadata.type !== 'knowledge_graph') {
      return -1;
    }
    if (b.metadata.type === 'knowledge_graph' && a.metadata.type !== 'knowledge_graph') {
      return 1;
    }
    // then sort by distance (relevance)
    return a.distance - b.distance;
  });

  for (const chunk of sortedChunks) {
    const chunkText = `Source: ${chunk.metadata.source}\n${chunk.content}\n\n`;

    if (currentLength + chunkText.length <= maxLength) {
      context += chunkText;
      currentLength += chunkText.length;
    } else {
      break;
    }
  }

  return context.trim();
}

// build the final prompt for the LLM
function buildPrompt(question, context, state, allowModelKnowledge) {
  const conversationContext = getRecentConversationContext(state);

  let prompt = allowModelKnowledge
    ? `You are an expert assistant. If the context below answers the question, use it. If the context is missing or unrelated, use your own knowledge.\n\n`
    : `You are an expert assistant. Answer the user's question using only the context below. If the context doesn't have the answer, say "I don't know."\n\n`;

  prompt += `--- CONTEXT START ---\n${context || 'No relevant context found.'}\n--- CONTEXT END ---\n`;

  if (conversationContext) {
    prompt += `\n\n--- RECENT CONVERSATION ---\n${conversationContext}`;
  }

  prompt += `\n\n--- QUESTION ---\n${question}`;

  return prompt;
}





// get recent conversation context
function getRecentConversationContext(state) {
  if (state.conversationHistory.length === 0) {
    return '';
  }

  const recentHistory = state.conversationHistory.slice(-4); // last 2 exchanges
  return recentHistory
    .map(entry => `${entry.role}: ${entry.content}`)
    .join('\n');
}

// add message to conversation history
function addToHistory(state, role, content) {
  state.conversationHistory.push({
    role,
    content,
    timestamp: new Date().toISOString()
  });

  // keep history manageable - this should probably be configurable
  const maxHistoryLength = 20; // reasonable default
  if (state.conversationHistory.length > maxHistoryLength) {
    state.conversationHistory = state.conversationHistory.slice(-maxHistoryLength);
  }
}

// basic deduplication of chunks
function deduplicateChunks(chunks) {
  const seen = new Set();
  const unique = [];

  for (const chunk of chunks) {
    // create a simple hash of the content
    const contentHash = chunk.content.substring(0, 100).toLowerCase().replace(/\s+/g, ' ');

    if (!seen.has(contentHash)) {
      seen.add(contentHash);
      unique.push(chunk);
    }
  }

  return unique;
}

// extract unique sources from chunks
function extractSources(chunks) {
  const sources = new Set();
  chunks.forEach(chunk => {
    if (chunk.metadata.source && chunk.metadata.source !== 'unknown') {
      sources.add(chunk.metadata.source);
    }
  });
  return Array.from(sources);
}

// get current topic info
function getCurrentTopic(state) {
  return {
    topic: state.currentTopic,
    topicId: state.currentTopicId,
    conversationLength: state.conversationHistory.length
  };
}

// clear conversation history
function clearHistory(state) {
  state.conversationHistory = [];
  console.log('cleared conversation history');
}

// get conversation history
function getHistory(state) {
  return state.conversationHistory;
}

module.exports = {
  createRAGState,
  setTopic,
  answerQuestion,
  getCurrentTopic,
  clearHistory,
  getHistory
}; 