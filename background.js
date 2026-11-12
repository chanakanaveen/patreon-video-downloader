// Watches Patreon tabs for HLS playlists (Patreon serves video through Mux)
// and remembers them per tab so the popup can offer a download.

const MAX_PER_TAB = 20;
const key = (tabId) => `tab_${tabId}`;

// Serialise storage writes so concurrent requests do not overwrite each other.
let chain = Promise.resolve();
const enqueue = (job) => {
  chain = chain.then(job).catch((error) => console.warn('[pvs]', error));
};

chrome.runtime.onInstalled.addListener(() => {
  // Mux may check the Referer on playlist requests. Requests made by this
  // extension's own pages are sent as if they came from the Patreon player.
  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: [
      {
        id: 1,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Referer', operation: 'set', value: 'https://www.patreon.com/' },
            { header: 'Origin', operation: 'set', value: 'https://www.patreon.com' }
          ]
        },
        condition: {
          requestDomains: ['mux.com'],
          initiatorDomains: [chrome.runtime.id],
          resourceTypes: ['xmlhttprequest']
        }
      }
    ]
  });
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return; // our own fetches
    if (!/\.m3u8(\?|$)/.test(details.url)) return;
    enqueue(() => record(details.tabId, details.url));
  },
  { urls: ['*://*.mux.com/*'] }
);

async function record(tabId, url) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.url) return;
  const host = new URL(tab.url).hostname;
  if (host !== 'patreon.com' && !host.endsWith('.patreon.com')) return;

  const parsed = new URL(url);
  const id = parsed.origin + parsed.pathname;

  const stored = await chrome.storage.session.get(key(tabId));
  const list = stored[key(tabId)] || [];
  const existing = list.find((item) => item.id === id);
  if (existing) {
    existing.url = url; // keep the freshest signed token
    await chrome.storage.session.set({ [key(tabId)]: list });
    return;
  }

  let kind = 'media';
  try {
    const text = await fetch(url, { credentials: 'omit' }).then((r) => r.text());
    if (text.includes('#EXT-X-STREAM-INF')) kind = 'master';
  } catch (error) {
    console.warn('[pvs] could not classify playlist', error);
  }

  list.push({
    id,
    url,
    kind,
    title: (tab.title || 'patreon-video').replace(/\s*\|\s*Patreon\s*$/i, ''),
    time: Date.now()
  });
  await chrome.storage.session.set({ [key(tabId)]: list.slice(-MAX_PER_TAB) });
  await updateBadge(tabId, list);
}

async function updateBadge(tabId, list) {
  const masters = list.filter((item) => item.kind === 'master').length;
  const count = masters || list.length;
  await chrome.action.setBadgeBackgroundColor({ color: '#f96854' });
  await chrome.action.setBadgeText({ tabId, text: count ? String(count) : '' });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  enqueue(async () => {
    await chrome.storage.session.remove(key(tabId));
    await chrome.action.setBadgeText({ tabId, text: '' });
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(() => chrome.storage.session.remove(key(tabId)));
});
