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
  'key.manual': '<b>F1</b> 설명서',
  'man.key.fire': '<b>좌클릭</b> 발사 — 총구를 잠시 얹고 있어야 나갑니다',
  'man.key.cards': '<b>1…9</b> 카드 내기',
  'man.key.brace': '<b>Space</b> 몸을 피하기',
  'man.key.look': '<b>마우스</b> 고개 돌리기 — 발은 그대로',
  'man.key.self': '<b>Q</b> 자기 머리에 겨누기',

  // ---------------------------------------------------------- the manual
  'ui.howToPlay': '게임 방법',
  'ui.theEighty': '여든 장',
  'ui.dealtGunhand': '총잡이는 배분됩니다',
  'ui.sixteenLead': '열여섯 명, 한 사람당 하나, 아무도 고르지 않습니다. 맞을 때마다 손에 카드가 한 장씩 늘어나는 자가 있고, 그를 피하려면 <b>「빗나감」</b>이 두 장 필요한 자가 있으며, 손이 절대 비지 않는 자가 있습니다. 당신이 받은 것은 역할 카드에 있습니다.',
  'ui.eightyLead': '스물두 종류, 총 여든 장. 체력만큼 받고 차례마다 두 장씩 뽑으니, 한 판이 끝나기 전에 대부분을 보게 됩니다. 카드에 적힌 <b>숫자키</b>로 냅니다.',
  'ui.manLead': '전부 <b>게임 방법</b>에 제대로 적어 두었습니다. 판이 시작된 뒤에도 <b>F1</b>로 다시 열 수 있습니다.',
  'rules.starDuel': '<b>보안관은 종이 울릴 때부터 별을 답니다.</b> 모두가 찾을 수 있는 단 한 사람이며, 이 모드에서 비밀이 아닌 유일한 역할입니다.',
  'rules.turns': '<b>탁자 앞에 서서 순서를 지켜 가며 합니다.</b> 아무도 걷지 않습니다. 한 사람씩 6초 동안 마을에서 유일하게 살아있는 총을 쥐고, 거리는 몇 자리 떨어져 있느냐로 셉니다.',
  'rules.ammo': '<b>탄약은 카드입니다.</b> 손에 「한 발」이 없으면 쏠 수 없고, 총이 닿는 거리는 앞에 깔린 카드가 정하며, 마을 전체가 함께 쓰는 약실에는 공포탄이 섞여 있습니다.',

  'man.title': '이렇게 하는 게임입니다',
  'man.sub': '지금 읽으십시오. 종이 울린 뒤에는 아무도 질문을 받아주지 않습니다.',
  'man.pointTitle': '무엇을 하려는 게임인가',
  'man.point': '<b>역할은 비밀이고, 모든 것을 역할이 정합니다.</b> <b>보안관</b>은 마을을 정리하고 싶어 합니다. <b>부관</b>들은 그를 살려두고 싶어 하지만, 보안관은 부관이 누구인지 모릅니다. <b>무법자</b>들은 보안관이 죽기를 바랍니다. <b>배신자</b>는 마지막 한 사람이 되고 싶어 하고, 그러려면 무법자들이 먼저 사라지고 <i>그다음에</i> 보안관이 죽어야 합니다.',
  'man.thread': '<b>실마리는 한 사람당 하나뿐입니다.</b> 부관은 두 이름을 듣고 그중 하나가 보안관입니다. 무법자는 공범 한 명의 얼굴을 압니다. 보안관은 아무것도 모릅니다. 나머지는 누가 누구를 쏘는지 보고 알아내는 것입니다.',
  'man.witness': '<b>누군가 그 장면을 봤을 때만 살해자의 이름이 붙습니다.</b> 그렇지 않으면 마을에는 총성과 방향과 소문만 남습니다. 죽은 사람은 역할이 뒤집혀 공개되므로, 시체 하나하나가 살아남은 자들에게는 증거입니다.',

  'man.tableTitle': '탁자',
  'man.table': '이 게임은 큰길 한복판의 <b>탁자 앞에 서서</b> 합니다. 바닥에 자리가 하나 배분되고, 판이 끝날 때까지 거기 서 있습니다 — 아무도 걷지 않습니다. <b>거리는 자리 수</b>입니다. 옆 사람은 한 자리, 맞은편은 서너 자리이고, 당신 총은 앞에 깔린 카드가 말하는 자리 수만큼 닿습니다. 어디에 섰는지는 손에 든 카드만큼이나 당신에게 배분된 것입니다.',
  'man.lapTitle': '한 바퀴',
  'man.lap': '<b>한 사람씩 차례를 갖습니다</b>. 각 6초, 판 시작 때 탁자 전체가 본 순서대로. 한 바퀴와 다음 바퀴 사이에는 <b>약실을 공개적으로 장전하는</b> 짧은 틈이 있고, 다들 무엇이 들어갔는지 셉니다. 고개는 언제든 돌릴 수 있습니다. 남의 차례에 할 수 있는 일은 그것뿐이며, 그것으로 충분합니다 — 누구든 받는 유일한 경고는 그가 총을 드는 것을 보는 것이니까요.',
  'man.fireTitle': '쏘려면 무엇이 필요한가',
  'man.fire': '세 가지가 동시에 맞아야 합니다. <b>당신의 차례</b>여야 하고, 손에 <b>「한 발」</b>이 있어야 하며 — 한 차례에 한 장, 맞히든 못 맞히든 소모됩니다 — 상대가 <b>당신 총이 닿는 거리 안</b>에 있어야 합니다. 그 거리는 조준경이 아니라 당신 앞에 깔린 카드가 정합니다.',
  'man.draw': '그다음 <b>총구를 그에게 얹은 채로</b> 1초 가까이 버텨야 발사됩니다. 그것이 「겨눔」이고, 상대가 받는 유일한 경고입니다. 보고 있는 사람은 당신이 누구를 골랐는지 알 수 있습니다.',

  'man.chamberTitle': '약실',
  'man.chamber': '약실은 <b>마을에 하나뿐</b>입니다. 매 바퀴가 시작될 때 공개적으로 장전되고 — 실탄 몇, 공포탄 몇, 순서는 절대 알려주지 않습니다 — <b>누가 쏘든 한 발씩 줄어듭니다</b>. 여섯 사람이 같은 여섯 발을 세면서 한 바퀴를 보냅니다. 공포탄은 연기와 소리뿐이지만, 카드는 똑같이 사라집니다.',
  'man.aimedTitle': '총구가 당신에게 멈췄을 때',
  'man.aimed': '화면이 알려줍니다. 그의 겨눔이 끝나기 전까지가 당신 시간입니다. <b>Space</b>를 누르면 그가 생각한 자리에 당신이 없습니다 — 대신 손에서 <b>「빗나감」</b> 한 장이 나갑니다. 없으면 소용없습니다. 아무도 대신 써주지 않습니다. 남의 차례에 할 수 있는 유일한 행동입니다.',
  'man.selfTitle': '총구를 돌려 자기에게',
  'man.self': '자기 차례에는 <b>Q</b>로 총구를 자기 머리에 댈 수 있습니다. 공포탄이면 그 자리에서 차례를 한 번 더 얻습니다. 실탄이면 한 대 맞고, 총알은 거기서 멈추지 않고 <b>등 뒤로 빠져나가</b> 당신 뒤에 일직선으로 선 사람에게 갑니다 — 둥근 탁자에서는 반대쪽 옆 사람입니다. 왼쪽 옆 사람을 향해 돌아서면, 그 총알은 오른쪽 옆 사람이 받습니다.',
  'man.handTitle': '당신이 받은 사람',
  'man.hand': '역할과 함께 <b>열여섯 총잡이</b> 중 하나를 받고, 역할 카드에 적혀 있습니다. 맞을 때마다 손에 카드가 한 장씩 늘어나는 자가 있고, 그를 피하려면 <b>「빗나감」</b>이 두 장 필요한 자가 있으며, 손이 절대 비지 않는 자가 있고, 쓰러진 자들의 주머니를 전부 챙기는 자가 있습니다. 남이 무엇을 받았는지는 아무도 모릅니다 — 다만 대부분은 처음 쓰이는 순간 드러납니다.',
  'man.cardsTitle': '여든 장',
  'man.cards': '손에 들 수 있는 카드 수는 당신의 체력과 같고, 차례가 시작될 때마다 두 장을 뽑습니다 — 죽음에 가까울수록 할 수 있는 일이 줄어듭니다. 카드에 적힌 <b>숫자키</b>로 냅니다. 어떤 카드는 먼저 상대를 조준해야 합니다. <b>「한 발」</b>과 <b>「빗나감」</b>은 키로 내지 않습니다. 하나는 쏘는 것이고, 하나는 당신이 몸을 피할 때 대신 나갑니다.',
  'man.deckTitle': '카드 여섯 장',
  'man.deck': '여섯 장 중 두 장이 매 판 주어지고, 남이 뭘 들고 있는지는 아무도 모릅니다. 어느 것도 총을 쏘지 않습니다 — 마을이 무엇을 알 수 있는지를 고쳐 쓸 뿐입니다. <b>Z</b> 또는 <b>X</b>로 냅니다.',
  'man.starTitle': '별',
  'man.starDuel': '보안관은 첫 종소리부터 별을 달고 있습니다 — 이 모드에서 유일하게 <b>비밀이 아닌</b> 역할이자, 모두가 찾을 수 있는 단 한 사람입니다. 그는 판의 첫 차례를 갖고, 다른 누구보다 맞을 수 있는 횟수가 많습니다. 둘 다 필요합니다: 패거리는 누구를 쏠지 정확히 알고, 법 쪽은 누구에게 되쏠지 모르니까요. 나머지는 다른 곳과 똑같이 숨겨져 있습니다.',
  'man.star': '보안관은 언제든 <b>B</b>로 별을 달 수 있습니다. 진짜 방어력이자 영원한 표적이며, 한 번 달면 뗄 수 없습니다. 낯선 사람으로 남는 것도 그 일의 절반입니다.',
  'man.close': '돌아가기',

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
  'turn.between': '약실이 장전되었습니다',
  'turn.yours': '당신 차례',
  'turn.theirs': '{name} 차례',
  'turn.betweenHint': '무엇이 들어갔는지 세십시오',
  'turn.rootedHint': '아무도 못 움직입니다',
  'turn.heldTitle': '손에 든 카드 수',
  'turn.stickTitle': '불붙은 다이너마이트를 들고 있음',

  // 약실 · 겨눔
  'cham.left': '약실에 {n}발',
  'cham.mix': '실탄 {live} · 공포탄 {blank}',
  'aim.onYou': '겨눠졌다',
  'aim.brace': 'Space — 몸을 피하고 카드를 씁니다',
  'aim.nothing': '막을 것이 손에 없습니다',

  // 여든 장
  'duel.aimFirst': '먼저 상대를 조준하십시오',
  'man.readTitle': '판 읽기',
  'man.read': '누구의 손패도 공개되지 않지만, <b>몇 장을 들고 있는지</b>는 공개되며 <b>앞에 펼쳐 놓은 것</b>도 전부 공개됩니다 — 내려놓은 총, 뒤에 선 빗물통, 한 자리 더 멀어지게 해주는 말. 전부 화면 위쪽 차례 순서에 이름과 나란히 표시되고, 한 바퀴가 도는 동안 계속 바뀝니다. 카드가 한 장 남은 사람은 대꾸할 수단이 거의 없다는 뜻입니다.',
  'man.keepHint': '자기 손패 위에 <b>가질 수 있는 장수</b>가 적혀 있습니다. 넘는 만큼은 차례가 끝날 때 더미로 버려지니, 아껴 둔 카드는 버린 카드입니다. 그 옆의 숫자는 마을 전체가 뽑아 쓰는 <b>더미에 남은 장수</b>입니다.',
  'duel.holding': '<b>{n}</b>장 — 가질 수 있는 건 {limit}장',
  'duel.pileLeft': '더미에 {n}장',
  'duel.bang.name': '한 발',
  'duel.missed.name': '빗나감',
  'duel.beer.name': '맥주',
  'duel.saloon.name': '살룬',
  'duel.stagecoach.name': '역마차',
  'duel.wells.name': '금고 마차',
  'duel.store.name': '잡화점',
  'duel.panic.name': '낚아채기',
  'duel.catbalou.name': '재로',
  'duel.indians.name': '능선의 먼지',
  'duel.gatling.name': '개틀링',
  'duel.duel.name': '결투',
  'duel.barrel.name': '빗물통',
  'duel.scope.name': '망원 조준경',
  'duel.mustang.name': '머스탱',
  'duel.jail.name': '유치장',
  'duel.dynamite.name': '다이너마이트',
  'duel.volcanic.name': '볼캐닉',
  'duel.schofield.name': '스코필드',
  'duel.remington.name': '레밍턴',
  'duel.carabine.name': '기병 카빈',
  'duel.winchester.name': '윈체스터',
  'duel.bang.rules': '방아쇠를 당길 수 있게 해주는 유일한 카드. 한 차례에 한 장 — 손에 든 총이 달리 말하지 않는 한.',
  'duel.missed.rules': '총알이 당신을 찾은 순간 소모됩니다. 대신 아무것도 찾지 못하게 됩니다.',
  'duel.beer.rules': '한 대 회복. 단 둘만 남으면 아무 값어치도 없습니다.',
  'duel.saloon.rules': '서 있는 사람 전원이 한 대씩 회복 — 당신을 죽이려는 자들까지.',
  'duel.stagecoach.rules': '지금 두 장 더.',
  'duel.wells.rules': '지금 세 장 더.',
  'duel.store.rules': '살아있는 사람 수만큼 펼칩니다. 당신부터 순서대로 한 장씩.',
  'duel.panic.rules': '손 닿는 거리에 있는 사람에게서 카드 한 장 — 손에서든, 앞에 깔린 것에서든.',
  'duel.catbalou.rules': '이 마을 누구든 카드 한 장을 버리게 합니다. 거리 무관. 당신이 갖지는 못합니다.',
  'duel.indians.rules': '당신 말고 전원이 「한 발」을 버리거나 한 대 맞습니다.',
  'duel.gatling.rules': '거리 무관, 살아있는 전원에게 한 발씩. 각자 「빗나감」으로 답할 수 있습니다.',
  'duel.duel.rules': '누구든 불러냅니다. 불린 쪽부터 번갈아 「한 발」을 내려놓고, 먼저 떨어진 쪽이 맞습니다.',
  'duel.barrel.rules': '뒤에 설 것. 당신에게 오는 모든 총알이 대신 이걸 맞을 가능성이 생깁니다.',
  'duel.scope.rules': '모든 것이 한 걸음 가까워집니다. 총이 그만큼 더 멀리 닿습니다.',
  'duel.mustang.rules': '실제보다 한 걸음 밖에 있게 됩니다. 남들이 당신에게 와야 합니다.',
  'duel.jail.rules': '한 명을 가둡니다. 그는 차례를 통째로 잃을 수 있습니다 — 별을 단 자는 예외입니다.',
  'duel.dynamite.rules': '불이 붙은 채 차례를 따라 돕니다. 언젠가 어딘가에서 세 대치로 멈춥니다.',
  'duel.volcanic.rules': '가까이서만 — 대신 손에 든 「한 발」을 몇 장이든 쏠 수 있습니다.',
  'duel.schofield.rules': '처음 들고 있던 쇠붙이의 두 배까지 닿습니다.',
  'duel.remington.rules': '세 걸음 밖까지 닿습니다.',
  'duel.carabine.rules': '네 걸음 밖까지 닿습니다.',
  'duel.winchester.rules': '거리 저쪽 끝까지 닿습니다.',

  // What a card is, in one word - shown where the printed face will go.
  'duel.kind.shot': '사격',
  'duel.kind.reaction': '반응',
  'duel.kind.play': '즉시',
  'duel.kind.target': '지목',
  'duel.kind.gear': '앞에 깔기',
  'duel.kind.weapon': '무기',
  'duel.kind.curse': '남에게 깔기',

  // ------------------------------------------------------- what bots say
  // Bots talk, and half the deduction layer is people reading what they said
  // against what they did. A Korean player who cannot read it is playing a
  // different game, so these are the same lines said again rather than a
  // gloss on them. No particle stands behind a name.
  'bot.sus1': '방금 누가 허공에다 쐈습니다. 누굽니까?',
  'bot.sus2': '{name} — 저렇게 조용한 게 마음에 안 듭니다.',
  'bot.sus3': '{name} — 자꾸 내 주위를 도는군요. 해명하시죠.',
  'bot.sus4': '{place} 쪽에서 총소리가 났습니다.',
  'bot.fr1': '{name}, 당신하고 나, 등 맞대고 갑시다.',
  'bot.fr2': '총구만 내리고 있으면 휴전은 유지됩니다.',
  'bot.fr3': '나는 당신하고 싸울 생각 없습니다.',
  'bot.ac1': '{name} — 저쪽이 먼저 쐈습니다. 내가 봤습니다.',
  'bot.ac2': '{name}입니다. 그럴 수밖에 없습니다.',
  'bot.ac3': '{name} — 저 사람한테 등 보이지 마십시오.',
  'bot.hu1': '맞았습니다! {name}가 했습니다!',
  'bot.hu2': '{place} 근처에서 누가 나한테 납을 박았습니다.',
  'bot.la1': '당신들이 뭘 믿든, 나는 법 쪽입니다.',
  'bot.la2': '내려놓으십시오. 오늘 아무도 묻히지 않아도 됩니다.',
  'hud.deadTag': '(사망)',
  'hud.beltGun': '벨트 총',
  'hud.metres': 'm 사거리',

  // ------------------------------------------------------ the timeline
  // The round's public account, on the aftermath screen. Everything here has
  // a name in front of it, so nothing here has a particle behind one.
  'tl.nothing': '기록에 남을 만한 일은 아무도 하지 않았습니다.',
  'tl.storm': '{who} — 모래폭풍 속에서 숨이 막힘',
  'tl.left': '{who} — 마을을 떠남',
  'tl.killed': '{killer} — {where} {who} 사살',
  'tl.died': '{who} — {where} 사망',
  'tl.card': '{who} — {card} 사용',
  'tl.cardSecret': '{who} — {card} 사용 (아무도 몰랐음)',
  'tl.cardOn': '{who} — {target}에게 {card} 사용',
  'tl.badge': '{who} — 별을 달았음',
  'tl.accuse': '{who} — {target} 지목',

  // -------------------------------------------------- the thread you pull
  // One sentence each, and it is most of what anybody has to go on all round.
  'intel.pair': '보안관은 이 둘 중 하나입니다: {a}  또는  {b}.',
  'intel.alone': '당신은 혼자 왔습니다. 나머지 패거리는 끝내 도착하지 못했습니다.',
  'intel.mate': '패거리 중 얼굴 하나를 알아봅니다 — {name}.',
  'intel.nothing': '여기 있는 누구에 대해서도 아는 것이 없습니다. 잘된 일입니다.',
  'intel.lawman': '{name} — 별이든 아니든, 어떤 종류의 배지를 달고 있다는 것을 압니다.',
  'intel.sheriff': '아무도 당신 얼굴을 모릅니다. 계속 그렇게 두거나, 별을 달고 덤벼보라고 하거나.',

  // ------------------------------------------------------- the kill feed
  // The one line everybody reads. Composed on the client, because who is told
  // what depends on who saw it - so the server sends the facts and the HUD
  // says them, in whichever language it is in.
  'kill.youDiedTo': '{killer} — 당신을 {where} 눕혔습니다.',
  'kill.youDied': '{where} 죽었습니다.',
  'kill.youKilled': '{victim} 사살 — 정체 {role}.',
  'kill.watched': '{killer} — {victim} 죽이는 장면을 당신이 봤습니다. 정체 {role}.',
  'kill.storm': '{victim} — 모래폭풍 속에서 숨이 막혔습니다. 정체 {role}.',
  'kill.left': '{victim} — 마을을 떠났습니다. 정체 {role}.',
  'kill.unseen': '{where} 총성 한 발. {victim} 사망 — 정체 {role}. 누가 쐈는지는 아무도 못 봤습니다.',

  // -------------------------------------------------------------- places
  // English puts the preposition in front of the name and Korean puts it on
  // the end, so the place and the phrase it sits in are separate keys.
  'place.saloon': '살룬',
  'place.office': '보안관 사무소',
  'place.store': '잡화점',
  'place.mine': '광산',
  'place.stable': '마구간',
  'place.church': '교회',
  'place.cemetery': '공동묘지',
  'place.main': '큰길',
  'place.alleys': '뒷골목',
  'place.tower': '급수탑',
  'place.flats': '벌판',
  'place.in': '{p}에서',
  'place.outside': '{p} 바로 밖에서',
  'place.roof': '{p} 위 지붕에서',
  'place.between': '{a:과/와} {b} 사이 공터에서',
  'place.outskirts': '마을 바깥 사막에서',

  // ------------------------------------------------------------ the feed
  // The server composes these in English and sends the key and the holes with
  // them. Nobody's name is ever standing in front of a particle: a Latin name
  // takes the particle its Korean reading takes and the reading is not in the
  // spelling, so these are written round the problem rather than into it.
  'feed.barrelSoak': '빗물통이 대신 맞았습니다. 쏜 자는 자기가 빗맞혔다고 믿고 있습니다.',
  'feed.bought': '아무도 못 봤습니다. 돈값은 했습니다.',
  'feed.outOfDark': '어둠 속에서 날아온 총알. 쏜 얼굴은 끝내 보지 못했습니다.',
  'feed.ledger': '장부가 알아서 적힙니다. 방금 그건 누가 했는지 알게 되었습니다.',
  'feed.blankMine': '공포탄. 연기와 소리뿐입니다.',
  'feed.blankAtYou': '당신을 겨눈 한 발 — 공포탄이었습니다.',
  'feed.tooFar': '너무 멉니다. 총알은 아무 의미 없는 곳으로 빗나갑니다.',
  'feed.intoBarrel': '총알이 빗물통에 박혔습니다.',
  'feed.woodNotMeat': '살이 아니라 나무였습니다.',
  'feed.notThere': '그가 생각한 자리에 당신은 없었습니다.',
  'feed.heWasReady': '빗나갔습니다. 상대는 준비하고 있었습니다.',
  'feed.neverMoved': '손에 들고 있으면서 움직이지 않았습니다.',
  'feed.patchedYou': '{name} — 당신을 치료했습니다 (+{n}).',
  'feed.youPatched': '{name} 치료 완료.',
  'feed.bandagedSelf': '스스로 붕대를 감았습니다 (+{n}).',
  'feed.callsOut': '{a} — {b} 앞으로 불러냈습니다.',
  'feed.pinsStar': '{name} — 별을 달고 법을 자처합니다. 믿을지 말지는 각자 알아서.',
  'feed.storeOut': '{name} — 잡화점을 펼쳤습니다.',
  'feed.noSights': '조준선 안에 이름 붙일 사람이 없습니다.',
  'feed.swept': '뒤쪽 거리를 쓸었습니다. 남긴 발자국이 전부 사라졌고, 한동안 남지도 않습니다.',
  'feed.glass': '유리를 눈에 댑니다. 몇 초 동안 이 마을에서 울리는 모든 총성에 얼굴이 붙습니다.',
  'feed.poster': '{a} — 교회 문에 수배 전단을 박았습니다. 이름은 {b}.',
  'feed.postered': '당신 이름이 방금 교회 문에 걸렸습니다. 마을 전체가 읽을 수 있습니다.',
  'feed.backAlive': '돌아왔습니다. 몸은 거리에서 한 발짝도 움직이지 않았습니다 — 그 조용한 틈을 아무도 쓰지 않았기를.',
  'feed.backDead': '돌아왔습니다. 그리고 여전히 죽어 있습니다.',
  'feed.rolesDealt': '역할이 배분되었습니다. 교회 종이 울릴 때까지 총은 총집에.',
  'feed.bell': '종이 울립니다. 이제 총집에 있는 것은 없습니다.',
  'feed.storm': '모래폭풍이 마을 광장으로 조여옵니다. 들어오거나, 숨이 막히거나.',
  'feed.stickGoesOff': '{name} — 손에 쥔 채로 터졌습니다.',
  'feed.fusePassed': '심지는 아직 타고 있습니다. 옆으로 넘깁니다.',
  'feed.handedStick': '누군가 불붙은 다이너마이트를 당신 손에 쥐여줍니다.',
  'feed.outOfCell': '{name} — 유치장에서 나왔습니다.',
  'feed.behindBars': '{name} — 차례를 창살 안에서 보냅니다.',
  'feed.chamberLoaded': '약실 장전 완료: 실탄 {live}, 공포탄 {blank}. 순서는 아무에게도 알려주지 않습니다.',
  'feed.shiftWeight': '몸의 무게를 옮깁니다.',
  'feed.selfClick': '{name} — 자기 머리에 대고 당겼습니다. 딸깍.',
  'feed.selfLive': '{name} — 자기 머리에 대고 당겼습니다. 공포탄이 아니었습니다.',
  'feed.throughInto': '총알은 그대로 관통해 뒤에 서 있던 {name}에게 박혔습니다.',

  // ------------------------------------------------------ the sixteen
  'feed.needTwo': '한 장으로는 부족했습니다. 그는 두 발을 박습니다.',
  'feed.lifted': '{name} — 당신 손에서 한 장 빼갔습니다.',
  'feed.offTheFloor': '{name} — 버려진 「{card}」을 바닥에서 도로 집었습니다.',
  'feed.showsRed': '{name} — 「{card}」을 뒤집어 보입니다. 붉은 패, 한 장 더 가져갑니다.',
  'feed.showsBlack': '{name} — 「{card}」을 뒤집어 보입니다. 검은 패, 여기까지입니다.',
  'feed.bleedsSlow': '손에 {n}장이 더 들어옵니다.',
  'feed.takesItBack': '{name} — 그 대가로 당신에게서 한 장 가져갑니다.',
  'feed.pockets': '{name}의 주머니를 뒤집니다. 손에 {n}장이 더 들어옵니다.',
  'feed.neverEmpty': '손이 비는 순간 이미 무언가가 들려 있습니다.',
  'gun.nothingToPress': '당신의 능력은 부탁하지 않아도 알아서 일합니다.',
  'gun.notYourGo': '남의 차례에는 안 됩니다.',
  'gun.needTwoCards': '그건 카드 두 장이 드는데, 두 장이 없습니다.',
  'gun.twoForOne': '두 장 버리고, 한 대 회복.',

  // The sixteen themselves. The names are ours and stay as they are; what each
  // one does is the line under it.
  'gun.ironhide.ability': '천천히 흘린다',
  'gun.ironhide.desc': '그에게 꽂히는 모든 한 방이 손에 카드를 한 장씩 더 얹습니다. 쏘는 것이 곧 무장시키는 것입니다.',
  'gun.scavenger.ability': '되받는다',
  'gun.scavenger.desc': '그를 때린 자는 그 대가로 카드 한 장을 잃습니다. 대신 세 대면 끝입니다.',
  'gun.cutpurse.ability': '가벼운 손끝',
  'gun.cutpurse.desc': '두 장 중 첫 장을 더미가 아니라 남의 손에서 가져올 수 있습니다.',
  'gun.ragpicker.ability': '바닥에서 줍는다',
  'gun.ragpicker.desc': '두 장 중 첫 장을 버린 더미 맨 위에서, 모두가 보는 앞에서 가져올 수 있습니다.',
  'gun.cardsharp.ability': '둘째 장을 보인다',
  'gun.cardsharp.desc': '둘째 장을 뒤집어 보입니다. 붉은 패면 한 장 더 — 그것도 뒤집어서.',
  'gun.surveyor.ability': '셋 보고 둘',
  'gun.surveyor.desc': '차례가 오면 세 장을 보고 두 장을 남깁니다. 나머지 한 장은 더미로 돌아갑니다.',
  'gun.cooper.ability': '통 뒤에서 태어났다',
  'gun.cooper.desc': '찾지 않아도 빗물통 하나를 끼고 섭니다. 그에게 오는 모든 총알이 나무를 만날 수 있습니다.',
  'gun.drifter.ability': '늘 한 걸음 밖',
  'gun.drifter.desc': '모두가 그녀에게 한 걸음 못 미칩니다. 세 대뿐이지만, 그 세 대가 쉽지 않습니다.',
  'gun.spotter.ability': '지형을 읽는다',
  'gun.spotter.desc': '모든 것이 한 걸음 가까워집니다. 그만큼 총이 멀리 닿습니다.',
  'gun.ambidexter.ability': '어느 손으로든',
  'gun.ambidexter.desc': '「한 발」을 「빗나감」으로, 「빗나감」을 「한 발」로 씁니다. 그의 손에 죽은 카드는 없습니다.',
  'gun.butcher.ability': '두 발을 박는다',
  'gun.butcher.desc': '그의 한 방을 피하려면 「빗나감」이 두 장 필요합니다. 한 장으로는 안 됩니다.',
  'gun.emptyhand.ability': '비지 않는다',
  'gun.emptyhand.desc': '손이 비는 순간 한 장을 뽑습니다. 그녀는 아무것도 안 들고 있는 법이 없습니다.',
  'gun.quickdraw.ability': '가진 만큼',
  'gun.quickdraw.desc': '한 차례 한 발 제한이 없습니다. 손에 든 「한 발」을 원하는 만큼 전부 쏩니다.',
  'gun.fortunate.ability': '확률이 두 번',
  'gun.fortunate.desc': '무언가를 뽑아야 할 때마다 두 번 뽑고, 그중 하나를 고릅니다.',
  'gun.fieldsurgeon.ability': '둘 주고 하나',
  'gun.fieldsurgeon.desc': '카드 두 장을 버리고 한 대를 회복합니다. 자기 차례라면 몇 번이든. (G)',
  'gun.undertaker.ability': '주머니를 뒤진다',
  'gun.undertaker.desc': '죽은 자의 손에 있던 것은 전부 그의 손으로 갑니다. 마을의 모든 시체가 그에게 값을 치릅니다.',

  // ------------------------------------------------- the eighty, in play
  'duel.say.reaction': '그건 남이 당신을 쐈을 때 쓰는 카드입니다.',
  'duel.say.gearOut': '이미 하나 깔아두었습니다.',
  'duel.say.noCurseTarget': '그걸 씌울 상대가 없습니다.',
  'duel.say.notTheStar': '별을 단 자에게는 안 됩니다.',
  'duel.say.alreadyIn': '이미 갇혀 있습니다.',
  'duel.say.noTarget': '그 카드를 쓸 상대가 없습니다.',
  'duel.say.notClose': '그러기엔 너무 멉니다.',
  'duel.say.nothingToTake': '가져올 것이 없습니다.',
  'duel.say.noPouring': '둘만 남으면 아무도 술을 따라주지 않습니다.',
  'duel.say.notHurt': '그걸 원할 만큼 다치지 않았습니다.',
  'duel.say.oneBack': '한 대 회복.',
  'duel.say.moreCards': '{n}장 더.',
  'duel.tell.weapon': '{name} — 「{card}」 탁자에 올려놓았습니다.',
  'duel.tell.gear': '{name} — 「{card}」 앞에 깔았습니다.',
  'duel.tell.lights': '{name} — 심지에 불을 붙여 내려놓았습니다.',
  'duel.tell.jail': '{a} — {b} 유치장에 처넣었습니다.',
  'duel.tell.panic': '{a} — {b}에게서 한 장 낚아챘습니다.',
  'duel.tell.catbalou': '{a} — {b}에게 카드 한 장을 버리게 했습니다.',
  'duel.tell.saloon': '{name} — 모두에게 한 잔씩 돌렸습니다.',
  'duel.tell.indians': '{name} — 능선을 가리킵니다.',
  'duel.tell.gatling': '{name} — 거리 전체를 향해 갈겼습니다.',

  // ------------------------------------------- picked up, and no room for it
  'deny.full.whiskey': '그걸 원할 만큼 다치지 않았습니다.',
  'deny.full.ammo': '탄띠가 전부 꽉 찼습니다.',
  'deny.full.dynamite': '한 개도 더 들 수 없습니다.',
  'deny.full.shotgun': '산탄총도, 그에 맞는 탄도 이미 다 있습니다.',
  'deny.full.rifle': '레버 소총도, 그에 맞는 탄도 이미 다 있습니다.',
  'deny.full.other': '그건 당신에게 쓸모가 없습니다.',
  'card.barrel.armed': '빗물통을 굴려다 놓았습니다. 다음에 당신을 찾아온 총알은 물을 찾게 됩니다.',
  'card.witness.armed': '돈이 오갔습니다. 당신의 다음 살인은 일어나지 않은 일이 됩니다.',
  'card.ledger.armed': '장부가 펼쳐졌습니다. 이 마을에서 다음으로 죽는 자가 당신 대신 이름을 적습니다.',

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
  'role.yourHands': '당신의 손이 하는 일',
  'role.dealtToYou': '받은 카드 — <b>Z</b> 와 <b>X</b> 로 사용',
  'role.dealtDuel': '받은 카드 — <b>숫자키</b>로 사용',
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
  // How a round ended, in one line, on the aftermath screen.
  'end.renegadeDust': '배신자가 흙먼지 속에 홀로 서 있습니다.',
  'end.starDead': '보안관이 죽었습니다. 패거리는 두둑하게 챙겨 떠납니다.',
  'end.starFellRenegade': '별이 떨어졌고, 마지막으로 방아쇠에 손을 얹고 있던 자는 배신자였습니다.',
  'end.holdsBleeding': '보안관이 숨을 거두기 전에 적대자가 전부 죽었습니다. 마을은 버팁니다.',
  'end.allBuried': '무법자도 배신자도 전부 묻혔습니다. 법이 퍼디션 플랫츠를 지켰습니다.',
  'end.lastSoul': '배신자가 마지막 한 사람으로 남았습니다.',
  'end.buzzards': '아무도 걸어 나가지 못했습니다. 이긴 건 독수리들입니다.',
  'end.lawGone': '법 쪽은 전멸했습니다.',
  'end.sundown': '해가 졌습니다. 보안관은 아직 서 있고, 마을은 이름을 지켰습니다.',
  'end.stormTook': '남아 있던 자들은 모래폭풍이 데려갔습니다.',

  // What the Gambler turned over.
  'boon.speed': '박차의 에이스 — 발이 빨라졌다',
  'boon.armour': '쇳조각 — 충격이 먹혔다',
  'boon.ammo': '가득 찬 탄띠 — 모든 총이 장전됐다',
  'boon.damage': '뜨거운 손 — 총알이 더 깊이 박힌다',
  'boon.dust': '흙먼지 — 이름도, 뚜렷한 형체도 없다',
  'boon.bust': '꽝 — 덱이 차가웠다',

  // Chips over the bottom of the screen.
  'chip.badge': '별을 달았다',
  'chip.speedMult': '발이 빨라졌다',
  'chip.damageMult': '손이 뜨겁다',
  'chip.spreadMult': '겨눈 곳에 박힌다',
  'chip.fireRateMult': '방아쇠가 가볍다',
  'chip.dust': '흙먼지',
  'chip.resist': '쇳조각을 덧댔다',
  'ui.nobodyYet': '아직 아무도 없음',
  'ui.botTag': '봇',

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
  'deny.shootIt': '그건 키가 아니라 방아쇠로 씁니다.',
  'deny.reactionCard': '그건 총에 맞을 때 쓰는 카드입니다.',
  'deny.noBang': '총에 넣을 것이 손에 없습니다.',

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
/**
 * Does this word end in a closing consonant? Korean picks half its particles on
 * the answer - 이 or 가, 은 or 는, 을 or 를 - so a sentence cannot know its own
 * grammar until the word arrives.
 *
 * For Hangul the question is arithmetic: a syllable block is
 * 0xAC00 + (initial * 588) + (vowel * 28) + final, so a remainder of zero means
 * no final consonant, and this is exact.
 *
 * For anything else it is not answerable. A Latin name takes the particle its
 * *Korean reading* takes, and the reading is not in the spelling: Vane is 베인
 * and closes, Kessler is 케슬러 and does not, and the two of them end in the
 * same letters. So there is no heuristic here - non-Hangul takes the closed
 * form and the strings in this file are written so that no player's name is
 * ever standing in front of a particle. Use this for words we chose ourselves.
 */
