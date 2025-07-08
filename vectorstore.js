const { ChromaClient } = require('chromadb');

// custom embedding function that uses Ollama
function createOllamaEmbeddingFunction(ollama, config) {
  return {
    async generate(texts) {
      const embeddings = [];
      for (const text of texts) {
        const response = await ollama.embeddings({
          model: config.ollama.embeddingModel,
          prompt: text
        });
        embeddings.push(response.embedding);
      }
      return embeddings;
    }
  };
}

// create and initialize vector store connection
async function initializeVectorStore(config, ollama) {
  try {
    console.log('🔌 connecting to ChromaDB...');
    const client = new ChromaClient();
    
    // create custom embedding function
    const embeddingFunction = createOllamaEmbeddingFunction(ollama, config);
    
    // get or create collection
    let collection;
    try {
      collection = await client.getCollection({
        name: config.vectorDb.collectionName,
        embeddingFunction: embeddingFunction
      });
      console.log('✅ connected to existing ELI5 knowledge collection');
    } catch (error) {
      console.log('📝 creating new ELI5 knowledge collection...');
      collection = await client.createCollection({
        name: config.vectorDb.collectionName,
        metadata: { description: 'ELI5 knowledge base for any topic' },
        embeddingFunction: embeddingFunction
      });
      console.log('✅ created new ELI5 knowledge collection');
    }
    
    return { client, collection, config };
  } catch (error) {
    console.error('❌ failed to initialize ChromaDB:', error.message);
    throw error;
  }
}

