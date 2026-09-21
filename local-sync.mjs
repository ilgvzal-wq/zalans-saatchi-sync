// local-sync.mjs
// Runs on YOUR computer to sync new Saatchi Art uploads to zalans.com's data feed.
// It does NOT run in the cloud, so it uses your own internet connection like a normal browser visit.
// It also downloads each new artwork's image and stores its own copy in this repo
// (docs/images/), so zalans.com never has to hotlink Saatchi's image servers.

import * as cheerio from 'cheerio';
import fs from 'fs';

const OWNER = 'ilgvzal-wq';
const REPO = 'zalans-saatchi-sync';
const JSON_PATH = 'docs/saatchi.json';
const BRANCH = 'main';
const ARTIST_URL = 'https://www.saatchiart.com/account/artworks/6161?perPage=100';
const PAGES_BASE = 'https://' + OWNER + '.github.io/' + REPO;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function readToken() {
        if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
        try {
                  return fs.readFileSync(new URL('./token.txt', import.meta.url), 'utf-8').trim();
        } catch (e) {
                  return null;
        }
}

function ghHeaders(token, extra) {
        return Object.assign({ Authorization: 'token ' + token, 'User-Agent': 'zalans-local-sync' }, extra || {});
}

async function getFile(token, path) {
        const url = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + path + '?ref=' + BRANCH;
        const res = await fetch(url, { headers: ghHeaders(token) });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error('Failed to fetch ' + path + ': ' + res.status);
        return res.json();
}

async function putFile(token, path, contentBuffer, message, sha) {
        const url = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + path;
        const body = { message: message, content: contentBuffer.toString('base64'), branch: BRANCH };
        if (sha) body.sha = sha;
        const res = await fetch(url, {
                  method: 'PUT',
                  headers: ghHeaders(token, { 'Content-Type': 'application/json' }),
                  body: JSON.stringify(body)
        });
        if (!res.ok) {
                  const t = await res.text();
                  throw new Error('Failed to write ' + path + ': ' + res.status + ' ' + t);
        }
        return res.json();
}

function cmToIn(cm) {
        return cm ? Math.round((cm / 2.54) * 10) / 10 : null;
}

function betterImage(url) {
        // Saatchi serves several pre-generated sizes of the same photo, named
  // "<hash>-<N>.jpg". The listing API gives a small thumbnail (N=6); "-7"
  // is a much larger rendition of the exact same file, so we just swap it.
  if (!url) return url;
        return url.replace(/-\d+\.jpg(\?.*)?$/, '-7.jpg');
}

async function fetchListing() {
        // The artist's "manage artworks" page is a client-rendered app: the raw
  // HTML it sends has no <figure>/<a> tags to scrape (they only appear
  // after JavaScript runs in a real browser). The same data is embedded
  // as JSON in a <script id="__NEXT_DATA__"> tag though, so we read that
  // directly instead of trying to parse rendered markup that isn't there.
  const res = await fetch(ARTIST_URL, { headers: { 'User-Agent': UA } });
        if (!res.ok) throw new Error('Failed to fetch Saatchi listing: ' + res.status);
        const html = await res.text();

  const marker = '__NEXT_DATA__" type="application/json">';
        const start = html.indexOf(marker);
        if (start === -1) {
                  throw new Error('Could not find artwork data on the Saatchi page (its layout may have changed).');
        }
        const jsonStart = start + marker.length;
        const jsonEnd = html.indexOf('</script>', jsonStart);
        const data = JSON.parse(html.slice(jsonStart, jsonEnd));

  const accountData = data && data.props && data.props.pageProps &&
            data.props.pageProps.initialState && data.props.pageProps.initialState.page &&
            data.props.pageProps.initialState.page.data && data.props.pageProps.initialState.page.data.accountData;
        const artworks = (accountData && accountData.artworks) || [];

  return artworks.map(function (a) {
            return {
                        id: String(a.artworkID),
                        title: a.title,
                        priceUsd: a.listPrice ? Math.round(a.listPrice / 100) : null,
                        widthCm: a.widthInCentimeters || null,
                        heightCm: a.heightInCentimeters || null,
                        medium: (a.mediums || []).join(' & ') || null,
                        material: (a.materials || []).join(' & ') || null,
                        available: a.originalStatus === 'avail',
                        image: betterImage(a.artworkImage),
                        url: 'https://www.saatchiart.com' + a.pdpUrl
            };
  });
}

