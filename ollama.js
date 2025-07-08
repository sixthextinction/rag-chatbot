const { Ollama } = require('ollama');

// create Ollama client
function createOllamaClient(config) {
  return new Ollama({ 
    host: config.ollama.host 
  });
}

// test connection to Ollama
async function testConnection(ollama, config) {
  try {
    console.log('🔗 testing Ollama connection...');
    await ollama.list();
    console.log('✅ Ollama connection successful');
  } catch (error) {
    console.error('❌ ollama connection failed:', error.message);
    throw new Error('ollama connection failed. make sure Ollama is running with: ollama serve');
  }
}

// check if required models are available
async function checkModels(ollama, config) {
  try {
    console.log('🔍 checking required models...');
    const response = await ollama.list();
    const availableModels = response.models.map(m => m.name);
    
    const requiredModels = [
      config.ollama.generationModel,
      config.ollama.embeddingModel
    ];
    
    const missingModels = requiredModels.filter(model => 
      !availableModels.some(available => available.startsWith(model))
    );
    
    if (missingModels.length > 0) {
      console.error('❌ missing required models:', missingModels.join(', '));
      throw new Error(`missing required models: ${missingModels.join(', ')}`);
    }
    
    console.log('✅ all required models are available');
    return true;
  } catch (error) {
    console.error('❌ model check failed:', error.message);
    throw error;
  }
}

// generate embedding for a single text
async function generateEmbedding(ollama, config, text) {
  try {
    const response = await ollama.embeddings({
      model: config.ollama.embeddingModel,
      prompt: text
    });
    return response.embedding;
  } catch (error) {
    console.error('❌ failed to generate embedding:', error.message);
    throw error;
  }
}

// generate embeddings for multiple texts
async function generateEmbeddings(ollama, config, texts) {
  try {
    console.log(`🔮 generating embeddings for ${texts.length} texts...`);
    const embeddings = [];
    
    for (const text of texts) {
      const embedding = await generateEmbedding(ollama, config, text);
      embeddings.push(embedding);
      
      // small delay to avoid overwhelming the model
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log('✅ embeddings generated successfully');
    return embeddings;
  } catch (error) {
    console.error('❌ failed to generate embeddings:', error.message);
    throw error;
  }
}

// generate a comprehensive technical brief using retrieved context
async function generateTechnicalBrief(ollama, config, context, question, topic) {
  try {
    console.log('🤖 generating technical brief...');
    
    // create a prompt for a comprehensive, well-structured technical brief
    const prompt = `You are a principal engineer writing a technical brief for a junior engineer.
Your audience has a computer science degree but is new to this specific topic. Your task is to provide a clear, comprehensive, and well-structured overview of the topic based on the provided context.

Topic: ${topic}
Question: ${question}

Context from various sources:
---
${context}
---

Based on the context, please generate a technical brief. The brief should be structured to cover the following aspects, where relevant:

1.  **Core Concepts:** Start with a clear definition and explanation of the fundamental concepts.
2.  **Architecture & How It Works:** Describe the underlying architecture and the mechanics of how the technology or concept functions.
3.  **Use Cases & Real-World Examples:** Provide concrete examples of where this is used in practice.
4.  **Strengths & Weaknesses (Pros & Cons):** Offer a balanced view of its advantages and disadvantages.
5.  **Comparisons to Alternatives:** Briefly compare it to other similar technologies or approaches.
6.  **Recent Developments & Future Trends:** Mention any recent news or updates that are relevant.

Assume your audience is intelligent and can understand technical details, but avoid domain-specific jargon without explaining it first. The goal is to get them up to speed quickly and thoroughly.

Technical Brief:`;

    const response = await ollama.generate({
      model: config.ollama.generationModel,
      prompt: prompt,
      stream: false,
      options: {
        temperature: 0.5, // lower temperature for more factual, less creative output
        top_p: 0.9,
        max_tokens: 1500 // increased token limit for more detailed explanations
      }
    });

    console.log('✅ technical brief generated');
    return response.response.trim();
  } catch (error) {
    console.error('❌ failed to generate technical brief:', error.message);
    throw error;
  }
}

// get model information
async function getModelInfo(ollama, config) {
  try {
    const response = await ollama.list();
    const models = response.models;
    
    const generationModel = models.find(m => 
      m.name.startsWith(config.ollama.generationModel)
    );
    const embeddingModel = models.find(m => 
      m.name.startsWith(config.ollama.embeddingModel)
    );
    
    return {
      generation_model: {
        name: generationModel?.name || config.ollama.generationModel,
        size: generationModel?.size || 'unknown'
      },
      embedding_model: {
        name: embeddingModel?.name || config.ollama.embeddingModel,
        size: embeddingModel?.size || 'unknown'
      }
    };
  } catch (error) {
    console.error('❌ failed to get model info:', error.message);
    return {
      generation_model: { name: config.ollama.generationModel, size: 'unknown' },
      embedding_model: { name: config.ollama.embeddingModel, size: 'unknown' }
    };
  }
}

// test model with a simple question
async function testGeneration(ollama, config) {
  try {
    console.log('🧪 testing generation...');
    
    const testContext = "The internet is a global network of computers that can talk to each other. Websites are like digital pages that live on these computers. It uses protocols like TCP/IP.";
    const testQuestion = "What is the internet?";
    const testTopic = "internet basics";
    
    const explanation = await generateTechnicalBrief(ollama, config, testContext, testQuestion, testTopic);
    
    console.log('✅ generation test passed');
    console.log('test explanation:', explanation.substring(0, 200) + '...');
    
    return true;
  } catch (error) {
    console.error('❌ generation test failed:', error.message);
    throw error;
  }
}

module.exports = {
  createOllamaClient,
  testConnection,
  checkModels,
  generateEmbedding,
  generateEmbeddings,
  generateTechnicalBrief,
  getModelInfo,
  testGeneration
}; 