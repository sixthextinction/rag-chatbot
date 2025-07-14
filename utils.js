// utility functions for the RAG chatbot system

function generateTopicId(topic) {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // remove special characters
    .replace(/\s+/g, '_') // replace spaces with underscores
    .trim();
}

// break down large documents into smaller, manageable pieces
// why?  because :
//  1. Embedding models have token limits (512/1024 tokens usually)
//  2. Smaller chunks = reduced noise, more precise matching
// 
// NOTE: 
//    To improve accuracy and avoid embedding failures:
//    1. we should really be using a tokenizer (like OpenAI's tiktoken or HuggingFace's tokenizer) to chunk by *token count* instead of word count, because embedding models operate on tokens, not words — 400 words may easily exceed 512 tokens.
//    2. we should try splitting on *semantic boundaries* (sentences or paragraphs) before chunking to preserve meaning, since breaking mid-sentence or mid-paragraph can confuse embeddings and reduce retrieval relevance.

function chunkText(text, chunkSize = 400, overlap = 50) {
  const chunks = [];
  const words = text.split(' '); // split text into individual words
  
  // create sliding window chunks with overlap for context preservation
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(' '); // extract chunk of words
    if (chunk.trim().length > 0) {
      chunks.push(chunk.trim()); // add non-empty chunk to array
    }
  }
  
  return chunks; // all done, return for vector storage
}

function sanitizeInput(input) {
  return input.trim().replace(/[<>]/g, '');
}

function formatTimestamp() {
  return new Date().toISOString();
}

function validateTopic(topic) {
  if (!topic || typeof topic !== 'string') {
    return false;
  }
  
  const cleaned = topic.trim();
  return cleaned.length > 0 && cleaned.length < 100;
}

module.exports = {
  generateTopicId,
  chunkText,
  sanitizeInput,
  formatTimestamp,
  validateTopic
}; 