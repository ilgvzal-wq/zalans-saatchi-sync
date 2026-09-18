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

function priceToUsd(text) {
      const currency = (text.match(/[€$£]/) || ['$'])[0];
      const numeric = parseFloat(text.replace(/[^0-9.]/g, ''));
      const rates = { '€': 1.09, '£': 1.27, '$': 1 };
      return Math.round(numeric * (rates[currency] || 1));
}

function cmToIn(cm) {
      return cm ? Math.round((cm / 2.54) * 10) / 10 : null;
}

async function fetchListing() {
            const res = await fetch(ARTIST_URL, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error('Failed to fetch Saatchi listing: ' + res.status);
      const html = await res.text();
      const $ = cheerio.load(html);
      const items = [];
      $('figure').each((i, el) => {
              const fig = $(el);
              const link = fig.find('a[href*="/art/"]').first();
              const href = link.attr('href');
              if (!href) return;
              const idMatch = href.match(/\/(\d+)\/view/);
              const id = idMatch ? idMatch[1] : null;
              if (!id) return;
              const figText = fig.text();
              let titleText = '';
              fig.find('a').each((j, a) => {
                        const t = $(a).text().trim();
                        if (!titleText && /".+"/.test(t)) titleText = t;
              });
              const titleMatch = titleText.match(/"([^"]+)"/);
              const title = titleMatch ? titleMatch[1] : '';
              if (!title) return;
              const priceMatch = figText.match(/[€$£][\d.,]+/);
              const priceUsd = priceMatch ? priceToUsd(priceMatch[0]) : null;
              const sizeMatch = figText.match(/(\d+)\s*x\s*(\d+)\s*cm/i);
              const widthCm = sizeMatch ? parseInt(sizeMatch[1]) : null;
              const heightCm = sizeMatch ? parseInt(sizeMatch[2]) : null;
              items.push({
                        id: id,
                        title: title,
                        priceUsd: priceUsd,
                        widthCm: widthCm,
                        heightCm: heightCm,
                        url: 'https://www.saatchiart.com' + href.split('?')[0]
              });
      });
      return items;
}

async function fetchDetail(url) {
      // Pulls the full-size image, year, medium and material straight from the
  // artwork's own page, which is more reliable than the listing thumbnail.
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) return {};
      const html = await res.text();
      const $ = cheerio.load(html);
      const ogImage = $('meta[property="og:image"]').attr('content') || null;

  const text = $('body').text().replace(/\s+/g, ' ');
      const yearMatch = text.match(/Year Created:\s*(\d{4})/i);
      const mediumsMatch = text.match(/Mediums:\s*([^]+?)(?:Need more information|Subject:|Styles:|ABOUT THE ARTIST)/i);

  let medium = null, material = null;
      if (mediumsMatch) {
              const parts = mediumsMatch[1].split(',').map(s => s.trim()).filter(Boolean);
              if (parts.length) {
                        material = parts[parts.length - 1];
                        medium = parts.slice(0, -1).join(' & ') || material;
              }
      }

  return {
          image: ogImage,
          year: yearMatch ? parseInt(yearMatch[1], 10) : null,
          medium: medium,
          material: material
  };
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
          const detail = await fetchDetail(item.url);

        let imageUrl = detail.image || null;
          if (detail.image) {
                    console.log('  Lejupielādēju attēlu...');
                    try {
                                const imgRes = await fetch(detail.image, { headers: { 'User-Agent': UA } });
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
                  medium: detail.medium || null,
                  material: detail.material || null,
                  available: true,
                  url: item.url,
                  image: imageUrl,
                  year: detail.year || null
        });
  }

    currentJson.updated = new Date().toISOString();

  currentJson.source = 'saatchiart.com/zalans';
      currentJson.total = currentJson.works.length;

  console.log('Saglabāju atjaunināto saatchi.json...');
      const newContent = Buffer.from(JSON.stringify(currentJson, null, 2));
      const latest = await getFile(token, JSON_PATH);
      await putFile(token, JSON_PATH, newContent, 'Auto-update saatchi.json (+' + newItems.length + ')', latest ? latest.sha : undefined);

  console.log('GATAVS! Jaunie darbi parādīsies zalans.com dažu minūšu laikā.');
}

main().catch(function (err) {
      console.error('KĻŪDA:', err.message);
      process.exit(1);
});
