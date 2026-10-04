/**
 * @module Infinity/Radio/AI/FrenchifyEnglish
 *
 * ⚠️ DEUX COPIES — GARDER IDENTIQUES (code, dictionnaire, règles) :
 *   - app Infinity           : src/modules/radio/ai/frenchify-english.ts
 *   - infinity-broadcast-scheduler : src/lib/frenchify-english.ts
 *   Les émissions AUTOMATIQUES (la nuit) sont fabriquées par le générateur, pas
 *   par l'app : un mot ajouté d'un seul côté ne s'entend que d'un seul côté.
 *   Seule différence admise : cette ligne d'en-tête qui nomme l'autre copie.
 *
 * @description Pré-processeur de prononciation : détecte les mots anglais dans
 *   un texte FRANÇAIS et les ré-épelle phonétiquement « à la française » AVANT
 *   la synthèse, pour qu'une voix française les dise comme un francophone qui
 *   parle bien anglais (« breaking news » → « bréïkigne niouze »), et non lus
 *   lettre à lettre à la française (« bréakingue nevse »).
 *
 *   04/10/2026 — « Le système a du mal à détecter les mots anglais pour les voix
 *   françaises » (Bâtisseur). Dictionnaire passé d'environ 100 à plus de 500
 *   entrées, pluriels / -ing / -ed / mots composés / élisions reconnus, casse
 *   conservée, règles de secours resserrées (elles ne touchent plus aucun mot
 *   français) et relevé des mots anglais NON couverts, pour les ajouter à
 *   l'oreille (`releverMotsAnglaisInconnus`).
 *
 *   Ordre de passage, le même dans l'app et dans le générateur :
 *     forme parlée du domaine → nettoyage (tts-sanitize) → CE MODULE → moteur.
 *
 *   Stratégie :
 *     1. PHRASES (plusieurs mots : expressions, noms propres, marques) — un
 *        passage unique : ce qu'une phrase a produit n'est JAMAIS repris par
 *        le dictionnaire (pas de double francisation).
 *     2. WORDS, dictionnaire curé : la brique FIABLE. Formes dérivées reconnues
 *        à partir d'une entrée : pluriel (-s, -es, -ies), -ing, -ed, possessif
 *        -'s, mots composés à trait d'union (si CHAQUE partie est anglaise),
 *        élisions françaises (l'update, d'Elon Musk).
 *     3. Règles de secours — seulement sur des marqueurs anglais FORTS qui
 *        n'existent pas en français (wh, ee, igh, ght, -ing, ck, sh initial ou
 *        final, -ness/-less/-ship/-ful), jamais sur un mot accentué, jamais
 *        sur un mot de NE_PAS_TOUCHER. « th », « w », « k », « -y » n'y sont
 *        PAS : rythme, thon, catholique, wagon, kilo, jury, Nancy sont français.
 *     4. SKIP — anglicismes que tout francophone dit déjà à la française
 *        (parking, week-end, sandwich, football…) : on n'y touche pas.
 *     5. NE_PAS_TOUCHER — homographes français (a, on, son, pour, bus, plus,
 *        fort, but, pain, chat, coin, four, Nice…) : jamais ré-épelés, quoi
 *        qu'en disent le dictionnaire ou les règles.
 *
 *   Casse : un mot qui commence par une majuscule (ou en MAJUSCULES) ressort
 *   avec une majuscule initiale, le reste en minuscules — un mot tout en
 *   capitales serait épelé lettre à lettre par certains moteurs.
 *
 *   Le transcript affiché garde l'orthographe d'origine : seul le texte envoyé
 *   au moteur est transformé. Pur, déterministe, sans I/O, sans dépendance.
 *
 *   ⚠️ Rien de ceci n'a été ÉCOUTÉ au moment de l'écrire : chaque ré-épellation
 *   se règle à l'oreille. Le relevé des mots inconnus sert à ça.
 */

/** Active la translittération par règles pour les mots hors dictionnaire. */
const RULE_FALLBACK = true

/**
 * Expressions et noms à plusieurs mots (clé en minuscules, espaces simples).
 * Une espace de la clé accepte aussi un trait d'union (« hip-hop », « fair-play »),
 * une apostrophe accepte aussi l'apostrophe typographique.
 */
