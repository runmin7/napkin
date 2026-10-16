// 지금 편집 중인 메모와, 그것을 둘러싼 동작들.
//
// 편집 중인 내용은 메인 프로세스가 들고 있다가 저장 시점마다 디스크로 내려쓴다.
// 렌더러에 저장을 요청하고 응답을 기다리는 구조였다면 창이 닫히는 순간의 저장을 놓칠 수 있다.
//
// 이 파일이 다루는 것은 전부 "지금 열려 있는 메모"를 중심으로 돈다. 저장, 다른 메모로
// 넘어가기, 목록 새로 그리기, 즐겨찾기와 단축키 걸기까지. 억지로 더 쪼개면 서로를 부르는
// 배선만 늘어 흐름을 따라가기가 오히려 어려워진다.

const { dialog, shell } = require('electron');
const { NOTES_DIR } = require('./paths');
const { settings, saveSettings, pruneMissing, rememberLastNote } = require('./settings-store');
const {
  isNoteId,
  notePath,
  noteExists,
  createNoteId,
  readNote,
  writeNote,
  titleOf,
  readNotes,
  noteIdsByRecency,
} = require('./note-store');
const { setQuery, buildList, noteIdsInListOrder } = require('./note-list');
const { SHORTCUT_LABELS, findAcceleratorOwner } = require('./accelerators');
const { applyShortcuts, registerShortcuts } = require('./shortcuts');
const { renderMarkdown } = require('./markdown');
const windows = require('./windows');
const saveFailure = require('./save-failure');
const { NOTE, LIST } = require('../../shared/channels');

// draft 객체는 참조를 고정한다. 내용을 갈아 끼울 때도 새 객체를 만들지 않고 덮어쓴다.
const draft = { id: null, content: '', savedContent: null };
let draftTimer = null;
const AUTOSAVE_DELAY = 600;

// 메모를 훑는 동안에는 목록 순서를 고정한다. 저장으로 수정시각이 바뀌어도 훑던 순서가 흔들리지 않는다.
let navOrder = null;
// 그 순서가 검색으로 걸러진 것이었는지. 걸러진 범위는 훑는 내내 지켜야 한다.
let navFiltered = false;

/* ---------------------------------------------------------------- 자동 저장 */

function replaceDraft(id, content, savedContent) {
  Object.assign(draft, { id, content, savedContent });
}

// 아직 디스크에 닿지 않은 편집 내용. 목록과 검색이 방금 친 글자까지 보게 한다.
function pendingEdit() {
  return draft.id ? { id: draft.id, content: draft.content } : null;
}

// 화면에만 있고 디스크에는 아직 없는 내용이 있는가.
function isDirty() {
  return draft.savedContent !== draft.content;
}

function setDraftContent(content) {
  draft.content = content;
  updateEditorTitle();
  scheduleAutosave();
}

function scheduleAutosave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(flushDraft, AUTOSAVE_DELAY);
}

// 지금 바로 디스크에 내려쓴다. 저장된(또는 이미 저장되어 있던) 메모의 id를 돌려주고,
// 쓸 것이 없으면 null을 돌려준다.
function flushDraft() {
  clearTimeout(draftTimer);
  draftTimer = null;

  if (draft.id === null) {
    // 빈 메모는 파일을 만들지 않는다. 첫 글자가 들어온 순간에야 파일이 생긴다.
    if (draft.content.trim() === '') return null;
    draft.id = createNoteId();
    draft.savedContent = null;
  }
  // 내용이 그대로면 쓰지 않는다. 열어보기만 했을 때 수정시각이 밀려 목록 순서가 뒤바뀌는 것을 막는다.
  if (!isDirty()) return draft.id;

  const failure = writeNote(draft.id, draft.content);
  if (failure) {
    saveFailure.report(failure);
    return draft.id;
  }
  saveFailure.clear();

  draft.savedContent = draft.content;
  rememberLastNote(draft.id);

  windows.sendToEditor(NOTE.SAVED, { id: draft.id, at: Date.now() });
  refreshList();
  return draft.id;
}

