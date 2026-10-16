// 메모 파일 자체를 다루는 곳. 디스크에 있는 것만 안다.
//
// 즐겨찾기인지, 단축키가 걸렸는지, 지금 편집 중인지는 여기서 다루지 않는다. 그런 것들은
// 설정이나 편집 세션이 들고 있고, 이 파일은 파일 이름·내용·수정시각까지만 본다.

const fs = require('fs');
const { NOTES_DIR, listNoteFiles } = require('./paths');
const { writeAtomic } = require('./atomic-write');
const path = require('path');

// 메모 id는 곧 파일 이름이다. 화면 쪽에서 넘어온 값을 그대로 경로에 붙이지 않도록,
// 앱이 만드는 형식인지 먼저 확인한다.
const NOTE_ID_PATTERN = /^[0-9]{8}-[0-9]{6}(-[0-9]+)?\.txt$/;

function isNoteId(id) {
  return typeof id === 'string' && NOTE_ID_PATTERN.test(id);
}

function notePath(id) {
  return path.join(NOTES_DIR, id);
}

function noteExists(id) {
  return isNoteId(id) && fs.existsSync(notePath(id));
}

function createNoteId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const base = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  let id = `${base}.txt`;
  let n = 1;
  while (fs.existsSync(notePath(id))) {
    id = `${base}-${n}.txt`;
    n += 1;
  }
  return id;
}

function readNote(id) {
  try {
    return fs.readFileSync(notePath(id), 'utf8');
  } catch {
    return '';
  }
}

// 성공하면 null, 실패하면 알릴 말을 돌려준다.
function writeNote(id, content) {
  return writeAtomic(notePath(id), content, '메모 저장 실패');
}

function titleOf(content) {
  const first = content.split(/\r?\n/).find((line) => line.trim() !== '');
  return first ? first.trim().slice(0, 80) : '';
}

// 목록은 저장할 때마다 다시 그려진다. 그때마다 모든 메모를 디스크에서 다시 읽으면
// 메모가 쌓일수록 타이핑이 무거워진다. 수정시각이 그대로인 메모는 여기 담아 둔 것을 쓴다.
const noteCache = new Map();

function cachedNote(id, mtime) {
  const hit = noteCache.get(id);
  if (hit && hit.mtime === mtime) return hit;
  const content = readNote(id);
  const entry = { mtime, content, title: titleOf(content) };
  noteCache.set(id, entry);
  return entry;
}

function mtimeOf(id) {
  try {
    return fs.statSync(notePath(id)).mtimeMs;
  } catch {
    /* 읽는 사이에 사라진 파일은 목록에서만 빠지면 된다 */
    return 0;
  }
}

// 모든 메모의 { id, content, title, mtime }.
//
// pendingEdit은 아직 디스크에 닿지 않은 편집 내용이다({ id, content }). 편집 중인 메모는
// 이것까지 반영해야 목록과 검색이 디스크 내용만 보고 어긋나는 일이 없다.
function readNotes(pendingEdit = null) {
  const files = listNoteFiles();
  if (!files) return [];

  // 지워진 메모는 캐시에서도 걷어낸다. 그러지 않으면 앱을 켜 둔 내내 쌓이기만 한다.
  const alive = new Set(files);
  for (const id of noteCache.keys()) {
    if (!alive.has(id)) noteCache.delete(id);
  }

  return files.map((id) => {
    const mtime = mtimeOf(id);
    const content = pendingEdit && pendingEdit.id === id ? pendingEdit.content : cachedNote(id, mtime).content;
    return { id, content, title: titleOf(content), mtime };
  });
}

// 순서만 필요하므로 내용은 읽지 않는다.
function noteIdsByRecency() {
  const files = listNoteFiles();
  if (!files) return [];

  return files
    .map((id) => ({ id, mtime: mtimeOf(id) }))
    .sort((a, b) => b.mtime - a.mtime)
    .map((n) => n.id);
}

module.exports = {
  isNoteId,
  notePath,
  noteExists,
  createNoteId,
  readNote,
  writeNote,
  titleOf,
  readNotes,
  noteIdsByRecency,
};
