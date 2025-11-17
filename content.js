// Etsy Handmade Filter - Content Script
// 
// DISCLAIMER: This is an unofficial extension and is not affiliated with, 
// endorsed by, or connected to Etsy, Inc. This extension is created and 
// maintained by independent developers.
//
// Icon Attribution: Peace Hand icon from Iconoir (https://iconoir.com/)
// Licensed under MIT License
//
// Music by https://pixabay.com/users/danamusic-31920663/?utm_source=link-attribution&utm_medium=referral&utm_campaign=music&utm_content=429916">Dana Music</a> from <a href="https://pixabay.com//?utm_source=link-attribution&utm_medium=referral&utm_campaign=music&utm_content=429916 from Pixabay

// Global state variables
let madeByCount = 0;
let otherCount = 0;
let checkedListings = new Set();
let isChecking = false;
let listingDataCache = new Map(); // Store extracted data for debug popup
let currentUrl = window.location.href; // Track current URL for page navigation detection
let peaceIconHoldTimeout = null; // Timeout for peace icon hold
let peaceIconHeldForDevMode = false; // Flag to prevent opening GitHub if dev mode was activated
let rateLimitedListings = new Map(); // Map of URL -> { listing element, timestamp } for rate-limited items

// Cache configuration
const CACHE_PREFIX = 'etsy_filter_cache_';
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours (cache persists across sessions)
const REQUEST_DELAY_MS = 200; // Delay between requests to avoid rate limiting
// With 48 items per page, allow caching ~20 pages worth (960 items) before eviction
const MAX_CACHE_ENTRIES = 1000; // Maximum number of cached entries to prevent quota issues
const RATE_LIMIT_RETRY_INTERVAL_MS = 5 * 1000; // Retry rate-limited items every 5 seconds
const RATE_LIMIT_MIN_WAIT_MS = 2.5 * 1000; // Minimum wait time before retrying (2.5 seconds)
const DEV_MODE_TIMEOUT = 3000; // 3 seconds to activate dev mode


// Cache management functions
function getListingId(url) {
  if (!url) return null;
  try {
    // Extract listing ID from URL like: /listing/1234567890/...
    const match = url.match(/\/listing\/(\d+)/);
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

function getCacheKey(url) {
  const listingId = getListingId(url);
  if (!listingId) {
    // Fallback to URL-based key if we can't extract ID (shouldn't happen for Etsy listings)
    return CACHE_PREFIX + btoa(url).replace(/[+/=]/g, '');
  }
  return CACHE_PREFIX + listingId;
}

function getCachedData(url) {
  try {
    const cacheKey = getCacheKey(url);
    // Use localStorage instead of sessionStorage for persistence across sessions
    const cached = localStorage.getItem(cacheKey);
    if (!cached) return null;
    
    const data = JSON.parse(cached);
    const age = Date.now() - data.timestamp;
    
    if (age > CACHE_EXPIRY_MS) {
      localStorage.removeItem(cacheKey);
      return null;
    }
    
    // Update timestamp for LRU (mark as recently used)
    data.timestamp = Date.now();
    try {
      localStorage.setItem(cacheKey, JSON.stringify(data));
    } catch (e) {
      // If update fails, just return the data without updating timestamp
    }
    
    return data;
  } catch (error) {
    console.error('Error reading cache:', error);
    return null;
  }
}

function getCacheEntryCount() {
  let count = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) {
        count++;
      }
    }
  } catch (error) {
    // Ignore errors
  }
  return count;
}

function evictOldestCacheEntries(countToRemove) {
  try {
    const allEntries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          allEntries.push({
            key,
            timestamp: data.timestamp || 0
          });
        } catch (e) {
          // If we can't parse, remove it
          allEntries.push({ key, timestamp: 0 });
        }
      }
    }
    
    // Sort by timestamp (oldest first)
    allEntries.sort((a, b) => a.timestamp - b.timestamp);
    
    // Remove the oldest entries
    const toRemove = Math.min(countToRemove, allEntries.length);
    for (let i = 0; i < toRemove; i++) {
      localStorage.removeItem(allEntries[i].key);
    }
  } catch (error) {
    console.error('Error evicting cache entries:', error);
  }
}

function setCachedData(url, extractedData) {
  try {
    const cacheKey = getCacheKey(url);
    const data = {
      ...extractedData,
      timestamp: Date.now()
    };
    const dataString = JSON.stringify(data);
    
    // Check if entry is too large (extracted data should be small, max ~10KB)
    if (dataString.length > 10000) {
      // If single entry is too large, skip caching
      return;
    }
    
    // Check cache size and evict oldest entries if needed
    const currentCount = getCacheEntryCount();
    if (currentCount >= MAX_CACHE_ENTRIES) {
      // Evict 25% of oldest entries to make room (more aggressive for larger cache)
      const toEvict = Math.max(1, Math.floor(MAX_CACHE_ENTRIES * 0.25));
      evictOldestCacheEntries(toEvict);
    }
    
    // Use localStorage instead of sessionStorage for persistence across sessions
    localStorage.setItem(cacheKey, dataString);
  } catch (error) {
    // If storage is full, aggressively clear cache and retry once
    if (error.name === 'QuotaExceededError' || error.code === 22) {
      try {
        // Clear expired entries first
        clearOldCacheEntries();
        // If still full, clear half the cache
        const currentCount = getCacheEntryCount();
        if (currentCount > 0) {
          evictOldestCacheEntries(Math.floor(currentCount / 2));
        }
        // Retry once after cleanup
        try {
          const cacheKey = getCacheKey(url);
          const data = {
            ...extractedData,
            timestamp: Date.now()
          };
          const dataString = JSON.stringify(data);
          if (dataString.length <= 10000) {
            localStorage.setItem(cacheKey, dataString);
          }
        } catch (retryError) {
          // If still fails, just skip caching for this item (silently)
        }
      } catch (cleanupError) {
        // If cleanup fails, just skip caching (silently)
      }
    } else {
      // For other errors, log them
      console.error('Error writing cache:', error);
    }
  }
}

function clearHalfCache() {
  try {
    const allKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) {
        allKeys.push(key);
      }
    }
    
    // Sort by timestamp (oldest first) and remove half
    const keysWithTimestamps = allKeys.map(key => {
      try {
        const data = JSON.parse(localStorage.getItem(key));
        return { key, timestamp: data.timestamp || 0 };
      } catch {
        return { key, timestamp: 0 };
      }
    }).sort((a, b) => a.timestamp - b.timestamp);
    
    const keysToRemove = keysWithTimestamps.slice(0, Math.floor(keysWithTimestamps.length / 2));
    keysToRemove.forEach(({ key }) => localStorage.removeItem(key));
  } catch (error) {
    console.error('Error clearing half cache:', error);
  }
}

function clearOldCacheEntries() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) {
        try {
          const cached = JSON.parse(localStorage.getItem(key));
          if (Date.now() - cached.timestamp > CACHE_EXPIRY_MS) {
            keysToRemove.push(key);
          }
        } catch (e) {
          keysToRemove.push(key);
        }
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  } catch (error) {
    console.error('Error clearing cache:', error);
  }
}

// Default filter settings
const defaultFilterSettings = {
  checkBadge: true,
  checkMadeToOrder: true,
  checkTitle: true,
  checkDescription: true,
  textLogic: 'OR',
  debugMode: false,
  holidayTheme: false, // Red/green theme with snowflakes
  keywordsInclude: [
    { text: 'handmade', enabled: true },
    { text: 'hand-made', enabled: true }
  ],
  keywordsExclude: []
};

// Filter settings
let filterSettings = { ...defaultFilterSettings };

// Storage key for filter settings
const FILTER_SETTINGS_KEY = 'etsy_filter_settings';

// Save filter settings to storage
function saveFilterSettings() {
  try {
    chrome.storage.local.set({ [FILTER_SETTINGS_KEY]: filterSettings }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error saving filter settings:', chrome.runtime.lastError);
      }
    });
  } catch (error) {
    console.error('Error saving filter settings:', error);
  }
}

// Load filter settings from storage
function loadFilterSettings(callback) {
  try {
    chrome.storage.local.get([FILTER_SETTINGS_KEY], (result) => {
      if (chrome.runtime.lastError) {
        console.error('Error loading filter settings:', chrome.runtime.lastError);
        if (callback) callback();
        return;
      }
      
      if (result[FILTER_SETTINGS_KEY]) {
        const saved = result[FILTER_SETTINGS_KEY];
        // Migrate old keywords structure to new include/exclude structure
        if (saved.keywords && !saved.keywordsInclude) {
          saved.keywordsInclude = saved.keywords.filter(kw => kw.enabled).map(kw => ({ text: kw.text, enabled: true }));
          saved.keywordsExclude = [];
          delete saved.keywords;
        }
        // Merge saved settings with defaults to handle any missing properties
        filterSettings = {
          ...defaultFilterSettings,
          ...saved,
          // Deep copy keywords arrays
          keywordsInclude: saved.keywordsInclude ? saved.keywordsInclude.map(kw => ({ ...kw })) : defaultFilterSettings.keywordsInclude.map(kw => ({ ...kw })),
          keywordsExclude: saved.keywordsExclude ? saved.keywordsExclude.map(kw => ({ ...kw })) : (defaultFilterSettings.keywordsExclude || [])
        };
      }
      
      if (callback) callback();
    });
  } catch (error) {
    console.error('Error loading filter settings:', error);
    if (callback) callback();
  }
}

// Create status banner
let isBannerCollapsed = true; // Start collapsed on page load
let autoHideTimeout = null;
const AUTO_HIDE_DELAY = 500; // Auto-hide 0.5 seconds after cursor leaves

const banner = document.createElement('div');
banner.id = 'etsy-filter-banner';
banner.style.cssText = `
  position: fixed;
  top: 20px;
  right: 0;
  background: linear-gradient(135deg, #f1641e 0%, #764ba2 100%);
  color: #fff;
  padding: 20px 24px;
  z-index: 9999;
  border-radius: 12px 0 0 12px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  min-width: 280px;
  max-width: 320px;
  max-height: 95vh;
  overflow: visible;
  box-shadow: 0 10px 40px rgba(0,0,0,0.3);
  transition: transform 0.3s ease-in-out, opacity 0.3s ease-in-out, background 0.5s ease-in-out;
  transform: translateX(0);
  opacity: 1;
`;

