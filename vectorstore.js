const { ChromaClient } = require('chromadb');
const { generateTopicId } = require('./utils');

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
    console.log('Connecting to ChromaDB...');
    const client = new ChromaClient();
    
    // create custom embedding function
    const embeddingFunction = createOllamaEmbeddingFunction(ollama, config);
    
    console.log('✅ ChromaDB connected successfully');
    
    return { client, embeddingFunction, config };
  } catch (error) {
    console.error('❌ Failed to initialize ChromaDB:', error.message);
    throw error;
  }
}

// get or create collection for a specific topic
async function getTopicCollection(vectorContext, topicId) {
  const { client, embeddingFunction, config } = vectorContext;
  const collectionName = `${config.vectorDb.baseCollectionName}_${topicId}`;
  
  try {
    let collection;
    try {
      collection = await client.getCollection({
        name: collectionName,
        embeddingFunction: embeddingFunction
      });
      // console.log(`[✅ CONNECTED TO EXISTING COLLECTION: ${collectionName}]`);
    } catch (error) {
      console.log(`[CREATING NEW COLLECTION: ${collectionName}...`);
      collection = await client.createCollection({
        name: collectionName,
        metadata: { 
          description: `knowledge base for topic: ${topicId}`,
          topic_id: topicId,
          created_at: new Date().toISOString()
        },
        embeddingFunction: embeddingFunction
      });
      console.log(`[✅ CREATED NEW COLLECTION: ${collectionName}]`);
    }
    
    return collection;
  } catch (error) {
    console.error(`❌ Failed to get/create collection for topic ${topicId}:`, error.message);
    throw error;
  }
}

// store chunks in vector database for a topic
async function storeTopicChunks(vectorContext, topicId, chunks) {
  try {
    const collection = await getTopicCollection(vectorContext, topicId);
    
    console.log(`[STORING ${chunks.length} CHUNKS FOR TOPIC: ${topicId}]`);

    // generate embeddings for all chunks
    const embeddings = [];
    for (const chunk of chunks) {
      const response = await vectorContext.embeddingFunction.generate([chunk.content]);
      embeddings.push(response[0]);
    }

    const ids = chunks.map(chunk => `${topicId}_${chunk.id}`);
    const documents = chunks.map(chunk => chunk.content);
    const metadatas = chunks.map(chunk => ({
      ...chunk.metadata,
      topic_id: topicId,
      stored_at: new Date().toISOString(),
      chunk_id: chunk.id,
      source: chunk.source,
      url: chunk.url,
      type: chunk.type
    }));

    // check for length mismatches
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

    console.log(`[✅ STORED ${chunks.length} CHUNKS FOR TOPIC: ${topicId}]`);
    return { success: true, stored_count: chunks.length };
  } catch (error) {
    console.error('❌ Failed to store chunks:', error.message);
    throw error;
  }
}

// search for similar chunks for a specific topic
async function searchTopicChunks(vectorContext, topicId, query, nResults = 8) {
  try {
    const collection = await getTopicCollection(vectorContext, topicId);
    
    // generate embedding for the query
    const queryEmbedding = await vectorContext.embeddingFunction.generate([query]);
    
    const results = await collection.query({
      queryEmbeddings: queryEmbedding,
      nResults: nResults
    });

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

    return formattedResults;
  } catch (error) {
    console.error(`❌ Failed to search chunks for topic ${topicId}:`, error.message);
    throw error;
  }
}

// get all chunks for a specific topic
async function getTopicChunks(vectorContext, topicId) {
  try {
    const collection = await getTopicCollection(vectorContext, topicId);
    
    const results = await collection.get();

    console.log(`[RETRIEVED ${results.documents.length} CHUNKS FOR TOPIC: ${topicId}]`);
    return results.documents.map((doc, i) => ({
      content: doc,
      metadata: results.metadatas[i],
      id: results.ids[i]
    }));
  } catch (error) {
    console.error(`❌ Failed to get topic chunks for ${topicId}:`, error.message);
    throw error;
  }
}

// list all available topics (collections)
async function listTopics(vectorContext) {
  try {
    const { client, config } = vectorContext;
    const collections = await client.listCollections();
    
    // handle different possible structures - ChromaDB returns collection names as strings
    const topicIds = [];
    
    for (const collection of collections) {
      // collection might be a string directly, or an object with name/id properties
      let collectionName;
      
      if (typeof collection === 'string') {
        collectionName = collection;
      } else if (collection && typeof collection === 'object') {
        collectionName = collection.name || collection.id;
      }
      
      if (collectionName && typeof collectionName === 'string' && 
          collectionName.startsWith(config.vectorDb.baseCollectionName + '_')) {
        const topicId = collectionName.replace(`${config.vectorDb.baseCollectionName}_`, '');
        topicIds.push(topicId);
      }
    }

    console.log(`Found ${topicIds.length} stored topics.`);
    return topicIds;
  } catch (error) {
    console.error('❌ Failed to list topics:', error.message);
    throw error;
  }
}

// delete a topic and its collection
async function deleteTopic(vectorContext, topicId) {
  try {
    const { client, config } = vectorContext;
    const collectionName = `${config.vectorDb.baseCollectionName}_${topicId}`;
    
    await client.deleteCollection({ name: collectionName });
    console.log(`[DELETED TOPIC COLLECTION: ${collectionName}]`);
    
    return { success: true, deleted_topic: topicId };
  } catch (error) {
    console.error(`❌ failed to delete topic ${topicId}:`, error.message);
    throw error;
  }
}

// check if a topic exists in the vector store
async function topicExists(vectorContext, topicId) {
  try {
    const { client, config } = vectorContext;
    const collectionName = `${config.vectorDb.baseCollectionName}_${topicId}`;
    
    console.log(`[CHECKING FOR COLLECTION: ${collectionName}]`);
    
    // try to get the collection directly - more reliable than listing all collections
    try {
      await client.getCollection({ name: collectionName });
      console.log(`[COLLECTION FOUND: ${collectionName}]`);
      return true;
    } catch (getError) {
      // if getCollection fails, the collection doesn't exist
      console.log(`[COLLECTION NOT FOUND: ${collectionName}, ERROR: ${getError.message}]`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Failed to check if topic exists ${topicId}:`, error.message);
    return false;
  }
}

// get statistics for a topic
async function getTopicStats(vectorContext, topicId) {
  try {
    const collection = await getTopicCollection(vectorContext, topicId);
    const results = await collection.get();
    
    // analyze chunk types and sources
    const chunkTypes = {};
    const sources = {};
    const searchTypes = {};
    
    results.metadatas.forEach(meta => {
      chunkTypes[meta.type] = (chunkTypes[meta.type] || 0) + 1;
      sources[meta.source] = (sources[meta.source] || 0) + 1;
      if (meta.searchType) {
        searchTypes[meta.searchType] = (searchTypes[meta.searchType] || 0) + 1;
      }
    });

    return {
      topic_id: topicId,
      total_chunks: results.documents.length,
      chunk_types: chunkTypes,
      sources: sources,
      search_types: searchTypes,
      collection_name: `${vectorContext.config.vectorDb.baseCollectionName}_${topicId}`
    };
  } catch (error) {
    console.error(`❌ Failed to get stats for topic ${topicId}:`, error.message);
    throw error;
  }
}

module.exports = {
  initializeVectorStore,
  getTopicCollection,
  storeTopicChunks,
  searchTopicChunks,
  getTopicChunks,
  listTopics,
  deleteTopic,
  topicExists,
  getTopicStats,
  createOllamaEmbeddingFunction
}; 