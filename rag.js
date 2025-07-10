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

    // fallback if hybrid mode is off and no chunks found
    if (relevantChunks.length === 0 && !config.chat.allowModelKnowledge) {
      return {
        answer: "I don't have enough information in my knowledge base to answer that question.",
        sources: [],
        chunks_used: 0,
        topic: state.currentTopicId
      };
    }

    // generate answer - let the model decide whether to use chunks or its own knowledge
    // the system prompt will guide this behavior based on allowModelKnowledge setting
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
    const hybridPrompt = `You are a helpful AI assistant with access to both context information and your own knowledge.

INSTRUCTIONS:
1. Evaluate if the provided context is relevant and helpful for answering the question
2. If the context directly addresses the question, use it as your primary source
3. If the context is irrelevant, incomplete, or doesn't contain the answer, IGNORE it and use your own knowledge instead
4. Do NOT say "the context doesn't contain this information" - just answer the question using your knowledge
5. Be natural, helpful, and informative in your responses

Remember: You have permission to use your internal knowledge when the context isn't useful.`;

const strictPrompt = `You are a helpful AI assistant that can only use the provided context to answer questions.

STRICT RULES:
1. Only use information from the provided context
2. If the context doesn't contain enough information to answer the question, respond with: "I don't have enough information in my knowledge base to answer that question."
3. Never use your internal knowledge, even if you know the answer
4. Be accurate and only state what is explicitly supported by the context`;


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

  // build prompt without conflicting instructions - let system prompt handle the behavior
  let prompt = `--- CONTEXT START ---\n${context || 'No relevant context found.'}\n--- CONTEXT END ---\n`;

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