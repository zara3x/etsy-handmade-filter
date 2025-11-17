# Etsy Handmade Filter - Chrome Extension

**⚠️ DISCLAIMER: This is an unofficial extension and is not affiliated with, endorsed by, or connected to Etsy, Inc. This extension is created and maintained by independent developers.**

A Chrome extension that filters Etsy search results to show only handmade items based on badges, titles, and descriptions.

## Features

- **Smart Filtering**: Filters listings based on:
  - "Made by" badge detection
  - Title keyword matching
  - Description keyword matching
- **Customizable Keywords**: Add your own keywords to search for in titles/descriptions
- **Flexible Logic**: Choose between "Permissive" (OR) or "Strict" (AND) matching
- **Auto-hide UI**: Filter panel auto-hides when not in use, expands on hover
- **Caching**: Intelligent caching system to reduce server requests and prevent rate limiting
- **Error Handling**: Visual indicators for items that fail to load (429 errors, etc.)
- **Viewport-based**: Only checks items in or near the viewport for better performance

## Installation

### Option 1: Load Unpacked Extension (Development)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the folder containing `manifest.json`, `content.js`, and icon files
6. The extension will now be active on Etsy.com

### Option 2: Create Icon Files

You'll need to create three icon files:
- `icons/icon16.png` (16x16 pixels)
- `icons/icon48.png` (48x48 pixels)
- `icons/icon128.png` (128x128 pixels)

You can use any image editor to create these, or use a placeholder image. The icons should represent a magnifying glass or filter symbol.

## Usage

1. Navigate to any Etsy search results page (e.g., `https://www.etsy.com/search?q=leggings`)
2. The filter panel will appear on the right side of the page
3. Configure your filter settings:
   - **Check Badge**: Enable to filter by "Made by" badge
   - **Check Title**: Enable to search for keywords in listing titles
   - **Check Description**: Enable to search for keywords in listing descriptions
   - **Matching Logic**: Choose "Permissive" (any keyword matches) or "Strict" (all keywords must match)
   - **Keywords**: Add custom keywords to search for
4. The filter will automatically start checking listings in the viewport
5. Handmade items will be highlighted with a green border
6. Non-handmade items will be dimmed and grayscale
7. Items with fetch errors will show a red overlay

## How It Works

- The extension checks each listing by fetching its page and analyzing:
  - Presence of "Made by" badge (excluding "Made by a production partner")
  - Title content for keyword matches
  - Description content for keyword matches
- Results are cached to avoid repeated requests
- Only items in or near the viewport are checked for performance
- The extension uses Intersection Observer to automatically check new items as you scroll

## Permissions

- **Storage**: Used for caching listing data in sessionStorage
- **Host Permissions**: Required to fetch listing pages from Etsy.com

## Troubleshooting

- **Extension not working**: Make sure you're on an Etsy search results page
- **Rate limiting errors**: The extension includes delays and caching to prevent this, but if you see red error overlays, you might have to wait a few minutes before continuing to browse
- **Filter panel not appearing**: Refresh the page or check the browser console for errors

## Development

The extension consists of:
- `manifest.json`: Extension configuration
- `content.js`: Main content script that runs on Etsy pages
- Icon files: Extension icons (you need to create these)

## Disclaimer

**This extension is unofficial and unaffiliated with Etsy, Inc.**

This Chrome extension is an independent project created by third-party developers. It is not created, endorsed, sponsored, or affiliated with Etsy, Inc. or any of its subsidiaries or affiliates. 

- Etsy is a registered trademark of Etsy, Inc.
- This extension uses Etsy's public website and is subject to Etsy's Terms of Service
- Use of this extension is at your own risk
- The developers are not responsible for any issues that may arise from using this extension

## License

Free to use and modify.

## Attribution

This extension uses the "Peace Hand" icon from [Iconoir](https://iconoir.com/), which is licensed under the MIT License. Iconoir is an open-source icon library available at https://iconoir.com/.