export function closed(word) {
  const s = String(word ?? '').trim();
  if (!s) return false;
  const code = s.charCodeAt(s.length - 1);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  return true;
}

/**
 * Fill the holes. `{name}` is the value; `{name:이/가}` is the value followed by
 * whichever of those two the value takes, which is the whole of why Korean
 * cannot be done with the same string table as English.
 */
function fill(text, params) {
  if (!params) return text;
  const value = (key) => (Object.prototype.hasOwnProperty.call(params, key) ? params[key] : undefined);
  return String(text).replace(/\{(\w+)(?::([^{}/]+)\/([^{}]+))?\}/g, (whole, key, a, b) => {
    const v = value(key);
    if (v === undefined) return whole;
    const word = String(v);
    return a ? word + (closed(word) ? a : b) : word;
  });
}

/**
 * A hole whose value is itself a word that gets translated.
 *
 * The server puts a card name in a sentence and can only send the English of
 * it, so it sends the key beside it: { card: 'Barrel', cardKey: 'duel.barrel.name' }
 * becomes { card: '빗물통' } before the sentence is filled in. The English
 * already in the hole is the fallback, which is the rule everywhere else here.
 */
export function resolve(lang, params) {
  if (!params) return params;
  const out = { ...params };
  for (const [key, v] of Object.entries(params)) {
    if (!key.endsWith('Key') || typeof v !== 'string') continue;
    const base = key.slice(0, -3);
    out[base] = t(lang, v, out[base] ?? '');
    delete out[key];
  }
  return out;
}

/** A line the server composed, said in this language. Key, English, holes. */
export function line(lang, msg) {
  if (!msg || !msg.k) return msg?.text ?? '';
  return t(lang, msg.k, msg.text, resolve(lang, msg.p));
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
