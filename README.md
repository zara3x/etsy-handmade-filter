# 🎨 Etsy Handmade Filter

**⚠️ DISCLAIMER: This is an unofficial extension and is not affiliated with, endorsed by, or connected to Etsy, Inc. This extension is created and maintained by independent developers.**

A Chrome extension that filters Etsy search results to show only handmade items based on badges, titles, and descriptions.

## ✨ Features

- 🔍 **Smart Filtering**: 
Filters listings based on:
  - "Made by" badge detection (excludes production partners)
  - "Made to Order" badge detection
  - Title keyword matching
  - Description keyword matching
- 🎯 **Customizable Keywords**: Add your own keywords to include or exclude in titles/descriptions
- 🔀 **Flexible Logic**: Choose between "Permissive" (OR) or "Strict" (AND) matching
- 🎨 **Product Highlighting**: Automatically highlights products and matching attributes on the search page as well as individual product pages
- 💾 **Intelligent Caching**: Smart caching system to reduce server requests and prevent rate limiting
- ⚠️ **Error Handling**: Visual indicators for items that fail to load (429 errors, etc.)
- 👁️ **Viewport-based**: Only checks items in or near the viewport
- 🔄 **Auto-retry**: Automatically retries rate-limited items

## 📖 Usage

1. Navigate to any Etsy search results page (e.g., `https://www.etsy.com/search?q=gifts`)
2. The extension icon will appear on the right side of the page (just hover over it to reveal the panel)
3. Configure your filter settings:
   - **Matching Logic**: Choose "Permissive" (any condition matches) or "Strict" (all conditions must match)
   - **Badges**: Enable "Made by Seller" and/or "Made to Order" badge detection
   - **Check**: Enable title and/or description keyword matching
   - **Keywords**: Add custom keywords to include or exclude from results
4. The filter will automatically start checking listings in the viewport
5. Handmade items will be highlighted with a green border
6. Non-handmade items will be dimmed and grayscale
7. Items with fetch errors will show a red or yellow ovrerlay

### 🎯 Product Page Features

When viewing an individual product page, the extension will:
- Highlight matching keywords in the product title and description
- Highlight matching badges in the product details
- Make it easy to see why an item matches your filter criteria

## 🔧 How It Works

- The extension checks each listing by fetching its page and analyzing:
  - Presence of "Made by" badge (excluding "Made by a production partner")
  - Presence of "Made to Order" badge
  - Title content for keyword matches
  - Description content for keyword matches
- Results are cached to avoid repeated requests (persists across sessions)
- Only items in or near the viewport are checked for performance
- The extension uses Intersection Observer to automatically check new items as you scroll
- Rate-limited items are automatically retried after a delay

## 🔐 Permissions

- **Storage**: Used for caching listing data in localStorage to improve performance
- **Host Permissions**: Required to fetch listing pages from Etsy.com for analysis

## 🐛 Troubleshooting

- **Extension not working**: Make sure you're on an Etsy search results page or product page
- **Rate limiting errors**: The extension includes delays and caching to prevent this, but if you see red error overlays, you might have to wait a few minutes before continuing to browse. The extension will automatically retry failed items.
- **Filter panel not appearing**: Refresh the page or check the browser console for errors
- **Keywords not highlighting**: Make sure you've enabled "Check Title" or "Check Description" and added keywords

## ⚖️ License

This project is licensed under the GNU General Public License v3.0 (GPL-3.0).

See the [LICENSE](LICENSE) file for the full license text.

## 🙏 Attribution

- **Peace Hand Icon**: From [Iconoir](https://iconoir.com/), licensed under the MIT License
- **Holiday Music**: "Holiday Music Loop" by [Dana Music](https://pixabay.com/users/danamusic-31920663/) from [Pixabay](https://pixabay.com/)

## ⚠️ Disclaimer

**This extension is unofficial and unaffiliated with Etsy, Inc.**

This Chrome extension is an independent project created by third-party developers. It is not created, endorsed, sponsored, or affiliated with Etsy, Inc. or any of its subsidiaries or affiliates.

- Etsy is a registered trademark of Etsy, Inc.
- This extension uses Etsy's public website and is subject to Etsy's Terms of Service
- Use of this extension is at your own risk
- The developers are not responsible for any issues that may arise from using this extension