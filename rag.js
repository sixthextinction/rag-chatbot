const { searchTopicChunks, topicExists } = require('./vectorstore');
const { sanitizeInput } = require('./utils');

// RAG system for answering questions about a specific topic
class RAGSystem {
  constructor(vectorContext, ollama, config) {
    this.vectorContext = vectorContext;
    this.ollama = ollama;
    this.config = config;
    this.currentTopic = null;
    this.currentTopicId = null;
    this.conversationHistory = [];
  }

  // set the current topic for the conversation
  async setTopic(topicId) {
    console.log(`checking if topic exists: ${topicId}`);
    const exists = await topicExists(this.vectorContext, topicId);
    console.log(`topic exists result: ${exists}`);
    
    if (!exists) {
      throw new Error(`topic "${topicId}" not found in knowledge base`);
    }
    
    this.currentTopic = topicId;
    this.currentTopicId = topicId;
    this.conversationHistory = []; // reset conversation history for new topic
    
    console.log(`set current topic to: ${topicId}`);
    return true;
  }

  // answer a question using RAG
  async answerQuestion(question) {
    if (!this.currentTopicId) {
      throw new Error('no topic set. Please set a topic first.');
    }

    const sanitizedQuestion = sanitizeInput(question);
    if (!sanitizedQuestion.trim()) {
      throw new Error('question cannot be empty');
    }

    console.log(`answering question about ${this.currentTopicId}: ${sanitizedQuestion}`);

    try {
      // retrieve relevant chunks
      const relevantChunks = await this.retrieveRelevantChunks(sanitizedQuestion);
      
      if (relevantChunks.length === 0) {
        return {
          answer: "I don't have enough information in my knowledge base to answer that question.",
          sources: [],
          chunks_used: 0,
          topic: this.currentTopicId
        };
      }

      // generate answer using retrieved context
      const answer = await this.generateAnswer(sanitizedQuestion, relevantChunks);
      
      // add to conversation history
      this.addToHistory('user', sanitizedQuestion);
      this.addToHistory('assistant', answer.answer);

      return {
        answer: answer.answer,
        sources: this.extractSources(relevantChunks),
        chunks_used: relevantChunks.length,
        topic: this.currentTopicId,
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
  async retrieveRelevantChunks(question) {
    try {
      const chunks = await searchTopicChunks(
        this.vectorContext,
        this.currentTopicId,
        question,
        this.config.rag.maxRetrievedChunks
      );

      // filter out chunks that are too similar (basic deduplication)
      const uniqueChunks = this.deduplicateChunks(chunks);
      
      console.log(`retrieved ${uniqueChunks.length} relevant chunks`);
      return uniqueChunks;
    } catch (error) {
      console.error('❌ failed to retrieve chunks:', error.message);
      return [];
    }
  }

  // generate answer using retrieved context
  async generateAnswer(question, chunks) {
    try {
      const context = this.buildContext(chunks);
      const prompt = this.buildPrompt(question, context);

      console.log(`generating answer using ${chunks.length} chunks...`);

      const response = await this.ollama.chat({
        system: this.config.chat.systemPrompt,
        prompt: prompt,
        temperature: 0.7,
        num_predict: 512
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
  buildContext(chunks) {
    let context = '';
    let currentLength = 0;
    const maxLength = this.config.rag.maxContextLength;

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
  buildPrompt(question, context) {
    const conversationContext = this.getRecentConversationContext();
    
    let prompt = `Answer the user's question using only the context below. If the answer isn't there, say you don't know.

CONTEXT:
${context}`;

    if (conversationContext) {
      prompt += `\n\nRECENT CONVERSATION:
${conversationContext}`;
    }

    prompt += `\n\nQUESTION:
${question}`;

    return prompt;
  }

  // get recent conversation context
  getRecentConversationContext() {
    if (this.conversationHistory.length === 0) {
      return '';
    }

    const recentHistory = this.conversationHistory.slice(-4); // last 2 exchanges
    return recentHistory
      .map(entry => `${entry.role}: ${entry.content}`)
      .join('\n');
  }

  // add message to conversation history
  addToHistory(role, content) {
    this.conversationHistory.push({
      role,
      content,
      timestamp: new Date().toISOString()
    });

    // keep history manageable
    if (this.conversationHistory.length > this.config.chat.maxHistoryLength) {
      this.conversationHistory = this.conversationHistory.slice(-this.config.chat.maxHistoryLength);
    }
  }

  // basic deduplication of chunks
  deduplicateChunks(chunks) {
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
  extractSources(chunks) {
    const sources = new Set();
    chunks.forEach(chunk => {
      if (chunk.metadata.source && chunk.metadata.source !== 'unknown') {
        sources.add(chunk.metadata.source);
      }
    });
    return Array.from(sources);
  }

  // get current topic info
  getCurrentTopic() {
    return {
      topic: this.currentTopic,
      topicId: this.currentTopicId,
      conversationLength: this.conversationHistory.length
    };
  }

  // clear conversation history
  clearHistory() {
    this.conversationHistory = [];
    console.log('cleared conversation history');
  }

  // get conversation history
  getHistory() {
    return this.conversationHistory;
  }
}

module.exports = { RAGSystem }; 