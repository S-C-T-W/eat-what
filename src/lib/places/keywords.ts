/**
 * Fine-grained cuisine/venue tags (OpenRice-style) that Google's Table A
 * types cannot express — 茶餐廳, 潮州菜, 點心, 火鍋, 放題… Each tag maps to a
 * Text Search (New) query, biased to the draw origin, merged with the
 * type-based Nearby results and deduped by place id.
 *
 * Curation: from the OpenRice taxonomy, keeping tags that (a) describe a
 * restaurant you'd draw for a meal and (b) return solid Text Search results
 * in HK. Dropped: non-dining venues (網吧/卡拉OK/販賣機/網店/到會), seasonal
 * one-offs (賀年食品/蛇羹/大閘蟹), certifications with no searchable term
 * (無翅), and anything the type-based tier already covers as a whole cuisine.
 *
 * Labels live in i18n (`kw.<id>`, groups `kwGroup.<id>`); queries here are
 * locale-tuned because 茶餐廳-style terms search best in Chinese while the
 * English UI wants romanized queries.
 */
export interface KeywordTag {
  id: string
  emoji: string
  /** Search queries per language family; `ja` only where the tag makes sense in Japan */
  q: { zh: string; en: string; ja?: string }
  /** Table A types that mean this tag — lets EXCLUSION catch places by type */
  types?: string[]
}

export interface KeywordGroup {
  id: string
  emoji: string
  tags: KeywordTag[]
}

/** Each selected tag costs one (cached) Text Search per draw — keep it tight. */
export const MAX_KEYWORD_TAGS = 3

export const KEYWORD_GROUPS: KeywordGroup[] = [
  {
    id: 'hk',
    emoji: '🇭🇰',
    tags: [
      { id: 'chaChaanTeng', emoji: '🍞', q: { zh: '茶餐廳', en: 'cha chaan teng' } },
      { id: 'daiPaiDong', emoji: '🍳', q: { zh: '大牌檔', en: 'dai pai dong' } },
      { id: 'twoDishRice', emoji: '🍱', q: { zh: '兩餸飯', en: 'two dish rice' } },
      { id: 'roastMeat', emoji: '🍗', q: { zh: '燒味 燒臘', en: 'hong kong roast meat siu mei' } },
      { id: 'congee', emoji: '🥣', q: { zh: '粥品 粥店', en: 'congee', ja: 'お粥' } },
      { id: 'dimSum', emoji: '🥟', q: { zh: '點心 飲茶', en: 'dim sum', ja: '点心 飲茶' } },
      { id: 'cartNoodle', emoji: '🛒', q: { zh: '車仔麵', en: 'cart noodles' } },
      { id: 'snackShop', emoji: '🍡', q: { zh: '小食店 街頭小食', en: 'hong kong street snacks' } },
    ],
  },
  {
    id: 'regional',
    emoji: '🀄',
    tags: [
      {
        id: 'chiuChow',
        emoji: '🦆',
        q: { zh: '潮州菜', en: 'chiu chow restaurant', ja: '潮州料理' },
      },
      { id: 'shunTak', emoji: '🐟', q: { zh: '順德菜', en: 'shunde restaurant' } },
      { id: 'hakka', emoji: '🍘', q: { zh: '客家菜', en: 'hakka restaurant', ja: '客家料理' } },
      {
        id: 'shanghainese',
        emoji: '🥠',
        q: { zh: '上海菜', en: 'shanghainese restaurant', ja: '上海料理' },
      },
      {
        id: 'sichuan',
        emoji: '🌶️',
        q: { zh: '川菜 四川菜', en: 'sichuan restaurant', ja: '四川料理' },
      },
      {
        id: 'hunan',
        emoji: '🥵',
        q: { zh: '湖南菜 湘菜', en: 'hunan restaurant', ja: '湖南料理' },
      },
      {
        id: 'beijing',
        emoji: '🏮',
        q: { zh: '北京菜 京菜', en: 'peking restaurant', ja: '北京料理' },
      },
      {
        id: 'northeastern',
        emoji: '❄️',
        q: { zh: '東北菜', en: 'dongbei northeastern chinese restaurant', ja: '中国東北料理' },
      },
      {
        id: 'xinjiang',
        emoji: '🍢',
        q: { zh: '新疆菜', en: 'xinjiang restaurant', ja: '新疆料理' },
      },
    ],
  },
  {
    id: 'jpkr',
    emoji: '🎌',
    tags: [
      { id: 'omakase', emoji: '🍣', q: { zh: '廚師發辦 omakase', en: 'omakase', ja: 'おまかせ' } },
      {
        id: 'ramen',
        emoji: '🍜',
        q: { zh: '拉麵', en: 'ramen', ja: 'ラーメン' },
        types: ['ramen_restaurant'],
      },
      { id: 'izakaya', emoji: '🏮', q: { zh: '居酒屋', en: 'izakaya', ja: '居酒屋' } },
      { id: 'yakiniku', emoji: '🥩', q: { zh: '日式燒肉', en: 'yakiniku', ja: '焼肉' } },
      { id: 'teppanyaki', emoji: '🔥', q: { zh: '鐵板燒', en: 'teppanyaki', ja: '鉄板焼き' } },
      {
        id: 'koreanFriedChicken',
        emoji: '🍗',
        q: { zh: '韓式炸雞', en: 'korean fried chicken', ja: '韓国チキン' },
      },
    ],
  },
  {
    id: 'hotpotGrill',
    emoji: '🫕',
    tags: [
      {
        id: 'hotpot',
        emoji: '🫕',
        q: { zh: '火鍋 打邊爐', en: 'hot pot', ja: '鍋料理 しゃぶしゃぶ 火鍋' },
      },
      { id: 'chickenPot', emoji: '🐔', q: { zh: '雞煲', en: 'chicken hot pot 雞煲' } },
      {
        id: 'skewers',
        emoji: '🍢',
        q: { zh: '串燒', en: 'skewers yakitori', ja: '焼き鳥 串焼き' },
      },
      {
        id: 'allYouCanEat',
        emoji: '🍽️',
        q: { zh: '放題 任食', en: 'all you can eat', ja: '食べ放題' },
      },
      { id: 'buffet', emoji: '🥂', q: { zh: '自助餐', en: 'buffet', ja: 'ビュッフェ バイキング' } },
    ],
  },
  {
    id: 'noodleWorks',
    emoji: '🍜',
    tags: [
      { id: 'riceNoodles', emoji: '🍜', q: { zh: '米線', en: 'mixian rice noodles' } },
      { id: 'wonton', emoji: '🥟', q: { zh: '雲吞麵', en: 'wonton noodles' } },
    ],
  },
  {
    id: 'special',
    emoji: '✨',
    tags: [
      { id: 'privateKitchen', emoji: '🔒', q: { zh: '私房菜', en: 'private kitchen' } },
      {
        id: 'fineDining',
        emoji: '🍾',
        q: { zh: 'fine dining 高級餐廳', en: 'fine dining', ja: '高級レストラン' },
      },
      {
        id: 'hotelDining',
        emoji: '🏨',
        q: { zh: '酒店餐廳', en: 'hotel restaurant', ja: 'ホテル レストラン' },
      },
      { id: 'curry', emoji: '🍛', q: { zh: '咖喱', en: 'curry restaurant', ja: 'カレー' } },
      {
        id: 'allDayBreakfast',
        emoji: '🍳',
        q: { zh: '全日早餐 all day breakfast', en: 'all day breakfast' },
      },
      {
        id: 'dessertSoup',
        emoji: '🍧',
        q: { zh: '糖水舖 中式甜品', en: 'chinese dessert soup tong sui' },
      },
      {
        id: 'halal',
        emoji: '☪️',
        q: { zh: '清真餐廳 halal', en: 'halal restaurant', ja: 'ハラール' },
      },
      {
        id: 'themed',
        emoji: '🎠',
        q: { zh: '主題餐廳', en: 'themed restaurant', ja: 'テーマレストラン' },
      },
      {
        id: 'kidFriendly',
        emoji: '👶',
        q: {
          zh: '親子餐廳',
          en: 'family friendly restaurant kids',
          ja: '子連れ ファミリーレストラン',
        },
      },
    ],
  },
]