async function fetchYear(url) {
        // Unlike the listing page, an individual artwork's own page IS rendered
  // server-side, so this plain fetch + cheerio approach works fine here.
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
        if (!res.ok) return null;
        const html = await res.text();
        const $ = cheerio.load(html);
        const text = $('body').text().replace(/\s+/g, ' ');
        const yearMatch = text.match(/Year Created:\s*(\d{4})/i);
        return yearMatch ? parseInt(yearMatch[1], 10) : null;
}

async function main() {
        const token = readToken();
        if (!token) {
                  console.error('KĻŪDA: nav atrasts GitHub tokens. Skaties SETUP_LV.md, solis C un D.');
                  process.exit(1);
        }

  console.log('Lasu pašreizējo saatchi.json no GitHub...');
        const current = await getFile(token, JSON_PATH);
        const currentJson = current
          ? JSON.parse(Buffer.from(current.content, 'base64').toString('utf-8'))
                  : { works: [] };
        const knownIds = new Set(currentJson.works.map(function (w) { return w.id; }));

  console.log('Skatos Saatchi Art profilu...');
        const listing = await fetchListing();

  const newItems = listing.filter(function (w) { return !knownIds.has(w.id); });
        if (newItems.length === 0) {
                  console.log('Nekas jauns. Viss jau ir zalans.com.');
                  return;
        }
        console.log('Atradu ' + newItems.length + ' jaunu darbu(s): ' + newItems.map(function (w) { return w.title; }).join(', '));

  for (const item of newItems) {
            console.log('Apstrādāju: ' + item.title);
            const year = await fetchYear(item.url);

          let imageUrl = item.image;
            if (item.image) {
                        console.log('  Lejupielādēju attēlu...');
                        try {
                                      const imgRes = await fetch(item.image, { headers: { 'User-Agent': UA } });
                                      if (imgRes.ok) {
                                                      const buf = Buffer.from(await imgRes.arrayBuffer());
                                                      const imgPath = 'docs/images/' + item.id + '.jpg';
                                                      await putFile(token, imgPath, buf, 'Add image for ' + item.title);
                                                      imageUrl = PAGES_BASE + '/images/' + item.id + '.jpg';
                                                      console.log('  Attēls saglabāts: ' + imageUrl);
                                      } else {
                                                      console.log('  BRĪDINĀJUMS: neizdevās lejupielādēt attēlu (' + imgRes.status + '), pagaidām izmantoju Saatchi saiti tieši.');
                                      }
                        } catch (e) {
                                      console.log('  BRĪDINĀJUMS: attēla lejupielāde neizdevās (' + e.message + '), pagaidām izmantoju Saatchi saiti tieši.');
                        }
            }

          currentJson.works.unshift({
                      id: item.id,
                      title: item.title,
                      priceUsd: item.priceUsd,
                      widthCm: item.widthCm,
                      heightCm: item.heightCm,
                      widthIn: cmToIn(item.widthCm),
                      heightIn: cmToIn(item.heightCm),
                      medium: item.medium,
                      material: item.material,
                      available: item.available,
                      url: item.url,
                      image: imageUrl,
                      year: year
          });
  }

    currentJson.updated = new Date().toISOString();
        currentJson.source = 'saatchiart.com/zalans';
        currentJson.total = currentJson.works.length;

    console.log('Saglabaju atjauninato saatchi.json...');
        const newContent = Buffer.from(JSON.stringify(currentJson, null, 2));
        const latest = await getFile(token, JSON_PATH);
        await putFile(token, JSON_PATH, newContent, 'Auto-update saatchi.json (+' + newItems.length + ')', latest ? latest.sha : undefined);

  console.log('GATAVS! Jaunie darbi paradisies zalans.com dazu minusu laika.');
}

main().catch(function (err) {
        console.error('KLUDA:', err.message);
        process.exit(1);
});