const bannerContent = document.createElement('div');
bannerContent.id = 'banner-content';
bannerContent.style.cssText = `
  position: relative;
  width: 100%;
  height: 100%;
  transition: opacity 0.2s ease-in-out;
  z-index: 1;
  opacity: 1;
  display: flex;
  flex-direction: column;
  max-height: calc(95vh - 40px);
`;
bannerContent.innerHTML = `
  <div id="banner-header" style="
    flex-shrink: 0;
    padding-bottom: 12px;
  ">
    <div style="font-size: 18px; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; position: relative; gap: 8px;">
      <img src="${chrome.runtime.getURL('icons/iconoir/peace-hand.svg')}" alt="Filter" id="peace-hand-icon" style="width: 20px; height: 20px; object-fit: contain; filter: brightness(0) invert(1) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2)); flex-shrink: 0; cursor: pointer;">
      <span style="flex: 1; text-align: center;">Etsy Handmade Filter</span>
      <a href="https://ko-fi.com/zara42" target="_blank" rel="noopener noreferrer" id="ko-fi-heart" title="Buy me a coffee?" style="display: inline-block; color: white; text-decoration: none; transition: all 0.2s; position: relative; cursor: pointer; width: 20px; height: 20px; flex-shrink: 0; overflow: visible; box-shadow: none !important;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="heart-outline" style="position: absolute; top: 0; left: 0; opacity: 1; filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="#FF0F0F" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="heart-solid" style="position: absolute; top: 0; left: 0; opacity: 0; transition: opacity 0.2s; filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
      </a>
    </div>
  </div>
  
  <div id="banner-scrollable-content" style="
    flex: 1;
    overflow-y: auto;
    padding-bottom: 12px;
  ">
  <div style="background: rgba(255,255,255,0.2); border-radius: 8px; padding: 12px; margin-bottom: 12px;">
    <div style="font-size: 12px; margin-bottom: 6px; opacity: 0.9;">Matching:</div>
    <label style="display: flex; align-items: center; cursor: pointer; margin-bottom: 4px; font-size: 13px;">
      <input type="radio" name="logic" value="OR" style="margin-right: 6px; cursor: pointer;">
      <span>Permissive (any condition)</span>
    </label>
    <label style="display: flex; align-items: center; cursor: pointer; font-size: 13px;">
      <input type="radio" name="logic" value="AND" checked style="margin-right: 6px; cursor: pointer;">
      <span>Strict (all conditions)</span>
    </label>
  </div>
  
  <div style="background: rgba(255,255,255,0.2); border-radius: 8px; padding: 12px; margin-bottom: 12px;">
    <div style="font-size: 12px; margin-bottom: 8px; opacity: 0.9;">Badges:</div>
    
    <label style="display: flex; align-items: center; cursor: pointer; margin-bottom: 6px; font-size: 13px;">
      <input type="checkbox" id="check-badge" style="margin-right: 8px; cursor: pointer;">
      <span>Made by Seller</span>
    </label>
    
    <label style="display: flex; align-items: center; cursor: pointer; margin-bottom: 6px; font-size: 13px;">
      <input type="checkbox" id="check-made-to-order" style="margin-right: 8px; cursor: pointer;">
      <span>Made to Order</span>
    </label>
  </div>
  
  <div style="background: rgba(255,255,255,0.2); border-radius: 8px; padding: 12px; margin-bottom: 12px;">
    <div style="font-size: 12px; margin-bottom: 8px; opacity: 0.9;">Check:</div>
    
    <label style="display: flex; align-items: center; cursor: pointer; margin-bottom: 6px; font-size: 13px;">
      <input type="checkbox" id="check-title" style="margin-right: 8px; cursor: pointer;">
      <span>Title</span>
    </label>
    
    <label style="display: flex; align-items: center; cursor: pointer; margin-bottom: 6px; font-size: 13px;">
      <input type="checkbox" id="check-description" style="margin-right: 8px; cursor: pointer;">
      <span>Description</span>
    </label>
    
    <div id="keyword-section" style="display: block; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.2);">
      <div id="keyword-label-include" style="font-size: 12px; margin-bottom: 6px; opacity: 0.9;">Keywords to Include:</div>
      <div id="keyword-list-include" style="margin-bottom: 8px;"></div>
      <div id="keyword-label-exclude" style="font-size: 12px; margin-bottom: 6px; margin-top: 8px; opacity: 0.9;">Keywords to Exclude:</div>
      <div id="keyword-list-exclude" style="margin-bottom: 8px;"></div>
      <div style="display: flex; gap: 4px;">
        <input type="text" id="new-keyword" placeholder="Add keyword..." style="
          flex: 1;
          padding: 6px 8px;
          border: none;
          border-radius: 4px;
          font-size: 12px;
          background: rgba(255,255,255,0.9);
          color: #333;
        ">
        <button id="add-keyword-include-btn" title="Add to include (Enter)" class="etsy-filter-lift-button" style="
          padding: 4px 8px;
          background: rgba(34, 197, 94, 0.8);
          border: 2px solid #22c55e;
          border-radius: 4px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 28px;
          transition: all 0.2s;
        " onmouseover="this.style.background='#22c55e'; this.style.borderColor='#22c55e'" onmouseout="this.style.background='rgba(34, 197, 94, 0.8)'; this.style.borderColor='#22c55e'">
          <img src="${chrome.runtime.getURL('icons/iconoir/plus.svg')}" alt="Add" style="width: 16px; height: 16px; filter: brightness(0) invert(1);">
        </button>
        <button id="add-keyword-exclude-btn" title="Add to exclude (Shift+Enter)" class="etsy-filter-lift-button" style="
          padding: 4px 8px;
          background: rgba(239, 68, 68, 0.8);
          border: 2px solid #ef4444;
          border-radius: 4px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 28px;
          transition: all 0.2s;
        " onmouseover="this.style.background='#ef4444'; this.style.borderColor='#ef4444'" onmouseout="this.style.background='rgba(239, 68, 68, 0.8)'; this.style.borderColor='#ef4444'">
          <img src="${chrome.runtime.getURL('icons/iconoir/minus.svg')}" alt="Remove" style="width: 16px; height: 16px; filter: brightness(0) invert(1);">
        </button>
      </div>
    </div>
  </div>
  
  <div id="debug-mode-section" style="background: rgba(255,255,255,0.2); border-radius: 8px; padding: 12px; margin-bottom: 12px; display: none;">
    <label style="display: flex; align-items: center; cursor: pointer; font-size: 13px;">
      <input type="checkbox" id="debug-mode" style="margin-right: 8px; cursor: pointer;">
      <span>Debug Mode (hover over listings)</span>
    </label>
  </div>
  
  </div>
  
  <div id="banner-footer" style="
    flex-shrink: 0;
    padding-top: 12px;
  ">
  <div style="display: flex; justify-content: space-between; align-items: center; font-size: 14px; margin-bottom: 12px;">
    <div>✓ Handmade: <span id="made-by" style="font-weight: 600; color: #4ade80;">0</span></div>
    <img id="holiday-theme-icon" src="${chrome.runtime.getURL('icons/iconoir/gift.svg')}" alt="Holiday Theme" style="width: 20px; height: 22px; cursor: pointer; filter: brightness(0) invert(1); transition: filter 0.3s, opacity 0.3s; object-fit: contain; display: none;" title="Toggle Holiday Theme">
    <div>⊘ Others: <span id="others" style="font-weight: 600; color: #fca5a5;">0</span></div>
  </div>
  
  <div style="display: flex; gap: 6px;">
    <button id="refresh-btn" title="Refresh" class="etsy-filter-lift-button" style="
      flex: 1;
    padding: 8px;
      background: rgba(34, 197, 94, 0.8);
      border: 2px solid #22c55e;
    border-radius: 6px;
    cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    transition: all 0.2s;
    " onmouseover="this.style.background='#22c55e'; this.style.borderColor='#22c55e'" onmouseout="this.style.background='rgba(34, 197, 94, 0.8)'; this.style.borderColor='#22c55e'">
      <img src="${chrome.runtime.getURL('icons/iconoir/refresh-circle.svg')}" alt="Refresh" style="width: 20px; height: 20px; filter: brightness(0) invert(1);">
  </button>
    <button id="default-btn" title="Reset to Defaults" class="etsy-filter-lift-button" style="
      flex: 1;
      padding: 8px;
      background: rgba(234, 179, 8, 0.8);
      border: 2px solid #eab308;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    " onmouseover="this.style.background='#eab308'; this.style.borderColor='#eab308'" onmouseout="this.style.background='rgba(234, 179, 8, 0.8)'; this.style.borderColor='#eab308'">
      <img src="${chrome.runtime.getURL('icons/iconoir/undo-circle.svg')}" alt="Default" style="width: 20px; height: 20px; filter: brightness(0) invert(1);">
    </button>
    <button id="clear-btn" title="Clear All Filters" class="etsy-filter-lift-button" style="
      flex: 1;
      padding: 8px;
      background: rgba(239, 68, 68, 0.8);
      border: 2px solid #ef4444;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    " onmouseover="this.style.background='#ef4444'; this.style.borderColor='#ef4444'" onmouseout="this.style.background='rgba(239, 68, 68, 0.8)'; this.style.borderColor='#ef4444'">
      <img src="${chrome.runtime.getURL('icons/iconoir/xmark-circle.svg')}" alt="Clear" style="width: 20px; height: 20px; filter: brightness(0) invert(1);">
    </button>
  </div>
  </div>
`;

banner.appendChild(bannerContent);

// Add lift animation CSS for buttons
if (!document.getElementById('etsy-filter-lift-animation')) {
  const style = document.createElement('style');
  style.id = 'etsy-filter-lift-animation';
  style.textContent = `
    .etsy-filter-lift-button {
      transform: translateY(0);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .etsy-filter-lift-button:hover {
      transform: translateY(-2px) scale(1.05);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    }
  `;
  document.head.appendChild(style);
}

// Load saved filter settings and initialize UI
loadFilterSettings(() => {
  // Initialize checkboxes from filterSettings to ensure they match
  // Use setTimeout to ensure DOM is ready
  setTimeout(() => {
    const checkBadge = document.getElementById('check-badge');
    const checkMadeToOrder = document.getElementById('check-made-to-order');
    const checkTitle = document.getElementById('check-title');
    const checkDescription = document.getElementById('check-description');
    const debugMode = document.getElementById('debug-mode');
    
    if (checkBadge) checkBadge.checked = filterSettings.checkBadge;
    if (checkMadeToOrder) checkMadeToOrder.checked = filterSettings.checkMadeToOrder;
    if (checkTitle) checkTitle.checked = filterSettings.checkTitle;
    if (checkDescription) checkDescription.checked = filterSettings.checkDescription;
    if (debugMode) debugMode.checked = filterSettings.debugMode;
    
    // Check if holiday theme should be available (December only)
    checkHolidayThemeAvailability();
    
    // Apply holiday theme if enabled
    applyHolidayTheme(filterSettings.holidayTheme);
    
    // Initialize holiday theme icon
    initializeHolidayThemeIcon();

    // Initialize radio buttons
    document.querySelectorAll('input[name="logic"]').forEach(radio => {
      radio.checked = (radio.value === filterSettings.textLogic);
    });
    
    // Update keyword section visibility
    updateKeywordSectionVisibility();
    
    // Re-render keyword list
    renderKeywordList();
  }, 0);
});

// Add hover effect to Ko-fi heart icon
setTimeout(() => {
  const koFiHeart = document.getElementById('ko-fi-heart');
  if (koFiHeart) {
    const heartOutline = koFiHeart.querySelector('.heart-outline');
    const heartSolid = koFiHeart.querySelector('.heart-solid');
    
    koFiHeart.addEventListener('mouseenter', () => {
      if (heartSolid) heartSolid.style.opacity = '1';
    });
    
    koFiHeart.addEventListener('mouseleave', () => {
      if (heartSolid) heartSolid.style.opacity = '0';
    });
  }
}, 100);

// Create collapsed emoji indicator
const collapsedEmoji = document.createElement('div');
collapsedEmoji.id = 'banner-collapsed-emoji';
collapsedEmoji.style.cssText = `
  position: fixed;
  top: 3em;
  right: 12px;
  width: 48px;
  height: 48px;
  background: linear-gradient(135deg, #f1641e 0%, #764ba2 100%);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  cursor: pointer;
  font-size: 24px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  transition: all 0.3s ease-in-out;
  opacity: 0;
  pointer-events: none;
  z-index: 10000;
`;
collapsedEmoji.innerHTML = `<img src="${chrome.runtime.getURL('icons/iconoir/peace-hand.svg')}" alt="Filter" style="width: 28px; height: 28px; object-fit: contain; filter: brightness(0) invert(1);">`;
document.body.appendChild(collapsedEmoji);

// Create debug popup
const debugPopup = document.createElement('div');
debugPopup.id = 'etsy-filter-debug-popup';
debugPopup.style.cssText = `
  position: fixed;
  background: rgba(0, 0, 0, 0.95);
  color: #fff;
  padding: 12px;
  border-radius: 8px;
  font-family: 'Courier New', monospace;
  font-size: 11px;
  z-index: 99999;
  max-width: 500px;
  max-height: 600px;
  overflow-y: auto;
  box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  display: none;
  pointer-events: none;
  line-height: 1.4;
`;
document.body.appendChild(debugPopup);

// Toggle banner function
function toggleBanner(expand = null) {
  // Clear any pending auto-hide timer
  cancelAutoHide();
  
  // If expand parameter is provided, use it; otherwise toggle
  if (expand !== null) {
    isBannerCollapsed = !expand;
  } else {
    isBannerCollapsed = !isBannerCollapsed;
  }
  
  if (isBannerCollapsed) {
    // Hide the banner completely, show only emoji
    banner.style.transform = 'translateX(100%)';
    banner.style.opacity = '0';
    bannerContent.style.opacity = '0';
    bannerContent.style.pointerEvents = 'none';
    collapsedEmoji.style.opacity = '1';
    collapsedEmoji.style.pointerEvents = 'auto';
    // Move emoji back to original position
    collapsedEmoji.style.right = '12px';
    // Add bounce animation when coming back
    collapsedEmoji.classList.add('bounce-in');
    // Remove animation class after animation completes
    setTimeout(() => {
      collapsedEmoji.classList.remove('bounce-in');
    }, 600);
  } else {
    // Show the full banner, hide emoji
    banner.style.transform = 'translateX(0)';
    banner.style.opacity = '1';
    banner.style.minWidth = '280px';
    bannerContent.style.opacity = '1';
    bannerContent.style.pointerEvents = 'auto';
    collapsedEmoji.style.opacity = '0';
    collapsedEmoji.style.pointerEvents = 'none';
    // Move emoji to the right edge of screen
    collapsedEmoji.style.right = '0';
    // Cancel any pending hide timer when expanding
    cancelAutoHide();
  }
}

// Cancel auto-hide timer
function cancelAutoHide() {
  if (autoHideTimeout) {
    clearTimeout(autoHideTimeout);
    autoHideTimeout = null;
  }
}

// Start auto-hide timer (when mouse leaves)
function startAutoHide() {
  cancelAutoHide();
  if (!isBannerCollapsed) {
    autoHideTimeout = setTimeout(() => {
      if (!isBannerCollapsed) {
        toggleBanner();
      }
    }, AUTO_HIDE_DELAY);
  }
}

document.body.appendChild(banner);

// Set initial collapsed state
toggleBanner(false); // Collapse the banner on page load

// Add CSS animation for button lift effect
if (!document.getElementById('etsy-filter-button-lift-animation')) {
  const style = document.createElement('style');
  style.id = 'etsy-filter-button-lift-animation';
  style.textContent = `
    @keyframes buttonLift {
      0% { transform: translateY(0); }
      50% { transform: translateY(-3px); }
      100% { transform: translateY(0); }
    }
    .etsy-filter-lift-button:active {
      animation: buttonLift 0.3s ease-out;
    }
    #ko-fi-heart {
      box-shadow: none !important;
    }
    #ko-fi-heart:hover {
      transform: none !important;
      box-shadow: none !important;
    }
    #ko-fi-heart:hover .heart-outline,
    #ko-fi-heart:hover .heart-solid {
      transform: translateY(-3px);
      transition: transform 0.15s ease-out;
    }
    #ko-fi-heart:not(:hover) .heart-outline,
    #ko-fi-heart:not(:hover) .heart-solid {
      transform: translateY(0);
      transition: transform 0.15s ease-out;
    }
    #peace-hand-icon {
      transition: transform 0.15s ease-out;
    }
    #peace-hand-icon:hover {
      transform: translateY(-3px);
    }
    #peace-hand-icon:not(:hover) {
      transform: translateY(0);
    }
    @keyframes bounceIn {
      0% { transform: scale(0.3); opacity: 0; }
      50% { transform: scale(1.1); }
      70% { transform: scale(0.9); }
      100% { transform: scale(1); opacity: 1; }
    }
    #banner-collapsed-emoji.bounce-in {
      animation: bounceIn 0.6s ease-out;
    }
  `;
  document.head.appendChild(style);
}

// Expand on hover anywhere on the banner (including collapsed tab)
banner.addEventListener('mouseenter', () => {
  if (isBannerCollapsed) {
    toggleBanner(true); // Expand
  } else {
    cancelAutoHide(); // Cancel auto-hide timer when mouse enters
  }
});

// Start auto-hide timer when mouse leaves the banner
banner.addEventListener('mouseleave', () => {
  if (!isBannerCollapsed) {
    startAutoHide(); // Start timer to hide after delay
  }
});

// Also handle collapsed emoji hover/click
collapsedEmoji.addEventListener('mouseenter', () => {
  if (isBannerCollapsed) {
    toggleBanner(true); // Expand
  } else {
    cancelAutoHide(); // Cancel auto-hide timer when mouse enters emoji
  }
});
collapsedEmoji.addEventListener('mouseleave', () => {
  if (!isBannerCollapsed) {
    startAutoHide(); // Start timer to hide after delay
  }
});
collapsedEmoji.addEventListener('click', () => {
  if (isBannerCollapsed) {
    toggleBanner(true); // Expand
  }
});

