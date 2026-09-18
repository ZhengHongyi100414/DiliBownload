// DiliBownload backend unit tests (node:test). No network calls; pure functions only.
// Run with: npm test
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const wbiMod = await import(pathToFileURL(path.join(ROOT, 'src', 'wbi.js')).href);
const videoMod = await import(pathToFileURL(path.join(ROOT, 'src', 'video.js')).href);

test('WBI: adds wts and a 32-hex w_rid', () => {
  const signed = wbiMod.encodeWbi({ bvid: 'BV1U7V66FEiK', cid: 123, qn: 127 }, 'aaaaaaaabbbbbbbbccccccccdddddddd', '00000000111111112222222233333333', 1700000000);
  assert.equal(signed.wts, '1700000000');
  assert.match(signed.w_rid, /^[0-9a-f]{32}$/);
});

test('WBI: parametersToQuery encodes values', () => {
  assert.equal(wbiMod.parametersToQuery({ a: '1 2', b: 'x+y' }), 'a=1+2&b=x%2By');
});

test('WBI: extractKeyFromUrl strips path/query/extension', () => {
  const url = 'https://i0.hdslb.com/bfs/wbi/wbi/7cd084941338484aae1ad9425b84077c.png';
  assert.equal(wbiMod.extractKeyFromUrl(url), '7cd084941338484aae1ad9425b84077c');
  const q = 'https://x.com/a/b/abcdef1234567890abcdef1234567890.png?t=1';
  assert.equal(wbiMod.extractKeyFromUrl(q), 'abcdef1234567890abcdef1234567890');
});

test('WBI: isValidKey enforces length 32 alnum', () => {
  assert.equal(wbiMod.isValidKey('7cd084941338484aae1ad9425b84077c'), true);
  assert.equal(wbiMod.isValidKey('short'), false);
});

test('parseInput: supports BV url, bare BV, av+aid, solo digits', () => {
  assert.equal(videoMod.parseInput('https://www.bilibili.com/video/BV1U7V66FEiK').bvid, 'BV1U7V66FEiK');
  assert.equal(videoMod.parseInput('BV1U7V66FEiK').bvid, 'BV1U7V66FEiK');
  assert.equal(videoMod.parseInput('https://www.bilibili.com/video/av969147110').aid, '969147110');
  assert.equal(videoMod.parseInput('969147110').aid, '969147110');
});

test('parseInput: rejects garbage', () => {
  assert.throws(() => videoMod.parseInput('hello world'), /无法|未找到|请输入/);
});