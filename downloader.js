// Downloads an HLS stream segment by segment and saves it as a single file.
// Unencrypted streams only: encrypted / DRM streams are refused.

const params = new URLSearchParams(location.search);
const sourceUrl = params.get('u');
const title = params.get('t') || 'patreon-video';
const safeName = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'patreon-video';

const CONCURRENCY = 6;
const RETRIES = 4;

const $ = (id) => document.getElementById(id);
const titleEl = $('title');
const qualityEl = $('quality');
const startEl = $('start');
const cancelEl = $('cancel');
const barEl = $('bar');
const statusEl = $('status');
const hintEl = $('hint');

let master = null;
let controller = null;

titleEl.textContent = title;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.className = isError ? 'error' : '';
}

function parseAttributes(text) {
  const result = {};
  const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let match;
  while ((match = pattern.exec(text))) result[match[1]] = match[2].replace(/^"|"$/g, '');
  return result;
}

async function fetchText(url, signal) {
  const response = await fetch(url, { credentials: 'omit', signal });
  if (!response.ok) throw new Error(`Playlist request failed (HTTP ${response.status}). The link may have expired: reload the Patreon post, play the video and try again.`);
  return response.text();
}

function parseMaster(text, base) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const variants = [];
  const audio = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXT-X-MEDIA:')) {
      const a = parseAttributes(line.slice(13));
      if (a.TYPE === 'AUDIO' && a.URI && (!audio[a['GROUP-ID']] || a.DEFAULT === 'YES')) {
        audio[a['GROUP-ID']] = new URL(a.URI, base).href;
      }
    } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const a = parseAttributes(line.slice(18));
      let j = i + 1;
      while (j < lines.length && (!lines[j] || lines[j].startsWith('#'))) j++;
      if (j >= lines.length) continue;
      const height = a.RESOLUTION ? Number(a.RESOLUTION.split('x')[1]) : 0;
      variants.push({
        url: new URL(lines[j], base).href,
        height,
        bandwidth: Number(a.BANDWIDTH) || 0,
        resolution: a.RESOLUTION || '',
        audioGroup: a.AUDIO || null
      });
    }
  }
  variants.sort((x, y) => y.height - x.height || y.bandwidth - x.bandwidth);
  return { variants, audio };
}

function parseByteRange(value, url, state) {
  const [lengthText, offsetText] = value.split('@');
  const length = Number(lengthText);
  const offset = offsetText !== undefined ? Number(offsetText) : (state.lastUrl === url ? state.lastEnd : 0);
  state.lastUrl = url;
  state.lastEnd = offset + length;
  return { offset, length };
}

function parseMedia(text, base) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const segments = [];
  const rangeState = { lastUrl: null, lastEnd: 0 };
  let init = null;
  let encrypted = false;
  let pendingRange = null;

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('#EXT-X-KEY:')) {
      const a = parseAttributes(line.slice(11));
      if (a.METHOD && a.METHOD !== 'NONE') encrypted = true;
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const a = parseAttributes(line.slice(11));
      const url = new URL(a.URI, base).href;
      init = { url, range: a.BYTERANGE ? parseByteRange(a.BYTERANGE, url, { lastUrl: null, lastEnd: 0 }) : null };
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      pendingRange = line.slice(17);
    } else if (!line.startsWith('#')) {
      const url = new URL(line, base).href;
      segments.push({ url, range: pendingRange ? parseByteRange(pendingRange, url, rangeState) : null });
      pendingRange = null;
    }
  }
  return { init, segments, encrypted };
}