function confirmLeaveUnsaved(detail) {
  return saveFailure.confirmLeaveUnsaved(detail, isDirty());
}

// 메모를 갈아 끼우기 직전에 부른다. 넘어가도 좋다고 답해야 true.
function mayReplaceDraft() {
  return confirmLeaveUnsaved(
    '지금 다른 메모로 넘어가면 방금 쓴 내용이 사라집니다.\n\n머물러서 내용을 다른 곳에 옮겨 두시기를 권합니다.'
  );
}

/* ---------------------------------------------------------------- 화면에 알리기 */

// 창 제목과 작업표시줄에 메모 첫 줄이 그대로 보이게 한다. 내용이 비면 앱 이름으로 돌아간다.
function updateEditorTitle() {
  windows.setEditorTitle(titleOf(draft.content) || '빠른 메모');
}

function editorPayload() {
  return {
    id: draft.id,
    content: draft.content,
    favorite: draft.id ? settings.favorites.includes(draft.id) : false,
    shortcut: draft.id ? settings.noteShortcuts[draft.id] || null : null,
    viewOnly: draft.id ? settings.viewOnlyNotes.includes(draft.id) : false,
  };
}

function sendEditorLoad() {
  updateEditorTitle();
  const payload = editorPayload();

  // 조회 전용으로 표시한 메모는 여는 순간 이미 렌더링된 모습이어야 한다. 본문과 같은 편에 실어
  // 보내면 편집기를 먼저 그렸다가 바꿔 끼우는 깜빡임이 없고, 화면과의 왕복도 한 번으로 끝난다.
  //
  // 표시가 없는 메모에서는 만들지 않는다. 메모를 열 때마다 쓰지도 않을 변환을 돌릴 이유가 없다.
  // 이 일을 editorPayload()가 아니라 여기서 하는 이유도 같다. 그쪽은 sendEditorMeta()도 쓰는데,
  // 거기에 html을 넣으면 별을 누를 때마다, 단축키를 걸 때마다 변환이 돈다.
  //
  // 표시는 걸려 있는데 보여 줄 것이 없는 메모는 편집기로 연다. 빈 화면을 주면 고장으로 보인다.
  // 변환이 실패해도 마찬가지다. 여기서 예외가 올라가면 note:load 자체가 나가지 못해, 화면은
  // 이전 메모를 띄운 채인데 메인은 이 메모를 쥔 어긋난 상태가 된다. 그대로 글을 치면
  // 이 메모 파일이 이전 메모의 내용으로 덮인다.
  if (payload.viewOnly) {
    try {
      const html = renderMarkdown(draft.content);
      if (html.trim() !== '') payload.html = html;
    } catch (err) {
      console.error('메모를 렌더링하지 못했습니다. 편집기로 엽니다:', err);
    }
  }

  windows.sendToEditor(NOTE.LOAD, payload);
}

// 편집 창의 별 표시 등 메모에 딸린 정보만 다시 보낸다. 본문은 건드리지 않는다.
function sendEditorMeta(id) {
  if (draft.id === id) windows.sendToEditor(NOTE.META, editorPayload());
}

function refreshList() {
  windows.sendToEditor(LIST.DATA, buildList(pendingEdit()));
}

function settingsPayload() {
  const notes = readNotes(pendingEdit());
  const byId = new Map(notes.map((n) => [n.id, n]));
  const noteShortcuts = Object.entries(settings.noteShortcuts).map(([id, accelerator]) => ({
    id,
    accelerator,
    title: byId.get(id) ? byId.get(id).title : '',
  }));
  return { shortcuts: { ...settings.shortcuts }, noteShortcuts };
}

