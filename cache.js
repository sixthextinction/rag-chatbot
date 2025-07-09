const fs = require('fs');
const path = require('path');
const { generateTopicId } = require('./utils');

// ensure cache directory exists
function ensureCacheDir(cacheDir) {
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
}

// generate cache filename for a search query
function getCacheFilename(searchQuery, cacheDir) {
  const sanitized = searchQuery
    .replace(/[^a-z0-9\s]/gi, '')
    .replace(/\s+/g, '_')
    .toLowerCase()
    .substring(0, 100);
  
  return path.join(cacheDir, `${sanitized}_cache.json`);
}

// check if cached data exists and is not expired
function hasCachedData(searchQuery, cacheDir = 'cache', expiryDays = 2) {
  try {
    ensureCacheDir(cacheDir);
    const filename = getCacheFilename(searchQuery, cacheDir);
    
    if (!fs.existsSync(filename)) {
      return false;
    }
    
    const stats = fs.statSync(filename);
    const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
    
    return ageInDays < expiryDays;
  } catch (error) {
    console.warn(`error checking cache for "${searchQuery}":`, error.message);
    return false;
  }
}

// load cached search results
function loadCachedData(searchQuery, cacheDir = 'cache') {
  try {
    const filename = getCacheFilename(searchQuery, cacheDir);
    
    if (!fs.existsSync(filename)) {
      return null;
    }
    
    const data = fs.readFileSync(filename, 'utf8');
    const parsed = JSON.parse(data);
    
    console.log(`loaded cached data for: ${searchQuery}`);
    return parsed;
  } catch (error) {
    console.warn(`error loading cache for "${searchQuery}":`, error.message);
    return null;
  }
}

// save search results to cache
function saveCacheData(searchQuery, data, cacheDir = 'cache', expiryDays = 2) {
  try {
    ensureCacheDir(cacheDir);
    const filename = getCacheFilename(searchQuery, cacheDir);
    
    const cacheData = {
      query: searchQuery,
      data: data,
      cached_at: new Date().toISOString(),
      expires_after_days: expiryDays
    };
    
    fs.writeFileSync(filename, JSON.stringify(cacheData, null, 2));
    console.log(`saved cache for: ${searchQuery}`);
  } catch (error) {
    console.warn(`error saving cache for "${searchQuery}":`, error.message);
  }
}

// clear expired cache files
function clearExpiredCache(cacheDir = 'cache', expiryDays = 2) {
  try {
    if (!fs.existsSync(cacheDir)) {
      return { cleared: 0 };
    }
    
    const files = fs.readdirSync(cacheDir);
    let cleared = 0;
    
    for (const file of files) {
      if (file.endsWith('_cache.json')) {
        const filePath = path.join(cacheDir, file);
        const stats = fs.statSync(filePath);
        const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
        
        if (ageInDays >= expiryDays) {
          fs.unlinkSync(filePath);
          cleared++;
        }
      }
    }
    
    if (cleared > 0) {
      console.log(`cleared ${cleared} expired cache files`);
    }
    
    return { cleared };
  } catch (error) {
    console.warn('error clearing expired cache:', error.message);
    return { cleared: 0 };
  }
}

module.exports = {
  hasCachedData,
  loadCachedData,
  saveCacheData,
  clearExpiredCache,
  ensureCacheDir
}; 