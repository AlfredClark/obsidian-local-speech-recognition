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
- Selectable recognition models: SenseVoice, FunASR and Paraformer families with int8/fp16/fp32 variants, each started with its own parameters (see [Supported models](#supported-models)).
- Trilingual UI: English / 简体中文 / 繁體中文, following the Obsidian interface language or set manually.

## Requirements

- Obsidian 1.13.1 or later (uses the declarative settings API).
- Desktop only. The plugin spawns a local subprocess and captures microphone audio, neither of which is available on mobile.
- A `sherpa-onnx-offline-websocket-server` binary (see [Choosing the server binary](#choosing-the-server-binary)) plus a model folder holding one of the supported models (see [Supported models](#supported-models)).

## Downloads

- sherpa-onnx releases (server binaries): <https://github.com/k2-fsa/sherpa-onnx/releases>
- Pre-trained ASR models: <https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models>

### Choosing the server binary

Each sherpa-onnx release ships pre-built archives for desktop platforms. Pick the one matching your OS and CPU, extract it, then point **Settings → Service settings → Server binary path** at the executable inside its `bin/` folder:

- macOS / Linux: `<extracted-folder>/bin/sherpa-onnx-offline-websocket-server`
- Windows: `<extracted-folder>/bin/sherpa-onnx-offline-websocket-server.exe`

| Platform              | Archive to download                                          |
| --------------------- | ------------------------------------------------------------ |
| macOS (Apple silicon) | `sherpa-onnx-v<version>-osx-arm64-static.tar.bz2`            |
| macOS (Intel)         | `sherpa-onnx-v<version>-osx-x64-static.tar.bz2`              |
| macOS (both)          | `sherpa-onnx-v<version>-osx-universal2-static.tar.bz2`       |
| Linux (x86_64)        | `sherpa-onnx-v<version>-linux-x64-static.tar.bz2`            |
| Linux (ARM64)         | `sherpa-onnx-v<version>-linux-aarch64-static.tar.bz2`        |
| Windows (x64)         | `sherpa-onnx-v<version>-win-x64-static-MD-Release.tar.bz2`   |
| Windows (ARM64)       | `sherpa-onnx-v<version>-win-arm64-static-MD-Release.tar.bz2` |
| Windows (32-bit)      | `sherpa-onnx-v<version>-win-x86-static-MD-Release.tar.bz2`   |

Notes:

- On Linux, when sherpa-onnx was installed through a package manager (pacman, yay, …) rather than a release archive, locate the installed binary with `whereis sherpa-onnx-offline-websocket-server` and use that path.
- Prefer the `-static` archives: their executable is self-contained. The `-shared` variants additionally need the archive's `lib/` folder on the library search path (`PATH` on Windows, `LD_LIBRARY_PATH` on Linux, `DYLD_LIBRARY_PATH` on macOS).
- Append `-no-tts` where available (e.g. `...-linux-x64-static-no-tts.tar.bz2`): the plugin only transcribes speech, and those archives are much smaller.
- macOS may refuse to run the unsigned binary when a browser set the quarantine flag; clear it with `xattr -dr com.apple.quarantine <extracted-folder>`.

### Supported models

Pick a model under **Settings → Service settings → Recognition model**, then point **Model folder path** at the folder you extracted. That folder must contain the files listed below; extra files such as `test_wavs/` are ignored. Switching models takes effect the next time the service starts.

| Recognition model | Model folder must contain                                                                 | Characteristics                                                                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SenseVoice (int8) | `model.int8.onnx`, `tokens.txt`                                                           | Default. Mandarin, Cantonese, English, Japanese and Korean; ITN adds punctuation; small (~230 MB) and fast                                                                                       |
| SenseVoice        | `model.onnx`, `tokens.txt`                                                                | The same model at full precision (~890 MB): slightly more accurate, but larger and slower                                                                                                        |
| FunASR (int8)     | `encoder_adaptor.int8.onnx`, `llm.int8.onnx`, `embedding.int8.onnx`, `Qwen3-0.6B/`        | Uses Qwen3-0.6B as the decoder, the most accurate option here; Mandarin (7 dialect groups, 26 regional accents), English and Japanese, and it also handles sung lyrics. Large (~950 MB) and slow |
| FunASR (fp16)     | `encoder_adaptor.int8.onnx`, `llm.fp16.onnx`, `embedding.int8.onnx`, `Qwen3-0.6B/`        | FunASR with an fp16 decoder (~1.5 GB); a middle ground between the int8 and fp32 builds                                                                                                          |
| FunASR (fp32)     | `encoder_adaptor.onnx`, `llm.fp32.onnx`, `llm.fp32.data`, `embedding.onnx`, `Qwen3-0.6B/` | FunASR at full precision (~3.7 GB), the heaviest option; keep `llm.fp32.data` next to `llm.fp32.onnx`                                                                                            |
| Paraformer (int8) | `model.int8.onnx`, `tokens.txt`                                                           | Non-autoregressive and the fastest model here (~220 MB); Chinese (some builds add English or Cantonese); the output carries no punctuation                                                       |
| Paraformer        | `model.onnx`, `tokens.txt`                                                                | Paraformer at full precision (~790 MB), the largest of its family                                                                                                                                |

`Qwen3-0.6B/` is a tokenizer folder, not a single file. Archives that match the table, from the ASR models release:

- **SenseVoice**: `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17` (contains both `model.onnx` and `model.int8.onnx`) or `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17` (int8 only).
- **FunASR**: `sherpa-onnx-funasr-nano-int8-2025-12-30`, `sherpa-onnx-funasr-nano-fp16-2025-12-30`, and `sherpa-onnx-funasr-nano-2025-12-30` for fp32.
- **Paraformer**: `sherpa-onnx-paraformer-zh-2024-03-09` and other archives of the same family — `-zh-small-2024-03-09` is the smallest, `-trilingual-zh-cantonese-en` adds Cantonese, `-zh-int8-2025-10-07` targets Sichuanese. Some builds (small, Sichuanese) ship `model.int8.onnx` only, so pair them with **Paraformer (int8)**.

> Note: a model of the same architecture with different file names can in theory be forced to run by renaming its files to the names listed above, but this is not guaranteed to work.

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

| Setting            | Description                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| Server binary path | Path to the `sherpa-onnx-offline-websocket-server` executable                                       |
| Model folder path  | Folder holding the files required by the selected model (see [Supported models](#supported-models)) |
| Recognition model  | Which supported model the service loads at start; takes effect on the next start                    |
| Host / Port        | Where the service listens (defaults `127.0.0.1` / `6006`)                                           |
| CPU threads        | Threads used by the service neural network                                                          |
| Test connection    | Dial the configured WebSocket address to check reachability                                         |
| Auto start server  | Start the service automatically when the plugin loads                                               |
| Start/Stop/Restart | Manual lifecycle controls, shown depending on service status                                        |

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