// 설정 창이 닫혀 있으면 내용을 만들지도 않는다. settingsPayload()가 메모 폴더를 훑으므로,
// 메모를 지우거나 단축키를 걸 때마다 보지도 않을 목록을 읽는 일이 생긴다.
function refreshSettingsWindow() {
  if (!windows.hasSettingsWindow()) return;
  windows.sendToSettings(settingsPayload());
}

/* ---------------------------------------------------------------- 메모 열기 */

// silent는 자동 실행으로 켜진 경우다. 메모를 읽어 쥐고만 있고 창은 띄우지 않는다.
// 나중에 트레이나 단축키로 창을 열면 editor:ready가 sendEditorLoad를 부르므로
// 지금 쥔 내용이 그때 그대로 실린다. 창이 없는 동안 보낼 곳도 없는 것은 보내지 않는다.
function loadIntoEditor(id, { silent = false } = {}) {
  const content = id ? readNote(id) : '';
  replaceDraft(id, content, id ? content : null);
  rememberLastNote(id);
  if (silent) return;
  windows.showEditor();
  sendEditorLoad();
}

// 목록 선택이나 메모 단축키처럼 탐색 밖에서 들어오는 진입. 훑던 순서는 여기서 버린다.
function openNote(id) {
  if (!isNoteId(id)) return;
  flushDraft();
  if (!mayReplaceDraft()) return;
  navOrder = null;

  // 앱이 켜져 있는 동안 탐색기에서 지운 메모일 수 있다. 딸린 설정까지 함께 정리한다.
  if (!noteExists(id)) {
    pruneMissing();
    saveSettings();
    applyShortcuts();
    refreshList();
    refreshSettingsWindow();
    return;
  }
  loadIntoEditor(id);
}

function newNote() {
  flushDraft();
  if (!mayReplaceDraft()) return;
  navOrder = null;
  replaceDraft(null, '', null);
  windows.showEditor();
  sendEditorLoad();
}

// 앱을 켤 때 무엇을 보여 줄지 정한다.
// 마지막으로 보던 메모가 우선이고, 그 기록이 없어졌더라도 메모가 남아 있다면
// 빈 새 메모 대신 가장 최근 메모를 연다. 쓰던 메모가 사라진 것처럼 보이지 않게 하기 위해서다.
function openInitialNote({ silent = false } = {}) {
  if (noteExists(settings.lastNote)) {
    loadIntoEditor(settings.lastNote, { silent });
    return;
  }
  const recent = noteIdsByRecency();
  if (recent.length > 0) {
    loadIntoEditor(recent[0], { silent });
    return;
  }
  // 메모가 하나도 없는 첫 실행. 조용히 켜는 중이라면 빈 메모만 쥐고 창은 열지 않는다.
  // newNote를 쓰지 않는 이유는 그쪽이 창을 띄우는 것까지 한 묶음이기 때문이다.
  if (silent) {
    loadIntoEditor(null, { silent });
    return;
  }
  newNote();
}

/* ---------------------------------------------------------------- 훑기 */

// 훑는 사이에 탐색기에서 지워진 메모는 건너뛴다. 지운 메모가 빈 창으로 되살아나지 않도록.
function nextExisting(order, from, step) {
  for (let i = from; i >= 0 && i < order.length; i += step) {
    if (noteExists(order[i])) return order[i];
  }
  return null;
}