// Helper function to update UI from filterSettings
function updateUIFromFilterSettings() {
  const checkBadge = document.getElementById('check-badge');
  const checkMadeToOrder = document.getElementById('check-made-to-order');
  const checkTitle = document.getElementById('check-title');
  const checkDescription = document.getElementById('check-description');
  const debugMode = document.getElementById('debug-mode');
  
  if (checkBadge) checkBadge.checked = filterSettings.checkBadge;
  if (checkMadeToOrder) checkMadeToOrder.checked = filterSettings.checkMadeToOrder;
  if (checkTitle) checkTitle.checked = filterSettings.checkTitle;
  if (checkDescription) checkDescription.checked = filterSettings.checkDescription;
  if (debugMode) debugMode.checked = filterSettings.debugMode;
  
  // Update radio buttons
  document.querySelectorAll('input[name="logic"]').forEach(radio => {
    radio.checked = (radio.value === filterSettings.textLogic);
  });
  
  // Update keyword section visibility
  updateKeywordSectionVisibility();
  
  // Re-render keyword list
  renderKeywordList();
}

// Set up button event listeners
setTimeout(() => {
  // Refresh button - just retriggers filtering
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      reCheckAllListings();
    });
  }

  // Default button - resets to default filter settings
  const defaultBtn = document.getElementById('default-btn');
  if (defaultBtn) {
    defaultBtn.addEventListener('click', () => {
      // Reset all filter settings to defaults
      filterSettings = {
        ...defaultFilterSettings,
        keywordsInclude: defaultFilterSettings.keywordsInclude.map(kw => ({ ...kw })), // Deep copy keywords arrays
        keywordsExclude: defaultFilterSettings.keywordsExclude.map(kw => ({ ...kw }))
      };
      
      // Clear saved settings and save defaults
      chrome.storage.local.remove([FILTER_SETTINGS_KEY], () => {
        saveFilterSettings();
      });
      
      updateUIFromFilterSettings();
      reCheckAllListings();
      
      // Hide debug popup if visible
      if (debugPopup) {
        debugPopup.style.display = 'none';
      }
    });
  }

  // Clear button - removes all applied filter settings
  const clearBtn = document.getElementById('clear-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      // Clear all filter settings (disable all filters)
      filterSettings.checkBadge = false;
      filterSettings.checkMadeToOrder = false;
      filterSettings.checkTitle = false;
      filterSettings.checkDescription = false;
      filterSettings.textLogic = 'AND';
      filterSettings.debugMode = false;
      filterSettings.keywordsInclude = [];
      filterSettings.keywordsExclude = [];
      
      // Save cleared settings
      saveFilterSettings();
      
      updateUIFromFilterSettings();
      reCheckAllListings();
      
      // Hide debug popup if visible
      if (debugPopup) {
        debugPopup.style.display = 'none';
      }
    });
  }
}, 0);

// Don't auto-hide on page load - banner starts collapsed

function renderKeywordList() {
  const keywordListInclude = document.getElementById('keyword-list-include');
  const keywordListExclude = document.getElementById('keyword-list-exclude');
  const keywordLabelInclude = document.getElementById('keyword-label-include');
  const keywordLabelExclude = document.getElementById('keyword-label-exclude');
  
  // Show/hide labels based on whether lists have items
  if (keywordLabelInclude) {
    keywordLabelInclude.style.display = filterSettings.keywordsInclude.length > 0 ? 'block' : 'none';
  }
  if (keywordLabelExclude) {
    keywordLabelExclude.style.display = filterSettings.keywordsExclude.length > 0 ? 'block' : 'none';
  }
  
  // Render include keywords
  keywordListInclude.innerHTML = filterSettings.keywordsInclude.map((kw, index) => `
    <label style="display: flex; align-items: center; cursor: pointer; margin-bottom: 4px; font-size: 12px;">
      <input type="checkbox" data-keyword-type="include" data-keyword-index="${index}" ${kw.enabled ? 'checked' : ''} style="margin-right: 6px; cursor: pointer;">
      <span style="flex: 1;">${kw.text}</span>
      <button data-keyword-type="include" data-remove-index="${index}" class="etsy-filter-lift-button" style="
        background: rgba(255,255,255,0.3);
        border: none;
        color: white;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 11px;
        cursor: pointer;
        margin-left: 4px;
        transition: all 0.2s;
      ">×</button>
    </label>
  `).join('');
  
  // Render exclude keywords
  keywordListExclude.innerHTML = filterSettings.keywordsExclude.map((kw, index) => `
    <label style="display: flex; align-items: center; cursor: pointer; margin-bottom: 4px; font-size: 12px;">
      <input type="checkbox" data-keyword-type="exclude" data-keyword-index="${index}" ${kw.enabled ? 'checked' : ''} style="margin-right: 6px; cursor: pointer;">
      <span style="flex: 1;">${kw.text}</span>
      <button data-keyword-type="exclude" data-remove-index="${index}" class="etsy-filter-lift-button" style="
        background: rgba(255,255,255,0.3);
        border: none;
        color: white;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 11px;
        cursor: pointer;
        margin-left: 4px;
        transition: all 0.2s;
      ">×</button>
    </label>
  `).join('');
  
  // Add event listeners for checkboxes
  keywordListInclude.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const index = parseInt(e.target.getAttribute('data-keyword-index'));
      filterSettings.keywordsInclude[index].enabled = e.target.checked;
      saveFilterSettings();
      reCheckAllListings();
      highlightProductPage();
    });
  });
  
  keywordListExclude.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const index = parseInt(e.target.getAttribute('data-keyword-index'));
      filterSettings.keywordsExclude[index].enabled = e.target.checked;
      saveFilterSettings();
      reCheckAllListings();
      highlightProductPage();
    });
  });
  
  // Add event listeners for remove buttons
  keywordListInclude.querySelectorAll('button[data-remove-index]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.getAttribute('data-remove-index'));
      filterSettings.keywordsInclude.splice(index, 1);
      saveFilterSettings();
      renderKeywordList();
      reCheckAllListings();
      highlightProductPage();
    });
  });
  
  keywordListExclude.querySelectorAll('button[data-remove-index]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.getAttribute('data-remove-index'));
      filterSettings.keywordsExclude.splice(index, 1);
      saveFilterSettings();
      renderKeywordList();
      reCheckAllListings();
      highlightProductPage();
    });
  });
}

function reCheckAllListings() {
  // Force immediate execution by resetting the checking flag
  isChecking = false;
  
  checkedListings.clear();
  madeByCount = 0;
  otherCount = 0;
  document.getElementById('made-by').textContent = '0';
  document.getElementById('others').textContent = '0';
  
  // Reset all styling
  findAllListingContainers().forEach(listing => {
    listing.style.opacity = '';
    listing.style.filter = '';
    const img = listing.querySelector('img')?.closest('div');
    if (img) {
      img.style.border = '';
      img.style.boxShadow = '';
    }
    // Remove error overlays
    const errorOverlay = listing.querySelector('.etsy-filter-error-overlay');
    if (errorOverlay) {
      errorOverlay.remove();
    }
  });
  
  // Immediately trigger check without any delays
  checkInitialViewportListings();
}

function updateKeywordSectionVisibility() {
  const keywordSection = document.getElementById('keyword-section');
  const anyTextCheckEnabled = filterSettings.checkTitle || filterSettings.checkDescription;
  keywordSection.style.display = anyTextCheckEnabled ? 'block' : 'none';
}

// Set up event listeners
const checkBadge = document.getElementById('check-badge');
const checkMadeToOrder = document.getElementById('check-made-to-order');
const checkTitle = document.getElementById('check-title');
const checkDescription = document.getElementById('check-description');
const logicRadios = document.querySelectorAll('input[name="logic"]');
const newKeywordInput = document.getElementById('new-keyword');

checkBadge.addEventListener('change', (e) => {
  filterSettings.checkBadge = e.target.checked;
  saveFilterSettings();
  reCheckAllListings();
  highlightProductPage();
});

checkMadeToOrder.addEventListener('change', (e) => {
  filterSettings.checkMadeToOrder = e.target.checked;
  saveFilterSettings();
  reCheckAllListings();
  highlightProductPage();
});

checkTitle.addEventListener('change', (e) => {
  filterSettings.checkTitle = e.target.checked;
  saveFilterSettings();
  updateKeywordSectionVisibility();
  if (e.target.checked) {
    renderKeywordList();
  }
  reCheckAllListings();
  highlightProductPage();
});

checkDescription.addEventListener('change', (e) => {
  filterSettings.checkDescription = e.target.checked;
  saveFilterSettings();
  updateKeywordSectionVisibility();
  if (e.target.checked) {
    renderKeywordList();
  }
  reCheckAllListings();
  highlightProductPage();
});

logicRadios.forEach(radio => {
  radio.addEventListener('change', (e) => {
    filterSettings.textLogic = e.target.value;
    saveFilterSettings();
    reCheckAllListings();
  });
});

const addKeywordIncludeBtn = document.getElementById('add-keyword-include-btn');
const addKeywordExcludeBtn = document.getElementById('add-keyword-exclude-btn');

addKeywordIncludeBtn.addEventListener('click', () => {
  const keyword = newKeywordInput.value.trim();
  if (keyword && !filterSettings.keywordsInclude.some(kw => kw.text.toLowerCase() === keyword.toLowerCase()) &&
      !filterSettings.keywordsExclude.some(kw => kw.text.toLowerCase() === keyword.toLowerCase())) {
    filterSettings.keywordsInclude.push({ text: keyword, enabled: true });
    saveFilterSettings();
    newKeywordInput.value = '';
    renderKeywordList();
    reCheckAllListings();
    highlightProductPage();
  }
});

addKeywordExcludeBtn.addEventListener('click', () => {
  const keyword = newKeywordInput.value.trim();
  if (keyword && !filterSettings.keywordsInclude.some(kw => kw.text.toLowerCase() === keyword.toLowerCase()) &&
      !filterSettings.keywordsExclude.some(kw => kw.text.toLowerCase() === keyword.toLowerCase())) {
    filterSettings.keywordsExclude.push({ text: keyword, enabled: true });
    saveFilterSettings();
    newKeywordInput.value = '';
    renderKeywordList();
    reCheckAllListings();
    highlightProductPage();
  }
});

newKeywordInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    if (e.shiftKey) {
      addKeywordExcludeBtn.click();
    } else {
      addKeywordIncludeBtn.click();
    }
  }
});

// Debug mode checkbox
const debugModeCheckbox = document.getElementById('debug-mode');
debugModeCheckbox.addEventListener('change', (e) => {
  filterSettings.debugMode = e.target.checked;
  saveFilterSettings();
  const debugSection = document.getElementById('debug-mode-section');
  if (e.target.checked) {
    // Show debug section when enabled
    if (debugSection) {
      debugSection.style.display = 'block';
    }
  } else {
    // Hide debug section and popup when disabled
    if (debugSection) {
      debugSection.style.display = 'none';
    }
    debugPopup.style.display = 'none';
  }
});

// ============================================================================
// HOLIDAY THEME SECTION
// ============================================================================

// Holiday theme color constants
const HOLIDAY_THEME_COLORS = {
  start: {
    color1: '#f1641e', // orange
    color2: '#764ba2'  // purple
  },
  end: {
    color1: '#16a34a', // green
    color2: '#dc2626'  // red
  }
};

// Helper function to convert hex to RGB
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

// Helper function to convert RGB to hex
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map(x => {
    const hex = Math.round(x).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  }).join("");
}

// Helper function to interpolate between two colors
function interpolateColor(color1, color2, factor) {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);
  if (!rgb1 || !rgb2) return color1;
  
  return rgbToHex(
    rgb1.r + (rgb2.r - rgb1.r) * factor,
    rgb1.g + (rgb2.g - rgb1.g) * factor,
    rgb1.b + (rgb2.b - rgb1.b) * factor
  );
}

// Function to animate background gradient transition
function animateBackgroundTransition(targetEnabled, duration = 500) {
  const startColors = HOLIDAY_THEME_COLORS.start;
  const endColors = HOLIDAY_THEME_COLORS.end;
  
  const startTime = performance.now();
  
  function animate(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Use ease-in-out easing
    const eased = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    
    if (targetEnabled) {
      // Transitioning to holiday theme (green/red)
      const color1 = interpolateColor(startColors.color1, endColors.color1, eased);
      const color2 = interpolateColor(startColors.color2, endColors.color2, eased);
      banner.style.background = `linear-gradient(135deg, ${color1} 0%, ${color2} 100%)`;
    } else {
      // Transitioning back to normal theme (orange/purple)
      const color1 = interpolateColor(endColors.color1, startColors.color1, eased);
      const color2 = interpolateColor(endColors.color2, startColors.color2, eased);
      banner.style.background = `linear-gradient(135deg, ${color1} 0%, ${color2} 100%)`;
    }
    
    if (progress < 1) {
      requestAnimationFrame(animate);
    }
  }
  
  requestAnimationFrame(animate);
}

// Function to create confetti animation
function createConfetti() {
  const holidayThemeIcon = document.getElementById('holiday-theme-icon');
  if (!holidayThemeIcon) return;
  
  const iconRect = holidayThemeIcon.getBoundingClientRect();
  const startX = iconRect.left + iconRect.width / 2;
  const startY = iconRect.top + iconRect.height / 2;
  
  const colors = ['#16a34a', '#dc2626', '#fbbf24', '#3b82f6', '#a855f7', '#ec4899'];
  const confettiCount = 30;
  
  for (let i = 0; i < confettiCount; i++) {
    const confetti = document.createElement('div');
    const color = colors[Math.floor(Math.random() * colors.length)];
    // Launch upward in a cone shape (from -60 to 60 degrees, but mostly upward)
    const baseAngle = -Math.PI / 2; // Point upward (-90 degrees)
    const spreadAngle = (Math.PI / 3) * (Math.random() - 0.5); // ±60 degrees spread
    const angle = baseAngle + spreadAngle;
    const velocity = 5 + Math.random() * 6; // Increased velocity for further travel
    const size = 6 + Math.random() * 4;
    
    confetti.style.cssText = `
      position: fixed;
      left: ${startX}px;
      top: ${startY}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: 50%;
      pointer-events: none;
      z-index: 100001;
    `;
    
    document.body.appendChild(confetti);
    
    const vx = Math.cos(angle) * velocity;
    let vy = Math.sin(angle) * velocity;
    const rotation = (Math.random() - 0.5) * 360;
    const rotationSpeed = (Math.random() - 0.5) * 10;
    
    let x = 0;
    let y = 0;
    let currentRotation = rotation;
    const gravity = 0.12; // Reduced gravity so they travel further before falling
    let opacity = 1;
    
    function animate(timestamp) {
      x += vx;
      y += vy;
      vy += gravity;
      currentRotation += rotationSpeed;
      opacity -= 0.010;
      
      confetti.style.left = `${startX + x}px`;
      confetti.style.top = `${startY + y}px`;
      confetti.style.transform = `rotate(${currentRotation}deg)`;
      confetti.style.opacity = Math.max(0, opacity);
      
      if (opacity > 0 && y < window.innerHeight + 100) {
        requestAnimationFrame(animate);
      } else {
        if (confetti.parentNode) {
          confetti.remove();
        }
      }
    }
    
    requestAnimationFrame(animate);
  }
}