const PHRASES: Readonly<Record<string, string>> = {
  // jurons et noms de stations
  'what the fuck': 'ouatte ze feuk',
  'big balls': 'bigue bôlze',
  // actualité, médias
  'fake news': 'féïke niouze',
  'breaking news': 'bréïkigne niouze',
  'no comment': 'nô komènte',
  'prime time': 'praïme taïme',
  'talk show': 'tôke chô',
  'late show': 'léïte chô',
  'reality show': 'rialiti chô',
  'one man show': 'ouane mène chô',
  'think tank': 'sinnke tènnke',
  'soft power': 'softe paoueur',
  'swing state': 'souigne stéïte',
  'black lives matter': 'blake laïvze mateur',
  'me too': 'mî tou',
  'fact checking': 'fakte tchèkigne',
  'best of': 'bèste ove',
  'low cost': 'lô koste',
  'start up': 'starte eupe',
  // tech
  'open source': 'ôpeune sorce',
  'big data': 'bigue déïta',
  'big tech': 'bigue tèke',
  'machine learning': 'meuchîne leurnigne',
  'deep learning': 'dîpe leurnigne',
  'artificial intelligence': 'artifichieul inntèlidjeunce',
  'dark web': 'darke ouèbe',
  'smart city': 'smarte siti',
  'chat gpt': 'tchatte djî pî tî',
  'open ai': 'ôpeune aï aï',
  // culture, musique
  'hip hop': 'hipe hope',
  'rock and roll': 'roke ènnde rôle',
  "rock'n'roll": 'rokeunrôle',
  'sound system': 'saounde sisteume',
  'happy hour': 'hèpi aoueur',
  'game over': 'guéïme ôveur',
  'game of thrones': 'guéïme ove srônze',
  'star wars': 'star ouorze',
  'harry potter': 'Hari Poteur',
  'the beatles': 'ze bîteulze',
  'rolling stones': 'rôligne stônze',
  'pink floyd': 'Pinnke Floïde',
  'michael jackson': 'Maïkeul Djakseune',
  'bob marley': 'Bobe Marli',
  'taylor swift': 'Téïleur Souifte',
  'super bowl': 'soupeur bôle',
  'world cup': 'wourlde keupe',
  // écologie, société
  'fair trade': 'fère tréïde',
  'fair play': 'fère pléï',
  'zero waste': 'ziro ouéïste',
  'street food': 'strîte foude',
  'street art': 'strîte arte',
  'fast food': 'faste foude',
  'slow food': 'slô foude',
  'climate change': 'klaïmeute tchéïnndje',
  'global warming': 'glôbeul ouormigne',
  'carbon footprint': 'karbeune foutprinnte',
  'do it yourself': 'dou ite yorsèlfe',
  'team building': 'tîme bildigne',
  'open space': 'ôpeune spéïce',
  'free world': 'fri wourld',
  // expressions
  'no way': 'nô ouéï',
  "let's go": 'lètse gô',
  'come on': 'keume ône',
  'game changer': 'guéïme tchéïnndjeur',
  'fun fact': 'feune fakte',
  'big up': 'bigue eupe',
  'number one': 'neumbeur ouane',
  'the end': 'zi ènnde',
  'happy end': 'hèpi ènnde',
  'happy birthday': 'hèpi beurzdéï',
  'merry christmas': 'mèri Krissmeusse',
  'black friday': 'blake fraïdéï',
  'good morning': 'goude mornigne',
  'good night': 'goude naïte',
  'good luck': 'goude leuke',
  "what's up": 'ouatse eupe',
  'how are you': 'haou ar iou',
  'i love you': 'aï leuve iou',
  "i don't know": 'aï dônte nô',
  'you know': 'iou nô',
  'cancel culture': 'kènnseul keultcheur',
  'safe space': 'séïfe spéïce',
  'coming out': 'keumigne aoute',
  'food truck': 'foude treuke',
  'green new deal': 'grîne niou dîle',
  'hedge fund': 'hèdje feunnde',
  'full time': 'foule taïme',
  'guest star': 'guèste star',
  'home run': 'hôme reune',
  'boris johnson': 'Boris Djonnseune',
  'snoop dogg': 'Snoupe Dogue',
  'cape town': 'Kéïpe Taoune',
  'so much': 'sô meutche',
  'oh my god': 'ô maï gode',
  'thank you': 'sènnke iou',
  'by the way': 'baï ze ouéï',
  'of course': 'ove korse',
  // personnes
  'elon musk': 'Ilone Meuske',
  'donald trump': 'Donalde Treumpe',
  'joe biden': 'Djô Baïdeune',
  'jeff bezos': 'Djèfe Bézôsse',
  'bill gates': 'Bile Guéïtse',
  'steve jobs': 'Stîve Djobze',
  'mark zuckerberg': 'Marke Zeukeurbeurgue',
  'julian assange': 'Djoulieune Assanndje',
  'edward snowden': 'Èdoueurde Snôdeune',
  // lieux, institutions, médias
  'new york times': 'Niou York Taïmze',
  'new york': 'Niou York',
  'new zealand': 'Niou Zîlande',
  'los angeles': 'Losse Ènndjeulèsse',
  'silicon valley': 'Silikeune Vali',
  'wall street journal': 'Ouol Strîte Djeurneul',
  'wall street': 'Ouol Strîte',
  'white house': 'Ouaïte Haousse',
  'downing street': 'Daounigne Strîte',
  'united states': 'Iounaïtide Stéïtse',
  'united kingdom': 'Iounaïtide Kinngdeume',
  'washington post': 'Ouochinngtone Pôste',
  'financial times': 'Faïnènnchieul Taïmze',
  'fox news': 'Fokse Niouze',
  'extinction rebellion': 'Ixtinnkcheune Ribèllieune',
}

/**
 * Dictionnaire curé : mot anglais (minuscules) → ré-épellation phonétique
 * française. Conventions : « î » i long (feed → fîde), « aï » (like → laïke),
 * « éï » (game → guéïme), « eu » (fun → feune), « ou » pour un w devant voyelle
 * (win → ouine), « -igne » pour -ing, un « e » final pour faire sonner la
 * consonne (job → djobe). Les noms propres portent leur majuscule.
 *
 * ⛔ Jamais un mot qui existe aussi en français (voir NE_PAS_TOUCHER, vérifié
 * par les tests).
 */
