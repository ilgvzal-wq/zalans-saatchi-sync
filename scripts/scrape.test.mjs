import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseListing, parseArtwork, sync } from './scrape.mjs';
const wrap = data => `<script type="application/json" id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{initialState:{page:{data}}}}})}</script>`;
const url = 'https://www.saatchiart.com/art/Painting-Threshold/6161/14369187/view';
const image = 'https://images.saatchiart.com/saatchi/6161/art/14369187/test-7.jpg';
const listing = wrap({accountData:{userId:6161,artworks:[{artworkID:'14369187',title:'Threshold',pdpUrl:new URL(url).pathname}]}});
const detail = wrap({artwork:{artworkId:14369187,userId:6161,title:'Threshold',width:100,height:140,yearProduced:2026,mediums:['Acrylic','Spray Paint'],materials:['Canvas'],artworkImage:{imageUrl:image}},pdpArtwork:{geoPricesInCents:{US:569000,EU1C:561000},originalArtworkStatus:'avail',artworkOriginalUrl:url}});
const current = {total:1,works:[{id:'older',title:'Keep older work',image:'preserve.jpg'}]};
const fetcher = async u => u === image ? new Response(new Uint8Array([0xff,0xd8,0xff,0xd9]),{headers:{'content-type':'image/jpeg'}}) : new Response(u === url ? detail : listing);
async function sandbox(fn) {
 const directory=await mkdtemp(path.join(tmpdir(),'saatchi-test-'));
 await writeFile(path.join(directory,'saatchi.json'),JSON.stringify(current));
 try { await fn(directory); } finally { await rm(directory,{recursive:true,force:true}); }
}
test('JSON parsing is independent of script attribute order; prices use US data',()=>{
 assert.equal(parseListing(listing)[0].id,'14369187');
 const w=parseArtwork(detail,'14369187');
 assert.equal(w.priceUsd,5690);assert.equal(w.widthCm,100);assert.equal(w.heightCm,140);assert.equal(w.year,2026);
 assert.throws(()=>parseListing('<html>Blocked</html>'));
 assert.throws(()=>parseArtwork(detail,'12345'));
});
test('new work includes image; older entries survive the limited listing; repeat run is idempotent',()=>sandbox(async directory=>{
 const first=await sync({directory,fetcher});assert.equal(first.total,2);assert.deepEqual(first.works[1],current.works[0]);
 assert.match(first.works[0].image,/\/images\/14369187.jpg$/);
 assert.equal((await readFile(path.join(directory,'images/14369187.jpg')))[0],0xff);
 const before=await readFile(path.join(directory,'saatchi.json'),'utf8');
 await sync({directory,fetcher});assert.equal(await readFile(path.join(directory,'saatchi.json'),'utf8'),before);
}));
test('HTTP failure, malformed detail and invalid image leave feed unchanged',()=>sandbox(async directory=>{
 const file=path.join(directory,'saatchi.json');const before=await readFile(file,'utf8');
 for(const bad of [async()=>new Response('Blocked',{status:403}),async u=>new Response(u===url?'<html>bad</html>':listing),async u=>u===image?new Response('not an image'):fetcher(u)]){
  await assert.rejects(sync({directory,fetcher:bad}));assert.equal(await readFile(file,'utf8'),before);
 }
}));
