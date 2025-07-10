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

// check if question is relevant to the current topic using LLM
async function checkQuestionRelevance(ollama, question, topicId) {
  try {
    const systemPrompt = `You are a topic relevance checker. Your job is to determine if a user's question is related to a specific topic.

INSTRUCTIONS:
1. Analyze if the question is asking about, discussing, or seeking information related to the given topic
2. Consider direct mentions, implied connections, and contextual relationships
3. Respond with ONLY "RELEVANT" or "NOT_RELEVANT" - no other text
4. Be generous with relevance - only mark as NOT_RELEVANT if the question is clearly about something completely different`;

    const prompt = `Topic: "${topicId}"
Question: "${question}"

Is this question relevant to the topic?`;

    const response = await ollama.chat({
      system: systemPrompt,
      prompt: prompt,
      temperature: 0.1, // very low temperature for consistent relevance decisions
      num_predict: 20 // short response needed
    });

    const result = response.message.content.trim().toUpperCase();
    return result === 'RELEVANT';
  } catch (error) {
    console.error('❌ failed to check question relevance:', error.message);
    // default to relevant if check fails to avoid breaking the flow
    return true;
  }
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
    // check if question is relevant to current topic
    const isRelevant = await checkQuestionRelevance(ollama, sanitizedQuestion, state.currentTopicId);
    // console.log(`Question relevance check: ${isRelevant ? 'RELEVANT' : 'NOT_RELEVANT'}`);

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

    // prepare final answer with relevance disclaimer if needed
    let finalAnswer = answer.answer;
    if (!isRelevant) {
      finalAnswer = `FYI, this question doesn't exactly seem relevant to the current topic "${state.currentTopicId}"\n\n${answer.answer}`;
    }

    return {
      answer: finalAnswer,
      sources: isRelevant ? extractSources(relevantChunks) : [], // no sources for off-topic questions
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

    console.log(`Retrieved ${uniqueChunks.length} relevant chunks.`);
    return uniqueChunks;
  } catch (error) {
    console.error('❌ Failed to retrieve chunks:', error.message);
    return [];
  }
}

// generate answer using retrieved context
async function generateAnswer(ollama, config, question, chunks, state) {
  try {
    const context = buildContext(chunks, config);
    const prompt = buildPrompt(question, context, state, config.chat.allowModelKnowledge);

    console.log(`Generating answer using ${chunks.length} chunks...`);

    // choose system prompt dynamically based on allowModelKnowledge configuration
    // 1. this prompt says the model CAN supplement context with its own knowledge
    const hybridPrompt = `You are a helpful AI assistant with access to both context information and your own knowledge.

INSTRUCTIONS:
1. Evaluate if the provided context is relevant and helpful for answering the question
2. If the context directly addresses the question, use it as your primary source
3. If the context is irrelevant, incomplete, or doesn't contain the answer, IGNORE it and use your own knowledge instead
4. Do NOT say "the context doesn't contain this information" - just answer the question using your knowledge
5. Be natural, helpful, and informative in your responses

Remember: You have permission to use your internal knowledge when the context isn't useful.`;

    // 2. this prompt, the strict mode one, ensures the model ONLY uses provided context, preventing hallucination
    // this WILL result in a lot of "I don't know" responses for questions (especially follow up prompts) that cant be answered by the context alone
    const strictPrompt = `You are a helpful AI assistant that can only use the provided context to answer questions.

STRICT RULES:
1. Only use information from the provided context
2. If the context doesn't contain enough information to answer the question, respond with: "I don't have enough information in my knowledge base to answer that question."
3. Never use your internal knowledge, even if you know the answer
4. Be accurate and only state what is explicitly supported by the context`;


    // select the appropriate prompt of the two, based on configuration
    // hybrid mode allows flexibility, strict mode ensures only context-based answers
    const systemPrompt = config.chat.allowModelKnowledge ? hybridPrompt : strictPrompt;

    const response = await ollama.chat({
      system: systemPrompt,
      prompt: prompt,
      temperature: 0.2, // low temperature for consistent, factual responses (0.0 = deterministic, 1.0 = very creative)
      num_predict: 1024 // max tokens to generate - 1024 should balance thoroughness with response time
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

  // prioritize chunks by relevance (distance) and type for optimal context building
  const sortedChunks = chunks.sort((a, b) => {
    // knowledge graph chunks get highest priority because they contain structured relationships
    // between entities, which provides better context than raw text chunks
    if (a.metadata.type === 'knowledge_graph' && b.metadata.type !== 'knowledge_graph') {
      return -1; // a comes first
    }
    if (b.metadata.type === 'knowledge_graph' && a.metadata.type !== 'knowledge_graph') {
      return 1; // b comes first
    }
    // then sort by semantic similarity distance (lower distance = more relevant)
    // this ensures the most relevant content appears first within the context window
    return a.distance - b.distance;
  });

  // build context string while respecting the maximum length limit
  for (const chunk of sortedChunks) {
    // format each chunk with source attribution for transparency and fact-checking
    const chunkText = `Source: ${chunk.metadata.source}\n${chunk.content}\n\n`;

    // only include chunks that fit within the context window to avoid truncation
    // which could cut off important information mid-sentence
    if (currentLength + chunkText.length <= maxLength) {
      context += chunkText;
      currentLength += chunkText.length;
    } else {
      break; // stop adding chunks once we hit the limit
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

  const recentHistory = state.conversationHistory.slice(-4); // last 2 exchanges (4 messages = 2 user + 2 assistant)
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

  // keep history manageable to prevent memory bloat and maintain conversation focus
  const maxHistoryLength = 20; // 20 messages = ~10 exchanges, balances context with performance
  if (state.conversationHistory.length > maxHistoryLength) {
    state.conversationHistory = state.conversationHistory.slice(-maxHistoryLength);
  }
}

// basic deduplication of chunks to avoid redundant information in context
function deduplicateChunks(chunks) {
  const seen = new Set();
  const unique = [];

  for (const chunk of chunks) {
    // create a simple hash using first 100 chars, normalized for case and whitespace
    // this catches near-duplicates without being too strict (different sources may have slight variations)
    const contentHash = chunk.content.substring(0, 100).toLowerCase().replace(/\s+/g, ' ');

    if (!seen.has(contentHash)) {
      seen.add(contentHash);
      unique.push(chunk);
    }
  }

  return unique;
}

// extract unique sources from chunks for citation and transparency
function extractSources(chunks) {
  const sources = new Set(); // use Set to automatically deduplicate source URLs
  chunks.forEach(chunk => {
    // only include valid sources, filter out placeholder values
    if (chunk.metadata.source && chunk.metadata.source !== 'unknown') {
      sources.add(chunk.metadata.source);
    }
  });
  return Array.from(sources); // convert back to array for consistent return type
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