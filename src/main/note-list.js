// 목록 패널에 보낼 목록을 만든다. 검색어도 여기서 들고 있는다.
//
// 검색은 메인에서 한다. 화면 쪽에서 거르려면 모든 메모의 본문을 매번 넘겨야 하는데,
// 그 비용이 메모 수에 그대로 비례한다.

const { settings } = require('./settings-store');
const { readNotes, noteIdsByRecency } = require('./note-store');

let listQuery = '';

function setQuery(query) {
  listQuery = typeof query === 'string' ? query.trim() : '';
}

// 메모 하나에 설정 쪽 정보를 붙인다. 별이 켜져 있는지, 단축키가 걸려 있는지, 조회 전용인지.
function withMeta(note) {
  return {
    ...note,
    favorite: settings.favorites.includes(note.id),
    shortcut: settings.noteShortcuts[note.id] || null,
    viewOnly: settings.viewOnlyNotes.includes(note.id),
  };
}

function matchesQuery(note, query) {
  if (!query) return true;
  const needle = query.toLowerCase();
  return note.title.toLowerCase().includes(needle) || note.content.toLowerCase().includes(needle);
}

// 본문은 검색에만 쓰고 화면으로는 보내지 않는다. 목록이 그리는 데 필요한 것은 제목뿐이다.
function forList({ content, ...rest }) {
  return rest;
}

// 목록은 즐겨찾기가 위, 나머지가 아래. 즐겨찾기는 별을 누른 순서로 자리가 고정된다.
// pendingEdit은 아직 저장되지 않은 편집 내용이다. 그것까지 넣어야 방금 친 글자가 검색에 걸린다.
function buildList(pendingEdit) {
  const notes = readNotes(pendingEdit)
    .map(withMeta)
    .filter((n) => matchesQuery(n, listQuery));
  const byId = new Map(notes.map((n) => [n.id, n]));
  const favorites = settings.favorites.map((id) => byId.get(id)).filter(Boolean);
  const others = notes.filter((n) => !n.favorite).sort((a, b) => b.mtime - a.mtime);
  return { favorites: favorites.map(forList), others: others.map(forList), query: listQuery };
}

// 화면 목록과 같은 순서. 즐겨찾기가 위(별을 누른 순서), 나머지가 수정일시 최신순이다.
// buildList()와 같은 규칙이어야 Ctrl+PageUp/PageDown이 눈에 보이는 대로 움직인다.
function noteIdsInListOrder() {
  const recent = noteIdsByRecency();
  const favorite = new Set(settings.favorites);
  const favorites = settings.favorites.filter((id) => recent.includes(id));
  return [...favorites, ...recent.filter((id) => !favorite.has(id))];
}

module.exports = { setQuery, buildList, noteIdsInListOrder };
