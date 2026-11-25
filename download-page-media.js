/*
  Download all media on a page (images, video, audio) as one .zip file.

  HOW TO USE
  1. Open the page in Chrome or Edge and scroll to the bottom, so that
     lazy-loaded images actually load.
  2. Open DevTools: press F12 (or Ctrl+Shift+J) and click the "Console" tab.
  3. Paste this whole file and press Enter. The first time, Chrome may ask
     you to type "allow pasting" before it accepts the paste.
  4. A file called <site>-media.zip downloads.

  Some files may be blocked. Other websites (CDNs) can refuse to let a page's
  script read their files; this rule is called CORS. Those files are listed in
  _could-not-download.txt inside the zip. Red "CORS" errors in the console
  are expected and do no harm.
*/
(async () => {
  // ---- Settings -------------------------------------------------------------
  const INCLUDE_INLINE = true; // images embedded in the page's code (data: URLs)
  const MIN_BYTES = 0;         // set to e.g. 2000 to skip 1x1 tracking pixels and tiny icons
  const PARALLEL = 6;          // how many files to fetch at once

  const MEDIA_EXT = /\.(jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|heic|mp4|webm|mov|m4v|mkv|ogv|mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i;
  const MEDIA_TYPE = /^(image|video|audio)\//i;

  // ---- 1. Collect every media URL the page has used ------------------------
  const urls = new Set();
  const add = (raw) => {
    if (!raw) return;
    try {
      const u = new URL(raw, location.href);
      if (u.protocol === 'data:' && !INCLUDE_INLINE) return;
      if (/^(https?|data|blob):$/.test(u.protocol)) urls.add(u.href);
    } catch { /* not a valid URL, ignore */ }
  };
  const hasMediaExt = (url) => {
    try { return MEDIA_EXT.test(new URL(url).pathname); } catch { return false; }
  };

  // a) The browser's own log of what it downloaded for this page
  for (const e of performance.getEntriesByType('resource')) {
    if (['img', 'image', 'video', 'audio'].includes(e.initiatorType) || hasMediaExt(e.name)) add(e.name);
  }

  // b) Every element on the page, including ones inside web components (shadow DOM)
  const elements = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      elements.push(el);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);

  const CSS_URL = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
  for (const el of elements) {
    const tag = el.tagName.toUpperCase();
    if (tag === 'IMG') { add(el.currentSrc); add(el.src); }
    else if (tag === 'VIDEO') { add(el.currentSrc); add(el.src); add(el.poster); }
    else if (tag === 'AUDIO') { add(el.currentSrc); add(el.src); }
    else if (tag === 'IMAGE' && el.href && el.href.baseVal) add(el.href.baseVal); // <image> inside SVG
    else if (tag === 'LINK' && (/icon/i.test(el.rel) || (/preload/i.test(el.rel) && /image|video|audio/i.test(el.as)))) add(el.href);

    // CSS background images, including on ::before / ::after
    for (const pseudo of [null, '::before', '::after']) {
      const bg = getComputedStyle(el, pseudo).backgroundImage;
      if (bg && bg !== 'none') for (const m of bg.matchAll(CSS_URL)) add(m[2]);
    }
  }

  if (!urls.size) {
    console.warn('No media found. Scroll through the page first, then run this again.');
    return;
  }
  console.log(`Found ${urls.size} media URLs. Downloading...`);

  // ---- 2. Download them -----------------------------------------------------
  const EXT_FOR = {
    'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
    'video/quicktime': 'mov', 'audio/x-wav': 'wav',
  };
  const extFor = (type) =>
    EXT_FOR[type] || (type.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'bin';

  const usedNames = new Set();
  const uniqueName = (url, type) => {
    let base = url.startsWith('blob:') ? 'blob' : 'inline';
    if (/^https?:/.test(url)) {
      const last = new URL(url).pathname.split('/').filter(Boolean).pop() || 'file';
      try { base = decodeURIComponent(last); } catch { base = last; }
    }
    base = base.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(-120); // safe on Windows
    if (!MEDIA_EXT.test(base)) base += '.' + extFor(type);
    const dot = base.lastIndexOf('.');
    const stem = base.slice(0, dot), ext = base.slice(dot);
    let name = base, n = 1;
    while (usedNames.has(name.toLowerCase())) name = `${stem} (${++n})${ext}`;
    usedNames.add(name.toLowerCase());
    return name;
  };

  const list = [...urls];
  const files = [], failed = [];
  let next = 0, done = 0;
  const worker = async () => {
    while (next < list.length) {
      const url = list[next++];
      try {
        const res = await fetch(url); // usually served from the browser's cache
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!MEDIA_TYPE.test(type) && !hasMediaExt(url)) continue; // e.g. a font or a web page
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length < MIN_BYTES) continue;
        files.push({ name: uniqueName(url, type), bytes });
      } catch (err) {
        failed.push(`${url.slice(0, 300)}   (${err.message})`);
      } finally {
        done++;
        if (done % 10 === 0 || done === list.length) console.log(`  ${done}/${list.length}`);
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  const saved = files.length;
  if (!saved) {
    console.warn('Nothing could be downloaded. Failures:\n' + failed.join('\n'));
    return;
  }
  if (failed.length) {
    files.push({
      name: '_could-not-download.txt',
      bytes: new TextEncoder().encode(
        'These files were blocked (usually by CORS). Open each link in a new tab to save it by hand.\r\n\r\n' +
        failed.join('\r\n') + '\r\n'),
    });
  }

  // ---- 3. Pack into a .zip and save ------------------------------------------
  const zipName = `${location.hostname.replace(/^www\./, '') || 'page'}-media.zip`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(makeZip(files));
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);

  console.log(`Done: ${saved} files saved to ${zipName}` +
    (failed.length ? `. ${failed.length} were blocked; see _could-not-download.txt in the zip.` : '.'));

  // --- zip start ---
  // A minimal ZIP writer. Files are stored without compression, because
  // images and video are already compressed and squeezing them again gains nothing.
  function makeZip(files) {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    const crc32 = (bytes) => {
      let c = 0xFFFFFFFF;
      for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
      return (c ^ 0xFFFFFFFF) >>> 0;
    };
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;

    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.bytes), size = f.bytes.length;

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); // local file header signature
      local.setUint16(4, 20, true);         // version needed
      local.setUint16(6, 0x0800, true);     // flag: file names are UTF-8
      local.setUint16(8, 0, true);          // method: stored
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);      // compressed size
      local.setUint32(22, size, true);      // uncompressed size
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);         // extra field length
      parts.push(local, name, f.bytes);

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);    // central directory signature
      cd.setUint16(4, 20, true);            // version made by
      cd.setUint16(6, 20, true);            // version needed
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, time, true);
      cd.setUint16(14, date, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, size, true);
      cd.setUint32(24, size, true);
      cd.setUint16(28, name.length, true);
      // bytes 30-41 (extra, comment, disk, attributes) stay 0
      cd.setUint32(42, offset, true);       // where this file's local header starts
      central.push(cd, name);

      offset += 30 + name.length + size;
    }

    const cdSize = central.reduce((s, p) => s + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);     // end of central directory signature
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }
  // --- zip end ---
})();
