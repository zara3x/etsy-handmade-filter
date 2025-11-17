# Icon Files Required

This extension requires three icon files. You can create them using any image editor:

- `icons/icon16.png` - 16x16 pixels
- `icons/icon48.png` - 48x48 pixels  
- `icons/icon128.png` - 128x128 pixels

## Quick Icon Creation

You can use online tools like:
- https://www.favicon-generator.org/
- https://realfavicongenerator.net/
- Or any image editor (GIMP, Photoshop, etc.)

Suggested icon: A magnifying glass (🔍) or filter symbol on a gradient background matching the extension's color scheme (#f1641e to #764ba2).

## Temporary Workaround

If you want to test the extension without icons, you can temporarily comment out the "icons" section in `manifest.json`:

```json
// "icons": {
//   "16": "icons/icon16.png",
//   "48": "icons/icon48.png",
//   "128": "icons/icon128.png"
// }
```

The extension will still work, but won't have an icon in the Chrome extensions menu.

