const MAJOR_NAMES = new Map([
  ["FOOL", "愚者"], ["MAGICIAN", "魔術師"], ["HIGH PRIESTESS", "女祭司"],
  ["EMPRESS", "皇后"], ["EMPEROR", "皇帝"], ["HIEROPHANT", "教皇"],
  ["LOVERS", "戀人"], ["CHARIOT", "戰車"], ["STRENGTH", "力量"],
  ["HERMIT", "隱者"], ["WHEEL OF FORTUNE", "命運之輪"], ["JUSTICE", "正義"],
  ["HANGED MAN", "倒吊人"], ["DEATH", "死神"], ["TEMPERANCE", "節制"],
  ["DEVIL", "惡魔"], ["TOWER", "高塔"], ["STAR", "星星"], ["MOON", "月亮"],
  ["SUN", "太陽"], ["JUDGEMENT", "審判"], ["JUDGMENT", "審判"], ["WORLD", "世界"],
]);
const SUIT_NAMES = new Map([
  ["WANDS", "權杖"], ["CUPS", "聖杯"], ["SWORDS", "寶劍"],
  ["PENTACLES", "錢幣"], ["COINS", "錢幣"],
]);
const RANK_NAMES = new Map([
  ["ACE", "王牌"], ["ONE", "王牌"], ["1", "王牌"],
  ...["TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN"]
    .flatMap((rank, index) => [[rank, String(index + 2)], [String(index + 2), String(index + 2)]]),
  ["PAGE", "侍者"], ["KNIGHT", "騎士"], ["QUEEN", "皇后"], ["KING", "國王"],
]);
const CHINESE_NUMBERS = new Map([
  ["一", "王牌"], ["二", "2"], ["三", "3"], ["四", "4"], ["五", "5"],
  ["六", "6"], ["七", "7"], ["八", "8"], ["九", "9"], ["十", "10"],
]);

const clean = (value) => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
const key = (value) => clean(value).replace(/\s+/g, " ").toUpperCase();
const placeholder = (value) => /^(?:CARD|卡牌|牌卡)(?:[\s#:_-]*\d+)?$/i.test(value) || /^(?:未命名|未命名牌卡|UNKNOWN|UNTITLED)$/i.test(value);

function chineseDisplayName(value) {
  // Only canonical suit + number labels are reformatted; custom deck titles stay intact.
  return value.replace(/^(權杖|聖杯|寶劍|錢幣)([一二三四五六七八九十])(?:\s*([AB]))?$/, (_, suit, rank, variant) =>
    `${suit}${CHINESE_NUMBERS.get(rank)}${variant ? ` ${variant}` : ""}`);
}

/** Return a Chinese-first label without inferring identity from the card's array index. */
export function getCardDisplayName(card) {
  if (!card || typeof card !== "object") return "未命名牌卡";
  const chinese = [card.nameZh, card.name_zh, card.title_zh, card.label_zh]
    .map(clean).find((name) => /\p{Script=Han}/u.test(name) && !placeholder(name));
  if (chinese) return chineseDisplayName(chinese);

  const original = clean(card.name ?? card.title ?? card.name_en ?? card.label);
  const english = key(original);
  const major = MAJOR_NAMES.get(english.replace(/^THE /, ""));
  if (major) return major;
  const minor = english.match(/^(.+?) OF (WANDS|CUPS|SWORDS|PENTACLES|COINS)$/);
  if (minor && RANK_NAMES.has(minor[1])) return `${SUIT_NAMES.get(minor[2])}${RANK_NAMES.get(minor[1])}`;

  // Unknown named cards may carry standard-looking fallback metadata. Do not rename them.
  if (original && !placeholder(original)) return original;
  const suit = SUIT_NAMES.get(key(card.suit));
  const rank = RANK_NAMES.get(key(card.rank));
  if (suit && rank) return `${suit}${rank}`;
  const majorId = clean(card.id).match(/^major-\d+-(.+)$/i);
  if (majorId) {
    const fromId = MAJOR_NAMES.get(key(majorId[1].replace(/-/g, " ")).replace(/^THE /, ""));
    if (fromId) return fromId;
  }
  return original || "未命名牌卡";
}