// Function to create and manage snowflakes
function setupSnowflakes() {
  // Add snowflake container
  if (!document.getElementById('snowflake-container')) {
    const snowflakeContainer = document.createElement('div');
    snowflakeContainer.id = 'snowflake-container';
    snowflakeContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      overflow: hidden;
      pointer-events: none;
      z-index: 0;
      border-radius: 12px 0 0 12px;
    `;
    // Insert before bannerContent so it's behind the content
    const bannerContent = document.getElementById('banner-content');
    if (bannerContent) {
      banner.insertBefore(snowflakeContainer, bannerContent);
    } else {
      banner.appendChild(snowflakeContainer);
    }
    
    // Add snowflake CSS animation
    if (!document.getElementById('snowflake-animation-style')) {
      const style = document.createElement('style');
      style.id = 'snowflake-animation-style';
      style.textContent = `
        @keyframes snowfall {
          0% {
            transform: translateY(0px) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(calc(75vh)) rotate(360deg);
            opacity: 0;
          }
        }
        .snowflake {
          position: absolute;
          color: white;
          font-size: 1em;
          font-family: Arial, sans-serif;
          text-shadow: 0 0 5px rgba(255, 255, 255, 0.8);
          animation: snowfall linear infinite;
          user-select: none;
          pointer-events: none;
        }
      `;
      document.head.appendChild(style);
    }
    
    // Get reference to the container for snowflake creation
    const snowflakeContainerRef = document.getElementById('snowflake-container');
    
    // Create snowflakes
    function createSnowflake() {
      const snowflake = document.createElement('div');
      const snowflakeSpeed = 10;
      snowflake.className = 'snowflake';
      snowflake.textContent = '❄';
      // Random position within the banner width
      snowflake.style.left = Math.random() * 100 + '%';
      snowflake.style.top = '-20px';
      snowflake.style.animationDuration = (Math.floor(snowflakeSpeed, Math.random() * snowflakeSpeed * 2)) + 's';
      snowflake.style.animationDelay = Math.random() * 2 + 's';
      snowflake.style.opacity = Math.random() * 0.5 + 0.5;
      snowflake.style.fontSize = (Math.random() * 10 + 10) + 'px';
      if (snowflakeContainerRef) {
        snowflakeContainerRef.appendChild(snowflake);
      }
      
      // Remove snowflake only when animation completes (opacity reaches 0)
      snowflake.addEventListener('animationend', () => {
        if (snowflake.parentNode) {
          snowflake.remove();
        }
      });
    }
    
    // Create initial snowflakes
    for (let i = 0; i < 15; i++) {
      setTimeout(() => createSnowflake(), i * 200);
    }
    
    // Continue creating snowflakes periodically
    const snowflakeInterval = setInterval(() => {
      if (!filterSettings.holidayTheme) {
        clearInterval(snowflakeInterval);
        return;
      }
      createSnowflake();
    }, 300);
    
    // Store interval ID for cleanup
    banner.snowflakeInterval = snowflakeInterval;
  }
}

// Function to remove snowflakes
function removeSnowflakes() {
  const snowflakeContainer = document.getElementById('snowflake-container');
  if (snowflakeContainer) {
    snowflakeContainer.remove();
  }
  
  // Clear snowflake interval
  if (banner.snowflakeInterval) {
    clearInterval(banner.snowflakeInterval);
    banner.snowflakeInterval = null;
  }
}

// Function to update holiday icon appearance
function updateHolidayIcon() {
  const holidayThemeIcon = document.getElementById('holiday-theme-icon');
  if (holidayThemeIcon) {
    // Only show icon in December
    if (isDecember()) {
      holidayThemeIcon.style.display = 'block';
    } else {
      holidayThemeIcon.style.display = 'none';
    }
    // Always keep icon white
    holidayThemeIcon.style.filter = 'brightness(0) invert(1)';
    holidayThemeIcon.style.fill = '';
    holidayThemeIcon.style.color = '';
  }
}

// Holiday music audio elements (for crossfading)
let holidayMusic1 = null;
let holidayMusic2 = null;
let currentMusicTrack = 1;
let musicFadeInterval = null;
let musicTimeUpdateHandlers = [];

// Function to setup holiday music with crossfading
function setupHolidayMusic() {
  if (!holidayMusic1) {
    holidayMusic1 = new Audio(chrome.runtime.getURL('music/holiday-music-loop.mp3'));
    holidayMusic1.volume = 0;
    holidayMusic2 = new Audio(chrome.runtime.getURL('music/holiday-music-loop.mp3'));
    holidayMusic2.volume = 0;
  }
  
  // Start first track
  if (holidayMusic1.paused) {
    holidayMusic1.play().catch(error => {
      console.log('Could not play holiday music:', error);
    });
    
    // Fade in first track
    fadeInMusic(holidayMusic1, 0.5, 1000);
    
    // Set up crossfade loop
    setupCrossfadeLoop();
  }
}

// Function to fade in music
function fadeInMusic(audio, targetVolume, duration) {
  const startVolume = audio.volume;
  const volumeChange = targetVolume - startVolume;
  const startTime = performance.now();
  
  function fade() {
    const elapsed = performance.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    audio.volume = startVolume + (volumeChange * progress);
    
    if (progress < 1) {
      requestAnimationFrame(fade);
    }
  }
  
  requestAnimationFrame(fade);
}

// Function to fade out music
function fadeOutMusic(audio, duration) {
  const startVolume = audio.volume;
  const startTime = performance.now();
  
  function fade() {
    const elapsed = performance.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    audio.volume = startVolume * (1 - progress);
    
    if (progress < 1) {
      requestAnimationFrame(fade);
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
  }
  
  requestAnimationFrame(fade);
}

// Function to setup crossfade loop
function setupCrossfadeLoop() {
  if (musicFadeInterval) {
    clearInterval(musicFadeInterval);
  }
  
  // Function to check and handle crossfade
  function checkCrossfade() {
    if (!filterSettings.holidayTheme) {
      clearInterval(musicFadeInterval);
      return;
    }
    
    const currentAudio = currentMusicTrack === 1 ? holidayMusic1 : holidayMusic2;
    const nextAudio = currentMusicTrack === 1 ? holidayMusic2 : holidayMusic1;
    
    // Check if we have duration loaded
    if (!currentAudio.duration || isNaN(currentAudio.duration)) {
      return; // Wait for metadata
    }
    
    const duration = currentAudio.duration;
    const currentTime = currentAudio.currentTime * 1000; // Convert to ms
    const fadeStartTime = (duration * 1000) - 2000; // Start crossfade 2 seconds before end
    
    if (currentTime >= fadeStartTime && nextAudio.paused) {
      // Start next track
      nextAudio.currentTime = 0;
      nextAudio.play().catch(() => {});
      
      // Crossfade: fade out current, fade in next
      fadeOutMusic(currentAudio, 2000);
      fadeInMusic(nextAudio, 0.5, 2000);
      
      // Switch to next track
      currentMusicTrack = currentMusicTrack === 1 ? 2 : 1;
    }
  }
  
  // Use timeupdate event for more accurate timing
  const handleTimeUpdate = () => {
    checkCrossfade();
  };
  
  holidayMusic1.addEventListener('timeupdate', handleTimeUpdate);
  holidayMusic2.addEventListener('timeupdate', handleTimeUpdate);
  musicTimeUpdateHandlers.push({ audio: holidayMusic1, handler: handleTimeUpdate });
  musicTimeUpdateHandlers.push({ audio: holidayMusic2, handler: handleTimeUpdate });
  
  // Also use interval as backup
  musicFadeInterval = setInterval(checkCrossfade, 100);
}

// Function to stop holiday music
function stopHolidayMusic() {
  if (musicFadeInterval) {
    clearInterval(musicFadeInterval);
    musicFadeInterval = null;
  }
  
  // Remove event listeners
  musicTimeUpdateHandlers.forEach(({ audio, handler }) => {
    if (audio) {
      audio.removeEventListener('timeupdate', handler);
    }
  });
  musicTimeUpdateHandlers = [];
  
  if (holidayMusic1 && !holidayMusic1.paused) {
    fadeOutMusic(holidayMusic1, 500);
  }
  if (holidayMusic2 && !holidayMusic2.paused) {
    fadeOutMusic(holidayMusic2, 500);
  }
  
  // Reset after fade
  setTimeout(() => {
    if (holidayMusic1) {
      holidayMusic1.pause();
      holidayMusic1.currentTime = 0;
      holidayMusic1.volume = 0;
    }
    if (holidayMusic2) {
      holidayMusic2.pause();
      holidayMusic2.currentTime = 0;
      holidayMusic2.volume = 0;
    }
    currentMusicTrack = 1;
  }, 600);
}

// Function to apply/remove holiday theme
function applyHolidayTheme(enabled) {
  // Animate the background transition
  animateBackgroundTransition(enabled);
  
  if (enabled) {
    setupSnowflakes();
    setupHolidayMusic();
  } else {
    removeSnowflakes();
    stopHolidayMusic();
  }
  
  // Update icon state
  updateHolidayIcon();
}

// Check if it's December
function isDecember() {
  const now = new Date();
  return now.getMonth() === 11; // December is month 11 (0-indexed)
}

// Function to check and disable holiday theme if not December
function checkHolidayThemeAvailability() {
  if (!isDecember() && filterSettings.holidayTheme) {
    // Disable holiday theme if it's not December
    filterSettings.holidayTheme = false;
    saveFilterSettings();
    applyHolidayTheme(false);
  }
}

// Initialize holiday theme icon
function initializeHolidayThemeIcon() {
  const holidayThemeIcon = document.getElementById('holiday-theme-icon');
  if (!holidayThemeIcon) return;
  
  // Only show icon in December
  if (isDecember()) {
    holidayThemeIcon.style.display = 'block';
  } else {
    holidayThemeIcon.style.display = 'none';
    return; // Don't set up event listeners if not December
  }
  
  const giftClosedUrl = chrome.runtime.getURL('icons/iconoir/gift.svg');
  const giftOpenedUrl = chrome.runtime.getURL('icons/iconoir/gift-opened.svg');
  
  // Hover animation - switch between closed and opened gift
  holidayThemeIcon.addEventListener('mouseenter', () => {
    holidayThemeIcon.style.opacity = '0';
    setTimeout(() => {
      holidayThemeIcon.src = giftOpenedUrl;
      holidayThemeIcon.style.opacity = '1';
    }, 150);
  });
  
  holidayThemeIcon.addEventListener('mouseleave', () => {
    holidayThemeIcon.style.opacity = '0';
    setTimeout(() => {
      holidayThemeIcon.src = giftClosedUrl;
      holidayThemeIcon.style.opacity = '1';
    }, 150);
  });
  
  holidayThemeIcon.addEventListener('click', () => {
    // Create confetti animation
    createConfetti();
    
    filterSettings.holidayTheme = !filterSettings.holidayTheme;
    saveFilterSettings();
    applyHolidayTheme(filterSettings.holidayTheme);
    updateHolidayIcon();
  });
  
  // Initialize icon state
  updateHolidayIcon();
}

// ============================================================================
// END HOLIDAY THEME SECTION
// ============================================================================

// Easter egg: Click peace icon 3 times to enable debug mode
function showToast(message) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: linear-gradient(135deg, #f1641e 0%, #764ba2 100%);
    color: white;
    padding: 20px 30px;
    border-radius: 12px;
    font-size: 18px;
    font-weight: 600;
    z-index: 100000;
    box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    animation: fadeInOut 2s ease-in-out;
    pointer-events: none;
  `;
  toast.textContent = message;
  
  // Add animation keyframes
  if (!document.getElementById('toast-animations')) {
    const style = document.createElement('style');
    style.id = 'toast-animations';
    style.textContent = `
      @keyframes fadeInOut {
        0% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
        20% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        80% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        100% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(toast);
  
  // Remove toast after animation
  setTimeout(() => {
    toast.remove();
  }, 2000);
}

// Add click and hold listeners to peace icon in banner title
setTimeout(() => {
  const peaceIcon = document.getElementById('peace-hand-icon') || bannerContent.querySelector('img[src*="icons/iconoir/peace-hand.svg"]');
  if (peaceIcon) {
    peaceIcon.style.cursor = 'pointer';
    
    // Handle mouse down (start of hold)
    peaceIcon.addEventListener('mousedown', () => {
      peaceIconHeldForDevMode = false;
      
      // Start 5 second timer for dev mode
      peaceIconHoldTimeout = setTimeout(() => {
        // Show debug mode section
        const debugSection = document.getElementById('debug-mode-section');
        if (debugSection) {
          debugSection.style.display = 'block';
        }
        // Enable debug mode
        filterSettings.debugMode = true;
        saveFilterSettings();
        const debugModeCheckbox = document.getElementById('debug-mode');
        if (debugModeCheckbox) {
          debugModeCheckbox.checked = true;
        }
        // Show toast
        showToast("you're a developer now!");
        // Set flag to prevent opening GitHub
        peaceIconHeldForDevMode = true;
        peaceIconHoldTimeout = null;
      }, DEV_MODE_TIMEOUT);
    });
    
    // Handle mouse up (end of hold/click)
    peaceIcon.addEventListener('mouseup', () => {
      // Clear the timeout if still running
      if (peaceIconHoldTimeout) {
        clearTimeout(peaceIconHoldTimeout);
        peaceIconHoldTimeout = null;
      }
      
      // Only open GitHub if dev mode wasn't activated
      if (!peaceIconHeldForDevMode) {
        window.open('https://github.com', '_blank');
      }
      
      // Reset flag after a short delay to allow for next interaction
      setTimeout(() => {
        peaceIconHeldForDevMode = false;
      }, 100);
    });
    
    // Handle mouse leave (cancel hold if mouse leaves)
    peaceIcon.addEventListener('mouseleave', () => {
      if (peaceIconHoldTimeout) {
        clearTimeout(peaceIconHoldTimeout);
        peaceIconHoldTimeout = null;
      }
      peaceIconHeldForDevMode = false;
    });
    
    // Also handle touch events for mobile
    peaceIcon.addEventListener('touchstart', (e) => {
      e.preventDefault(); // Prevent default touch behavior
      peaceIconHeldForDevMode = false;
      
      peaceIconHoldTimeout = setTimeout(() => {
        const debugSection = document.getElementById('debug-mode-section');
        if (debugSection) {
          debugSection.style.display = 'block';
        }
        filterSettings.debugMode = true;
        saveFilterSettings();
        const debugModeCheckbox = document.getElementById('debug-mode');
        if (debugModeCheckbox) {
          debugModeCheckbox.checked = true;
        }
        showToast("you're a developer now!");
        peaceIconHeldForDevMode = true;
        peaceIconHoldTimeout = null;
      }, 5000);
    });
    
    peaceIcon.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (peaceIconHoldTimeout) {
        clearTimeout(peaceIconHoldTimeout);
        peaceIconHoldTimeout = null;
      }
      if (!peaceIconHeldForDevMode) {
        window.open('https://github.com', '_blank');
      }
      setTimeout(() => {
        peaceIconHeldForDevMode = false;
      }, 100);
    });
  }
}, 100);

// Render keyword list on page load
renderKeywordList();

async function checkListing(listing) {
  const link = listing.querySelector('a[href*="/listing/"]');
  if (!link) return;
  
  // Use listing ID for tracking instead of full URL
  const listingId = getListingId(link.href);
  if (!listingId) return; // Skip if we can't extract ID
  
  if (checkedListings.has(listingId)) return;
  
  checkedListings.add(listingId);
  const imageContainer = listing.querySelector('img')?.closest('div');
  
  try {
    // Check cache first for extracted data (using listing ID as key)
    let cachedData = getCachedData(link.href);
    let hasMadeByLabel, hasMadeToOrder, title, description;
    
    if (cachedData) {
      // Use cached extracted data
      hasMadeByLabel = cachedData.hasMadeByLabel;
      hasMadeToOrder = cachedData.hasMadeToOrder;
      title = cachedData.title || '';
      description = cachedData.description || '';
      
      // Store for debug popup
      listingDataCache.set(link.href, {
        hasMadeByLabel,
        hasMadeToOrder,
        title,
        description,
        url: link.href
      });
    } else {
      // Add delay before fetching to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
      
      const response = await fetch(link.href);
      
      // Check for rate limiting or other blocking errors
      if (!response.ok) {
        const isRateLimited = response.status === 429;
        const errorMessage = isRateLimited ? 'Rate Limited' : 'Error fetching';
        showListingError(listing, errorMessage, isRateLimited);
        // Store error state for debug
        listingDataCache.set(link.href, {
          hasMadeByLabel: false,
          hasMadeToOrder: false,
          title: '',
          description: '',
          url: link.href,
          error: isRateLimited ? 'HTTP 429 (Rate Limited)' : `HTTP ${response.status}`
        });
        
        // If rate limited, add to retry queue (using listing ID)
        if (isRateLimited) {
          rateLimitedListings.set(listingId, {
            listing: listing,
            timestamp: Date.now()
          });
        }
        
        return;
      }
      
      // If we successfully fetched, remove from rate-limited list if it was there
      if (rateLimitedListings.has(listingId)) {
        rateLimitedListings.delete(listingId);
        // Clear any error overlay
        const errorOverlay = listing.querySelector('.etsy-filter-error-overlay');
        if (errorOverlay) {
          errorOverlay.remove();
        }
      }
      
      const html = await response.text();
      
      // Check badges
      hasMadeByLabel = html.includes('Made by') && !html.includes('Made by a production partner');
      hasMadeToOrder = html.includes('Made to Order') || html.includes('Made-to-Order');
      
      // Parse HTML to extract title and description
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      title = doc.querySelector('[data-buy-box-listing-title]')?.textContent || '';
      description = doc.querySelector('[data-product-details-description-text-content]')?.textContent || '';
      
      // Truncate very long text to prevent cache bloat (keep enough for keyword matching)
      const MAX_TITLE_LENGTH = 500;
      const MAX_DESCRIPTION_LENGTH = 2000;
      if (title.length > MAX_TITLE_LENGTH) {
        title = title.substring(0, MAX_TITLE_LENGTH);
      }
      if (description.length > MAX_DESCRIPTION_LENGTH) {
        description = description.substring(0, MAX_DESCRIPTION_LENGTH);
      }
      
      // Cache only the extracted data (much smaller than full HTML)
      setCachedData(link.href, {
        hasMadeByLabel,
        hasMadeToOrder,
        title,
        description
      });
      
      // Store for debug popup
      listingDataCache.set(link.href, {
        hasMadeByLabel,
        hasMadeToOrder,
        title,
        description,
        url: link.href
      });
    }
    
    // Build list of conditions to check
    const conditions = [];
    
    // Add badge conditions if enabled
    if (filterSettings.checkBadge) {
      conditions.push(hasMadeByLabel);
    }
    if (filterSettings.checkMadeToOrder) {
      conditions.push(hasMadeToOrder);
    }
    
    // Check for exclude keywords first - if any match, item is excluded
    let excluded = false;
    if (filterSettings.checkTitle || filterSettings.checkDescription) {
      const enabledExcludeKeywords = filterSettings.keywordsExclude.filter(kw => kw.enabled);
      
      if (enabledExcludeKeywords.length > 0) {
        const trimmedTitle = title.trim();
        const trimmedDescription = description.trim();
        excluded = enabledExcludeKeywords.some(kw => {
          const escapedKeyword = kw.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const pattern = new RegExp(`\\b${escapedKeyword}\\b`, 'i');
          return (filterSettings.checkTitle && pattern.test(trimmedTitle)) ||
                 (filterSettings.checkDescription && pattern.test(trimmedDescription));
        });
      }
    }
    
    // Check title and/or description if enabled
    if (filterSettings.checkTitle || filterSettings.checkDescription) {
      const enabledIncludeKeywords = filterSettings.keywordsInclude.filter(kw => kw.enabled);
      
      // If excluded, don't match - but continue to styling code to dim the item
      if (excluded) {
        // Don't add any include keyword conditions, item will be dimmed
      } else {
        // Check include keywords only if not excluded
        if (enabledIncludeKeywords.length > 0) {
        let titleMatch = false;
        let descriptionMatch = false;
        
        if (filterSettings.checkTitle) {
            const trimmedTitle = title.trim();
            titleMatch = enabledIncludeKeywords.some(kw => {
            const escapedKeyword = kw.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pattern = new RegExp(`\\b${escapedKeyword}\\b`, 'i');
              return pattern.test(trimmedTitle);
          });
        }
        
        if (filterSettings.checkDescription) {
            const trimmedDescription = description.trim();
            descriptionMatch = enabledIncludeKeywords.some(kw => {
            const escapedKeyword = kw.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pattern = new RegExp(`\\b${escapedKeyword}\\b`, 'i');
              return pattern.test(trimmedDescription);
            });
          }
          
          // Add title and description as separate conditions
          // This allows OR/AND logic to work correctly across all conditions
          if (filterSettings.checkTitle) {
          conditions.push(titleMatch);
          }
          if (filterSettings.checkDescription) {
          conditions.push(descriptionMatch);
          }
        }
      }
    }
    
    // Store data for debug popup (even if no conditions are enabled)
    // This ensures debug popup can always show data
    if (!listingDataCache.has(link.href)) {
      listingDataCache.set(link.href, {
        hasMadeByLabel,
        hasMadeToOrder,
        title,
        description,
        url: link.href
      });
    }
    
    // Determine if item passes filter based on logic
    // If excluded, item should be dimmed (isMadeBy = false)
    // If no conditions are enabled, don't filter (show all items normally)
    let isMadeBy = false;
    
    if (excluded) {
      // Item is excluded - will be dimmed
      isMadeBy = false;
    } else if (conditions.length === 0) {
      // No filter applied - don't modify the listing
      return;
    } else {
      // Check conditions based on logic
      if (filterSettings.textLogic === 'OR') {
        isMadeBy = conditions.some(c => c); // Any condition is true
      } else { // AND (Strict)
        isMadeBy = conditions.every(c => c); // All conditions must be true
      }
    }
    
    if (isMadeBy) {
      if (imageContainer) {
        imageContainer.style.border = '4px solid #4ade80';
        imageContainer.style.backgroundColor = '#4ade80';
        imageContainer.style.boxShadow = '0 0 20px rgba(74, 222, 128, 0.5)';
        imageContainer.style.borderRadius = 'var(--clg-shape-sem-border-radius-card, 12px)';
        imageContainer.style.transition = 'all 0.3s ease';
        imageContainer.style.overflow = 'hidden';
      }
      madeByCount++;
    } else {
      listing.style.opacity = '0.25';
      listing.style.filter = 'grayscale(100%)';
      listing.style.transition = 'all 0.3s ease';
      otherCount++;
    }
    
    document.getElementById('made-by').textContent = madeByCount;
    document.getElementById('others').textContent = otherCount;
    
  } catch (error) {
    console.error('Error checking listing:', error);
    // Show error overlay for network errors or other exceptions
    showListingError(listing, 'Error fetching');
    
    // Store error state for debug even when exception occurs
    const link = listing.querySelector('a[href*="/listing/"]');
    if (link) {
      listingDataCache.set(link.href, {
        hasMadeByLabel: false,
        hasMadeToOrder: false,
        title: '',
        description: '',
        url: link.href,
        error: error.message || 'Network error'
      });
    }
  }
}

// Function to retry rate-limited listings
async function retryRateLimitedListings() {
  if (rateLimitedListings.size === 0) return;
  if (isChecking) return; // Don't retry if we're already checking listings
  
  const now = Date.now();
  const toRetry = [];
  
  // Find listings that have waited long enough
  for (const [listingId, data] of rateLimitedListings.entries()) {
    const timeSinceRateLimit = now - data.timestamp;
    if (timeSinceRateLimit >= RATE_LIMIT_MIN_WAIT_MS) {
      // Try to find the listing element again (it might have been removed from DOM)
      let listing = data.listing;
      
      // Check if listing is still in DOM
      if (!listing.isConnected) {
        // Try to find it again by listing ID
        const allListings = findAllListingContainers();
        listing = allListings.find(l => {
          const link = l.querySelector('a[href*="/listing/"]');
          if (!link) return false;
          const id = getListingId(link.href);
          return id === listingId;
        });
        
        if (!listing) {
          // Listing no longer exists, remove from retry queue
          rateLimitedListings.delete(listingId);
          continue;
        }
        
        // Update the stored listing reference
        data.listing = listing;
      }
      
      toRetry.push({ listingId, listing });
    }
  }
  
  if (toRetry.length === 0) return;
  
  console.log(`Retrying ${toRetry.length} rate-limited listing(s)...`);
  
  // Remove from checkedListings so they can be rechecked
  toRetry.forEach(({ listingId }) => {
    checkedListings.delete(listingId);
  });
  
  // Retry listings one at a time with delays to avoid rate limiting again
  for (const { listing } of toRetry) {
    await checkListing(listing);
    // Add delay between retries
    await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS * 2));
  }
}

// Function to show debug popup
function showDebugPopup(listing, event) {
  if (!filterSettings.debugMode) return;
  
  // Ensure we have valid event coordinates
  if (!event || typeof event.clientX !== 'number' || typeof event.clientY !== 'number') {
    console.warn('Invalid event object in showDebugPopup:', event);
    return;
  }
  
  const link = listing.querySelector('a[href*="/listing/"]');
  if (!link) return;
  
  const data = listingDataCache.get(link.href);
  if (!data) {
    // Data not yet loaded - show a message
    debugPopup.innerHTML = `
<strong style="color: #fca5a5;">Debug Info</strong><br>
<strong>URL:</strong> ${link.href.substring(0, 60)}...<br><br>
<strong>Status:</strong> <span style="color: #fca5a5;">Data not yet loaded</span><br>
This listing hasn't been checked yet. It will be checked automatically when it comes into view.
    `.trim();
    debugPopup.style.display = 'block';
    debugPopup.style.position = 'fixed';
    debugPopup.style.visibility = 'hidden'; // Temporarily hide to get accurate dimensions
    
    // Force a reflow to ensure dimensions are calculated
    void debugPopup.offsetWidth;
    
    // Get actual popup dimensions after content is set
    const popupRect = debugPopup.getBoundingClientRect();
    const actualPopupWidth = popupRect.width;
    const actualPopupHeight = popupRect.height;
    
    // Position popup very close to cursor
    let left = event.clientX + 5;
    let top = event.clientY + 5;
    
    if (left + actualPopupWidth > window.innerWidth) {
      left = event.clientX - actualPopupWidth - 5;
    }
    if (top + actualPopupHeight > window.innerHeight) {
      top = event.clientY - actualPopupHeight - 5;
    }
    
    // Ensure popup is positioned relative to viewport (not document)
    debugPopup.style.left = `${left}px`;
    debugPopup.style.top = `${top}px`;
    debugPopup.style.visibility = 'visible'; // Make visible after positioning
    
    // Debug: Log cursor and popup positions
    console.log('Popup Position Debug (Not Loaded):', {
      cursorX: event.clientX,
      cursorY: event.clientY,
      popupLeft: left,
      popupTop: top,
      actualPopupWidth: actualPopupWidth,
      actualPopupHeight: actualPopupHeight,
      actualLeft: debugPopup.style.left,
      actualTop: debugPopup.style.top,
      popupRectAfter: debugPopup.getBoundingClientRect()
    });
    return;
  }
  
  // Print full title and description to console
  console.log('=== Listing Debug Info ===');
  console.log('URL:', data.url);
  console.log('Title:', data.title);
  console.log('Description:', data.description);
  console.log('Made by Seller:', data.hasMadeByLabel);
  console.log('Made to Order:', data.hasMadeToOrder);
  
  // Debug keyword matching
  const enabledIncludeKeywords = filterSettings.keywordsInclude.filter(kw => kw.enabled);
  const enabledExcludeKeywords = filterSettings.keywordsExclude.filter(kw => kw.enabled);
  console.log('Enabled Include Keywords:', enabledIncludeKeywords.map(kw => kw.text));
  console.log('Enabled Exclude Keywords:', enabledExcludeKeywords.map(kw => kw.text));
  console.log('Check Title:', filterSettings.checkTitle);
  console.log('Check Description:', filterSettings.checkDescription);
  console.log('Text Logic:', filterSettings.textLogic);
  
  // Check for exclude keywords first - if any match, item is excluded (matches main filtering logic)
  let excluded = false;
  if (enabledExcludeKeywords.length > 0) {
    const trimmedTitle = data.title.trim();
    const trimmedDescription = data.description.trim();
    for (const kw of enabledExcludeKeywords) {
      const escapedKeyword = kw.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`\\b${escapedKeyword}\\b`, 'i');
      const titleExcludeMatch = filterSettings.checkTitle && pattern.test(trimmedTitle);
      const descExcludeMatch = filterSettings.checkDescription && pattern.test(trimmedDescription);
      
      console.log(`Exclude keyword "${kw.text}" - Title match: ${titleExcludeMatch}, Description match: ${descExcludeMatch}`);
      
      if (titleExcludeMatch || descExcludeMatch) {
        excluded = true;
        console.log(`❌ EXCLUDED by keyword "${kw.text}"`);
        break;
      }
    }
  }
  
  console.log('Excluded by exclude keywords:', excluded);
  
  let titleMatch = false;
  let descriptionMatch = false;
  
  // Only check include keywords if not excluded (matches main filtering logic)
  if (!excluded) {
    if (filterSettings.checkTitle && enabledIncludeKeywords.length > 0) {
      titleMatch = enabledIncludeKeywords.some(kw => {
        const escapedKeyword = kw.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`\\b${escapedKeyword}\\b`, 'i');
        const matches = pattern.test(data.title);
        console.log(`Title match for "${kw.text}":`, matches);
        return matches;
      });
    }
    
    if (filterSettings.checkDescription && enabledIncludeKeywords.length > 0) {
      descriptionMatch = enabledIncludeKeywords.some(kw => {
        const escapedKeyword = kw.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`\\b${escapedKeyword}\\b`, 'i');
        const matches = pattern.test(data.description);
        console.log(`Description match for "${kw.text}":`, matches);
        return matches;
      });
    }
  }
  
  console.log('Title Match Result:', titleMatch);
  console.log('Description Match Result:', descriptionMatch);
  console.log('Final Decision: ' + (excluded ? '❌ EXCLUDED' : (titleMatch || descriptionMatch ? '✅ INCLUDED' : '⚪ NO MATCH')));
  console.log('========================');
  
  // Build debug info with detailed keyword matching
  const keywordMatches = [];
  
  // Check exclude keywords first (matches main filtering logic)
  if (enabledExcludeKeywords.length > 0) {
    enabledExcludeKeywords.forEach(kw => {
      const escapedKeyword = kw.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`\\b${escapedKeyword}\\b`, 'i');
      const trimmedTitle = data.title.trim();
      const trimmedDescription = data.description.trim();
      const titleMatches = filterSettings.checkTitle ? pattern.test(trimmedTitle) : null;
      const descMatches = filterSettings.checkDescription ? pattern.test(trimmedDescription) : null;
      keywordMatches.push({ keyword: kw.text, titleMatch: titleMatches, descMatch: descMatches, type: 'exclude' });
    });
  }
  
  // Only check include keywords if not excluded (matches main filtering logic)
  if (!excluded && enabledIncludeKeywords.length > 0) {
    enabledIncludeKeywords.forEach(kw => {
      const escapedKeyword = kw.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`\\b${escapedKeyword}\\b`, 'i');
      const trimmedTitle = data.title.trim();
      const trimmedDescription = data.description.trim();
      const titleMatches = filterSettings.checkTitle ? pattern.test(trimmedTitle) : null;
      const descMatches = filterSettings.checkDescription ? pattern.test(trimmedDescription) : null;
      keywordMatches.push({ keyword: kw.text, titleMatch: titleMatches, descMatch: descMatches, type: 'include' });
    });
  }
  
  const conditions = [];
  if (filterSettings.checkBadge) conditions.push({ name: 'Made by Seller', value: data.hasMadeByLabel, enabled: true });
  if (filterSettings.checkMadeToOrder) conditions.push({ name: 'Made to Order', value: data.hasMadeToOrder, enabled: true });
  
  // Only add title/description conditions if not excluded (matches main filtering logic)
  if (!excluded) {
    if (filterSettings.checkTitle) conditions.push({ name: 'Title Match', value: titleMatch, enabled: true });
    if (filterSettings.checkDescription) conditions.push({ name: 'Description Match', value: descriptionMatch, enabled: true });
  }
  
  // Show disabled conditions too
  if (!filterSettings.checkBadge) conditions.push({ name: 'Made by Seller', value: data.hasMadeByLabel, enabled: false });
  if (!filterSettings.checkMadeToOrder) conditions.push({ name: 'Made to Order', value: data.hasMadeToOrder, enabled: false });
  if (!filterSettings.checkTitle) conditions.push({ name: 'Title Match', value: titleMatch, enabled: false });
  if (!filterSettings.checkDescription) conditions.push({ name: 'Description Match', value: descriptionMatch, enabled: false });
  
  let isMadeBy = false;
  
  // Calculate active conditions for display (always calculate, even if excluded)
  const activeConditions = conditions.filter(c => c.enabled);
  
  // If excluded, item should NOT be highlighted (matches main filtering logic)
  if (excluded) {
    isMadeBy = false;
  } else {
    if (activeConditions.length > 0) {
      if (filterSettings.textLogic === 'OR') {
        isMadeBy = activeConditions.some(c => c.value);
      } else {
        isMadeBy = activeConditions.every(c => c.value);
      }
    }
  }
  
  // Check if there was an error
  if (data.error) {
    const isRateLimit = data.error.includes('429');
    const debugInfo = `
<strong style="color: #fca5a5;">Debug Info</strong><br>
<strong>URL:</strong> ${data.url.substring(0, 60)}...<br><br>
<strong>Status:</strong> <span style="color: #fca5a5;">Error: ${data.error}</span><br>
${isRateLimit ? '<strong style="color: #fbbf24;">⚠ Rate Limited - Too many requests</strong><br>' : ''}
<strong>Extracted Properties:</strong><br>
• Made by Seller: ${data.hasMadeByLabel ? '✓' : '✗'}<br>
• Made to Order: ${data.hasMadeToOrder ? '✓' : '✗'}<br>
• Title: "${data.title || '(not available)'}"<br>
• Description: "${data.description || '(not available)'}"<br>
    `.trim();
    
    debugPopup.innerHTML = debugInfo;
    debugPopup.style.display = 'block';
    debugPopup.style.position = 'fixed';
    debugPopup.style.visibility = 'hidden'; // Temporarily hide to get accurate dimensions
    
    // Force a reflow to ensure dimensions are calculated
    void debugPopup.offsetWidth;
    
    // Get actual popup dimensions after content is set
    const popupRect = debugPopup.getBoundingClientRect();
    const actualPopupWidth = popupRect.width;
    const actualPopupHeight = popupRect.height;
    
    // Position popup closer to cursor for error cases
    let left = event.clientX + 5;
    let top = event.clientY + 5;
    
    if (left + actualPopupWidth > window.innerWidth) {
      left = event.clientX - actualPopupWidth - 5;
    }
    if (top + actualPopupHeight > window.innerHeight) {
      top = event.clientY - actualPopupHeight - 5;
    }
    
    // Ensure popup is positioned relative to viewport (not document)
    debugPopup.style.left = `${left}px`;
    debugPopup.style.top = `${top}px`;
    debugPopup.style.visibility = 'visible'; // Make visible after positioning
    
    // Debug: Log cursor and popup positions
    console.log('Popup Position Debug (Error):', {
      cursorX: event.clientX,
      cursorY: event.clientY,
      popupLeft: left,
      popupTop: top,
      actualPopupWidth: actualPopupWidth,
      actualPopupHeight: actualPopupHeight,
      actualLeft: debugPopup.style.left,
      actualTop: debugPopup.style.top,
      popupRectAfter: debugPopup.getBoundingClientRect()
    });
    return;
  }
  
  const debugInfo = `
<strong style="color: #4ade80;">Debug Info</strong><br>
<strong>URL:</strong> ${data.url.substring(0, 60)}...<br><br>
<strong>Filter Settings:</strong><br>
• Check Badge: ${filterSettings.checkBadge ? '✓' : '✗'}<br>
• Check Made to Order: ${filterSettings.checkMadeToOrder ? '✓' : '✗'}<br>
• Check Title: ${filterSettings.checkTitle ? '✓' : '✗'}<br>
• Check Description: ${filterSettings.checkDescription ? '✓' : '✗'}<br>
• Logic: ${filterSettings.textLogic === 'OR' ? 'Permissive (OR)' : 'Strict (AND)'}<br><br>
<strong>Enabled Keywords:</strong><br>
<strong>Include:</strong> ${enabledIncludeKeywords.length > 0 ? enabledIncludeKeywords.map(kw => `"${kw.text}"`).join(', ') : 'None'}<br>
<strong>Exclude:</strong> ${enabledExcludeKeywords.length > 0 ? enabledExcludeKeywords.map(kw => `"${kw.text}"`).join(', ') : 'None'}<br><br>
<strong>Keyword Matches:</strong><br>
${keywordMatches.length > 0 ? keywordMatches.map(km => {
  const titleStatus = km.titleMatch === null ? '-' : (km.titleMatch ? '✓' : '✗');
  const descStatus = km.descMatch === null ? '-' : (km.descMatch ? '✓' : '✗');
  const typeLabel = km.type === 'exclude' ? '[EXCLUDE]' : '[INCLUDE]';
  return `• ${typeLabel} "${km.keyword}": Title=${titleStatus}, Desc=${descStatus}`;
}).join('<br>') : 'N/A'}<br><br>
<strong>Extracted Properties:</strong><br>
• Made by Seller: ${data.hasMadeByLabel ? '✓' : '✗'}<br>
• Made to Order: ${data.hasMadeToOrder ? '✓' : '✗'}<br>
• Title: "${data.title.trim().substring(0, 50)}${data.title.trim().length > 50 ? '...' : ''}"<br>
• Description: "${data.description.trim().substring(0, 50)}${data.description.trim().length > 50 ? '...' : ''}"<br><br>
<strong>All Filter Conditions:</strong><br>
${conditions.map(c => {
  const status = c.enabled ? (c.value ? '✓' : '✗') : '(disabled)';
  const style = c.enabled ? (c.value ? 'color: #4ade80;' : 'color: #fca5a5;') : 'color: #888;';
  return `• <span style="${style}">${c.name}: ${status}</span>`;
}).join('<br>')}<br><br>
<strong>Active Conditions (${activeConditions.length}):</strong><br>
${activeConditions.length > 0 ? activeConditions.map(c => {
  const style = c.value ? 'color: #4ade80;' : 'color: #fca5a5;';
  return `• <span style="${style}">${c.name}: ${c.value ? '✓' : '✗'}</span>`;
}).join('<br>') : 'None'}<br><br>
<strong>Final Result (${filterSettings.textLogic}):</strong><br>
${excluded ? '<span style="color: #fbbf24; font-weight: bold;">✗ EXCLUDED by exclude keyword - Not highlighted</span>' : 
  (isMadeBy ? '<span style="color: #4ade80; font-weight: bold;">✓ HIGHLIGHTED</span>' : '<span style="color: #fca5a5; font-weight: bold;">✗ DIMMED</span>')}
  `.trim();
  
  debugPopup.innerHTML = debugInfo;
  debugPopup.style.display = 'block';
  debugPopup.style.position = 'fixed';
  debugPopup.style.visibility = 'hidden'; // Temporarily hide to get accurate dimensions
  
  // Force a reflow to ensure dimensions are calculated
  void debugPopup.offsetWidth;
  
  // Get actual popup dimensions after content is set
  const popupRect = debugPopup.getBoundingClientRect();
  const actualPopupWidth = popupRect.width;
  const actualPopupHeight = popupRect.height;
  
  // Position popup close to the mouse cursor
  // Use clientX/clientY which are relative to the viewport
  let left = event.clientX + 5;
  let top = event.clientY + 5;
  
  // Adjust if popup would go off screen using actual dimensions
  if (left + actualPopupWidth > window.innerWidth) {
    left = event.clientX - actualPopupWidth - 5;
  }
  if (top + actualPopupHeight > window.innerHeight) {
    top = event.clientY - actualPopupHeight - 5;
  }
  
  // Ensure popup is positioned relative to viewport (not document)
  debugPopup.style.left = `${left}px`;
  debugPopup.style.top = `${top}px`;
  debugPopup.style.visibility = 'visible'; // Make visible after positioning
  
  // Debug: Log cursor and popup positions
  console.log('Popup Position Debug:', {
    cursorX: event.clientX,
    cursorY: event.clientY,
    popupLeft: left,
    popupTop: top,
    actualPopupWidth: actualPopupWidth,
    actualPopupHeight: actualPopupHeight,
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    actualLeft: debugPopup.style.left,
    actualTop: debugPopup.style.top,
    computedLeft: window.getComputedStyle(debugPopup).left,
    computedTop: window.getComputedStyle(debugPopup).top,
    popupRectAfter: debugPopup.getBoundingClientRect()
  });
}

// Function to hide debug popup
function hideDebugPopup() {
  debugPopup.style.display = 'none';
}

// Function to attach debug hover listeners to a listing
function attachDebugListeners(listing) {
  // Check if already attached
  if (listing.hasAttribute('data-debug-attached')) {
    return;
  }
  
  listing.setAttribute('data-debug-attached', 'true');
  
  listing.addEventListener('mouseenter', (e) => {
    if (filterSettings.debugMode) {
      showDebugPopup(listing, e);
    }
  });
  
  listing.addEventListener('mouseleave', () => {
    if (filterSettings.debugMode) {
      hideDebugPopup();
    }
  });
  
  listing.addEventListener('mousemove', (e) => {
    if (filterSettings.debugMode && debugPopup.style.display === 'block') {
      // Get actual popup dimensions
      const popupRect = debugPopup.getBoundingClientRect();
      const actualPopupWidth = popupRect.width;
      const actualPopupHeight = popupRect.height;
      
      // Update popup position as mouse moves (close to cursor)
      let left = e.clientX + 5;
      let top = e.clientY + 5;
      
      if (left + actualPopupWidth > window.innerWidth) {
        left = e.clientX - actualPopupWidth - 5;
      }
      if (top + actualPopupHeight > window.innerHeight) {
        top = e.clientY - actualPopupHeight - 5;
      }
      
      // Ensure popup is positioned relative to viewport (not document)
      debugPopup.style.position = 'fixed';
      debugPopup.style.left = `${left}px`;
      debugPopup.style.top = `${top}px`;
    }
  });
}

// Function to show error overlay on listing
function showListingError(listing, message, isRateLimited = false) {
  // Remove any existing error overlay from listing or its children
  const existingOverlay = listing.querySelector('.etsy-filter-error-overlay');
  if (existingOverlay) {
    existingOverlay.remove();
  }
  
  // Try to find a better container - look for image container or first child div
  let container = listing.querySelector('img')?.closest('div');
  if (!container) {
    // Try to find the first div child that might be the card container
    container = listing.querySelector('div');
  }
  if (!container) {
    container = listing;
  }
  
  // Create error overlay - yellow for rate limited, red for other errors
  const overlay = document.createElement('div');
  overlay.className = 'etsy-filter-error-overlay';
  const backgroundColor = isRateLimited 
    ? 'rgba(234, 179, 8, 0.85)' // Yellow/amber
    : 'rgba(220, 38, 38, 0.85)'; // Red
  overlay.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: ${backgroundColor};
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 4;
    border-radius: 12px;
    color: white;
    font-weight: 600;
    font-size: 14px;
    text-align: center;
    padding: 10px;
    box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.3);
    pointer-events: none;
    gap: 8px;
  `;
  
  // Add message text
  const messageText = document.createElement('div');
  messageText.textContent = message;
  messageText.style.cssText = 'font-weight: 600; font-size: 14px;';
  overlay.appendChild(messageText);
  
  // If rate limited, add spinning refresh icon
  if (isRateLimited) {
    const refreshIcon = document.createElement('img');
    refreshIcon.src = chrome.runtime.getURL('icons/iconoir/refresh-circle.svg');
    refreshIcon.alt = 'Retrying...';
    refreshIcon.style.cssText = `
      width: 24px;
      height: 24px;
      filter: brightness(0) invert(1);
      animation: spin 2s linear infinite;
    `;
    overlay.appendChild(refreshIcon);
    
    // Add spin animation if not already added
    if (!document.getElementById('etsy-filter-spin-animation')) {
      const style = document.createElement('style');
      style.id = 'etsy-filter-spin-animation';
      style.textContent = `
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }
  }
  
  // Make sure the container has position relative for absolute overlay
  const containerStyle = window.getComputedStyle(container);
  if (containerStyle.position === 'static') {
    container.style.position = 'relative';
  }
  
  // Also ensure listing has position relative as fallback
  const listingStyle = window.getComputedStyle(listing);
  if (listingStyle.position === 'static') {
    listing.style.position = 'relative';
  }
  
  container.appendChild(overlay);
  
  // Debug log
  if (isRateLimited) {
    console.log('Rate limited overlay added to:', container, 'on listing:', listing);
  }
}

// Helper function to find all listing containers on any Etsy page
function findAllListingContainers() {
  // Try specific selectors first (for search results pages - faster)
  // Use the original selectors that worked on search pages
  // The original selector was: '[data-search-results-lg] > div, .wt-grid__item-xs-6'
  // This means: direct children of data-search-results-lg OR any .wt-grid__item-xs-6
  const searchResults = document.querySelector('[data-search-results-lg]');
  if (searchResults) {
    // Use the exact same selector as before - query globally for both patterns
    const listings = Array.from(document.querySelectorAll('[data-search-results-lg] > div, .wt-grid__item-xs-6'));
    // Filter to only include items that actually have listing links
    return listings.filter(listing => listing.querySelector('a[href*="/listing/"]'));
  }
  
  // Fallback: find all listing links and get their containers
  // Look for links to listings and find their parent containers
  const listingLinks = Array.from(document.querySelectorAll('a[href*="/listing/"]'));
  const containers = new Set();
  
  listingLinks.forEach(link => {
    // Find the closest container that likely represents a listing card
    // Try to find a parent div that contains the link and an image
    let container = link.closest('div');
    
    // Walk up the DOM to find a reasonable container
    // Look for containers that have images (likely listing cards)
    while (container && container !== document.body) {
      const hasImage = container.querySelector('img');
      const hasListingLink = container.querySelector('a[href*="/listing/"]');
      
      if (hasImage && hasListingLink) {
        // Check if this container is not too large (likely a section, not a card)
        const rect = container.getBoundingClientRect();
        if (rect.width < window.innerWidth * 0.8 && rect.height < window.innerHeight * 0.8) {
          containers.add(container);
          break;
        }
      }
      
      container = container.parentElement;
    }
  });
  
  return Array.from(containers);
}

async function checkListingInViewport(listing) {
  const link = listing.querySelector('a[href*="/listing/"]');
  if (!link) return;
  
  const listingId = getListingId(link.href);
  if (!listingId || checkedListings.has(listingId)) return;
  
  await checkListing(listing);
}

// Check items already in viewport using the same function as scrolling
async function checkInitialViewportListings() {
  if (isChecking) return;
  isChecking = true;
  
  const listings = findAllListingContainers();
  
  // Check if results are already loaded (if there are listings outside viewport)
  let hasListingsOutsideViewport = false;
  let visibleCount = 0;
  
  listings.forEach(listing => {
    const link = listing.querySelector('a[href*="/listing/"]');
    if (!link) return;
    
    const rect = listing.getBoundingClientRect();
    const isVisible = rect.top < window.innerHeight && 
                     rect.bottom > 0 && 
                     rect.left < window.innerWidth && 
                     rect.right > 0;
    
    if (isVisible) {
      visibleCount++;
    } else if (rect.top >= window.innerHeight || rect.bottom <= 0) {
      // Listing is outside viewport (above or below)
      hasListingsOutsideViewport = true;
    }
  });
  
  // If results are already loaded (listings exist outside viewport), check all listings
  // Otherwise, only check visible ones to avoid unnecessary requests
  const listingsToCheck = [];
  
  listings.forEach(listing => {
    const link = listing.querySelector('a[href*="/listing/"]');
    if (!link) return;
    
    const listingId = getListingId(link.href);
    if (!listingId || checkedListings.has(listingId)) return;
    
    if (hasListingsOutsideViewport) {
      // Results are loaded - check all listings on the page
      listingsToCheck.push(listing);
    } else {
      // Results are still loading - only check visible ones
      const rect = listing.getBoundingClientRect();
      const isVisible = rect.top < window.innerHeight && 
                       rect.bottom > 0 && 
                       rect.left < window.innerWidth && 
                       rect.right > 0;
      
      if (isVisible) {
        listingsToCheck.push(listing);
      }
    }
  });
  
  // Sort by distance from viewport (closest first) - useful for prioritizing visible items
  listingsToCheck.sort((a, b) => {
    const rectA = a.getBoundingClientRect();
    const rectB = b.getBoundingClientRect();
    const distA = Math.min(
      Math.abs(rectA.top),
      Math.abs(rectA.bottom - window.innerHeight)
    );
    const distB = Math.min(
      Math.abs(rectB.top),
      Math.abs(rectB.bottom - window.innerHeight)
    );
    return distA - distB;
  });
  
  // Process listings using the same function as scrolling, in batches to avoid rate limiting
  // Limit to max 4 items at a time to reduce throttling
  const MAX_CONCURRENT_CHECKS = 4;
  for (let i = 0; i < listingsToCheck.length; i += MAX_CONCURRENT_CHECKS) {
    const batch = listingsToCheck.slice(i, i + MAX_CONCURRENT_CHECKS);
    await Promise.all(batch.map(checkListingInViewport));
    // Small delay between batches to avoid rate limiting (cached items are instant)
    if (i + MAX_CONCURRENT_CHECKS < listingsToCheck.length) {
      await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS + 100));
    }
  }
  
  isChecking = false;
}

// Set up Intersection Observer to watch for items entering viewport
const intersectionObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const listing = entry.target;
      checkListingInViewport(listing);
    }
  });
}, {
  root: null, // viewport
  rootMargin: '0px', // Only check when actually visible
  threshold: 0.1 // Trigger when 10% of item is visible
});

// Initial check of viewport items (uses same function as scrolling)
checkInitialViewportListings();

// Observe all existing listings
function observeListings() {
  const listings = findAllListingContainers();
  listings.forEach(listing => {
    const link = listing.querySelector('a[href*="/listing/"]');
    if (link) {
      const listingId = getListingId(link.href);
      if (listingId && !checkedListings.has(listingId)) {
        intersectionObserver.observe(listing);
      }
      // Attach debug listeners to all listings (even if already checked)
      attachDebugListeners(listing);
    }
  });
}

// Initial observation
observeListings();

// Clean up old cache entries on initialization
clearOldCacheEntries();
// Enforce cache size limit
const currentCount = getCacheEntryCount();
if (currentCount > MAX_CACHE_ENTRIES) {
  evictOldestCacheEntries(currentCount - MAX_CACHE_ENTRIES);
}

// Watch for new listings being added to the DOM
const mutationObserver = new MutationObserver(() => {
  setTimeout(() => {
    observeListings();
    // Also do a batch check for items near viewport (uses same function as scrolling)
    checkInitialViewportListings();
  }, REQUEST_DELAY_MS + 300);
});

// Observe DOM changes on any Etsy page
// Try to find a main content container, otherwise observe body
const searchResults = document.querySelector('[data-search-results-lg]');
const mainContent = document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
if (searchResults) {
  mutationObserver.observe(searchResults, { childList: true, subtree: true });
} else if (mainContent) {
  // For pages without search results container (like home page), observe main content
  mutationObserver.observe(mainContent, { childList: true, subtree: true });
}

// Set up periodic retry for rate-limited listings
setInterval(() => {
  retryRateLimitedListings();
}, RATE_LIMIT_RETRY_INTERVAL_MS);

// Function to reset and retrigger filtering on page change
function handlePageChange() {
  // Clear all checked listings and data cache
  checkedListings.clear();
  listingDataCache.clear();
  rateLimitedListings.clear(); // Clear rate-limited queue on page change
  
  // Reset counters
  madeByCount = 0;
  otherCount = 0;
  const madeByElement = document.getElementById('made-by');
  const othersElement = document.getElementById('others');
  if (madeByElement) madeByElement.textContent = '0';
  if (othersElement) othersElement.textContent = '0';
  
  // Clear all styling
  findAllListingContainers().forEach(listing => {
    listing.style.opacity = '';
    listing.style.filter = '';
    const img = listing.querySelector('img')?.closest('div');
    if (img) {
      img.style.border = '';
      img.style.boxShadow = '';
    }
    // Remove error overlays
    const errorOverlay = listing.querySelector('.etsy-filter-error-overlay');
    if (errorOverlay) {
      errorOverlay.remove();
    }
    // Remove debug attachment marker
    listing.removeAttribute('data-debug-attached');
  });
  
  // Reset checking flag
  isChecking = false;
  
  // Re-observe listings and check them after a delay to allow DOM to update
  setTimeout(() => {
    // Re-attach mutation observer for any page type
    mutationObserver.disconnect();
    const searchResults = document.querySelector('[data-search-results-lg]');
    const mainContent = document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
    if (searchResults) {
      mutationObserver.observe(searchResults, { childList: true, subtree: true });
    } else if (mainContent) {
      mutationObserver.observe(mainContent, { childList: true, subtree: true });
    }
    
    observeListings();
    checkInitialViewportListings();
    
    // Highlight product page if we're on one
    highlightProductPage();
  }, REQUEST_DELAY_MS + 300);
}

// Monitor URL changes for Etsy's AJAX navigation
// Method 1: Intercept pushState and replaceState
const originalPushState = history.pushState;
const originalReplaceState = history.replaceState;

history.pushState = function(...args) {
  originalPushState.apply(history, args);
  if (window.location.href !== currentUrl) {
    currentUrl = window.location.href;
    handlePageChange();
  }
};

history.replaceState = function(...args) {
  originalReplaceState.apply(history, args);
  if (window.location.href !== currentUrl) {
    currentUrl = window.location.href;
    handlePageChange();
  }
};

// Method 2: Listen for popstate (back/forward buttons)
window.addEventListener('popstate', () => {
  if (window.location.href !== currentUrl) {
    currentUrl = window.location.href;
    handlePageChange();
  }
});

// Method 3: Periodically check for URL changes (fallback for edge cases)
setInterval(() => {
  if (window.location.href !== currentUrl) {
    currentUrl = window.location.href;
    handlePageChange();
  }
}, 1000);

// WeakMap to store original HTML for elements (more efficient than data attributes)
const originalHTMLCache = new WeakMap();

// Function to check if we're on a product listing page
function isProductPage() {
  return window.location.href.includes('/listing/');
}

// Function to highlight matching keywords in text (preserves HTML structure and selection)
function highlightKeywordsInText(element, text, includeKeywords, excludeKeywords) {
  if (!element) return;
  
  // Check if user is currently selecting text - if so, don't re-highlight
  const currentSelection = window.getSelection();
  if (currentSelection.rangeCount > 0) {
    const range = currentSelection.getRangeAt(0);
    if (!range.collapsed && (element.contains(range.commonAncestorContainer) || element === range.commonAncestorContainer)) {
      // User is selecting text in this element, skip re-highlighting
      return;
    }
  }
  
  // Create a hash of current keywords to check if they've changed
  const keywordsHash = JSON.stringify({
    include: includeKeywords.map(kw => kw.text).sort(),
    exclude: excludeKeywords.map(kw => kw.text).sort()
  });
  
  // Check if highlighting is already applied with the same keywords
  const currentHash = element.getAttribute('data-highlight-hash');
  if (currentHash === keywordsHash && element.querySelector('.etsy-filter-highlight')) {
    // Already highlighted with same keywords, skip
    return;
  }
  
  // Store original HTML if not already stored (using WeakMap instead of data attribute)
  if (!originalHTMLCache.has(element)) {
    originalHTMLCache.set(element, element.innerHTML);
  }
  
  // Get original HTML
  const originalHTML = originalHTMLCache.get(element);
  
  if (!text || (includeKeywords.length === 0 && excludeKeywords.length === 0)) {
    // No keywords to highlight, restore original HTML
    if (originalHTML) {
      element.innerHTML = originalHTML;
      originalHTMLCache.delete(element); // Clean up cache when restoring
    }
    element.removeAttribute('data-highlight-hash');
    return;
  }
  
  // Build regex patterns for all keywords
  const excludePatterns = excludeKeywords.map(kw => {
    const escaped = kw.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { pattern: new RegExp(`\\b${escaped}\\b`, 'gi'), isExclude: true };
  });
  
  const includePatterns = includeKeywords.map(kw => {
    const escaped = kw.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { pattern: new RegExp(`\\b${escaped}\\b`, 'gi'), isExclude: false };
  });
  
  const allPatterns = [...excludePatterns, ...includePatterns];
  
  if (allPatterns.length === 0) {
    element.innerHTML = originalHTML;
    return;
  }
  
  // Save current selection state if any
  const selection = window.getSelection();
  let savedRange = null;
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    // Only save if selection is within our element
    if (element.contains(range.commonAncestorContainer) || element === range.commonAncestorContainer) {
      // Calculate offset relative to element
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(element);
      preCaretRange.setEnd(range.startContainer, range.startOffset);
      savedRange = {
        startOffset: preCaretRange.toString().length,
        endOffset: preCaretRange.toString().length + range.toString().length
      };
    }
  }
  
  // Create a temporary container to parse the original HTML
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = originalHTML;
  
  // Function to process a text node and highlight matches
  function processTextNode(textNode) {
    const text = textNode.textContent;
    if (!text) return;
    
    // Find all matches with their positions
    const matches = [];
    
    allPatterns.forEach(({ pattern, isExclude }) => {
      let match;
      // Reset regex lastIndex
      pattern.lastIndex = 0;
      while ((match = pattern.exec(text)) !== null) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          text: match[0],
          isExclude: isExclude
        });
      }
    });
    
    if (matches.length === 0) return;
    
    // Sort matches by position
    matches.sort((a, b) => a.start - b.start);
    
    // Remove overlapping matches (exclude takes priority)
    const nonOverlapping = [];
    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      let overlaps = false;
      
      for (let j = 0; j < nonOverlapping.length; j++) {
        const existing = nonOverlapping[j];
        // Check if they overlap
        if (!(current.end <= existing.start || current.start >= existing.end)) {
          // If current is exclude and existing is not, replace it
          if (current.isExclude && !existing.isExclude) {
            nonOverlapping[j] = current;
          }
          overlaps = true;
          break;
        }
      }
      
      if (!overlaps) {
        nonOverlapping.push(current);
      }
    }
    
    // Build replacement nodes
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    
    nonOverlapping.forEach(match => {
      // Add text before match
      if (match.start > lastIndex) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.start)));
      }
      
      // Add highlighted match
      // Create span with text node to minimize selection interference
      const highlightSpan = document.createElement('span');
      highlightSpan.className = 'etsy-filter-highlight';
      highlightSpan.setAttribute('data-highlight', 'true');
      highlightSpan.style.cssText = `
        background-color: ${match.isExclude ? 'rgba(239, 68, 68, 0.3)' : 'rgba(74, 222, 128, 0.4)'};
        padding: 2px 4px;
        border-radius: 3px;
        font-weight: 600;
        color: ${match.isExclude ? '#dc2626' : '#16a34a'};
        display: inline;
      `;
      // Use text node instead of textContent to avoid selection boundary issues
      highlightSpan.appendChild(document.createTextNode(match.text));
      fragment.appendChild(highlightSpan);
      
      lastIndex = match.end;
    });
    
    // Add remaining text
    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
    }
    
    // Replace the text node with the fragment
    textNode.parentNode.replaceChild(fragment, textNode);
  }
  
  // Walk through all text nodes in the tree
  const walker = document.createTreeWalker(
    tempDiv,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  
  const textNodes = [];
  let node;
  while (node = walker.nextNode()) {
    // Skip text nodes that are inside script or style tags, or inside our highlight spans
    if (node.parentNode && 
        node.parentNode.tagName !== 'SCRIPT' && 
        node.parentNode.tagName !== 'STYLE' &&
        !node.parentNode.classList.contains('etsy-filter-highlight')) {
      textNodes.push(node);
    }
  }
  
  // Process text nodes in reverse order to avoid index issues
  textNodes.reverse().forEach(processTextNode);
  
  // Update the original element with the processed HTML
  element.innerHTML = tempDiv.innerHTML;
  
  // Store the keywords hash to prevent unnecessary re-highlighting
  element.setAttribute('data-highlight-hash', keywordsHash);
  
  // Restore selection if it was saved
  if (savedRange) {
    try {
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      
      let charCount = 0;
      let startNode = null, startOffset = 0;
      let endNode = null, endOffset = 0;
      
      let textNode;
      while (textNode = walker.nextNode()) {
        const nodeLength = textNode.textContent.length;
        
        if (!startNode && charCount + nodeLength >= savedRange.startOffset) {
          startNode = textNode;
          startOffset = savedRange.startOffset - charCount;
        }
        
        if (!endNode && charCount + nodeLength >= savedRange.endOffset) {
          endNode = textNode;
          endOffset = savedRange.endOffset - charCount;
          break;
        }
        
        charCount += nodeLength;
      }
      
      if (startNode && endNode) {
        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } catch (e) {
      // If restoration fails, just clear selection
      selection.removeAllRanges();
    }
  }
}

// Function to highlight badges on product page
function highlightBadgesOnProductPage() {
  if (!isProductPage()) return;
  
  // Find the buy box container where badges typically appear
  // Look for the container that has the listing title (buy box area)
  const buyBoxContainer = document.querySelector('[data-buy-box-listing-title]')?.closest('[data-listing-id]') ||
                          document.querySelector('[data-buy-box-listing-title]')?.closest('div[class*="buy-box"]') ||
                          document.querySelector('[data-buy-box-listing-title]')?.parentElement?.parentElement;
  
  // If we can't find buy box, try to find product details area
  const productDetailsContainer = document.querySelector('[data-product-details-description-text-content]')?.closest('div') ||
                                   document.querySelector('[data-listing-id]');
  
  // Use buy box if available, otherwise product details, otherwise null
  const badgeContainer = buyBoxContainer || productDetailsContainer;
  
  if (!badgeContainer) return;
  
  // Find "Made by Seller" badge - only within the badge container
  const madeByBadge = Array.from(badgeContainer.querySelectorAll('*')).find(el => {
    const text = el.textContent || '';
    // Must contain "Made by" but not "Made by a production partner"
    // And should be a relatively small element (badge-like, not a whole section)
    const isBadgeLike = el.children.length <= 2 && text.length < 100;
    return isBadgeLike && 
           text.includes('Made by') && 
           !text.includes('Made by a production partner') && 
           !text.includes('Made to Order') && 
           !text.includes('Made-to-Order');
  });
  
  // Find "Made to Order" badge - only within the badge container
  const madeToOrderBadge = Array.from(badgeContainer.querySelectorAll('*')).find(el => {
    const text = el.textContent || '';
    // Must contain "Made to Order" and be badge-like
    const isBadgeLike = el.children.length <= 2 && text.length < 100;
    return isBadgeLike && 
           (text.includes('Made to Order') || text.includes('Made-to-Order')) &&
           !text.includes('Made by');
  });
  
  // Remove existing badge highlights from the badge container
  badgeContainer.querySelectorAll('.etsy-filter-badge-highlight').forEach(el => {
    el.classList.remove('etsy-filter-badge-highlight');
    el.style.backgroundColor = '';
    el.style.border = '';
    el.style.borderRadius = '';
    el.style.padding = '';
  });
  
  // Highlight "Made by Seller" badge if enabled and matches
  if (filterSettings.checkBadge && madeByBadge) {
    madeByBadge.classList.add('etsy-filter-badge-highlight');
    madeByBadge.style.cssText += `
      background-color: rgba(74, 222, 128, 0.2) !important;
      border: 2px solid #4ade80 !important;
      border-radius: 6px !important;
      padding: 4px 8px !important;
    `;
  }
  
  // Highlight "Made to Order" badge if enabled and matches
  if (filterSettings.checkMadeToOrder && madeToOrderBadge) {
    madeToOrderBadge.classList.add('etsy-filter-badge-highlight');
    madeToOrderBadge.style.cssText += `
      background-color: rgba(74, 222, 128, 0.2) !important;
      border: 2px solid #4ade80 !important;
      border-radius: 6px !important;
      padding: 4px 8px !important;
    `;
  }
}

// Function to highlight text on product page
function highlightTextOnProductPage() {
  if (!isProductPage()) return;
  
  const enabledIncludeKeywords = filterSettings.keywordsInclude.filter(kw => kw.enabled);
  const enabledExcludeKeywords = filterSettings.keywordsExclude.filter(kw => kw.enabled);
  
  // Find title element
  const titleElement = document.querySelector('[data-buy-box-listing-title]');
  if (titleElement) {
    if (filterSettings.checkTitle) {
      const titleText = titleElement.textContent || '';
      highlightKeywordsInText(titleElement, titleText, enabledIncludeKeywords, enabledExcludeKeywords);
    } else {
      // Clear highlights if title checking is disabled
      const originalHTML = originalHTMLCache.get(titleElement);
      if (originalHTML) {
        titleElement.innerHTML = originalHTML;
        originalHTMLCache.delete(titleElement); // Clean up cache
      }
    }
  }
  
  // Find description element
  const descriptionElement = document.querySelector('[data-product-details-description-text-content]');
  if (descriptionElement) {
    if (filterSettings.checkDescription) {
      const descriptionText = descriptionElement.textContent || '';
      // Ensure the element allows text selection
      descriptionElement.style.userSelect = 'text';
      descriptionElement.style.webkitUserSelect = 'text';
      descriptionElement.style.mozUserSelect = 'text';
      descriptionElement.style.msUserSelect = 'text';
      
      // Prevent any event handlers from interfering with selection
      // Remove any existing handlers that might interfere
      const oldOnSelectStart = descriptionElement.onselectstart;
      descriptionElement.onselectstart = null;
      
      highlightKeywordsInText(descriptionElement, descriptionText, enabledIncludeKeywords, enabledExcludeKeywords);
      
      // Ensure all highlight spans don't interfere with selection
      descriptionElement.querySelectorAll('.etsy-filter-highlight').forEach(span => {
        // Make spans transparent to selection - they shouldn't create boundaries
        span.style.userSelect = 'text';
        span.style.webkitUserSelect = 'text';
        span.style.mozUserSelect = 'text';
        span.style.msUserSelect = 'text';
        // Prevent spans from blocking selection events
        span.onselectstart = null;
        span.onmousedown = null;
      });
    } else {
      // Clear highlights if description checking is disabled
      const originalHTML = originalHTMLCache.get(descriptionElement);
      if (originalHTML) {
        descriptionElement.innerHTML = originalHTML;
        originalHTMLCache.delete(descriptionElement); // Clean up cache
      }
    }
  }
}

// Throttle for highlightProductPage to prevent excessive re-highlighting
let highlightProductPageTimeout = null;
let lastHighlightTime = 0;
const HIGHLIGHT_THROTTLE_MS = 300; // Minimum time between highlights

// Function to apply all highlights on product page
function highlightProductPage() {
  if (!isProductPage()) return;
  
  // Clear any pending highlight
  if (highlightProductPageTimeout) {
    clearTimeout(highlightProductPageTimeout);
    highlightProductPageTimeout = null;
  }
  
  // Throttle: only highlight if enough time has passed since last highlight
  const now = Date.now();
  const timeSinceLastHighlight = now - lastHighlightTime;
  
  if (timeSinceLastHighlight < HIGHLIGHT_THROTTLE_MS) {
    // Schedule highlight for later
    highlightProductPageTimeout = setTimeout(() => {
      highlightProductPage();
    }, HIGHLIGHT_THROTTLE_MS - timeSinceLastHighlight);
    return;
  }
  
  lastHighlightTime = now;
  
  // Wait a bit for page to fully load
  setTimeout(() => {
    highlightBadgesOnProductPage();
    highlightTextOnProductPage();
  }, 100); // Reduced delay since we're throttling
}

// Call highlightProductPage when page loads or changes
if (isProductPage()) {
  highlightProductPage();
  
  // Also watch for DOM changes on product page (in case content loads dynamically)
  // But be selective - only watch for changes to title/description elements
  const productPageObserver = new MutationObserver((mutations) => {
    // Only re-highlight if title or description elements are added/changed
    const shouldHighlight = mutations.some(mutation => {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (let node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if it's the title or description element, or contains them
            if (node.matches && (
              node.matches('[data-buy-box-listing-title]') ||
              node.matches('[data-product-details-description-text-content]') ||
              node.querySelector('[data-buy-box-listing-title]') ||
              node.querySelector('[data-product-details-description-text-content]')
            )) {
              return true;
            }
          }
        }
      }
      return false;
    });
    
    if (shouldHighlight) {
      highlightProductPage();
    }
  });
  
  // Only observe the main content area, not the entire body
  const mainContent = document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
  productPageObserver.observe(mainContent, {
    childList: true,
    subtree: true
  });
}