// 화면에 보이는 목록을 그대로 훑는다. 검색으로 걸러진 목록이면 걸러진 것만 오간다.
// 그래서 순서는 화면 쪽에서 받아 온다. 메인이 따로 계산하면 화면과 어긋난다.
function navigate(direction, visibleOrder) {
  if (direction !== 'up' && direction !== 'down') return;

  // 훑기를 시작한 시점의 순서를 얼려 둔다. 저장이 수정시각을 바꿔도 훑던 순서가 흔들리지 않는다.
  if (!navOrder) {
    // 목록은 늘 떠 있으므로 화면에서 받은 순서를 그대로 쓴다. 배열이 아닌 것이 올 자리는
    // 없지만, 넘어온 값을 그대로 믿지는 않는다. 그때는 목록에 보일 순서를 여기서 만든다.
    const listOrder = noteIdsInListOrder();
    navOrder = Array.isArray(visibleOrder) ? visibleOrder.filter(isNoteId) : listOrder;
    navFiltered = navOrder.length !== listOrder.length;
  }
  flushDraft();
  if (!mayReplaceDraft()) return;
  // 방금 저장으로 생긴 메모는 화면 목록에 아직 없다. 그 메모까지 넣어 순서를 다시 잡는다.
  // 단 검색으로 걸러 둔 목록이라면 다시 잡지 않는다. 걸러 낸 메모들이 되살아나 버린다.
  if (!navFiltered && draft.id && !navOrder.includes(draft.id)) navOrder = noteIdsInListOrder();

  const order = navOrder;
  if (order.length === 0) return;

  const current = draft.id ? order.indexOf(draft.id) : -1;
  if (current === -1) {
    // 목록에 없는 메모(저장 전 새 메모, 검색에 걸러진 메모)에서 눌렀다면 맨 위부터 시작한다.
    const first = nextExisting(order, 0, 1);
    if (first) loadIntoEditor(first);
    return;
  }
  const step = direction === 'up' ? -1 : 1;
  const target = nextExisting(order, current + step, step);
  if (target) loadIntoEditor(target);
}

/* ---------------------------------------------------------------- 목록 패널 */

function search(query) {
  setQuery(query);
  // 보이는 목록이 달라졌으니 얼려 둔 이동 순서도 버린다.
  navOrder = null;
  refreshList();
}

/* ---------------------------------------------------------------- 즐겨찾기 */

// 목록의 별과 편집 창의 별이 같은 일을 한다. 어느 쪽에서 눌러도 여기로 모인다.
function toggleFavorite(id) {
  if (!isNoteId(id)) return;
  const at = settings.favorites.indexOf(id);
  if (at === -1) settings.favorites.push(id);
  else settings.favorites.splice(at, 1);
  saveSettings();
  // 즐겨찾기는 목록 맨 위로 올라간다. 얼려 둔 이동 순서가 화면과 어긋나므로 버린다.
  navOrder = null;
  refreshList();
  sendEditorMeta(id);
}

// 쓰던 메모를 그 자리에서 즐겨찾기에 넣는다. 목록에서 그 줄을 찾아 별을 누를 필요 없이,
// "이건 남겨 둬야겠다" 싶은 순간에 바로 누르는 용도다.
// 즐겨찾기는 파일 이름으로 기억하므로 아직 저장 전인 새 메모라면 지금 저장해 이름을 확정한다.
function toggleCurrentFavorite() {
  const id = flushDraft();
  if (id === null) return 'empty';
  if (!noteExists(id)) return 'failed';
  toggleFavorite(id);
  return 'ok';
}

/* ---------------------------------------------------------------- 조회 전용 */

// 다 쓰고 나면 읽기만 하는 메모에 거는 표시. 그 메모를 열면 편집기 대신 렌더링된 모습이 나온다.
// 잠그는 것이 아니라 여는 순간의 기본값이라, 화면에서 미리보기 버튼을 누르면 편집으로 돌아간다.
//
// 즐겨찾기와 달리 navOrder를 버리지 않는다. 이 표시는 목록에 보이는 순서를 바꾸지 않으므로
// 얼려 둔 이동 순서가 화면과 어긋나지 않는다. 버리면 훑던 자리만 이유 없이 처음으로 돌아간다.
function toggleViewOnly(id) {
  if (!isNoteId(id)) return;
  const at = settings.viewOnlyNotes.indexOf(id);
  if (at === -1) settings.viewOnlyNotes.push(id);
  else settings.viewOnlyNotes.splice(at, 1);
  saveSettings();
  refreshList();
  // 지금 그 메모를 열어 두고 있다면 상태바의 표시도 함께 바뀐다. 보고 있는 모습은 건드리지 않는다.
  sendEditorMeta(id);
}

