# Patreon Video Saver

A Chrome (Manifest V3) extension that saves videos from Patreon posts **you have access to**, for personal offline viewing.

> ⚠️ This tool only works with content you are subscribed to and can already play. It does **not** bypass paywalls, access control, or DRM. Use it for personal offline viewing only — redistributing a creator's content violates their copyright and Patreon's Terms of Service.

## Features

- Detects the HLS video stream on any Patreon post you can play (Patreon serves video through Mux).
- Lets you pick the quality when multiple are available.
- Downloads all segments in parallel and joins them into a single file.
- Handles streams that keep audio separate, and prints the `ffmpeg` merge command.
- Refuses encrypted / DRM streams.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `patreon-video-downloader` folder.

## Usage

1. Open a Patreon post and press **play** on the video (the stream is only detected once it starts playing).
2. The extension icon shows a badge count. Click the icon, then **Download**.
3. A new tab opens. Choose the quality and click **Download**. Keep the tab open until it finishes.

## Notes

- Output is often a `.ts` file, which plays in VLC. To convert to MP4 without re-encoding, run the `ffmpeg -c copy` command shown on the download page.
- If audio is a separate stream, the video and audio are saved as two files along with a merge command.
- Encrypted (DRM) streams cannot be saved.
- Embedded YouTube/Vimeo videos are not supported.
- If a stream link expires, reload the Patreon post and play the video again.
- Large videos (1GB+) are joined in memory and use a lot of RAM.

## Files

| File | Role |
|------|------|
| `manifest.json` | Extension manifest (MV3), permissions, background worker |
| `background.js` | Watches Patreon tabs for `.m3u8` playlists and records them per tab |
| `popup.html` / `popup.js` | Lists detected videos; download / copy-URL actions |
| `downloader.html` / `downloader.js` | Parses the HLS playlist, downloads segments, saves the file |

## License

MIT
