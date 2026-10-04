/**
 * 自由之声 (135,9 MHz, `zi-you-zhi-sheng`) : « parfois les animateurs parlent étrangement, mais
 * pas chinois » (Bâtisseur, 04/10/2026). Les phrases ci-dessous sont des tours RÉELS des émissions
 * publiées (kind 30093) du 22/09 au 04/10/2026.
 *
 * Lancer :  npx tsx --test src/lib/__tests__/langue-chinois.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { horsLangue, intrusionsLatines, garantirLangue, demandeReecriture } from '../langue-station'
import { textePourVoixChinoise, nombreChinois } from '../prononciation-zh'
import { decouperTexte, maxCaracteres } from '../chatterbox'
import { consigneTour } from '../consignes-tour'

test('⭐ un tour chinois réel passe, sigles et noms propres compris', () => {
  for (const t of [
    '大家好，这里是自由之声——中文独立新闻台，我是美琳。',
    '结果对面坐的中国AI模型「月之暗面Kimi」倒是大方，教人家直接造生化武器。',
    '就是几个倒霉蛋半夜跑错片区，结果被当成了“潜在的ISIS细胞”了！',
  ]) assert.equal(horsLangue(t, 'zh'), null, t)
})

test('⭐ « De retour sur 自由之声 » (consigne française recopiée, 22 fois en 13 émissions) est attrapé', () => {
  const t = 'De retour sur 自由之声，刚才那段音乐听得我都想跟着西班牙工人一起去议会广场唱《国际歌》了！美琳你说是吧？'
  assert.equal(horsLangue(t, 'zh'), 'fr')
  assert.deepEqual(intrusionsLatines(t, 'zh'), ['De retour sur'])
})

test('⭐ mots anglais glissés dans du chinois : attrapés', () => {
  assert.notEqual(horsLangue('这会儿美国国防部发言人还说「撤军彰显美国 commitment」，commitment你妹啊！', 'zh'), null)
  assert.notEqual(horsLangue('把AI改名SI这事儿，我觉得挺有意思——silicon intelligence? 或是 super idiot？', 'zh'), null)
  assert.notEqual(horsLangue('那帮失业工人才不care什么“战略主动权”呢，他们只知道自己养家糊口的工厂说没就没了！', 'zh'), null)
})

test('⭐ du PINYIN (aucune voix chinoise ne le lit) est rejeté', () => {
  assert.notEqual(horsLangue('Dajia hao, zheli shi ziyou zhi sheng, wo shi Meilin.', 'zh'), null)
  assert.notEqual(horsLangue('Ni hao, 今天我们来聊聊新闻自由，聊聊那些政府不想让你知道的事情。', 'zh'), null)
})

test('la réécriture nomme les mots latins à traduire', async () => {
  const demandes: string[] = []
  const r = await garantirLangue('De retour sur 自由之声，刚才那段音乐真好听，我们继续聊西班牙的住房危机。', 'zh', async (_f, d) => {
    demandes.push(d)
    return '回到自由之声，刚才那段音乐真好听，我们继续聊西班牙的住房危机。'
  })
  assert.equal(r.horsLangue, null)
  assert.equal(r.reecritures, 1)
  assert.match(demandes[0], /"De retour sur"/)
  assert.match(demandeReecriture('zh', 'en', ['care']), /Chinese/)
})

test('⭐ la voix chinoise reçoit sigles, chiffres et lettres rendus prononçables', () => {
  assert.equal(textePourVoixChinoise('川普把AI改名SI'), '川普把人工智能改名艾斯艾')
  assert.equal(textePourVoixChinoise('2026年的GDP增长了65%'), '二〇二六年的国内生产总值增长了百分之六十五')
  assert.equal(textePourVoixChinoise('Web 2.0'), 'Web 二点零')
  assert.equal(textePourVoixChinoise('第07首'), '第零七首')
  assert.equal(textePourVoixChinoise('5G网络'), '五吉网络')
  assert.equal(textePourVoixChinoise('谷歌和Google'), '谷歌和谷歌')
  assert.equal(textePourVoixChinoise('今天我们来聊聊新闻自由。'), '今天我们来聊聊新闻自由。')
})

test('chiffres chinois', () => {
  assert.equal(nombreChinois(10), '十')
  assert.equal(nombreChinois(15), '十五')
  assert.equal(nombreChinois(110), '一百一十')
  assert.equal(nombreChinois(1005), '一千零五')
  assert.equal(nombreChinois(120000), '十二万')
  assert.equal(nombreChinois(1000001), '一百万零一')
  assert.equal(nombreChinois(200), '二百')
})

test('⭐ découpage chinois : morceaux ≤ 120 caractères, coupés après « 。！？ » (sans blanc)', () => {
  const phrase = '西班牙的住房危机越来越严重，年轻人根本租不起房子，政府却还在说一切都好。'
  const texte = phrase.repeat(10)
  assert.equal(maxCaracteres('zh'), 120)
  assert.equal(maxCaracteres('fr'), 350)
  const m = decouperTexte(texte, maxCaracteres('zh'))
  assert.ok(m.length >= 3)
  for (const x of m) {
    assert.ok(x.length <= 120, `${x.length}`)
    assert.match(x, /。$/)
  }
  assert.equal(m.join(''), texte)
})

test('découpage chinois sans fin de phrase : coupe après une virgule pleine largeur', () => {
  const texte = '年轻人根本租不起房子，'.repeat(30)
  for (const x of decouperTexte(texte, 120)) assert.ok(x.length <= 120 && x.endsWith('，'), x)
})

test('⭐ station chinoise : on ne fait pas dire un titre de morceau en lettres latines', () => {
  const c = consigneTour({ type: 'avant-pause', morceau: 'Default Track 07' }, 'zh')
  assert.match(c, /do NOT say its title "Default Track 07"/)
  const r = consigneTour({ type: 'retour-pause', morceau: 'Default Track 07', station: '自由之声' }, 'zh')
  assert.match(r, /do NOT say its title/)
  // Station anglaise : inchangé.
  assert.match(consigneTour({ type: 'avant-pause', morceau: 'Default Track 07' }, 'en'), /LAUNCH the track "Default Track 07" naturally/)
})
