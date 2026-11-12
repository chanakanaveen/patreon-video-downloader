const listEl = document.getElementById('list');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

async function render() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const storageKey = `tab_${tab.id}`;
  const stored = await chrome.storage.session.get(storageKey);
  const all = stored[storageKey] || [];
  const masters = all.filter((item) => item.kind === 'master');
  const items = (masters.length ? masters : all).slice().reverse();

  listEl.textContent = '';
  if (!items.length) {
    listEl.append(
      el('div', 'empty', 'No video detected on this tab. Open a Patreon post, press play on the video, then open this popup again.')
    );
    return;
  }

  for (const item of items) {
    const box = el('div', 'item');
    box.append(el('div', 'title', item.title));
    box.append(el('div', 'meta', `Detected ${new Date(item.time).toLocaleTimeString()}`));

    const download = el('button', 'primary', 'Download');
    download.addEventListener('click', () => {
      const page = chrome.runtime.getURL('downloader.html') +
        `?u=${encodeURIComponent(item.url)}&t=${encodeURIComponent(item.title)}`;
      chrome.tabs.create({ url: page });
    });

    const copy = el('button', '', 'Copy stream URL');
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(item.url);
      copy.textContent = 'Copied';
    });

    box.append(download, copy);
    listEl.append(box);
  }
}

render();
