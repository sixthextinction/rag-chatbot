const fs = require('fs');
const path = require('path');

function getCacheFilePath(searchQuery, cacheDir = 'cache') {
  const queryIdentifier = searchQuery.toLowerCase().replace(/[^a-z0-9]/g, '_');
  return path.join(cacheDir, `${queryIdentifier}_cache.json`);
}

function hasCachedData(searchQuery, cacheDir = 'cache', cacheExpiryDays = 1) {
  try {
    const cacheFilePath = getCacheFilePath(searchQuery, cacheDir);
    
    if (!fs.existsSync(cacheFilePath)) {
      return false;
    }
    
    const cacheData = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
    const cacheAge = Date.now() - new Date(cacheData.timestamp).getTime();
    const maxAge = cacheExpiryDays * 24 * 60 * 60 * 1000;
    
    if (cacheAge > maxAge) {
      return false;
    }
    
    return true;
  } catch (error) {
    return false;
  }
}

function loadCachedData(searchQuery, cacheDir = 'cache') {
  try {
    const cacheFilePath = getCacheFilePath(searchQuery, cacheDir);
    const cacheData = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
    
    console.log(`📁 loaded cached data for: ${searchQuery}`);
    return cacheData.searchResults;
  } catch (error) {
    return null;
  }
}

function saveCacheData(searchQuery, searchResults, cacheDir = 'cache', cacheExpiryDays = 1) {
  try {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    
    const cacheFilePath = getCacheFilePath(searchQuery, cacheDir);
    const cacheData = {
      timestamp: new Date().toISOString(),
      searchQuery: searchQuery,
      searchResults: searchResults,
      metadata: {
        cache_version: '1.0',
        expiry_days: cacheExpiryDays,
        organic_count: searchResults.organic?.length || 0,
        has_knowledge_graph: !!searchResults.knowledge
      }
    };
    
    fs.writeFileSync(cacheFilePath, JSON.stringify(cacheData, null, 2), 'utf8');
    console.log(`💾 cached search results for: ${searchQuery}`);
    return true;
  } catch (error) {
    console.error('❌ failed to save cache:', error.message);
    return false;
  }
}

module.exports = {
  getCacheFilePath,
  hasCachedData,
  loadCachedData,
  saveCacheData
}; 