const tagById = new Map<string, KeywordTag>(
  KEYWORD_GROUPS.flatMap((g) => g.tags).map((t) => [t.id, t]),
)

export function keywordTagById(id: string): KeywordTag | undefined {
  return tagById.get(id)
}

/** The Text Search query for a tag in the UI's language family. */
export function tagQuery(tag: KeywordTag, locale: string): string {
  if (locale.startsWith('zh')) return tag.q.zh
  if (locale === 'ja') return tag.q.ja ?? tag.q.en
  return tag.q.en
}

const stripPattern = /[\s·・,，。()（）【】\-–—'']/g

function normalized(s: string): string {
  return s.toLowerCase().replace(stripPattern, '')
}

const hasCjk = (s: string) => /[㐀-鿿]/.test(s)

/**
 * Does a place LOOK like this tag? Used by keyword EXCLUSION (opt-out), which
 * can't run a search — it matches by name terms, Table A types, and the
 * diner's own diary craving tags. Term rules guard against generic-word false
 * positives: the zh query splits into alternatives (火鍋／打邊爐), the en query
 * matches only as a whole compound ("hotpot", never "hot"). Heuristic by
 * nature: a hotpot place with an oblique name and no diary tag slips through —
 * that's the honest limit.
 */
export function matchesKeywordTag(
  place: { name: string; types: string[] },
  tag: KeywordTag,
  diaryKeywords?: readonly string[],
): boolean {
  if (diaryKeywords?.includes(tag.id)) return true
  if (tag.types?.some((t) => place.types.includes(t))) return true
  const name = normalized(place.name)
  const terms = [
    ...tag.q.zh.split(' ').map(normalized),
    normalized(tag.q.en),
    ...(tag.q.ja?.split(' ').map(normalized) ?? []),
  ]
  return terms
    .filter((term) => (hasCjk(term) ? term.length >= 2 : term.length >= 4))
    .some((term) => name.includes(term))
}
