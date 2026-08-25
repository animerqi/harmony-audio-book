const PROGRESSION_SEPARATOR_SOURCE = '(?:—|至|到)';
const ABSOLUTE_ROOT_SOURCE = '[A-G](?:#|b)?';
const ABSOLUTE_QUALITY_SOURCE = '(?:m7b5|maj(?:6|7|9|\\((?:6|7|9)\\))?|min(?:6|7|9|\\((?:6|7|9)\\))?|m(?:6|7|9|\\((?:6|7|9)\\))?|dim7?|°7?|ø7?|aug7?|\\+7?|sus(?:2|4)|add9|(?:6|7|9)|Δ(?:7|9)?|\\((?:6|7|9|Δ)\\))';

// Longer suffixes must precede shorter ones so a token such as Cmaj7 is
// consumed as a whole instead of being treated as the bare C prefix.
export const ABSOLUTE_CHORD_SOURCE = [
  ABSOLUTE_ROOT_SOURCE,
  `(?:${ABSOLUTE_QUALITY_SOURCE})?`,
  `(?:\\/${ABSOLUTE_ROOT_SOURCE})?`,
].join('');

export const ROMAN_TOKEN_SOURCE = '[#b]?\\s*(?:(?:Ger|Gr|Fr|It)\\+6|N6|k46|(?:vii|VII|vi|VI|v|V|iv|IV|iii|III|ii|II|i|I)(?:(?:°|ø|\\+)?(?:\\(?\\d{1,2}\\)?|Δ)?(?:\\/[#b]?(?:vii|VII|vi|VI|v|V|iv|IV|iii|III|ii|II|i|I))?))';

const ABSOLUTE_PATTERN = new RegExp(
  `(?<![A-Za-z0-9#b])(${ABSOLUTE_CHORD_SOURCE}(?:${PROGRESSION_SEPARATOR_SOURCE}${ABSOLUTE_CHORD_SOURCE}){1,12})(?![A-Za-z0-9#b])`,
  'g',
);

const ROMAN_PATTERN = new RegExp(
  `(?<![A-Za-z0-9#b])(${ROMAN_TOKEN_SOURCE}(?:${PROGRESSION_SEPARATOR_SOURCE}${ROMAN_TOKEN_SOURCE}){1,12})(?![A-Za-z0-9#b])`,
  'g',
);

const QUALIFIED_CHORD_PATTERN = new RegExp(`^${ABSOLUTE_ROOT_SOURCE}(?:${ABSOLUTE_QUALITY_SOURCE}|\\/${ABSOLUTE_ROOT_SOURCE})$`);
const NON_CHORD_PITCH_CONTEXT = /(?:音程|音阶|音名|音列|音集|旋律|低音|高音|音符|半音|全音|上行|下行|整数表示|转调|调号|路线|声部[^。；]{0,12}(?:构成|形成))/;
const STRONG_NOTE_LIST_CONTEXT = /(?:(?:包括|含有|构成|排列成|排成)[^。；]{0,20}(?:音|三度|四度|五度|六度|七度)|(?:三个|四个|五个|七个)音|音列为|调性[^。；]{0,16}(?:呈现|变化)|转调[^。；]{0,20}(?:路线|调号))/;
const PROGRESSION_LANGUAGE = /(?:进行|终止|连接|解决|套路|循环|演奏|弹奏)/;

export function normalizeProgressionSymbols(value: string) {
  return value
    .replaceAll('♯', '#')
    .replaceAll('♭', 'b')
    .replace(/[‐‑‒–−]/g, '—')
    .replaceAll('→', '—')
    .replace(/\s*(?:—|-)\s*/g, '—')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitNormalizedProgression(value: string) {
  return value.replace(/[至到]/g, '—').split('—').map((token) => token.trim()).filter(Boolean);
}

export function extractAbsoluteProgressions(value: string): string[][] {
  const normalized = normalizeProgressionSymbols(value);
  const progressions = [...normalized.matchAll(ABSOLUTE_PATTERN)].map((match) => splitNormalizedProgression(match[1]));
  const remainder = normalized.replace(ABSOLUTE_PATTERN, ' ');
  const symbolicRemainder = remainder
    .replace(/\b(?:vs\.?|versus)\b/gi, ' ')
    .replace(/(?:对比|比较|与|和|或)/g, ' ')
    .replace(/[\s.,，。;；:：/()（）[\]“”"'、]+/g, '');
  const isSymbolicBlock = symbolicRemainder.length === 0;
  const compactAsciiSeparators = /[A-G](?:[#b♯♭])?-[A-G]/.test(value) && !/[—–→]/.test(value);

  return progressions.filter((sequence) => {
    if (isSymbolicBlock) return true;
    const hasQualifiedChord = sequence.some((token) => QUALIFIED_CHORD_PATTERN.test(token));
    if (STRONG_NOTE_LIST_CONTEXT.test(normalized)) return false;
    if (compactAsciiSeparators && !PROGRESSION_LANGUAGE.test(normalized)) return false;
    if (NON_CHORD_PITCH_CONTEXT.test(normalized) && (!hasQualifiedChord || !PROGRESSION_LANGUAGE.test(normalized))) return false;
    if (hasQualifiedChord) return true;
    if (/[A-Za-z]{2,}/.test(remainder)) return false;
    return true;
  });
}

export function extractRomanProgressions(value: string): string[][] {
  const normalized = normalizeProgressionSymbols(value);
  return [...normalized.matchAll(ROMAN_PATTERN)].map((match) => splitNormalizedProgression(match[1]));
}