const WORDS_SOURCE: Readonly<Record<string, string>> = {
  // ── mots-outils, liaisons ──
  the: 'ze', this: 'zisse', that: 'zatte', these: 'zîze', those: 'zôze',
  with: 'ouize', without: 'ouizaoute', what: 'ouatte', why: 'ouaï', who: 'hou',
  how: 'haou', now: 'naou', when: 'ouène', where: 'ouère', yes: 'yèsse',
  not: 'notte', and: 'ènnde', of: 'ove', you: 'iou', your: 'yor', we: 'oui',
  they: 'zéï', my: 'maï', everything: 'èvrisigne', nothing: 'neussigne',
  something: 'seumsigne', everybody: 'èvribodi', anyway: 'èniouéï',
  whatever: 'ouatèveur', just: 'djeuste', really: 'rili', actually: 'aktchouali',
  basically: 'béïsikli', literally: 'litreuli', honestly: 'onèstli',
  seriously: 'sirieusli', much: 'meutche', very: 'vèri', maybe: 'méïbi', about: 'abaoute', because: 'bikoze',
  // ── expressions ──
  yeah: 'yèa', hello: 'hèlo', bye: 'baï', goodbye: 'goudbaï', welcome: 'ouèlkeume',
  please: 'plîze', thanks: 'sènnkse', thank: 'sènnke', sorry: 'sori', okay: 'okéï',
  wow: 'ouaou', oops: 'oupse', damn: 'dèmme', cheers: 'tchîrze', awesome: 'ôsseume',
  amazing: 'améïzigne', great: 'gréïte', crazy: 'kréïzi', cute: 'kioute',
  funny: 'feuni', best: 'bèste', worst: 'weurste', cool: 'coul', fun: 'feune',
  good: 'goude', bad: 'bade', happy: 'hèpi', baby: 'béïbi', love: 'leuve',
  life: 'laïfe', time: 'taïme', world: 'wourlde', man: 'mène', woman: 'woumeune',
  girl: 'gueurle', boy: 'boï', kid: 'kide', friend: 'frènnde', family: 'fèmili',
  people: 'pîpeul', home: 'hôme', homeless: 'hômlèsse', house: 'haousse',
  lifestyle: 'laïfstaïle', fashion: 'fècheune', high: 'haï', light: 'laïte',
  night: 'naïte', right: 'raïte', deep: 'dîpe', dark: 'darke', black: 'blake',
  white: 'ouaïte', green: 'grîne', free: 'fri', freedom: 'frîdeume',
  power: 'paoueur', money: 'meuni', cash: 'kache',
  king: 'kinng', queen: 'kouîne', boss: 'bosse', job: 'djobe', jobs: 'djobze',
  team: 'tîme', fight: 'faïte', win: 'ouine', winner: 'ouineur', loser: 'louzeur',
  fake: 'féïke', deal: 'dîle', way: 'ouéï', fast: 'faste', speed: 'spîde',
  run: 'reune', after: 'afteur', work: 'weurke', workshop: 'weurkchope',
  workout: 'weurkaoute', happiness: 'hèpinèsse', mindfulness: 'maïndfoulnèsse',
  wellness: 'ouèlnèsse', selfcare: 'sèlfekère', care: 'kère', self: 'sèlfe',
  burnout: 'beurnaoute', burn: 'beurne', out: 'aoute', up: 'eupe', down: 'daoune',
  // ── actualité, politique, médias ──
  news: 'niouze', breaking: 'bréïkigne', break: 'bréïke', leader: 'lîdeur',
  lobby: 'lobi', lobbying: 'lobiïgne', lobbyist: 'lobiïste', business: 'biznèsse',
  businessman: 'biznèssmène', startup: 'starteupe', start: 'starte',
  meeting: 'mîtigne', show: 'chô', live: 'laïve', podcast: 'podkaste',
  streaming: 'strîmigne', stream: 'strîme', streamer: 'strîmeur', replay: 'riplèï',
  talk: 'tôke', speech: 'spîtche', staff: 'stafe', speaker: 'spîkeur',
  brexit: 'brèxite', lockdown: 'lokdaoune', shutdown: 'cheutdaoune',
  impeachment: 'impîtchmeunte', fact: 'fakte', check: 'tchèke',
  checking: 'tchèkigne', hoax: 'hôkse', leak: 'lîke', whistleblower: 'ouisseulblôweur',
  backlash: 'baklache', trend: 'trènnde', trending: 'trènndigne', buzz: 'beuze',
  hype: 'haïpe', mainstream: 'méïnnstrîme', underground: 'eundeurgraounde',
  government: 'gueuveurnmeunte', congress: 'konngrèsse', senator: 'sèneteur',
  governor: 'gueuveurneur', story: 'stori', storytelling: 'storitèligne',
  newsroom: 'niouzroume', newsletter: 'niouzlèteur', bullshit: 'boulchitte',
  feedback: 'fîdbake', networking: 'nètweurkigne', network: 'nètweurke',
  empowerment: 'impaoueurmeunte', community: 'keumiouniti',
  // ── tech, internet ──
  smartphone: 'smartefône', phone: 'fône', app: 'èpe', apps: 'èpse',
  cloud: 'klaoude', data: 'déïta', hacker: 'hakeur', hack: 'hake',
  hacking: 'hakigne', open: 'ôpeune', blockchain: 'blokétchéïne',
  bitcoin: 'bitkoïne', crypto: 'kripto', token: 'tôkeune', wallet: 'ouolète',
  bluetooth: 'bloutousse', email: 'imèle', 'e-mail': 'imèle',
  password: 'passeweurde', login: 'loguine', logout: 'logaoute',
  username: 'iouzeurnéïme', users: 'iouzeurze', update: 'eupdéïte',
  upgrade: 'eupgréïde', download: 'daounelôde', upload: 'eupelôde',
  online: 'onelaïne', offline: 'ofelaïne', web: 'ouèbe', website: 'ouèbsaïte',
  browser: 'braouzeur', feed: 'fîde', like: 'laïke', follow: 'folô',
  following: 'folôwigne', follower: 'folôweur', hashtag: 'hachetague',
  influencers: 'innflouènnseurze', youtuber: 'youtioubeur', gaming: 'guéïmigne',
  game: 'guéïme', gamer: 'guéïmeur', share: 'chère', sharing: 'chèrigne',
  post: 'pôste', tweet: 'touîte', retweet: 'ritouîte', selfie: 'sèlfi',
  laptop: 'laptope', computer: 'keumpiouteur', software: 'softouère',
  hardware: 'hardouère', smart: 'smarte', smartwatch: 'smartouotche',
  tablet: 'tablète', device: 'divaïce', chatbot: 'tchatebote', cookie: 'kouki',
  server: 'seurveur', tech: 'tèke', fintech: 'finetèke', learning: 'leurnigne',
  'e-learning': 'î leurnigne', metaverse: 'mètaveurse', deepfake: 'dîpféïke',
  darknet: 'darknète', firewall: 'faïeurouole', malware: 'malouère',
  ransomware: 'rènnseumouère', phishing: 'fichigne', backup: 'bakeupe',
  workflow: 'weurkflô', framework: 'fréïmweurke', coding: 'kôdigne',
  developer: 'divèlopeur', screen: 'skrîne', push: 'pouche',
  wireless: 'ouaïeurlèsse', hotspot: 'hotspote', link: 'linnke', crash: 'krache',
  // ── musique ──
  jazz: 'djaze', blues: 'blouze', groove: 'grouve', beat: 'bîte',
  playlist: 'pléïliste', single: 'sinngueul', dj: 'dîdjéï', remix: 'rîmixe',
  funk: 'feunnke', punk: 'peunnke', heavy: 'hèvi', song: 'sonngue',
  band: 'bènnde', cover: 'keuveur', hit: 'hite', feat: 'fîte',
  featuring: 'fîtcheurigne', track: 'trake', sound: 'saounde', crew: 'krou',
  lyrics: 'liriks', flow: 'flô', battle: 'bateul', freestyle: 'fristaïle',
  country: 'keunntri', folk: 'fôlke', dance: 'dènnse', clubbing: 'kleubigne',
  nightclub: 'naïtkleube', party: 'parti', breakdance: 'bréïkdènnse',
  // ── écologie, société ──
  fair: 'fère', trade: 'tréïde', greenwashing: 'grînouochigne',
  crowdfunding: 'kraoudfeunndigne', coworking: 'kôweurkigne',
  'co-working': 'kôweurkigne', coliving: 'kôlivigne', food: 'foude',
  street: 'strîte', waste: 'ouéïste', upcycling: 'eupsaïkligne',
  recycling: 'risaïkligne', climate: 'klaïmeute', carbon: 'karbeune',
  footprint: 'foutprinnte',
  // ── sports ──
  play: 'pléï', player: 'pléïeur', skate: 'skéïte', skateboard: 'skéïtborde',
  snowboard: 'snôborde', running: 'reunigne', trail: 'tréïle',
  fitness: 'fitnèsse', crossfit: 'krossfite', tie: 'taï', soccer: 'sokeur',
  baseball: 'béïsbôle', cricket: 'krikète', kick: 'kike', boxing: 'boksigne',
  knockout: 'nokaoute', stand: 'stènnde',
  // ── jurons (radio Pirate) ──
  fuck: 'feuk', fucking: 'feukigne', shit: 'chitte', wtf: 'ouatte ze feuk',
  // ── médias, divertissement ──
  headline: 'hèdlaïne', showbiz: 'chôbize', entertainment: 'ènteurtéïnnmeunte',
  blockbuster: 'blokbeusteur', trailer: 'tréïleur', binge: 'binndje',
  watch: 'ouotche', series: 'sirîze', reboot: 'ribboute', remake: 'riméïke',
  sequel: 'sîkouèle', cast: 'kaste', guest: 'guèste', host: 'hôste',
  soundtrack: 'saoundtrake', vinyl: 'vaïneul', backstage: 'bakstéïdje',
  showcase: 'chôkéïce', headliner: 'hèdlaïneur', lineup: 'laïneupe',
  'line-up': 'laïne eupe',
  // ── économie, travail ──
  market: 'markète', marketplace: 'markètpléïce', deadline: 'dèdlaïne',
  boost: 'bouste', pitch: 'pitche', brainstorming: 'bréïnnstormigne',
  benchmark: 'bènntchmarke', freelance: 'frîlènnce', remote: 'rimôte',
  brand: 'brènnde', customer: 'keusteumeur', retail: 'rîtéïle',
  trader: 'tréïdeur', fund: 'feunnde', funding: 'feunndigne', crowd: 'kraoude',
  friday: 'fraïdéï', monday: 'meunndéï',
  // ── société, réseaux ──
  scroll: 'skrôle', swipe: 'souaïpe', dating: 'déïtigne', crush: 'kreuche',
  ghost: 'gôste', ghosting: 'gôstigne', cancel: 'kènnseul', woke: 'wôke',
  safe: 'séïfe', queer: 'kouîr', gender: 'djènndeur', friendly: 'frènndli',
  easy: 'îzi', cheap: 'tchîpe', fancy: 'fènnsi', trendy: 'trènndi',
  classy: 'klassi', chill: 'tchile', truck: 'treuke', bike: 'baïke',
  biker: 'baïkeur', organic: 'orguènik', low: 'lô', big: 'bigue', small: 'smôle',
  little: 'liteul', old: 'ôlde', new: 'niou', next: 'nèxte', last: 'laste',
  first: 'feurste', one: 'ouane', two: 'tou', three: 'srî', end: 'ènnde',
  luck: 'leuke', know: 'nô', never: 'nèveur', ever: 'èveur', forever: 'forèveur',
  always: 'olouéïze', today: 'toudéï', tonight: 'tounaïte', tomorrow: 'toumorô',
  yesterday: 'yèsteurdéï', nobody: 'nôbodi', somebody: 'seumbodi',
  birthday: 'beurzdéï', christmas: 'Krissmeusse', halloween: 'Halôwîne',
  thanksgiving: 'Sènnksguivigne',
  "don't": 'dônte', "can't": 'kènnte', "it's": 'itse', "i'm": 'aïme',
  "let's": 'lètse', "that's": 'zatse', "what's": 'ouatse',
  // ── sports (suite) ──
  dunk: 'deunnke', touchdown: 'teutchdaoune', rookie: 'rouki',
  playoff: 'pléïofe', skater: 'skéïteur', kitesurf: 'kaïtseurfe',
  // ── Infinity ──
  infinity: 'infiniti', freeworld: 'friwourld',
  // ── noms propres : marques ──
  google: 'Gougueul', facebook: 'Féïsbouke', twitter: 'Touiteur',
  youtube: 'Youtioube', netflix: 'Nètflixe', amazon: 'Amazeune', apple: 'Apeul',
  microsoft: 'Maïkrosofte', instagram: 'Innstagrame', whatsapp: 'Ouotsape',
  spotify: 'Spotifaï', airbnb: 'Èrbiènnbi', linkedin: 'Linnkdine',
  snapchat: 'Snaptchate', iphone: 'Aïfône', ipad: 'Aïpade', android: 'Ènndroïde',
  windows: 'Ouinndôze', nvidia: 'Ènnvidia', openai: 'Ôpeune aï aï',
  chatgpt: 'Tchatte djî pî tî', boeing: 'Bôwigne', nike: 'Naïki',
  starbucks: 'Starbeukse', "mcdonald's": 'Mak Donaldze', mcdonald: 'Mak Donalde',
  disney: 'Dizni', marvel: 'Marveul', greenpeace: 'Grînpîce',
  wikileaks: 'Ouikilîkse', bloomberg: 'Bloumbeurgue', reuters: 'Roïteurze',
  guardian: 'Gardieune', times: 'Taïmze', anonymous: 'Anonimeusse',
  ethereum: 'Issirieume', occupy: 'Okioupaï', metoo: 'Mîtou',
  // ── noms propres : personnes ──
  elon: 'Ilone', musk: 'Meuske', donald: 'Donalde', trump: 'Treumpe',
  biden: 'Baïdeune', bezos: 'Bézôsse', zuckerberg: 'Zeukeurbeurgue',
  snowden: 'Snôdeune', assange: 'Assanndje', steve: 'Stîve',
  spiderman: 'Spaïdeurmène', spider: 'spaïdeur', kennedy: 'Kènnedi',
  lincoln: 'Linnkeune', hillary: 'Hilari', clinton: 'Klinnteune',
  putin: 'Poutine', johnson: 'Djonnseune', smith: 'Smisse', william: 'Ouilieume',
  harry: 'Hari', taylor: 'Téïleur', drake: 'Dréïke', radiohead: 'Réïdiohède',
  coldplay: 'Kôldpléï', springsteen: 'Sprinngstîne', bowie: 'Bôwi',
  lennon: 'Lèneune', mccartney: 'Mak Kartni', presley: 'Prèsli',
  marley: 'Marli', jackson: 'Djakseune',
  // ── noms propres : lieux ──
  london: 'Leundeune', washington: 'Ouochinngtone', hollywood: 'Holiwoude',
  brooklyn: 'Brouklinne', manhattan: 'Mènnhateune', california: 'Kalifornia',
  oxford: 'Oksfeurde', cambridge: 'Kéïmbridje', harvard: 'Harveurde',
  stanford: 'Stanfeurde', england: 'Inngueulande', scotland: 'Skotlande',
  ireland: 'Aïeurlande', america: 'Amérika', american: 'Amérikeune',
  british: 'Britiche', english: 'Innglice', york: 'York', miami: 'Maïami',
  seattle: 'Siateul', detroit: 'Ditroïte', houston: 'Hiousteune',
  philadelphia: 'Filadèlfia', pennsylvania: 'Pènnsilvéïnia',
  virginia: 'Veurdjinia', georgia: 'Djordjia', ohio: 'Ohaïo',
  michigan: 'Michiguène', utah: 'Youta', manchester: 'Mènntchèsteur',
  liverpool: 'Liveurpoule', birmingham: 'Beurminngueume',
  edinburgh: 'Èdinnbeura', dublin: 'Deubline', glasgow: 'Glazgô',
  sydney: 'Sidni', melbourne: 'Mèlbeurne', vancouver: 'Vènnkouveur',
  singapore: 'Sinngapor', silicon: 'Silikeune', valley: 'Vali',
}

