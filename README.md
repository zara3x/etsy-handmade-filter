# <img align="center" width="48" height="48" alt="icon-full" src="https://github.com/user-attachments/assets/34243453-409c-414c-b25e-0593f401813c" /> Etsy Handmade Filter
A Chrome extension that filters Etsy search results to show only handmade items ✨

<a href="https://chromewebstore.google.com/detail/etsy-handmade-filter/aiocpbdmcbdiclfhdcclfaeppimljkjg"><img width="150" height="150" alt="chrome-store" src="https://github.com/user-attachments/assets/e239aa02-eb51-444e-b74d-f9c44aa17c2b"/></a>


**⚠️ This is an unofficial extension and is not affiliated with, endorsed by, or connected to Etsy, Inc. This extension is created and maintained by independent developers.**


## 📸 Screencaps

|     |     |
| --- | --- |
| <img width="1280" height="800" alt="handmade-1" src="https://github.com/user-attachments/assets/2e77c7c0-7fd7-4db0-815c-2aa13c935293" /> | <img width="1280" height="800" alt="handmade-2" src="https://github.com/user-attachments/assets/3ef8f478-31e6-45b7-8120-f91f88a155e7" /> |

https://github.com/user-attachments/assets/3dc0b285-41e5-47a0-85ba-9817288c94a9


## ✨ Features

- 🔍 **Smart Filtering**: 
Filters listings based on:
  - "Made by" badge detection (excludes production partners)
  - "Made to Order" badge detection
  - Title keyword matching
  - Description keyword matching
- 🎯 **Customizable Keywords**: Add your own keywords to include or exclude in titles/descriptions
- 🔀 **Flexible Logic**: Choose between "Permissive" (OR) or "Strict" (AND) matching
- 🎨 **Search Page**: Automatically highlights products and matching attributes on the search page as well as individual product pages
- 🧶 **Product Page**: Highlight matching keywords and badges to see why an item fits your filter criteria
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
7. Items with fetch errors will show a red or yellow overlay

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
- **Access Denied**: If you use this too heavily it's possible Etsy will give you a captcha to solve and even block access to the website - don't panic just wait half an hour and try again.
- **Filter panel not appearing**: Refresh the page or check the browser console for errors
- **Results not being modified**: Sometimes the page gets in a weird state so check and recheck a setting to re-trigger the filtering

## ⚖️ License

This project is licensed under the GNU General Public License v3.0 (GPL-3.0).

See the [LICENSE](LICENSE) file for the full license text.

## 🙏 Attribution

- **Icons**: [Iconoir](https://iconoir.com/) licensed under the MIT License
- **Holiday Music**: "Holiday Music Loop" by [Dana Music](https://pixabay.com/users/danamusic-31920663/) from [Pixabay](https://pixabay.com/)

## ⚠️ DISCLAIMER

This Chrome extension is an independent project created by third-party developers. It is not created, endorsed, sponsored, or affiliated with Etsy, Inc. or any of its subsidiaries or affiliates.

- Etsy is a registered trademark of Etsy, Inc.
- This extension uses Etsy's public website and is subject to Etsy's Terms of Service
- Use of this extension is at your own risk
- The developers are not responsible for any issues that may arise from using this extension
