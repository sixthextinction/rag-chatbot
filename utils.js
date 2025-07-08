function generateTopicId(topic) {
  return topic.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
}

module.exports = {
  generateTopicId
}; 