/* ---------------------------------------------------------------- 폴더 */

function openNotesFolder() {
  // 저장된 메모를 보고 있으면 그 파일을 고른 채로 폴더를 연다. 어느 파일인지 바로 보인다.
  flushDraft();
  if (noteExists(draft.id)) {
    shell.showItemInFolder(notePath(draft.id));
    return;
  }
  shell.openPath(NOTES_DIR);
}

/* ---------------------------------------------------------------- 딸린 창 */

function openSettings() {
  flushDraft();
  windows.openSettingsWindow();
}

// 지금 보고 있는 내용을 렌더링해 돌려준다. 띄우는 일은 편집 창이 한다 — 여기는 창을 모른다.
// 표가 격자로 보이고 제목이 제 크기로 보이는 모습이 이 결과다.
// 안 되는 이유를 함께 돌려준다. 화면이 그 이유대로 다른 말을 해 줘야,
// 내용이 멀쩡히 있는 메모에서 "내용을 입력하면"이라는 엉뚱한 안내가 뜨지 않는다.
// assignNoteShortcut()이 { ok, reason }을 돌려주는 것과 같은 모양이다.
function renderCurrent() {
  // 보고 있는 그대로를 만든다. 저장 전 내용이 빠지면 방금 쓴 부분이 없는 채로 보인다.
  flushDraft();
  if (draft.content.trim() === '') return { ok: false, reason: 'empty' };

  // 변환이 실패해도 버튼이 아무 반응 없이 끝나지는 않게 한다. 여기서 예외가 그대로 올라가면
  // 화면 쪽 await가 거부되는데 그쪽에는 받아낼 곳이 없어, 눌러도 아무 일이 없는 것처럼 보인다.
  // 메모를 열 때(sendEditorLoad)와 같은 원칙이다.
  let html;
  try {
    html = renderMarkdown(draft.content);
  } catch (err) {
    console.error('메모를 렌더링하지 못했습니다:', err);
    return { ok: false, reason: 'failed' };
  }

  // 글자는 있는데 보여 줄 것이 없는 경우가 있다. 링크 참조 정의처럼 마크다운이 화면에
  // 아무것도 내놓지 않는 문법만 적힌 메모다. 빈 화면 대신 편집기에 그대로 둔다.
  if (html.trim() === '') return { ok: false, reason: 'nothing' };
  return { ok: true, html };
}

/* ---------------------------------------------------------------- 삭제 */

async function deleteNote(id) {
  if (!isNoteId(id)) return false;

  const parent = windows.editorWindow();
  const { response } = await dialog.showMessageBox(parent, {
    type: 'question',
    buttons: ['삭제', '취소'],
    defaultId: 1,
    cancelId: 1,
    title: '메모 삭제',
    message: '이 메모를 휴지통으로 보낼까요?',
    detail: titleOf(readNote(id)) || '(빈 메모)',
  });
  if (response !== 0) return false;

  try {
    await shell.trashItem(notePath(id));
  } catch (err) {
    await dialog.showMessageBox(parent, {
      type: 'error',
      title: '삭제 실패',
      message: '메모를 휴지통으로 보내지 못했습니다.',
      detail: String(err.message || err),
    });
    return false;
  }

  settings.favorites = settings.favorites.filter((f) => f !== id);
  settings.viewOnlyNotes = settings.viewOnlyNotes.filter((v) => v !== id);
  delete settings.noteShortcuts[id];
  if (settings.lastNote === id) settings.lastNote = null;
  saveSettings();
  applyShortcuts();
  navOrder = null;

  // 지워진 메모를 편집 중이었다면 빈 메모로 넘어간다.
  if (draft.id === id) {
    replaceDraft(null, '', null);
    sendEditorLoad();
  }
  refreshList();
  refreshSettingsWindow();
  return true;
}

