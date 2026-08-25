import { readFileSync } from 'node:fs';

import { extractAbsoluteProgressions, normalizeProgressionSymbols } from '../lib/harmony/progression-detector.ts';

const OLD_CHORD_SOURCE = '[A-G](?:#|b)?(?:m7b5|maj(?:7|9)?|min(?:7)?|m(?:7|9)?|dim7?|°7?|ø7?|aug7?|\\+7?|7|Δ)?(?:\\/[A-G](?:#|b)?)?';
const OLD_PATTERN = new RegExp(`(${OLD_CHORD_SOURCE}(?:\\s*(?:—|–|-|→)\\s*${OLD_CHORD_SOURCE}){1,12})`, 'g');

function textBlocks(html) {
  return [...html.matchAll(/<(p|h[1-6])\b[^>]*>[\s\S]*?<\/\1>/gi)].map((match) => match[0]
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#x20;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim());
}

function oldAbsoluteProgressions(text) {
  const normalized = text.replaceAll('♯', '#').replaceAll('♭', 'b').replaceAll('–', '—')
    .replaceAll('→', '—').replace(/\s+/g, ' ').trim();
  const noteMotionContext = /(?:音阶|半音|旋律|低音|高音|音符|音程|上行|下行|从[A-G]|由[A-G])/.test(normalized);
  const progressionContext = /进行|终止|套路|序进|连接|循环|演奏|弹奏/.test(normalized);
  const progressions = [];
  for (const match of normalized.matchAll(OLD_PATTERN)) {
    const sequence = normalizeProgressionSymbols(match[1]).split('—');
    const hasChordQuality = sequence.some((token) => /(?:maj|min|m7b5|m|dim|°|ø|aug|\+|\d|Δ|\/[A-G])/.test(token));
    if (!hasChordQuality && (!progressionContext || noteMotionContext)) continue;
    progressions.push(sequence);
  }
  return progressions;
}

const results = [];
for (const volume of ['basic', 'advanced']) {
  const blocks = textBlocks(readFileSync(new URL(`../public/books/${volume}.html`, import.meta.url), 'utf8'));
  for (const [index, text] of blocks.entries()) {
    if (/^谱例\s*[0-9]/.test(text)) continue;
    const oldKeys = new Set(oldAbsoluteProgressions(text).map((sequence) => sequence.join('—')));
    const newKeys = new Set(extractAbsoluteProgressions(text).map((sequence) => sequence.join('—')));
    for (const progression of newKeys) {
      if (!oldKeys.has(progression)) results.push({ volume, block: index, progression, text });
    }
  }
}

console.log(JSON.stringify({ addedCount: results.length, added: results }, null, 2));
