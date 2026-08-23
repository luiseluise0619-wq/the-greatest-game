// Korean, laid over the English rather than beside it.
//
// The obvious way to do this is a table with an `en` column and a `ko` column,
// and the obvious thing that then happens is that somebody edits one of the two
// English copies. So there is only ever one English copy - the one already in
// the HTML, in constants.js, in the sentence the server built - and this file
// is an overlay keyed to it:
//
//     t(lang, 'ui.join', 'JOIN')      // 'JOIN' in English, '입장' in Korean
//
// A key nobody has translated yet falls through to the English it was given,
// so a half-finished translation is a game with some English in it rather than
// a game with holes in it.
//
// Two things are deliberately NOT translated. Character names are people's
// names - Cassidy "Quickhand" Vane is called that in any language - so only
// their job title moves. And the card faces are printed, not written: they are
// 1880s American job printing, engraved and pressed onto rag paper by
// cardart.js, and setting them in Hangul would be setting them in a typeface
// no press in Perdition Flats ever owned. The card in your hand stays in
// English; everything the game says ABOUT that card is Korean.

export const LANGS = ['en', 'ko'];
export const DEFAULT_LANG = 'en';

const KO = {
  // ------------------------------------------------------------------ lobby
  'ui.tagline': '여덟 명의 낯선 자들. 감춰진 별 하나. 아무도 깨끗하게 떠나지 못한다.',
  'ui.nameLabel': '묘비에 새길 이름',
  'ui.namePlaceholder': '이방인',
  'ui.thisTown': '이 마을',
  'ui.copyLink': '초대 링크 복사',
  'ui.copied': '링크 복사됨',
  'ui.codePlaceholder': '코드',
  'ui.join': '입장',
  'ui.newRoom': '새 마을',
  'ui.newRoomTitle': '내 코드로만 들어올 수 있는 비공개 마을을 엽니다',
  'ui.tableSize': '판 인원',
  'ui.gunhands': '명',
  'ui.inTheLobby': '로비',
  'ui.deal': '역할 배분',
  'ui.dealing': '배분 중…',
  'ui.dealIn': '역할 배분 — {n}초',
  'ui.settings': '설정',
  'ui.pickGunhand': '캐릭터 선택',
  'ui.howItGoes': '한 판은 이렇게 굴러갑니다',
  'ui.theDeck': '덱',
  'ui.controls': '조작',
  'ui.connecting': '접속 중…',
  'ui.connected': '접속됨 — 캐릭터를 고르고 역할을 배분하세요',
  'ui.lost': '연결 끊김 — 재접속 중 ({n})…',
  'ui.findingTown': '마을을 찾는 중…',
  'ui.publicTown': '공개 · 아무나 들어올 수 있음',
  'ui.privateTown': '비공개 · 코드로만',
  'ui.codeIsFour': '마을 코드는 네 글자입니다',
  'ui.lostForGood': '연결이 끊겼습니다 — 새로고침하면 다시 시작합니다',
  'ui.finishFirst': '이 판을 끝내고 마을을 옮기십시오',
  'ui.ridingOver': '옮겨 가는 중…',
  'ui.humanBots': '사람 {h}명 · 봇 {b}명',

  // These carry their own <b>, because the bold half is a different clause in
  // Korean than it is in English and splitting them would fix the word order.
  'rules.secret': '<b>역할은 비밀입니다.</b> 보안관, 부관들, 무법자들, 그리고 배신자 하나. 아무도 남의 정체를 듣지 못합니다.',
  'rules.thread': '<b>실마리는 딱 하나 주어집니다.</b> 부관은 두 명의 이름을 알고, 그중 하나가 보안관입니다. 무법자는 공범 한 명의 얼굴만 압니다.',
  'rules.kills': '<b>누군가 보고 있었을 때만 살해자의 이름이 붙습니다.</b> 그 밖에는 소문과 장소뿐입니다.',
  'rules.dead': '<b>죽은 자는 역할이 드러납니다.</b> 시체 하나하나가 살아남은 자들에게는 증거입니다.',
  'rules.star': '<b>보안관은 별을 달 수 있습니다.</b> 진짜 방어력이 붙지만 영원한 표적이 됩니다. 아니면 그냥 낯선 사람으로 남거나.',
  'ui.deckLead': '여섯 장 중 두 장이 매 판 당신에게 주어지고, 남이 뭘 들고 있는지는 아무도 모릅니다. 어느 것도 총을 쏘지 않습니다 — 마을이 무엇을 알 수 있는지를 고쳐 쓸 뿐입니다. <b>Z</b> 또는 <b>X</b>로 냅니다.',

  // The key itself is not language, so it travels with the label.
  'key.move': '<b>WASD</b> 이동',
  'key.sprint': '<b>Shift</b> 달리기',
  'key.crouch': '<b>Ctrl</b> 앉기',
  'key.jump': '<b>Space</b> 점프',
  'key.fire': '<b>좌클릭</b> 발사',
  'key.aim': '<b>우클릭</b> 조준 (소총)',
  'key.reload': '<b>R</b> 재장전',
  'key.guns': '<b>1 2 3</b> 무기',
  'key.dynamite': '<b>G</b> 다이너마이트',
  'key.pickup': '<b>E</b> 줍기',
  'key.ability': '<b>Q</b> 능력',
  'key.callout': '<b>F</b> 지목',
  'key.shout': '<b>V</b> 외치기',
  'key.chat': '<b>T</b> 대화',
  'key.table': '<b>Tab</b> 명단',
  'key.hand': '<b>H</b> 내 패',
  'key.star': '<b>B</b> 별 달기',
  'key.card': '<b>Z X</b> 카드 내기',
  'key.settings': '<b>Esc</b> 설정',

  // --------------------------------------------------------------- settings
  'set.title': '설정',
  'set.note': '이 브라우저에만 저장됩니다. 아무 데도 전송되지 않습니다.',
  'set.language': '언어',
  'set.sens': '마우스 감도',
  'set.invert': '상하 반전',
  'set.fov': '시야각',
  'set.volume': '음량',
  'set.mute': '전체 음소거',
  'set.fps': '프레임 표시',
  'set.backToGame': '게임으로 돌아가기',
  'set.backToLobby': '로비로 돌아가기',
  'set.reset': '기본값으로',
  'set.escHint': '언제든 <b>Esc</b>를 눌러 열고 닫을 수 있습니다',

  // -------------------------------------------------------------------- HUD
  'hud.standing': '<b>{n}</b>명 생존',
  'hud.ofTotal': '{n}명 중',
  'loot.shotgun': '산탄총 줍기',
  'loot.rifle': '레버 소총 줍기',
  'loot.ammo': '탄약 줍기',
  'loot.whiskey': '마시기 (+35 회복)',
  'loot.dynamite': '다이너마이트 줍기',
  'hud.ability': '능력',
  'hud.pickup': '줍기',
  'hud.dynamite': '다이너마이트 x{n}',
  'hud.say': '말하기',
  'hud.sayDead': '말하기 (죽은 자만 듣습니다)',
  'hud.reconnecting': '재접속 중…',
  'hud.reconnectingN': '재접속 중 ({n})…',
  'hud.dead': '당신은 죽었다',
  'hud.spectating': '관전 중. 판은 아직 끝나지 않았습니다.',
  'hud.killcam': '킬캠',
  'hud.killedBy': '가해자',
  'hud.skip': '아무 키나 누르면 넘어갑니다',
  'hud.loading': '말에 안장을 얹는 중…',

  // The turn
  'turn.walk': '자리를 잡으십시오',
  'turn.yours': '당신 차례',
  'turn.theirs': '{name} 차례',
  'turn.walkHint': '아무도 못 쏩니다 · 모두 움직일 수 있습니다',
  'turn.rootedHint': '아무도 못 움직입니다',

  'phase.lobby': '로비',
  'phase.prep': '준비',
  'phase.combat': '교전',
  'phase.endgame': '모래폭풍',
  'phase.results': '해가 졌다',
  'phase.prepObjective': '총은 아직 총집에 있습니다. 무기를 찾고, 사람을 찾고, 누구를 믿을지 정하세요.',

  // ------------------------------------------------------------- role card
  'role.yourHand': '당신의 패 — 아무에게도 말하지 마시오',
  'role.objective': '목표',
  'role.whatYouKnow': '당신이 아는 것',
  'role.youArePlaying': '당신의 캐릭터',
  'role.dealtToYou': '받은 카드 — <b>Z</b> 와 <b>X</b> 로 사용',
  'role.hint': '게임 중 <b>H</b> 를 누르고 있으면 다시 볼 수 있습니다 · 클릭하거나 <b>Space</b> 를 눌러 시작',

  'role.sheriff.name': '보안관',
  'role.deputy.name': '부관',
  'role.outlaw.name': '무법자',
  'role.renegade.name': '배신자',
  'role.sheriff.objective': '무법자 전원과 배신자를 쓰러뜨리십시오. 별은 당신 혼자 답니다.',
  'role.deputy.objective': '보안관을 살려두고 무법자들을 묻으십시오.',
  'role.outlaw.objective': '보안관을 죽이십시오. 이 땅에서 그 밖의 것은 아무 의미도 없습니다.',
  'role.renegade.objective': '이 마을에서 마지막까지 서 있는 사람이 되십시오.',
  'role.sheriff.blurb': '이 마을은 당신이 지켜야 합니다. 아직은 아무도 당신 얼굴을 모릅니다.',
  'role.deputy.blurb': '새벽에 선서했습니다. 누가 별을 달았는지 짚이는 데가 있습니다.',
  'role.outlaw.blurb': '패거리와 함께 들어왔습니다. 알아본 얼굴은 딱 하나뿐입니다.',
  'role.renegade.blurb': '여기 있는 전부가 당신 앞을 막고 있습니다. 그중 몇은 아직 그걸 모릅니다.',

  'faction.law': '법',
  'faction.outlaw': '무법자들',
  'faction.renegade': '혼자',

  // ------------------------------------------------------------- characters
  'char.gunslinger.role': '총잡이',
  'char.medic.role': '의사',
  'char.scout.role': '망꾼',
  'char.duelist.role': '결투자',
  'char.gambler.role': '노름꾼',
  'char.tracker.role': '추적자',
  'char.gunslinger.ability': '헤어 트리거',
  'char.medic.ability': '응급 처치',
  'char.scout.ability': '새소리',
  'char.duelist.ability': '지목 사격',
  'char.gambler.ability': '카드 뽑기',
  'char.tracker.ability': '흙을 읽다',
  'char.gunslinger.desc': '지속: 무기 교체가 두 배 빠릅니다. 발동: 5초간 연사와 즉시 재장전.',
  'char.medic.desc': '조준선에 있는 사람을 45 회복시킵니다 (자신은 30). 신뢰도 자원입니다.',
  'char.scout.desc': '지속: 발소리가 절반밖에 퍼지지 않습니다. 발동: 4초간 38m 안에서 움직이는 사람이 벽 너머로 빛납니다 — 움직임만이니, 가만히 앉아 있으면 걸리지 않습니다.',
  'char.duelist.desc': '6초간 거의 완벽한 명중률과 피해 +20% — 먼 거리에서 손이 떨리지 않는다면.',
  'char.gambler.desc': '무작위로 하나를 뽑습니다: 속도, 방어, 탄약 가득, 화력, 모래바람 — 아니면 꽝.',
  'char.tracker.desc': '모두의 지난 12초치 발자국을 8초 동안 드러냅니다. 발자국에는 색이 없습니다 — 누구 것인지는 알아내야 합니다.',

  // ------------------------------------------------------------------ cards
  'card.barrel.name': '빗물통',
  'card.poster.name': '수배 전단',
  'card.tracks.name': '흔적 지우기',
  'card.witness.name': '목격자 매수',
  'card.ledger.name': '죽은 자의 장부',
  'card.spyglass.name': '망원경',
  'card.kind.armed': '쓸 때까지 유지',
  'card.kind.instant': '즉시',
  'card.inPlay': '작동 중',
  'role.blind': '아무것도 없습니다. 맨눈으로 하셔야 합니다.',
  'card.barrel.rules': '다음에 당신을 맞히는 총알은 아무 일도 일으키지 않습니다 — 쏜 사람도 아무것도 듣지 못합니다.',
  'card.poster.rules': '조준선에 있는 사람의 이름을 붙입니다. 마을 전체가 듣습니다. 답은 당신만 듣습니다.',
  'card.tracks.rules': '남긴 발자국이 전부 지워지고, 75초 동안 새로 남지 않습니다.',
  'card.witness.rules': '다음 살인에는 아무 이름도 붙지 않습니다. 목격자도, 기록도, 킬캠도 — 시체조차 모릅니다.',
  'card.ledger.rules': '이 마을에서 다음으로 죽는 사람이 자기 살해자의 이름을 당신 장부에 적습니다.',
  'card.spyglass.rules': '12초 동안, 이 마을에서 발사되는 모든 총알에 얼굴이 붙습니다.',
  'card.barrel.desc': '쓸 때까지 걸려 있습니다. 다음에 당신을 맞히는 총알은 정말로 아무 일도 하지 않고 — 쏜 사람에게는 명중 표시도, 피도, 확인도 가지 않습니다. 그 사람은 마을에 대고 맞혔다고 맹세할 겁니다.',
  'card.poster.desc': '조준선에 있는 사람의 이름을 교회 문에 못박습니다. 그걸 당신이 했다고 마을 전체에 알려집니다. 대신 그 사람이 별을 달았는지는 당신만 알게 됩니다.',
  'card.tracks.desc': '이 마을에 남긴 발자국을 전부 쓸어내고, 75초 동안 새 발자국을 남기지 않습니다. 그 뒤에 흙을 읽는 추적자는 당신이 서 있던 자리에서 텅 빈 거리를 봅니다.',
  'card.witness.desc': '쓸 때까지 걸려 있습니다. 다음 살인에는 아무 이름도 붙지 않습니다: 목격자도, 누구의 기록에도 이름이 없고, 킬캠도 없습니다. 시체조차 누가 했는지 모릅니다.',
  'card.ledger.desc': '쓸 때까지 걸려 있습니다. 마을 어디서든 다음에 누가 죽으면, 방아쇠를 당긴 사람이 누구인지 당신만 알게 됩니다 — 거리 반대편이라도. 목격자 매수에는 집니다: 지워진 살인에는 읽을 것이 남지 않습니다.',
  'card.spyglass.desc': '12초 동안, 마을 어디서든 총을 쏜 사람이 3초간 당신에게만 윤곽으로 보입니다 — 벽 너머로, 지도 끝까지. 총성이 소리가 아니라 이름이 됩니다.',

  // ------------------------------------------------------------ scoreboard
  'sb.town': '퍼디션 플랫츠',
  'sb.note': '역할은 누군가 죽었을 때만 드러납니다. 나머지는 당신이 알아서 할 일입니다.',
  'sb.gunhand': '이름',
  'sb.status': '상태',
  'sb.knownRole': '알아낸 역할',
  'sb.kills': '처치',
  'sb.standing': '생존',
  'sb.deadStatus': '사망',
  'sb.unknown': '모름',
  'sb.yours': '(내 역할)',
  'sb.you': '(나)',
  'sb.bot': '봇',

  // --------------------------------------------------------------- results
  'res.character': '캐릭터',
  'res.role': '역할',
  'res.cards': '카드',
  'res.damage': '피해',
  'res.won': '승리',
  'res.lost': '패배',
  'res.howItWent': '이렇게 됐습니다',
  'res.rideAgain': '한 판 더',
  'res.rideAgainN': '한 판 더 — {ready}/{of}',
  'res.backToLobby': '{n}초 뒤 로비로',
  'res.title.law': '법이 이겼다',
  'res.title.outlaw': '무법자들이 떠난다',
  'res.title.renegade': '마지막 한 사람',
  'res.title.none': '아무도 남지 않았다',

  // ---------------------------------------------------- refusals (client)
  'deny.dead': '당신은 죽었습니다. 보고, 듣기만 하십시오.',
  'deny.notReady': '{name} — 아직입니다. {n}초.',
  'deny.noDynamite': '다이너마이트가 없습니다.',
  'deny.alreadyStar': '이미 달고 있습니다.',
  'deny.notYourStar': '그 별은 당신 것이 아닙니다.',
  'deny.noGun': '{name}은(는) 지니고 있지 않습니다.',
  'deny.emptyHand': '그 자리에는 카드가 없습니다.',
  'deny.oneCard': '카드는 한 번에 한 장입니다.',
  'deny.deadNoCards': '죽은 자는 카드를 내지 않습니다.',
  'deny.noTarget': '조준선에 지목할 사람이 없습니다.',
  'deny.accuseSoon': '방금 지목했습니다 — {n}초 뒤에.',
  'deny.nothingNear': '손 닿는 곳에 아무것도 없습니다.',
  'deny.running': '전력으로 달리면서는 못 쏩니다. 속도를 줄이십시오.',
  'deny.notYourTurn': '당신 차례가 아닙니다. 호명될 때까지 기다리십시오.',
  'deny.walkTime': '마을이 걷는 동안에는 아무도 쏘지 않습니다.',

  // ------------------------------------------------------------ boot failure
  'boot.title': '오늘 밤 게임은 없습니다',
  'boot.noWebgl': '이 브라우저는 3D 그래픽(WebGL)을 그리지 못합니다.',
  'boot.noWebglFix': '브라우저 설정에서 하드웨어 가속을 켜거나, 최신 크롬·파이어폭스·엣지·사파리에서 열어 보십시오.',
  'boot.broke': '마을을 세우지 못했습니다.',
  'boot.brokeFix': '새로고침을 한 번은 해볼 만합니다.',

  // ----------------------------------------------------------- voice wheel
  'voice.friendly': '진정해 — 난 당신 문제가 아니야.',
  'voice.follow': '나랑 붙어 다녀, 그래야 오래 산다.',
  'voice.sawthat': '방금 네가 한 짓 봤다.',
  'voice.help': '나 잡혔어! 아무나!',
  'voice.lawman': '난 법 쪽이다. 믿든 말든.',
  'voice.liar': '거짓말이고, 너도 알잖아.',
  'voice.truce': '휴전. 일단은.',
  'voice.clear': '여긴 아무것도 없다. 이동한다.',
};