async function fetchPart(part, signal) {
  const headers = part.range
    ? { Range: `bytes=${part.range.offset}-${part.range.offset + part.range.length - 1}` }
    : {};
  let lastError;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const response = await fetch(part.url, { credentials: 'omit', headers, signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.blob();
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  throw new Error(`Segment failed after ${RETRIES} attempts: ${lastError.message}`);
}

async function downloadPlaylist(url, label, isAudio, signal) {
  const playlist = parseMedia(await fetchText(url, signal), url);
  if (playlist.encrypted) throw new Error('This stream is encrypted (DRM). It cannot be saved by this extension.');
  if (!playlist.segments.length) throw new Error('No segments found in the playlist.');

  const parts = playlist.init ? [playlist.init, ...playlist.segments] : playlist.segments;
  const blobs = new Array(parts.length);
  let next = 0;
  let done = 0;
  let bytes = 0;

  barEl.hidden = false;
  barEl.max = parts.length;
  barEl.value = 0;

  async function worker() {
    while (next < parts.length) {
      const index = next++;
      blobs[index] = await fetchPart(parts[index], signal);
      bytes += blobs[index].size;
      done++;
      barEl.value = done;
      setStatus(`${label}: ${done} / ${parts.length} segments (${(bytes / 1048576).toFixed(1)} MB)`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, parts.length) }, worker));

  let extension;
  if (playlist.init) extension = isAudio ? 'm4a' : 'mp4';
  else if (/\.aac(\?|$)/i.test(playlist.segments[0].url)) extension = 'aac';
  else extension = 'ts';

  const type = extension === 'ts' ? 'video/mp2t' : extension === 'mp4' ? 'video/mp4' : 'audio/mp4';
  return { blob: new Blob(blobs, { type }), extension };
}

async function save(blob, filename) {
  const url = URL.createObjectURL(blob); // kept alive until this tab closes
  await chrome.downloads.download({ url, filename, saveAs: false });
}

function showHint(text) {
  hintEl.hidden = false;
  hintEl.textContent = text;
}

async function start() {
  controller = new AbortController();
  const { signal } = controller;
  startEl.disabled = true;
  qualityEl.disabled = true;
  cancelEl.hidden = false;
  hintEl.hidden = true;

  try {
    let videoUrl = sourceUrl;
    let audioUrl = null;
    if (master) {
      const variant = master.variants[Number(qualityEl.value)];
      videoUrl = variant.url;
      audioUrl = variant.audioGroup ? master.audio[variant.audioGroup] || null : null;
    }

    const video = await downloadPlaylist(videoUrl, 'Video', false, signal);

    if (audioUrl) {
      const audio = await downloadPlaylist(audioUrl, 'Audio', true, signal);
      const videoName = `${safeName}.video.${video.extension}`;
      const audioName = `${safeName}.audio.${audio.extension}`;
      await save(video.blob, videoName);
      await save(audio.blob, audioName);
      setStatus('Done. Video and audio were saved as two files.');
      showHint(`This stream keeps audio separate. Merge with ffmpeg:\n\nffmpeg -i "${videoName}" -i "${audioName}" -c copy "${safeName}.mp4"`);
    } else {
      const name = `${safeName}.${video.extension}`;
      await save(video.blob, name);
      setStatus(`Done. Saved as ${name}`);
      if (video.extension === 'ts') {
        showHint(`.ts plays in VLC. To convert to MP4 without re-encoding:\n\nffmpeg -i "${name}" -c copy "${safeName}.mp4"`);
      }
    }
  } catch (error) {
    setStatus(signal.aborted ? 'Cancelled.' : error.message, !signal.aborted);
  } finally {
    startEl.disabled = false;
    qualityEl.disabled = false;
    cancelEl.hidden = true;
  }
}

async function init() {
  if (!sourceUrl) {
    setStatus('No stream URL given.', true);
    return;
  }
  try {
    const text = await fetchText(sourceUrl);
    if (text.includes('#EXT-X-STREAM-INF')) {
      master = parseMaster(text, sourceUrl);
      if (!master.variants.length) throw new Error('No video qualities found.');
      master.variants.forEach((variant, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        const mbps = (variant.bandwidth / 1e6).toFixed(1);
        option.textContent = variant.height ? `${variant.height}p (${mbps} Mbps)` : `${mbps} Mbps`;
        qualityEl.append(option);
      });
      qualityEl.hidden = false;
    }
    startEl.disabled = false;
    setStatus('Ready.');
  } catch (error) {
    setStatus(error.message, true);
  }
}

startEl.addEventListener('click', start);
cancelEl.addEventListener('click', () => controller && controller.abort());
init();
