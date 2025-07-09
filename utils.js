// utility functions for the RAG chatbot system

function generateTopicId(topic) {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // remove special characters
    .replace(/\s+/g, '_') // replace spaces with underscores
    .trim();
}

function chunkText(text, chunkSize = 400, overlap = 50) {
  const chunks = [];
  const words = text.split(' ');
  
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim().length > 0) {
      chunks.push(chunk.trim());
    }
  }
  
  return chunks;
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