/*
  ollama API endpoints used in this client (for more info, see https://ollama.readthedocs.io/en/api/):
  - GET /api/tags: check available models
  - POST /api/embeddings: generate embeddings for a given prompt
  - POST /api/chat: generate a chat completion with support for system prompts and message history
  - POST /api/pull: pull a model from the ollama model registry (honestly, optional. Just a quality of life thing. Makes it more 'production ready'.)

  some quick notes:
  - unless configured otherwise, the /api calls here are hitting the ollama
    local server — typically running at http://localhost:11434. this is the ollama HTTP api (duh), which
    exposes several prebuilt endpoints to interact with models you've downloaded/are running.
  - these apis run on your machine by default and have no authentication. so make sure:
    - they're not exposed to external networks
    - you only use them in local dev or behind a firewall in prod
*/
const fetch = require('node-fetch');

// wrapping ollama api calls in a class so we don't have to pass config around everywhere
class OllamaClient {
  constructor(config) {
    this.host = config.ollama.host;
    this.generationModel = config.ollama.generationModel;
    this.embeddingModel = config.ollama.embeddingModel;
  }

  // check if Ollama is running and models are available
  async checkConnection() {
    try {
      const response = await fetch(`${this.host}/api/tags`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      const modelNames = data.models.map(m => m.name);
      
      const hasGenerationModel = modelNames.some(name => name.includes(this.generationModel.split(':')[0]));
      const hasEmbeddingModel = modelNames.some(name => name.includes(this.embeddingModel.split(':')[0]));
      
      return {
        connected: true,
        models: modelNames,
        hasGenerationModel,
        hasEmbeddingModel,
        missingModels: [
          ...(hasGenerationModel ? [] : [this.generationModel]),
          ...(hasEmbeddingModel ? [] : [this.embeddingModel])
        ]
      };
    } catch (error) {
      return {
        connected: false,
        error: error.message,
        models: [],
        hasGenerationModel: false,
        hasEmbeddingModel: false,
        missingModels: [this.generationModel, this.embeddingModel]
      };
    }
  }

  // generate embeddings for text
  async embeddings(options) {
    try {
      const response = await fetch(`${this.host}/api/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: options.model || this.embeddingModel,
          prompt: options.prompt
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('❌ embedding generation failed:', error.message);
      throw error;
    }
  }

  // generate chat completion with system prompt
  async chat(options) {
    try {
      const messages = [];
      
      if (options.system) {
        messages.push({
          role: 'system',
          content: options.system
        });
      }
      
      if (options.messages) {
        messages.push(...options.messages);
      } else if (options.prompt) {
        messages.push({
          role: 'user',
          content: options.prompt
        });
      }

      const response = await fetch(`${this.host}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: options.model || this.generationModel,
          messages: messages,
          stream: false, // TODO: replace node-fetch with axios/undici and add streaming support
          options: {
            temperature: options.temperature || 0.7, // balanced creativity vs consistency
            top_p: options.top_p || 0.9, // nucleus sampling - keeps most probable tokens while allowing some variety
            num_predict: options.num_predict || 512 // feels like a reasonable response length for chat...
          }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('❌ chat generation failed:', error.message);
      throw error;
    }
  }

  // pull a model if it's not available
  async pullModel(modelName) {
    try {
      console.log(`pulling model: ${modelName}...`);
      
      const response = await fetch(`${this.host}/api/pull`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: modelName,
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      console.log(`✅ model ${modelName} pulled successfully`);
      return true;
    } catch (error) {
      console.error(`❌ failed to pull model ${modelName}:`, error.message);
      throw error;
    }
  }
}

module.exports = { OllamaClient }; 