const WORDS: ReadonlyMap<string, string> = new Map(Object.entries(WORDS_SOURCE))
const PHRASES_MAP: ReadonlyMap<string, string> = new Map(Object.entries(PHRASES))

/**
 * Anglicismes déjà adoptés : un francophone les dit déjà avec l'accent
 * français, les ré-épeler les dégraderait. Comparés en minuscules.
 */
const SKIP: ReadonlySet<string> = new Set([
  'parking', 'camping', 'smoking', 'shopping', 'marketing', 'planning',
  'casting', 'listing', 'footing', 'brushing', 'lifting', 'pressing',
  'jogging', 'dancing', 'doping', 'zapping', 'briefing', 'building',
  'coaching', 'dumping', 'holding', 'leasing', 'living', 'mailing',
  'piercing', 'rafting', 'roaming', 'standing', 'timing', 'training',
  'trekking', 'karting', 'bowling', 'sitting', 'stretching', 'tuning',
  'weekend', 'week-end', 'wifi', 'internet', 'film', 'films', 'radio',
  'design', 'star', 'stars', 'fan', 'fans', 'club', 'clubs', 'ticket', 'stop',
  'taxi', 'sport', 'sports', 'match', 'sandwich', 'manager', 'leadership',
  'standard', 'budget', 'football', 'tennis', 'rugby', 'golf', 'basket',
  'hockey', 'surf', 'sprint', 'penalty', 'corner', 'coach', 'shampoing',
  'shampooing', 'bus', 'rock', 'rap', 'pop', 'top', 'look', 'must', 'scoop',
  'spam', 'bug', 'bugs', 'gadget', 'festival', 'reggae', 'gospel', 'electro',
  'techno', 'glamour', 'vintage', 'vegan', 'spoiler', 'dylan', 'tee-shirt', 't-shirt', 'stock', 'snack',
  'hamburger', 'ketchup', 'cocktail', 'jean', 'jeans', 'short', 'pull',
  'clown', 'boxer', 'flash', 'clash', 'tunnel', 'puzzle', 'barbecue',
  'cowboy', 'western', 'bluff', 'jury', 'record', 'reporter', 'interview',
  'whisky', 'wagon',
])

