// Incrementally merge Saatchi's newest works into the public zalans.com feed.
// The listing is a client-rendered page: read its embedded JSON, not <figure> tags.
import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = 'https://ilgvzal-wq.github.io/zalans-saatchi-sync';
const SOURCE = 'https://www.saatchiart.com/account/artworks/6161';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const inches = cm => Math.round(cm / 2.54 * 10) / 10;

export function pageData(html) {
  const script = html.match(/<script\b(?=[^>]*\bid=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/i);
  if (!script) throw new Error('Saatchi embedded JSON missing; existing feed retained.');
  const data = JSON.parse(script[1])?.props?.pageProps?.initialState?.page?.data;
  if (!data) throw new Error('Saatchi data schema changed; existing feed retained.');
  return data;
}

export function parseListing(html) {
  const account = pageData(html).accountData;
  if (String(account?.userId) !== '6161' || !account?.artworks?.length) {
    throw new Error('Artist listing missing or empty; existing feed retained.');
  }
  // Saatchi currently returns the newest 15 works, ignoring perPage=100.
  // Preserve older entries: absence from this window never means sold/deleted.
  return account.artworks.map(a => {
    if (!/^\d+$/.test(String(a.artworkID)) || !a.title || !a.pdpUrl?.startsWith('/art/')) {
      throw new Error('Invalid artwork listing; existing feed retained.');
    }
    return { id: String(a.artworkID), url: new URL(a.pdpUrl, SOURCE).href };
  });
}

export function parseArtwork(html, id) {
  const data = pageData(html);
  const a = data.artwork;
  const pdp = data.pdpArtwork;
  if (String(a?.artworkId) !== id || String(a?.userId) !== '6161') {
    throw new Error(`Artwork identity mismatch for ${id}`);
  }
  // Use Saatchi's explicit US price; no guessed currency conversion.
  const cents = pdp?.geoPricesInCents?.US ?? a.products?.find(p => p.original)?.original?.listPrices?.US;
  const status = pdp?.originalArtworkStatus;
  if (!['avail', 'sold', 'not_for_sale'].includes(status)) throw new Error(`Unknown status for ${id}: ${status}`);
  const image = a.artworkImage?.imageUrl;
  if (!a.title || !(a.width > 0) || !(a.height > 0) || !image || !(a.yearProduced > 1900) || (status === 'avail' && !(cents > 0))) {
    throw new Error(`Incomplete artwork data for ${id}`);
  }
  return {
    id, title: a.title, priceUsd: cents > 0 ? Math.round(cents / 100) : null,
    widthCm: a.width, heightCm: a.height, widthIn: inches(a.width), heightIn: inches(a.height),
    medium: (a.mediums || []).join(' & '), material: (a.materials || []).join(' & '),
    available: status === 'avail', url: pdp.artworkOriginalUrl,
    image, year: a.yearProduced
  };
}

async function request(url, fetcher) {
  const r = await fetcher(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Saatchi request failed (${r.status}): ${url}; existing feed retained.`);
  return r;
}

export async function sync({ directory = 'docs', fetcher = fetch } = {}) {
  const output = path.join(directory, 'saatchi.json');
  // Missing/corrupt current data must never silently replace the catalogue.
  const current = JSON.parse(await readFile(output, 'utf8'));
  if (!Array.isArray(current.works) || !current.works.length) throw new Error('Existing feed invalid.');
  const listing = parseListing(await (await request(SOURCE, fetcher)).text());
  const known = new Map(current.works.map(w => [String(w.id), w]));
  const fresh = [];
  const images = [];
  for (const item of listing) {
    // Keep existing curated entries intact; import all newly discovered works.
    if (known.has(item.id)) continue;
    const work = parseArtwork(await (await request(item.url, fetcher)).text(), item.id);
    const imagePath = path.join(directory, 'images', `${item.id}.jpg`);
    try { await access(imagePath); }
    catch {
      const r = await request(work.image, fetcher);
      const bytes = Buffer.from(await r.arrayBuffer());
      if (!r.headers.get('content-type')?.startsWith('image/') || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
        throw new Error(`Invalid JPEG for ${item.id}; existing feed retained.`);
      }
      images.push({ imagePath, bytes });
    }
    work.image = `${BASE}/images/${item.id}.jpg`;
    fresh.push(work);
  }
  if (!fresh.length) { console.log('No new artworks; feed unchanged.'); return current; }
  // Fetch/validate everything before writing. A block or schema error keeps the feed.
  await mkdir(path.join(directory, 'images'), { recursive: true });
  for (const { imagePath, bytes } of images) await writeFile(imagePath, bytes);
  const works = [...fresh, ...current.works];
  const next = { ...current, updated: new Date().toISOString(), source: 'saatchiart.com/zalans', total: works.length, works };
  await writeFile(output + '.tmp', JSON.stringify(next, null, 2) + '\n');
  await rename(output + '.tmp', output);
  console.log(`Added ${fresh.map(w => w.title).join(', ')}; retained ${current.works.length} existing artworks.`);
  return next;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  sync().catch(error => { console.error(error.message); process.exitCode = 1; });
}