// store chunks in vector database for a topic
async function storeTopicChunks(vectorContext, chunks, embeddings, topicId) {
  const { collection } = vectorContext;
  
  try {
    console.log(`📚 storing ${chunks.length} chunks for topic: ${topicId}`);

    const ids = chunks.map(chunk => `${topicId}_${chunk.id}`);
    const documents = chunks.map(chunk => chunk.content);
    const metadatas = chunks.map(chunk => ({
      ...chunk.metadata,
      topic_id: topicId,
      stored_at: new Date().toISOString()
    }));

    // Debugging: Check for length mismatches
    if (ids.length !== embeddings.length || ids.length !== documents.length || ids.length !== metadatas.length) {
      const errorMsg = `Length mismatch: ids=${ids.length}, embeddings=${embeddings.length}, documents=${documents.length}, metadatas=${metadatas.length}`;
      console.error(`❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }

    await collection.add({
      ids: ids,
      embeddings: embeddings,
      documents: documents,
      metadatas: metadatas
    });

    console.log('✅ topic chunks stored successfully');
    return { success: true, stored_count: chunks.length };
  } catch (error) {
    console.error('❌ failed to store chunks:', error.message);
    throw error;
  }
}

// search for similar chunks about any topic
async function searchSimilar(vectorContext, queryEmbedding, nResults = 6, topicId = null) {
  const { collection } = vectorContext;
  
  try {
    const queryOptions = {
      queryEmbeddings: [queryEmbedding],
      nResults: nResults
    };

    // filter by topic if specified
    if (topicId) {
      queryOptions.where = { topic_id: topicId };
    }

    const results = await collection.query(queryOptions);

    // format results for easier use
    const formattedResults = [];
    for (let i = 0; i < results.documents[0].length; i++) {
      formattedResults.push({
        content: results.documents[0][i],
        metadata: results.metadatas[0][i],
        distance: results.distances[0][i],
        id: results.ids[0][i]
      });
    }

    console.log(`🔍 found ${formattedResults.length} similar chunks`);
    return formattedResults;
  } catch (error) {
    console.error('❌ failed to search similar chunks:', error.message);
    throw error;
  }
}

// get all chunks for a specific topic
async function getTopicChunks(vectorContext, topicId) {
  const { collection } = vectorContext;
  
  try {
    const results = await collection.get({
      where: { topic_id: topicId }
    });

    console.log(`📖 retrieved ${results.documents.length} chunks for topic: ${topicId}`);
    return results.documents.map((doc, i) => ({
      content: doc,
      metadata: results.metadatas[i],
      id: results.ids[i]
    }));
  } catch (error) {
    console.error('❌ failed to get topic chunks:', error.message);
    throw error;
  }
}

// list all stored topics
async function listTopics(vectorContext) {
  const { collection } = vectorContext;
  
  try {
    // get all unique topic IDs
    const results = await collection.get();
    const topicIds = [...new Set(
      results.metadatas
        .map(meta => meta.topic_id)
        .filter(id => id)
    )];

    console.log(`📋 found ${topicIds.length} stored topics`);
    return topicIds;
  } catch (error) {
    console.error('❌ failed to list topics:', error.message);
    throw error;
  }
}

// delete a topic and all its chunks
async function deleteTopic(vectorContext, topicId) {
  try {
    const chunks = await getTopicChunks(vectorContext, topicId);
    const idsToDelete = chunks.map(chunk => chunk.id);

    if (idsToDelete.length > 0) {
      await vectorContext.collection.delete({
        ids: idsToDelete
      });
      console.log(`🗑️ deleted ${idsToDelete.length} chunks for topic: ${topicId}`);
    }

    return { success: true, deleted_count: idsToDelete.length };
  } catch (error) {
    console.error('❌ failed to delete topic:', error.message);
    throw error;
  }
}

// get vector store statistics
async function getVectorStats(vectorContext) {
  const { collection, config } = vectorContext;
  
  try {
    const results = await collection.get();
    const topicIds = [...new Set(
      results.metadatas
        .map(meta => meta.topic_id)
        .filter(id => id)
    )];

    // get topic breakdown
    const topicBreakdown = {};
    results.metadatas.forEach(meta => {
      if (meta.topic_id) {
        topicBreakdown[meta.topic_id] = (topicBreakdown[meta.topic_id] || 0) + 1;
      }
    });

    return {
      total_chunks: results.documents.length,
      total_topics: topicIds.length,
      collection_name: config.vectorDb.collectionName,
      topic_breakdown: topicBreakdown,
      recent_topics: topicIds.slice(-5) // last 5 topics
    };
  } catch (error) {
    console.error('❌ failed to get vector stats:', error.message);
    throw error;
  }
}

// clear old cached topics to keep storage manageable
async function cleanupOldTopics(vectorContext, maxTopics = 50) {
  try {
    const stats = await getVectorStats(vectorContext);
    
    if (stats.total_topics <= maxTopics) {
      return { cleaned: 0, message: 'no cleanup needed' };
    }

    // get all topics with timestamps
    const results = await vectorContext.collection.get();
    const topicTimestamps = {};
    
    results.metadatas.forEach(meta => {
      if (meta.topic_id && meta.stored_at) {
        if (!topicTimestamps[meta.topic_id] || meta.stored_at < topicTimestamps[meta.topic_id]) {
          topicTimestamps[meta.topic_id] = meta.stored_at;
        }
      }
    });

    // sort topics by age and delete oldest ones
    const sortedTopics = Object.entries(topicTimestamps)
      .sort(([,a], [,b]) => new Date(a) - new Date(b))
      .slice(0, stats.total_topics - maxTopics);

    let totalDeleted = 0;
    for (const [topicId] of sortedTopics) {
      const result = await deleteTopic(vectorContext, topicId);
      totalDeleted += result.deleted_count;
    }

    console.log(`🧹 cleaned up ${sortedTopics.length} old topics (${totalDeleted} chunks)`);
    return { cleaned: sortedTopics.length, chunks_deleted: totalDeleted };
  } catch (error) {
    console.error('❌ failed to cleanup old topics:', error.message);
    throw error;
  }
}

module.exports = {
  initializeVectorStore,
  storeTopicChunks,
  searchSimilar,
  getTopicChunks,
  listTopics,
  deleteTopic,
  getVectorStats,
  cleanupOldTopics,
  createOllamaEmbeddingFunction
}; 