/**
 * Homographes FRANÇAIS : un mot qui s'écrit pareil en français. Jamais touché,
 * ni par le dictionnaire, ni par les règles, ni listé comme inconnu. Les tests
 * vérifient qu'aucune clé de WORDS n'y figure.
 */
const NE_PAS_TOUCHER: ReadonlySet<string> = new Set([
  'a', 'as', 'an', 'on', 'son', 'sons', 'pour', 'plus', 'fort', 'but', 'buts',
  'pain', 'chat', 'chats', 'coin', 'four', 'car', 'fin', 'sale', 'date', 'case',
  'place', 'rose', 'page', 'table', 'nation', 'image', 'type', 'message',
  'service', 'net', 'dent', 'lent', 'tire', 'pile', 'race', 'rage', 'cave',
  'mare', 'bride', 'bat', 'rat', 'mars', 'us', 'me', 'are', 'in', 'do', 'sort',
  'mine', 'main', 'dire', 'rang', 'ring', 'test', 'fine', 'nice', 'hop', 'hi',
  'soul', 'metal', 'ok', 'no', 'for', 'slow', 'goal', 'box', 'poing', 'coing',
  'seing', 'mail', 'user', 'influencer', 'coder', 'challenge', 'chance', 'cent',
  'sept', 'vie', 'ride', 'rider', 'pays', 'lame', 'bite', 'stage', 'pot', 'pet',
  'pin', 'pine', 'rate', 'dame', 'fade', 'mot', 'pore', 'pure', 'rude', 'ruse',
  'vague', 'grave', 'large', 'long', 'tact', 'chose', 'once', 'plane', 'mince',
  'parties', 'bandé', 'bandée', 'bandés', 'bandées', 'posté', 'postée', 'postés',
  'postées', 'booster', 'surfer', 'tour', 'tours', 'line', 'meme', 'lové', 'lovée', 'lovés', 'lovées', 'lit', 'fit', 'met', 'dit', 'vent', 'fut', 'sent', 'if', 'or', 'bot', 'router',
  'action', 'question', 'attention', 'parent', 'content', 'patient', 'moment',
  'important', 'excellent', 'document', 'accident', 'client', 'station',
  'information', 'source', 'office', 'change', 'machine', 'intelligence',
  'president', 'art', 'arts', 'cost', 'tape', 'site', 'sites', 'super', 'style',
  'max', 'gay', 'hall', 'fax', 'bar', 'pub', 'sexy', 'tram', 'troll', 'blog',
  'zoo', 'alcool', 'beijing', 'jinping', 'nanjing', 'chongqing', 'xiaoping',
])

