// disable SSL certificate validation for proxy connections
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { HttpsProxyAgent } = require('https-proxy-agent');
const fetch = require('node-fetch');
const { hasCachedData, loadCachedData, saveCacheData } = require('./cache');
const { generateTopicId, chunkText } = require('./utils');

// fetch search results for a single query
async function fetchTopicData(searchQuery, config) {
  // check for cached data first
  if (hasCachedData(searchQuery, config.cache?.dir, config.cache?.expiryDays)) {
    const cachedResults = loadCachedData(searchQuery, config.cache?.dir);
    if (cachedResults && cachedResults.data) {
      return cachedResults.data;
    }
  }

  try {
    const proxyUrl = `http://brd-customer-${config.brightData.customerId}-zone-${config.brightData.zone}:${config.brightData.password}@${config.brightData.proxyHost}:${config.brightData.proxyPort}`;

    const agent = new HttpsProxyAgent(proxyUrl, {
      rejectUnauthorized: false,
      secureProtocol: 'TLSv1_2_method'
    });

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}&num=${config.brightData.maxResults}&brd_json=1`;

    console.log(`searching for: ${searchQuery}`);

    const response = await fetch(searchUrl, {
      method: 'GET',
      agent: agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json, text/html, */*',
        'Accept-Encoding': 'gzip, deflate, br'
      }
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status} - ${response.statusText}`);
    }

    let data;
    try {
      data = JSON.parse(responseText);
      console.log(`✅ found ${data.organic?.length || 0} organic results`);
      
      // save to cache
      saveCacheData(searchQuery, data, config.cache?.dir, config.cache?.expiryDays);
      
      return data;

    } catch (parseError) {
      if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
        throw new Error('received HTML instead of JSON - proxy may not be working correctly');
      } else {
        throw new Error('response is not valid JSON');
      }
    }
  } catch (error) {
    console.error('❌ search request failed:', error.message);
    throw error;
  }
}

// comprehensive topic research using multiple search templates
async function researchTopic(topic, config) {
  const allChunks = [];
  const searchResults = [];
  const topicId = generateTopicId(topic);

  console.log(`\nResearching topic: ${topic}`);
  console.log(`Using ${config.search.searchTemplates.length} search templates`);
  console.log(`\nThis may take a few minutes...\n`);
  
  // execute searches (via SERP API) using each template
  for (let i = 0; i < config.search.searchTemplates.length; i++) {
    const template = config.search.searchTemplates[i];
    const searchQuery = template.replace('{topic}', topic);
    
    try {
      // add delay between requests to avoid rate limiting
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, config.requests.delayBetweenRequests));
      }
      
      const searchData = await fetchTopicData(searchQuery, config);
      searchResults.push(searchData);
      
      // process search results into chunks
      const chunks = processSearchResults(searchData, topic, topicId, template, config);
      allChunks.push(...chunks);
      
    } catch (error) {
      console.warn(`Search failed for template "${template}": ${error.message}`);
      // continue with other searches even if one fails
    }
  }

  console.log(`Collected ${allChunks.length} total chunks for ${topic}`);
  
  // extract unique sources from all chunks
  const uniqueSources = [...new Set(allChunks.map(chunk => chunk.source))];
  
  return {
    chunks: allChunks,
    searchResults,
    metadata: {
      topic,
      topicId,
      searchTemplatesUsed: config.search.searchTemplates.length,
      totalChunks: allChunks.length,
      sources: uniqueSources,
      timestamp: new Date().toISOString()
    }
  };
}

// process search results into structured chunks
function processSearchResults(searchResults, topic, topicId, searchTemplate, config) {
  const chunks = [];

  // process organic search results
  if (searchResults.organic) {
    searchResults.organic.forEach((result, index) => {
      if (result.title && result.description) {
        // create content combining title and description
        const content = `${result.title}\n${result.description}`;
        
        // chunk the content if it's too long
        const textChunks = chunkText(content, config.rag.chunkSize, config.rag.chunkOverlap);
        
        textChunks.forEach((chunk, chunkIndex) => {
          // create unique ID for each chunk
          const templateKey = getTemplateKey(searchTemplate);
          const urlHash = result.link ? result.link.split('/').pop().substring(0, 8) : index;
          
          chunks.push({
            id: `${templateKey}_organic_${index}_${chunkIndex}_${urlHash}`,
            content: chunk,
            source: result.display_link || 'unknown',
            url: result.link || '',
            type: 'search_result',
            metadata: {
              topic,
              topicId,
              source: result.display_link || 'unknown',
              url: result.link || '',
              title: result.title,
              searchType: getSearchType(searchTemplate),
              rank: index + 1,
              chunkIndex
            }
          });
        });
      }
    });
  }

  // process knowledge graph if available
  if (searchResults.knowledge) {
    const knowledgeContent = [];
    
    if (searchResults.knowledge.description) {
      knowledgeContent.push(searchResults.knowledge.description);
    }

    if (searchResults.knowledge.facts) {
      searchResults.knowledge.facts.forEach(fact => {
        knowledgeContent.push(`${fact.key}: ${fact.value}`);
      });
    }

    if (knowledgeContent.length > 0) {
      const content = knowledgeContent.join('\n');
      const textChunks = chunkText(content, config.rag.chunkSize, config.rag.chunkOverlap);
      
      textChunks.forEach((chunk, chunkIndex) => {
        const templateKey = getTemplateKey(searchTemplate);
        
        chunks.push({
          id: `${templateKey}_knowledge_graph_${chunkIndex}`,
          content: chunk,
          source: 'Google Knowledge Graph',
          url: '',
          type: 'knowledge_graph',
          metadata: {
            topic,
            topicId,
            source: 'Google Knowledge Graph',
            url: '',
            title: 'Knowledge Graph',
            searchType: 'knowledge_graph',
            rank: 0, // highest priority
            chunkIndex
          }
        });
      });
    }
  }

  return chunks;
}

// helper functions
function getTemplateKey(template) {
  const parts = template.split(' ');
  let templateKey = parts[0] === '{topic}' && parts.length > 1 ? parts[1] : parts[0];
  return templateKey.replace(/[^a-z0-9]/gi, '') || 'general';
}

function getSearchType(template) {
  if (template.includes('explained')) return 'explanation';
  if (template.includes('guide')) return 'guide';
  if (template.includes('definition')) return 'definition';
  if (template.includes('how')) return 'howto';
  if (template.includes('examples')) return 'examples';
  if (template.includes('vs') || template.includes('alternatives')) return 'comparison';
  if (template.includes('news') || template.includes('update')) return 'news';
  return 'general';
}

module.exports = {
  researchTopic,
  fetchTopicData,
  processSearchResults,
  getSearchType,
  getTemplateKey
}; 