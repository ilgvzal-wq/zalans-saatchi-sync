// scripts/scrape.mjs
// Scrapes the public Saatchi Art "all artworks" listing for artist Ilgvars
// Zalans (profile id 6161) and writes a JSON feed consumed by zalans.com.
//
// Saatchi Art renders prices in the visitor's local currency based on
// geolocation. GitHub Actions runners are US-hosted, so this should see
// USD prices directly. A fallback conversion is applied if another
// currency is detected, and the raw currency/amount are kept for reference.

import * as cheerio from "cheerio";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ARTIST_ID = "6161";
const SOURCE_URL = `https://www.saatchiart.com/account/artworks/${ARTIST_ID}?perPage=100`;
const OUTPUT_PATH = path.join("docs", "saatchi.json");
const FALLBACK_RATES = { EUR: 1.09, GBP: 1.27, USD: 1 };

async function fetchHtml(url) {
    const res = await fetch(url, {
          headers: {
                  "User-Agent":
                    "Mozilla/5.0 (compatible; ZalansSaatchiSync/1.0; +https://github.com/ilgvzal-wq/zalans-saatchi-sync)",
                  "Accept-Language": "en-US,en;q=0.9",
          },
    });
    if (!res.ok) {
          throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    }
    return res.text();
}

function parsePrice(text) {
    const match = text.match(/([\u20ac$\u00a3])\s?([\d.,]+)/);
    if (!match) return null;
    const symbolMap = { "$": "USD", "\u20ac": "EUR", "\u00a3": "GBP" };
    const currency = symbolMap[match[1]] || "USD";
    const amount = parseFloat(match[2].replace(/,/g, ""));
    const rate = FALLBACK_RATES[currency] ?? 1;
    return { amount, currency, priceUsd: Math.round(amount * rate) };
}

function extractIdFromUrl(url) {
    const match = url.match(/\/(\d+)\/view/);
    return match ? match[1] : null;
}


function parseCard($, el) {
    const $el = $(el);
    const link = $el.find('a[href*="/art/"]').first();
    const href = link.attr("href");
    if (!href) return null;

  const id = extractIdFromUrl(href);
    if (!id) return null;

  const texts = $el
      .find("p, span, a")
      .map((i, node) => $(node).text().trim())
      .get()
      .filter(Boolean);

  const priceText = texts.find((t) => /[\u20ac$\u00a3]\s?[\d.,]+/.test(t));
    const titleText = texts.find((t) => /^".+"/.test(t));
    const sizeText = texts.find((t) => /\d+(\.\d+)?\s*x\s*\d+(\.\d+)?\s*cm/i.test(t));
    const mediumText = texts.find(
          (t) =>
                  t !== priceText &&
                  t !== titleText &&
                  t !== sizeText &&
                  !/^Prints From/i.test(t) &&
                  !/^Ready to hang/i.test(t) &&
                  t.length > 0
        );

  if (!priceText || !titleText || !sizeText) return null;

  const price = parsePrice(priceText);
    const titleMatch = titleText.match(/^"(.+)"\s*(.*)$/);
    const title = titleMatch ? titleMatch[1] : titleText;
    const category = titleMatch ? titleMatch[2].trim() : null;

  const sizeMatch = sizeText.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*cm/i);
    const widthCm = sizeMatch ? parseFloat(sizeMatch[1]) : null;
    const heightCm = sizeMatch ? parseFloat(sizeMatch[2]) : null;

  const img = $el.find("img").first();
    const imageSrc = img.attr("src") || img.attr("data-src") || null;

  return {
        id,
        title,
        category,
        priceUsd: price ? price.priceUsd : null,
        priceRaw: price ? price.amount : null,
        priceCurrency: price ? price.currency : null,
        widthCm,
        heightCm,
        widthIn: widthCm ? Math.round((widthCm / 2.54) * 10) / 10 : null,
        heightIn: heightCm ? Math.round((heightCm / 2.54) * 10) / 10 : null,
        medium: mediumText || null,
        available: true,
        url: href,
        sourceImage: imageSrc,
  };
}

async function main() {
    const html = await fetchHtml(SOURCE_URL);
    const $ = cheerio.load(html);

  const seen = new Set();
    const works = [];

  $("figure").each((i, el) => {
        const $el = $(el);
        if (!$el.find('a[href*="/art/"]').length) return;
        if (!$el.find("img").length) return;
        const parsed = parseCard($, el);
        if (parsed && !seen.has(parsed.id)) {
                seen.add(parsed.id);
                works.push(parsed);
        }
  });

  if (works.length === 0) {
        throw new Error(
                "No artworks parsed - Saatchi Art page structure may have changed, or the page could not be read without a login session."
              );
  }

  const output = {
        updated: new Date().toISOString(),
        source: `saatchiart.com/account/artworks/${ARTIST_ID}`,
        total: works.length,
        works,
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
    console.log(`Wrote ${works.length} works to ${OUTPUT_PATH}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

});
