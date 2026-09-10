# Local Speech Recognition

**English** | [简体中文](docs/README_zh-CN.md)

Offline speech recognition in Obsidian, powered by a locally deployed sherpa-onnx service. Press a hotkey, speak, and the transcription is inserted at your cursor. No cloud, no API keys.

## Features

- Offline transcription via `sherpa-onnx-offline-websocket-server` over a local WebSocket (default `ws://127.0.0.1:6006`).
- Hotkey-triggered recording with toggle and push-to-talk modes. The plugin ships with no preset hotkey; assign one yourself in Settings → Hotkeys.
- Microphone selection with device enumeration and one-click refresh.
- 16 kHz 16-bit mono pipeline: `AudioWorklet` capture with linear downsampling.
- Smart delivery: inserts at the cursor when a Markdown editor is focused (source mode), otherwise copies to the clipboard with a Notice.
- Lexicon (designed for Chinese): add words from the editor context menu; after a transcription, matching words are underlined and can be clicked to replace with a same-pinyin alternative. Optional fuzzy pinyin matching tolerates retroflex/nasal confusions.
- Sidebar view (ribbon icon): a Lexicon tab for managing entries and a Service tab for controlling the service.
- Service management: manual start/stop/restart, auto-start on plugin load, and a connection test.
- Trilingual UI: English / 简体中文 / 繁體中文, following the Obsidian interface language or set manually.

## Requirements

- Obsidian 1.13.1 or later (uses the declarative settings API).
- Desktop only. The plugin spawns a local subprocess and captures microphone audio, neither of which is available on mobile.
- A `sherpa-onnx-offline-websocket-server` binary plus a model folder. Currently only the int8 build of `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17` is supported: the folder must contain `model.int8.onnx` and `tokens.txt`. Other models need follow-up releases for adaptation.

## Downloads

- sherpa-onnx releases (server binaries): <https://github.com/k2-fsa/sherpa-onnx/releases>
- Pre-trained ASR models: <https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models>

## Installation

1. In Obsidian, open Settings → Community plugins → Browse, search for "Local Speech Recognition", and install it. After installation, enable the plugin.
2. If you prefer a manual install, download `main.js`, `manifest.json`, and `styles.css` from the GitHub release, copy them to `<vault>/.obsidian/plugins/local-speech-recognition/`, reload Obsidian, then enable the plugin in Settings → Community plugins.

## Quick start

