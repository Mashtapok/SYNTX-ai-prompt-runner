# SynteX Prompt Runner

Internal Chrome extension for submitting prepared TXT prompts to an already prepared SynteX image generation page.

## Development

```bash
npm install
npm run test
npm run typecheck
npm run build
```

Load `dist` as an unpacked extension in Chrome.

## TXT format

```text
СЦЕНА 1 — ПРОМПТ:
Prompt text

СЦЕНА 2 — ПРОМПТ:
Prompt text
```

The extension stores parsed scenes locally in `chrome.storage.local` so Resume can continue after browser restart.

## Learning mode

Use `Learn` to click the current Prompt field and Generate button on the SynteX page. The extension stores those selectors in `chrome.storage.local` and uses them before built-in fallback selectors. Use `Reset Learning` to delete them and train again without reinstalling the extension.
