// disable SSL certificate validation for proxy connections
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { HttpsProxyAgent } = require('https-proxy-agent');
const fetch = require('node-fetch');
const { hasCachedData, loadCachedData, saveCacheData } = require('./cache');
const { generateTopicId } = require('./utils');

async function fetchTopicData(searchQuery, config) {
  // check for cached data first
  if (hasCachedData(searchQuery, config.cache?.dir, config.cache?.expiryDays)) {
    const cachedResults = loadCachedData(searchQuery, config.cache?.dir);
    if (cachedResults) {
      return cachedResults;
    }
  }

  try {
    const proxyUrl = `http://brd-customer-${config.brightData.customerId}-zone-${config.brightData.zone}:${config.brightData.password}@${config.brightData.proxyHost}:${config.brightData.proxyPort}`;

    const agent = new HttpsProxyAgent(proxyUrl, {
      rejectUnauthorized: false,
      secureProtocol: 'TLSv1_2_method'
    });

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}&num=${config.brightData.maxResults}&brd_json=1`;

    console.log(`🔍 searching for: ${searchQuery}`);

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

// gather comprehensive topic data using multiple search templates
async function gatherTopicData(topic, config) {
  const allChunks = [];
  const searchResults = [];
  const topicId = generateTopicId(topic);

  console.log(`📊 gathering comprehensive data for: ${topic}`);
  
  // search using each template for this topic
  for (let i = 0; i < config.search.searchTemplates.length; i++) {
    const template = config.search.searchTemplates[i];
    const searchQuery = buildTopicSearchQuery(template, topic);
    
    try {
      // add delay between requests to avoid rate limiting
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, config.requests.delayBetweenRequests));
      }
      
      const searchData = await fetchTopicData(searchQuery, config);
      searchResults.push(searchData);
      
      // build knowledge chunks from this search
      const knowledgeBase = buildTopicKnowledgeBase(searchData, topic, topicId, template);
      allChunks.push(...knowledgeBase.chunks);
      
    } catch (error) {
      console.warn(`⚠️ search failed for template "${template}": ${error.message}`);
      // continue with other searches even if one fails
    }
  }

  console.log(`📚 collected ${allChunks.length} total chunks for ${topic}`);
  
  // extract unique sources from all chunks
  const uniqueSources = [...new Set(allChunks.map(chunk => chunk.source))];
  
  return {
    chunks: allChunks,
    searchResults,
    metadata: {
      topic,
      searchTemplatesUsed: config.search.searchTemplates.length,
      totalChunks: allChunks.length,
      sources: uniqueSources,
      timestamp: new Date().toISOString()
    }
  };
}

// build structured data from SERP results for a single topic
function buildTopicKnowledgeBase(searchResults, topic, topicId, searchTemplate) {
  const chunks = [];

  // process organic search results
  if (searchResults.organic) {
    searchResults.organic.forEach((result, index) => {
      if (result.title && result.description) {
        // create unique ID using template key and URL hash to avoid duplicates
        const parts = searchTemplate.split(' ');
        let templateKey = parts[0] === '{topic}' && parts.length > 1 ? parts[1] : parts[0];
        templateKey = templateKey.replace(/[^a-z0-9]/gi, '') || 'general';
        
        const urlHash = result.link ? result.link.split('/').pop().substring(0, 8) : index;
        chunks.push({
          id: `${templateKey}_organic_${index}_${urlHash}`,
          content: `${result.title}\n${result.description}`,
          source: result.display_link || 'unknown',
          url: result.link || '',
          type: 'search_result',
          metadata: {
            topic,
            source: result.display_link || 'unknown',
            url: result.link || '',
            title: result.title,
            searchType: getSearchType(searchTemplate),
            rank: index + 1
          }
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
      // create unique ID by including search template to avoid duplicates
      const parts = searchTemplate.split(' ');
      let templateKey = parts[0] === '{topic}' && parts.length > 1 ? parts[1] : parts[0];
      templateKey = templateKey.replace(/[^a-z0-9]/gi, '') || 'general';

      const contentHash = knowledgeContent.join('').substring(0, 8);
      chunks.push({
        id: `${templateKey}_knowledge_graph_${contentHash}`,
        content: knowledgeContent.join('\n'),
        source: 'Google Knowledge Graph',
        url: '',
        type: 'knowledge_graph',
        metadata: {
          topic,
          source: 'Google Knowledge Graph',
          url: '',
          title: 'Knowledge Graph',
          searchType: 'knowledge_graph',
          rank: 0 // highest priority
        }
      });
    }
  }

  return {
    chunks,
    metadata: {
      timestamp: new Date().toISOString(),
      topic,
      searchTemplate,
      total_chunks: chunks.length,
      organic_results_count: searchResults.organic?.length || 0,
      has_knowledge_graph: !!searchResults.knowledge,
      search_quality_score: calculateSearchQuality(searchResults)
    }
  };
}

function calculateSearchQuality(searchResults) {
  let score = 0;
  let maxScore = 100;

  // organic results quality (60% of score)
  if (searchResults.organic && searchResults.organic.length > 0) {
    const organicScore = Math.min(searchResults.organic.length * 10, 60);
    score += organicScore;
  }

  // knowledge graph presence (40% of score)
  if (searchResults.knowledge) {
    score += 40;
  }

  return Math.round((score / maxScore) * 100);
}

function buildTopicSearchQuery(template, topic) {
  return template.replace('{topic}', topic);
}

function getSearchType(template) {
  if (template.includes('explained')) return 'explanation';
  if (template.includes('guide')) return 'guide';
  if (template.includes('definition')) return 'definition';
  if (template.includes('how')) return 'howto';
  if (template.includes('examples')) return 'examples';
  return 'general';
}

module.exports = {
  gatherTopicData,
  fetchTopicData,
  buildTopicKnowledgeBase,
  calculateSearchQuality,
  buildTopicSearchQuery,
  getSearchType
}; 