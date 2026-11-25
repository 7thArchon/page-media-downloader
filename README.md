# Page media downloader

`download-page-media.js` is a script you paste into the browser console. It saves every image, video and audio file a web page has loaded, as a single `.zip`. It doesn't need an install or an extension.

## How to use it

1. Open the page in Chrome or Edge, then scroll to the bottom so that images which only load as you scroll actually load.
2. Press **F12** and open the **Console** tab.
3. Paste the whole script and press **Enter**. The first time, Chrome may ask you to type `allow pasting` before it accepts the paste.
4. A file called `<site>-media.zip` downloads.

## What it finds

- Files listed in the browser's own download log for the page.
- The page's `<img>`, `<video>` and `<audio>` elements, including video posters.
- Pictures inside SVGs.
- Icons, and images, video or audio the page preloads.
- CSS background images, including those on `::before` and `::after`.
- All of the above inside web components (shadow DOM).
- Optionally, images written into the page's code (`data:` URLs).

## Settings

These are at the top of the script:

| Setting | Default | What it does |
|---|---|---|
| `INCLUDE_INLINE` | `true` | Also saves images written into the page's code (`data:` URLs) |
| `MIN_BYTES` | `0` | Skips files smaller than this, for example `2000` to drop tracking pixels |
| `PARALLEL` | `6` | How many files it downloads at once |

## Blocked files

Some sites won't let a page's script read their files (this rule is called CORS). Those files are listed in `_could-not-download.txt` inside the zip, and you can open each link to save it by hand. Red CORS errors in the console are expected and harmless.

The zip isn't compressed, because images and video are already compressed and squeezing them again gains nothing.

Only download media you have the right to use.
