// local-sync.mjs
// Runs on YOUR computer to sync new Saatchi Art uploads to zalans.com's data feed.
// It does NOT run in the cloud, so it uses your own internet connection like a normal browser visit.

import * as cheerio from 'cheerio';

const OWNER = 'ilgvzal-wq';
const REPO = 'zalans-saatchi-sync';
const FILE_PATH = 'docs/saatchi.json';
const BRANCH = 'main';
const ARTIST_URL = 'https://www.saatchiart.com/account/artworks/6161?perPage=100';

function readToken() {
    if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
    try {
          const fs = require('fs');
          return fs.readFileSync(new URL('./token.txt', import.meta.url), 'utf-8').trim();
    } catch (e) {
          return null;
    }
}

function priceToUsd(text) {
    const currency = (text.match(/[€$£]/) || ['$'])[0];
    const numeric = parseFloat(text.replace(/[^0-9.]/g, ''));
    const rates = { '€': 1.09, '£': 1.27, '$': 1 };
    return Math.round(numeric * (rates[currency] || 1));
}

async function fetchGitHubFile(token) {
  const url = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + FILE_PATH + '?ref=' + BRANCH;
  const res = await fetch(url, {
    headers: { Authorization: 'token ' + token, 'User-Agent': 'zalans-local-sync' }
  });
  if (!res.ok) throw new Error('Failed to fetch existing saatchi.json: ' + res.status);
  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return { json: JSON.parse(content), sha: data.sha };
}

async function fetchArtworks() {
  const res = await fetch(ARTIST_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
  if (!res.ok) throw new Error('Failed to fetch Saatchi Art page: ' + res.status);
  const html = await res.text();
  const $ = cheerio.load(html);
  const works = [];
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
    const mediumMatch = figText.match(/(Acrylic|Oil|Watercolor|Mixed Media|Spray Paint|Enamel)[^,\n]*/i);
    const medium = mediumMatch ? mediumMatch[0].trim().slice(0, 60) : '';
    const img = fig.find('img').first().attr('src') || fig.find('img').first().attr('data-src') || '';
    works.push({ id, title, priceUsd, widthCm, heightCm, medium, url: 'https://www.saatchiart.com' + href.split('?')[0], image: img });
  });
  return works;
}


async function updateGitHubFile(token, newJsonStr, sha, message) {
  const url = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + FILE_PATH;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: 'token ' + token, 'User-Agent': 'zalans-local-sync', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: Buffer.from(newJsonStr).toString('base64'), sha, branch: BRANCH })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('Failed to update saatchi.json: ' + res.status + ' ' + t);
  }
  return res.json();
}


async function main() {
  const token = readToken();
  if (!token) {
    console.error('ERROR: No GitHub token found. Put it in token.txt next to this script, or set GITHUB_TOKEN environment variable. See SETUP_LV.md');
    process.exit(1);
  }

console.log('Fetching current saatchi.json from GitHub...');
  const current_data = await fetchGitHubFile(token);
  const current = current_data.json;
  const sha = current_data.sha;
  const existingIds = new Set(current.works.map(w => String(w.id)));

console.log('Fetching your artworks from Saatchi Art...');
  const scraped = await fetchArtworks();
  const newWorks = scraped.filter(w => !existingIds.has(String(w.id)));

if (newWorks.length === 0) {
  console.log('No new artworks found. Nothing to do.');
  return;
}

console.log('Found ' + newWorks.length + ' new artwork(s):');
  newWorks.forEach(w => console.log(' - ' + w.title + ' (' + w.id + ')'));


const converted = newWorks.map(w => ({
  available: true,
  heightCm: w.heightCm,
  heightIn: w.heightCm ? Math.round(w.heightCm / 2.54 * 10) / 10 : null,
  id: String(w.id),
  image: w.image,
  material: 'Canvas',
  medium: w.medium,
  priceUsd: w.priceUsd,
  title: w.title,
  url: w.url,
  widthCm: w.widthCm,
  widthIn: w.widthCm ? Math.round(w.widthCm / 2.54 * 10) / 10 : null,
  year: new Date().getFullYear()
}));

current.works = [...converted, ...current.works];
  current.total = current.works.length;
  current.updated = new Date().toISOString();

const newJsonStr = JSON.stringify(current, null, 2);
  console.log('Pushing update to GitHub...');
  await updateGitHubFile(token, newJsonStr, sha, 'Add new artwork(s): ' + newWorks.map(w => w.title).join(', '));
  console.log('Done! zalans.com will show the new artwork(s) within a minute or two.');
}

main().catch(err => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});