/** Mots français courants qui portent « th », « w » ou un « -y » final : hors du relevé. */
const FRANCAIS_FAUX_INDICES: ReadonlySet<string> = new Set([
  'rythme', 'rythmes', 'thon', 'thym', 'thermique', 'thermos', 'thorax',
  'catholique', 'catholiques', 'sympathique', 'sympathiques', 'orthographe',
  'mythe', 'mythes', 'mythique', 'labyrinthe', 'luth', 'math', 'maths', 'bizuth',
  'mammouth', 'aneth', 'thomas', 'thierry', 'mathieu', 'marthe', 'arthur',
  'nathalie', 'mathilde', 'thibault', 'thibaut', 'judith', 'edith', 'ruth',
  'elisabeth', 'gauthier', 'gothique', 'ethnique', 'ethnie', 'ethnies',
  'anthologie', 'anthropologie', 'plinthe', 'absinthe', 'jacinthe', 'menthe',
  'thaï', 'thaïs', 'thuya', 'thomson', 'wagon', 'wagons', 'wallon', 'wallonne',
  'wallonie', 'watt', 'watts', 'kiwi', 'kiwis', 'nancy', 'orly', 'vichy', 'bercy',
  'cergy', 'issy', 'annecy', 'poissy', 'cluny', 'sully', 'chantilly', 'neuilly',
  'thionville', 'methane', 'mathematique', 'arithmetique', 'rhythme', 'thermes',
  'goethe', 'thalès', 'thales', 'athos', 'thor', 'thé', 'thés', 'kathy',
  'bangladesh', 'tiktok', 'twitch', 'kiev', 'tokyo', 'york',
])

/**
 * Les mots que CE module écrit (« friwourld », « ouatte »…) : un texte déjà
 * passé ici, comme la forme parlée du domaine du générateur (« Infiniti tiret
 * Friwourld point com »), ne doit être ni re-francisé ni relevé comme inconnu.
 */
const FORMES_PHONETIQUES: ReadonlySet<string> = new Set(
  [...WORDS.values(), ...PHRASES_MAP.values()]
    .flatMap(v => v.toLowerCase().split(/[\s-]+/))
    .filter(Boolean),
)

/** Verbes anglais qu'un francophone conjugue (« il a liké ») : seuls eux prennent -é, -ée, -és, -ées. */
const VERBES_CONJUGUES: ReadonlySet<string> = new Set([
  'like', 'stream', 'update', 'upload', 'download', 'follow', 'share', 'tweet',
  'retweet', 'hack', 'check', 'boost', 'pitch', 'crash', 'kick', 'ghost', 'swipe',
  'scroll', 'deal', 'fake', 'skate', 'chill', 'cancel', 'remix', 'link', 'feed',
  'play', 'watch', 'trade', 'fund', 'crush', 'dunk', 'start', 'push', 'login',
  'reboot', 'backup', 'freelance',
])

/** Familles de mots français que les marqueurs anglais attraperaient (stockage, hollywoodien…). */
const FRANCAIS_MOTIFS: ReadonlyArray<RegExp> = [/^stock/, /^bifteck/, /^jockey/, /^ticket/, /^hollywood./, /^shampo/, /^micro/, /^zoo/, /^coo/, /alcool/]

/** Ce que les tests ont besoin de voir (lecture seule). */
export const DICTIONNAIRE = { phrases: PHRASES_MAP, mots: WORDS, skip: SKIP, nePasToucher: NE_PAS_TOUCHER } as const

// ── Recherche d'une entrée et de ses formes dérivées ─────────────────────────

const VOYELLE_FINALE = /[aeiouyàâäéèêëïîôöùûüÿ]$/

/** Retire le « e » muet final ajouté pour faire sonner la consonne (hake → hak). */
function sansEMuet(phon: string): string {
  return /[^aeiouyàâäéèêëïîôöùûü]e$/.test(phon) ? phon.slice(0, -1) : phon
}

