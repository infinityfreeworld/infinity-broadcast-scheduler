/**
 * @module InfinityScheduler/Lib/PrononciationZh
 * @description Ce qu'une voix CHINOISE reçoit : sigles, chiffres et lettres latines rendus
 *   prononçables, à l'entrée des deux moteurs du chinois (voix clonée en `zh`, Kokoro).
 *
 *   🔴 04/10/2026 — « parfois les animateurs [de 自由之声] parlent étrangement, mais pas chinois ».
 *   Relevé dans les tours publiés : « 把AI改名SI », « Default Track 07 », « 65% », « 2.0 »,
 *   « 5G »… Kokoro SUPPRIME toute lettre latine (le pont Python ne traduisait qu'une vingtaine de
 *   sigles : « SI », « VIP », « GPS » disparaissaient) ; la voix clonée, elle, ne recevait AUCUNE
 *   adaptation et lisait les lettres latines avec une phonétique chinoise.
 *
 *   Règles, dans l'ordre :
 *     1. sigles et mots connus → leur nom chinois (même table que `scripts/kokoro-python.py`, plus
 *        les sigles relevés dans les émissions) ;
 *     2. nombres → chiffres chinois (« 2026年 » → « 二〇二六年 », « 65% » → « 百分之六十五 »,
 *        « 2.0 » → « 二点零 », « 07 » → « 零七 ») ;
 *     3. autre sigle en capitales (≤ 6 lettres) → épelé en chinois (« SI » → « 艾斯艾 »).
 *   Les mots latins en minuscules ne sont PAS traités ici : le contrôle de langue
 *   (`intrusionsLatines`) les fait réécrire par le modèle avant la synthèse.
 */

/** Sigles (sensibles à la casse : « IT » est un sigle, « it » n'en est pas un). */
const SIGLES: Record<string, string> = {
  AI: '人工智能', AGI: '通用人工智能', NGO: '非政府组织', CNN: '美国有线电视新闻网', BBC: '英国广播公司',
  UN: '联合国', EU: '欧盟', NATO: '北约', WHO: '世界卫生组织', IMF: '国际货币基金组织',
  WTO: '世界贸易组织', GDP: '国内生产总值', CEO: '首席执行官', USA: '美国', US: '美国', UK: '英国',
  IT: '信息技术', VPN: '虚拟专用网络', NASA: '美国国家航空航天局', FBI: '美国联邦调查局',
  CIA: '美国中央情报局', CNBC: '美国消费者新闻与商业频道', NFT: '非同质化代币',
  // Relevés dans les émissions publiées de 自由之声 (22/09 → 04/10/2026).
  VIP: '贵宾', GPS: '卫星定位', GPU: '图形处理器', CPU: '中央处理器', ISIS: '伊斯兰国',
  RFA: '自由亚洲电台', ATM: '自动取款机', HR: '人力资源', PPT: '幻灯片', LOGO: '标志',
  TV: '电视', DNA: '脱氧核糖核酸', APP: '应用程序',
}
/** Mots et marques, insensibles à la casse. */
const MOTS: Record<string, string> = {
  bitcoin: '比特币', blockchain: '区块链', internet: '互联网', app: '应用程序',
  google: '谷歌', facebook: '脸书', twitter: '推特', youtube: '油管', tiktok: '抖音国际版',
  instagram: '照片墙', linkedin: '领英', microsoft: '微软', apple: '苹果公司', tesla: '特斯拉',
  anthropic: '安思睿', openai: '开放人工智能', meta: '元宇宙公司', wifi: '无线网络',
}

/** Épellation chinoise usuelle des lettres latines. */
const LETTRES: Record<string, string> = {
  A: '诶', B: '比', C: '西', D: '迪', E: '伊', F: '艾弗', G: '吉', H: '艾尺', I: '艾', J: '杰',
  K: '开', L: '艾勒', M: '艾姆', N: '艾恩', O: '欧', P: '屁', Q: '丘', R: '阿尔', S: '艾斯',
  T: '提', U: '优', V: '维', W: '达布留', X: '艾克斯', Y: '歪', Z: '贼德',
}

const CHIFFRES = '零一二三四五六七八九'

/** Chiffres un par un (années, numéros commençant par 0). */
export function chiffresUnParUn(s: string): string {
  return [...s].map(c => c === '0' ? '〇' : CHIFFRES[Number(c)]).join('')
}

function sousDixMille(n: number): string {
  const unites = ['', '十', '百', '千']
  const d = String(n).split('').map(Number)
  let res = ''
  let zero = false
  for (let i = 0; i < d.length; i++) {
    const p = d.length - 1 - i
    if (d[i] === 0) { zero = res.length > 0; continue }
    if (zero) { res += '零'; zero = false }
    res += CHIFFRES[d[i]] + unites[p]
  }
  return res
}

/** Entier → chiffres chinois (« 10 » → « 十 », « 1005 » → « 一千零五 », « 120000 » → « 十二万 »). */
export function nombreChinois(n: number): string {
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return String(n)
  if (n === 0) return '零'
  if (n >= 1e16) return chiffresUnParUn(String(n))
  const groupes: number[] = []
  let x = n
  while (x > 0) { groupes.push(x % 10000); x = Math.floor(x / 10000) }
  const noms = ['', '万', '亿', '万亿']
  let res = ''
  for (let g = groupes.length - 1; g >= 0; g--) {
    const v = groupes[g]
    if (v === 0) { if (res && !res.endsWith('零')) res += '零'; continue }
    if (res && v < 1000 && !res.endsWith('零')) res += '零'
    res += sousDixMille(v) + noms[g]
  }
  res = res.replace(/零+$/, '')
  // « 一十二 » → « 十二 » en tête (10-19).
  return res.startsWith('一十') ? res.slice(1) : res
}

/** Un nombre écrit (« 65 », « 07 », « 2.0 », « 1,000,001 ») → sa lecture chinoise. */
function lireNombre(brut: string): string {
  const s = brut.replace(/,(?=\d{3}\b)/g, '')
  const [ent, dec] = s.split('.')
  const entier = ent.length > 1 && ent.startsWith('0') ? chiffresUnParUn(ent).replace(/〇/g, '零') : nombreChinois(Number(ent))
  return dec !== undefined && dec !== '' ? `${entier}点${chiffresUnParUn(dec).replace(/〇/g, '零')}` : entier
}

/**
 * Texte prêt pour une voix chinoise. Pure ; sans effet sur un texte sans chiffres ni lettres latines.
 */
export function textePourVoixChinoise(texte: string): string {
  let t = texte
  // 1. Sigles et mots connus (un jeton latin entier, éventuellement suivi d'un chiffre : « 5G » reste à l'étape 2).
  t = t.replace(/[A-Za-z]+/g, m => SIGLES[m] ?? MOTS[m.toLowerCase()] ?? m)
  // 2. Nombres.
  t = t.replace(/(\d{4})(?=\s*年)/g, (_m, a: string) => chiffresUnParUn(a))
  t = t.replace(/(\d+(?:[.,]\d+)*)\s*[%％]/g, (_m, n: string) => `百分之${lireNombre(n.replace(/,(?=\d{3}\b)/g, ''))}`)
  t = t.replace(/\d+(?:,\d{3})*(?:\.\d+)?/g, m => lireNombre(m))
  // 3. Sigles restants en capitales → épelés.
  t = t.replace(/(?<![A-Za-z])[A-Z]{1,6}(?![A-Za-z])/g, m => [...m].map(c => LETTRES[c] ?? c).join(''))
  return t
}