const TABLE = { ko: KO };

/** Fill {name} holes. Missing values are left alone rather than printed as undefined. */
function fill(text, params) {
  if (!params) return text;
  return String(text).replace(/\{(\w+)\}/g, (whole, key) => (
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : whole
  ));
}

/**
 * The English you already have, or its translation if there is one.
 *
 * `fallback` is not a courtesy - it is where the English lives. Nothing in this
 * file is the source of truth for an English string.
 */
export function t(lang, key, fallback = '', params = null) {
  const table = TABLE[lang];
  const found = table && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : fallback;
  return fill(found, params);
}

/** True if this language has anything to say about this key. */
export function has(lang, key) {
  return !!TABLE[lang] && Object.prototype.hasOwnProperty.call(TABLE[lang], key);
}

/**
 * Which language to start in, from what the browser says it wants. Anything
 * beginning "ko" is Korean; everything else gets English, because English is
 * the only other one there is.
 */
export function pickLang(prefs) {
  const list = Array.isArray(prefs) ? prefs : [prefs];
  for (const raw of list) {
    const tag = String(raw || '').toLowerCase();
    for (const lang of LANGS) {
      if (lang !== DEFAULT_LANG && (tag === lang || tag.startsWith(`${lang}-`))) return lang;
    }
  }
  return DEFAULT_LANG;
}

/** Every key this file translates, for the test that checks none of them rot. */
export function keys(lang) {
  return TABLE[lang] ? Object.keys(TABLE[lang]) : [];
}