/** Forme en -ing à partir de la forme de base (hake → hakigne, folô → folôwigne). */
function enIng(phon: string): string {
  const base = sansEMuet(phon)
  if (/[oô]$|ou$/.test(base)) return base + 'wigne'
  if (base.endsWith('ï')) return base.slice(0, -1) + 'yigne'   // pléï → pléyigne
  if (VOYELLE_FINALE.test(base)) return base + 'ïgne'
  return base + 'igne'
}

/** Forme en -ed : /ɪd/ après t ou d, /t/ après une sourde, /d/ ailleurs. */
function enEd(phon: string, motBase: string): string {
  const base = sansEMuet(phon)
  if (/[td]e?$/.test(motBase)) return base + 'ide'
  if (/(?:[kpfsx]|ch|che)$/.test(base)) return base + 'te'
  return base + 'de'
}

function entree(mot: string): string | undefined {
  return WORDS.get(mot)
}

/**
 * Ré-épellation d'un mot en minuscules (sans élision ni trait d'union), avec
 * ses formes dérivées. `undefined` = pas une entrée du dictionnaire.
 */
function chercher(mot: string): string | undefined {
  if (NE_PAS_TOUCHER.has(mot) || SKIP.has(mot)) return undefined
  const direct = entree(mot)
  if (direct) return direct
  if (mot.length < 4) return undefined
  // possessif anglais : Google's → Gougueulze
  if (mot.endsWith("'s")) {
    const b = entree(mot.slice(0, -2))
    if (b) return b + 'ze'
  }
  // pluriels : -ies, -es (après s, x, z, ch, sh), -s
  if (mot.endsWith('ies')) {
    const b = entree(mot.slice(0, -3) + 'y')
    if (b) return b + 's'
  }
  if (/(?:s|x|z|ch|sh)es$/.test(mot)) {
    const b = entree(mot.slice(0, -2))
    if (b) return b + 's'
  }
  if (mot.endsWith('s') && !mot.endsWith('ss')) {
    const sing = mot.slice(0, -1)
    if (!NE_PAS_TOUCHER.has(sing) && !SKIP.has(sing)) {
      const b = entree(sing)
      if (b) return b + 's'
    }
  }
  // -ing : hacking ← hack, liking ← like, running ← run
  if (mot.endsWith('ing') && mot.length >= 6) {
    const r = mot.slice(0, -3)
    for (const base of [r, r + 'e', /([b-df-hj-np-tv-z])\1$/.test(r) ? r.slice(0, -1) : '']) {
      const b = base && !NE_PAS_TOUCHER.has(base) ? entree(base) : undefined
      if (b) return enIng(b)
    }
  }
  // -ed : hacked ← hack, liked ← like, updated ← update
  if (mot.endsWith('ed') && mot.length >= 5) {
    const r = mot.slice(0, -2)
    for (const base of [r, r + 'e', mot.slice(0, -1), /([b-df-hj-np-tv-z])\1$/.test(r) ? r.slice(0, -1) : '']) {
      const b = base && !NE_PAS_TOUCHER.has(base) ? entree(base) : undefined
      if (b) return enEd(b, base)
    }
  }
  // verbe anglais conjugué à la française : liké, streamée, updatés → laïké…
  // Seulement les VERBES de la liste : « carbonée » ou « bandé » sont français.
  const fr = /^(.+?)(ée|ées|és|é)$/.exec(mot)
  if (fr && fr[1].length >= 3) {
    const r = fr[1]
    for (const base of [r, r + 'e', /([b-df-hj-np-tv-z])\1$/.test(r) ? r.slice(0, -1) : '']) {
      const b = base && VERBES_CONJUGUES.has(base) ? entree(base) : undefined
      if (b) return sansEMuet(b) + fr[2]
    }
  }
  return undefined
}

// ── Règles de secours ────────────────────────────────────────────────────────

/**
 * Marqueurs anglais FORTS, absents du français. Volontairement étroits : un
 * mot anglais manqué s'entend « à la française », un mot français abîmé
 * s'entend comme une faute — la seconde erreur est bien pire.
 */
function estFrancais(w: string): boolean {
  return NE_PAS_TOUCHER.has(w) || SKIP.has(w) || FRANCAIS_FAUX_INDICES.has(w) || FRANCAIS_MOTIFS.some(re => re.test(w))
}

function looksEnglish(w: string): boolean {
  if (w.length < 4 || !/^[a-z]+$/.test(w) || estFrancais(w)) return false
  // Onomatopée ou remplissage (« eeeeee », « wooow », « ouuuh ») : pas un mot.
  if (!/[b-df-hj-np-tv-xz]/.test(w) || /(.)\1\1/.test(w)) return false
  // Terminaison de verbe français sur une racine anglaise (« ils boostent ») :
  // la règle ne saurait pas la dire, on laisse le moteur la lire en français.
  if (/(?:ent|ez|ons|ait|aient|ais)$/.test(w)) return false
  // « ee » final = un « ée » français écrit sans accent (entree, INSEE) : exclu.
  return /wh|ee(?!s?$)|igh|ght|ck|^sh|sh$|(?:ness|less|ship|ful)$/.test(w)
    || (w.length >= 5 && /[^oe]ing$/.test(w))
    || /(?:^|[^cz])oo/.test(w)
}

/**
 * Indices plus faibles (w, -y, « th » de mot-outil anglais) : servent au
 * RELEVÉ, jamais à la transformation. Un « th » quelconque est trop français
 * (authentique, marathon, rythme, enthousiasme) ; un -lly final aussi (Neuilly).
 */
function looksEnglishLoose(w: string): boolean {
  if (w.length < 4 || !/^[a-z]+$/.test(w) || estFrancais(w) || /watt/.test(w)) return false
  return /^th(?:e|is|at|ey|em|ere|ink|ank|ing|ose|ree|row|ough)|w|[^aeiouyl]y$/.test(w)
}