/* ---------------------------------------------------------------- 단축키 */

// 메모별 단축키를 바꾼 뒤 화면들을 맞춘다. 목록의 뱃지, 설정 창의 표, 편집 창의 표시.
function announceShortcutChange(id) {
  refreshList();
  refreshSettingsWindow();
  sendEditorMeta(id);
}

function assignNoteShortcut(id, accelerator) {
  const owner = findAcceleratorOwner(accelerator, { skipNoteId: id });
  if (owner) return { ok: false, reason: `이미 ${owner}에 쓰이고 있습니다.` };

  const previous = settings.noteShortcuts[id];
  settings.noteShortcuts[id] = accelerator;
  const failed = applyShortcuts({ expect: accelerator });
  if (failed.includes(accelerator)) {
    // 다른 프로그램이 점유한 조합. 지정을 취소하고 원래대로 되돌린다.
    if (previous) settings.noteShortcuts[id] = previous;
    else delete settings.noteShortcuts[id];
    registerShortcuts();
    return { ok: false, reason: '다른 프로그램이 이미 쓰고 있는 조합입니다.' };
  }
  saveSettings();
  announceShortcutChange(id);
  return { ok: true };
}

function clearNoteShortcut(id) {
  delete settings.noteShortcuts[id];
  saveSettings();
  applyShortcuts();
  announceShortcutChange(id);
  return { ok: true };
}

function saveGlobalShortcuts(next) {
  const previous = { ...settings.shortcuts };
  const keys = Object.keys(SHORTCUT_LABELS);

  for (const key of keys) {
    const accelerator = next[key];
    if (!accelerator) return { ok: false, reason: `${SHORTCUT_LABELS[key]} 단축키가 비어 있습니다.` };

    // 저장하려는 값끼리의 중복도, 메모에 걸어 둔 단축키와의 중복도 한 번에 걸러진다.
    const owner = findAcceleratorOwner(accelerator, { shortcuts: next, skipKey: key });
    if (owner) return { ok: false, reason: `${SHORTCUT_LABELS[key]} 조합이 이미 ${owner}에 쓰이고 있습니다.` };
  }

  // 지금 쓰이는 키만 골라 담는다. next를 통째로 넣으면 설정 창에서 없앤 항목이
  // 화면이 보낸 값을 타고 설정 파일에 되살아난다.
  settings.shortcuts = Object.fromEntries(keys.map((key) => [key, next[key]]));
  const failed = applyShortcuts({ expect: keys.map((key) => next[key]) });
  const failedKeys = keys.filter((key) => failed.includes(settings.shortcuts[key]));
  if (failedKeys.length > 0) {
    // 하나라도 등록에 실패하면 통째로 되돌린다. 단축키가 반만 먹는 상태를 만들지 않는다.
    settings.shortcuts = previous;
    registerShortcuts();
    const names = failedKeys.map((key) => SHORTCUT_LABELS[key]).join(', ');
    return { ok: false, reason: `${names} 단축키를 등록하지 못했습니다. 다른 프로그램이 쓰고 있는 조합입니다.` };
  }
  saveSettings();
  refreshSettingsWindow();
  return { ok: true };
}

module.exports = {
  // 자동 저장
  setDraftContent,
  flushDraft,
  confirmLeaveUnsaved,

  // 화면에 알리기
  sendEditorLoad,
  refreshList,
  refreshSettingsWindow,
  settingsPayload,

  // 메모 열기
  openNote,
  newNote,
  openInitialNote,
  navigate,

  // 목록 패널
  search,

  // 즐겨찾기
  toggleFavorite,
  toggleCurrentFavorite,

  // 조회 전용
  toggleViewOnly,

  // 폴더
  openNotesFolder,

  // 딸린 창과 렌더링
  openSettings,
  renderCurrent,

  // 삭제와 단축키
  deleteNote,
  assignNoteShortcut,
  clearNoteShortcut,
  saveGlobalShortcuts,
};