1. Download the server binary and the model from the links above, and unpack the model folder somewhere local.
2. Open plugin settings → Service settings: fill in the server binary path and model folder path, check host/port/threads, then click Test connection or Start service (or enable auto-start).
3. Open Speech input: pick a microphone. If the list is empty or unlabeled, allow microphone access once, then click Refresh microphones. Choose an input mode.
4. Open Obsidian Settings → Hotkeys, find "Toggle speech recognition", and assign a hotkey.
5. Focus a note editor, press the hotkey, speak, then press it again. The text is inserted at the cursor. If no editor is focused, the result goes to the clipboard with a Notice instead.
6. Optional: build a lexicon of names or jargon. Select a word in an editor and pick **Add to lexicon** from the right-click menu; later transcriptions will underline it and offer one-click corrections. See [Lexicon](#lexicon) below.

## Settings reference

General:

| Setting            | Description                                                    |
| ------------------ | -------------------------------------------------------------- |
| Plugin language    | Interface language: follow system, English, 简体中文, 繁體中文 |
| Collapsible groups | Render settings groups as navigable sub-pages when on          |

Service settings:

| Setting            | Description                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Server binary path | Path to the `sherpa-onnx-offline-websocket-server` executable                                                              |
| Model folder path  | Folder with `model.int8.onnx` + `tokens.txt` from `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17` (int8 only for now) |
| Host / Port        | Where the service listens (defaults `127.0.0.1` / `6006`)                                                                  |
| CPU threads        | Threads used by the service neural network                                                                                 |
| Test connection    | Dial the configured WebSocket address to check reachability                                                                |
| Auto start server  | Start the service automatically when the plugin loads                                                                      |
| Start/Stop/Restart | Manual lifecycle controls, shown depending on service status                                                               |

Speech input:

| Setting             | Description                                  |
| ------------------- | -------------------------------------------- |
| Microphone          | Input device; empty means the system default |
| Refresh microphones | Re-enumerate audio input devices             |
| Input mode          | Toggle on click, or push-to-talk (see below) |

Lexicon settings:

| Setting                 | Description                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Enable lexicon          | Turn all lexicon features on or off, including the sidebar tab and editor integration (default on)                     |
| Fuzzy pinyin matching   | Also match words differing only in retroflex initials or front/back nasals (default off; see Lexicon below)            |
| Export / Import / Clear | Back up to JSON, import from JSON or one-word-per-line text, or permanently delete every entry (hidden while disabled) |

## Usage notes

- Toggle mode: press once to start, press again to stop and transcribe.
- Push-to-talk mode (transitional): press to start; releasing the hotkey or pressing again stops and transcribes. Obsidian hotkeys only deliver key-down events, so exact hold-to-talk semantics are approximated for now.
- Recording is capped at 280 seconds (the server rejects utterances over 300 seconds) and then transcribed automatically.
- While a transcription is in flight, new triggers are rejected with a Notice.
- Lexicon: select text in an editor and choose **Add to lexicon** from the right-click menu. After that, every transcription is scanned for lexicon words; matches get a dotted underline, and clicking one opens a menu of same-pinyin replacements.
- Manage entries in the sidebar (ribbon icon) → **Lexicon**: search, filter by enabled state, add/edit/delete, and batch enable/disable/delete.

## Lexicon

The lexicon is **designed for Chinese**. Each entry pairs a word with its pinyin, and matching compares the pinyin of transcribed text against those entries. That means a word can still be flagged when the speech model returns a homophone — e.g. the lexicon knows 知识, so a transcription of 资石 (identical pinyin `zhi shi`) is underlined and can be corrected with one click. Because matching is pinyin-based, the lexicon has no effect on non-Chinese text: Latin-script segments are ignored, and words without a pinyin are skipped.

Enable **Fuzzy pinyin matching** to also treat words as equivalent when they differ only in retroflex initials (zh/z, ch/c, sh/s) or front/back nasals (an/ang, en/eng, in/ing, ian/iang, uan/uang). This helps with accents and model confusions, but it trades precision for recall — with it on, 张 and 脏 become mutually interchangeable — so it is off by default.

Notes:

- Pinyin is generated automatically when you add a word; you can edit it, or regenerate it from the word, in the entry dialog.
- An entry can be disabled instead of deleted; disabled entries are kept in the list but excluded from matching.
- Assigning a **weight** ranks entries that share a pinyin, so higher-weight words appear first among the replacements.
- Adding a word that already exists (same word and pinyin) is rejected with a Notice; homophones with different characters are allowed.

## Troubleshooting

| Symptom                            | What to do                                                                |
| ---------------------------------- | ------------------------------------------------------------------------- |
| Microphone list empty or unlabeled | Allow microphone access once, then click Refresh microphones              |
| "Service is not running" Notice    | Start the service from settings, or enable auto-start                     |
| Connection test fails              | Check binary/model paths, host/port, and whether the port is in use       |
| Microphone denied / not found      | Check OS microphone permission and that the selected device is plugged in |
| Recognition fails                  | Check the Notice detail; for exit codes, verify the model folder layout   |
| An unexpected word gets underlined | Fuzzy pinyin matching is on; turn it off under Lexicon settings           |

## Privacy

All recognition runs locally. Microphone audio is sent only to the WebSocket address you configure (default localhost) and never to any third party.

## Development

```sh
bun install
bun run dev      # watch + rebuild into dist
bun run build    # typecheck + production build
bun run lint
bun run format
```

## License

GPL-3.0-only. See [LICENSE](LICENSE).