/** Translittération par règles (secours) — remplacements ordonnés. */
function transliterate(w: string): string {
  let s = w
  s = s.replace(/ness$/, 'nèsse').replace(/less$/, 'lèsse').replace(/ship$/, 'chipe').replace(/ful$/, 'foul')
  s = s.replace(/ee/g, 'î')        // sweet → swît (avant -ight : « lighter »)
  s = s.replace(/ight/g, 'aïte')   // night → naïte
  s = s.replace(/igh/g, 'aï')      // high → haï
  s = s.replace(/ght/g, 't')       // thought → zout
  s = s.replace(/ing$/, 'igne')    // feeling → fîligne
  s = s.replace(/th/g, 'z')        // th → z (accent français typique)
  s = s.replace(/wh/g, 'ou')       // wheel → ouîl
  s = s.replace(/oo/g, 'ou')       // book → bouk
  s = s.replace(/ea/g, 'î')        // team → tîm
  s = s.replace(/ck/g, 'k')        // back → bak
  s = s.replace(/sh/g, 'ch')       // shine → chine
  s = s.replace(/ph/g, 'f')        // phone → fone
  s = s.replace(/^w([aeiou])/, 'ou$1')
  s = s.replace(/oa/g, 'ô')        // boat → bôt
  s = s.replace(/y$/, 'i')         // happy → happi
  s = s.replace(/([bdgkpt])$/, '$1e') // consonne finale sonore : book → bouke
  return s
}

// ── Découpage du texte ───────────────────────────────────────────────────────

const echapper = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Pas de « lookbehind » (?<!…) : un Safari antérieur à 16.4 refuserait le
// module entier au chargement. Le caractère qui précède est capturé (groupe 1).
const RE_PHRASES = new RegExp(
  '(^|[^\\p{L}\\p{N}])('
  + [...PHRASES_MAP.keys()]
    .sort((a, b) => b.length - a.length)
    .map(k => echapper(k).replace(/'/g, "['’]").replace(/ /g, '[\\s\\u00A0-]+'))
    .join('|')
  + ')(?![\\p{L}\\p{N}])',
  'giu',
)

/** Un mot : lettres, avec apostrophes ou traits d'union INTERNES. */
const RE_MOT = /[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu

const ELISION = /^(l|d|j|n|s|c|m|t|qu|jusqu|lorsqu|puisqu)'(.+)$/

const normaliser = (s: string): string => s.toLowerCase().replace(/’/g, "'")

/** Garde la majuscule initiale du mot d'origine (et seulement elle). */
function casse(original: string, phon: string): string {
  const premiere = original.charAt(0)
  if (premiere !== premiere.toLowerCase()) return phon.charAt(0).toUpperCase() + phon.slice(1)
  return phon
}

/** Découpe en morceaux : [texte hors phrase, phrase reconnue | null]. */
function decouper(text: string): Array<{ libre: string } | { phrase: string; phon: string }> {
  const out: Array<{ libre: string } | { phrase: string; phon: string }> = []
  let dernier = 0
  for (const m of text.matchAll(RE_PHRASES)) {
    const debut = (m.index ?? 0) + m[1].length
    const cle = normaliser(m[2]).replace(/[\s\u00A0-]+/g, ' ')
    const phon = PHRASES_MAP.get(cle)
    if (!phon) continue
    if (debut > dernier) out.push({ libre: text.slice(dernier, debut) })
    out.push({ phrase: m[2], phon })
    dernier = debut + m[2].length
  }
  if (dernier < text.length) out.push({ libre: text.slice(dernier) })
  return out
}

/** Transforme un mot (avec ses élisions et traits d'union éventuels). */
function transformWord(w: string): string {
  const lower = normaliser(w)
  if (SKIP.has(lower) || NE_PAS_TOUCHER.has(lower) || FORMES_PHONETIQUES.has(lower)) return w
  const trouve = chercher(lower)
  if (trouve) return casse(w, trouve)
  // élision française : l'update, d'Elon → on garde « l' », on traite la suite
  const el = ELISION.exec(lower)
  if (el) {
    const prefixe = w.slice(0, el[1].length + 1)
    return prefixe + transformWord(w.slice(el[1].length + 1))
  }
  // mot composé : seulement si CHAQUE partie est une entrée anglaise
  // (« post-apocalyptique » reste intact, « fair-play » est traité).
  if (lower.includes('-')) {
    const parties = w.split('-')
    const phons = parties.map(p => chercher(normaliser(p)))
    if (phons.every(Boolean)) return phons.map((p, i) => casse(parties[i], p as string)).join(' ')
    return w
  }
  if (RULE_FALLBACK && looksEnglish(lower)) return casse(w, transliterate(lower))
  return w
}

/**
 * Ré-épelle phonétiquement (en français) les mots anglais d'un texte, pour
 * une prononciation anglaise correcte par une voix française.
 *
 * @param text texte d'origine (déjà nettoyé pour la voix)
 * @returns texte à envoyer au moteur (mots anglais ré-épelés)
 */
export function frenchifyEnglishWords(text: string): string {
  return decouper(text)
    .map(m => ('phrase' in m ? casse(m.phrase, m.phon) : m.libre.replace(RE_MOT, transformWord)))
    .join('')
}

/**
 * Relevé des mots PROBABLEMENT anglais qu'aucune entrée du dictionnaire ne
 * couvre (les règles de secours peuvent en dire certains, mais à peu près) :
 * à écouter, puis à ajouter à WORDS. En minuscules, sans doublon, dans l'ordre
 * d'apparition. Jamais un homographe français ni un anglicisme de SKIP.
 */
export function releverMotsAnglaisInconnus(text: string): string[] {
  const vus = new Set<string>()
  for (const m of decouper(text)) {
    if ('phrase' in m) continue
    for (const [mot] of m.libre.matchAll(RE_MOT)) {
      let lower = normaliser(mot)
      const el = ELISION.exec(lower)
      if (el) lower = el[2]
      if (SKIP.has(lower) || NE_PAS_TOUCHER.has(lower) || chercher(lower)) continue
      for (const partie of lower.split('-')) {
        if (vus.has(partie) || chercher(partie) || FORMES_PHONETIQUES.has(partie)) continue
        if (looksEnglish(partie) || looksEnglishLoose(partie)) vus.add(partie)
      }
    }
  }
  return [...vus]
}
