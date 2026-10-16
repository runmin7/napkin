// 화면에서 들어오는 요청을 알맞은 곳에 넘긴다.
//
// 여기서는 일을 하지 않는다. 채널과 동작을 이어 주기만 하므로, 무슨 요청이 오갈 수 있는지
// 이 파일 하나만 보면 전부 드러난다. 채널 이름은 shared/channels.js에서 preload와 함께 쓴다.

const { ipcMain } = require('electron');
const { EDITOR, LIST, SETTINGS, CAPTURE } = require('../../shared/channels');
const { settings } = require('./settings-store');
const { isNoteId } = require('./note-store');
const windows = require('./windows');
const session = require('./session');
const shortcuts = require('./shortcuts');

function registerIpc() {
  /* -------------------------------------------------------------- 편집 창 */

  ipcMain.on(EDITOR.READY, () => {
    session.sendEditorLoad();
    windows.sendToEditor(EDITOR.PIN, settings.alwaysOnTop);
    session.refreshList();
  });

  ipcMain.on(EDITOR.DRAFT, (_e, content) => {
    session.setDraftContent(content);
  });

  ipcMain.on(EDITOR.FLUSH, () => {
    session.flushDraft();
  });

  ipcMain.on(EDITOR.NAVIGATE, (_e, { direction, order } = {}) => {
    session.navigate(direction, order);
  });

  ipcMain.on(EDITOR.HIDE, () => {
    session.flushDraft();
    windows.hideEditor();
  });

  ipcMain.on(EDITOR.NEW, () => session.newNote());
  ipcMain.on(EDITOR.TOGGLE_PIN, () => windows.toggleAlwaysOnTop());
  ipcMain.on(EDITOR.OPEN_FOLDER, () => session.openNotesFolder());

  ipcMain.handle(EDITOR.PREVIEW, () => session.renderCurrent());
  ipcMain.handle(EDITOR.TOGGLE_FAVORITE, () => session.toggleCurrentFavorite());

  /* -------------------------------------------------------------- 목록 패널 */

  ipcMain.on(LIST.OPEN, (_e, id) => session.openNote(id));
  ipcMain.on(LIST.TOGGLE_FAVORITE, (_e, id) => session.toggleFavorite(id));
  ipcMain.on(LIST.TOGGLE_VIEW_ONLY, (_e, id) => session.toggleViewOnly(id));
  ipcMain.on(LIST.SEARCH, (_e, query) => session.search(query));

  ipcMain.handle(LIST.DELETE, (_e, id) => session.deleteNote(id));

  ipcMain.handle(LIST.SET_SHORTCUT, (_e, { id, accelerator }) => {
    if (!isNoteId(id)) return { ok: false, reason: '알 수 없는 메모입니다.' };
    return accelerator ? session.assignNoteShortcut(id, accelerator) : session.clearNoteShortcut(id);
  });

  /* -------------------------------------------------------------- 설정 창 */

  ipcMain.on(SETTINGS.READY, () => session.refreshSettingsWindow());
  ipcMain.on(SETTINGS.CLOSE, () => windows.closeSettingsWindow());

  ipcMain.handle(SETTINGS.SAVE, (_e, next) => session.saveGlobalShortcuts(next));

  ipcMain.handle(SETTINGS.CLEAR_NOTE_SHORTCUT, (_e, id) => {
    if (!isNoteId(id)) return { ok: false };
    return session.clearNoteShortcut(id);
  });

  /* -------------------------------------------------------------- 조합 받아내기 */

  // 받아내는 중에 그 화면이 사라지면 END가 올 길이 없다. 그대로 두면 전역 단축키가
  // 내려놓인 채 남아 트레이로 창을 부르는 길까지 막힌다. 창을 숨기거나 포커스가 넘어가는
  // 흔한 경우는 화면 쪽이 blur로 먼저 알려 주므로(keycapture.js), 여기는 그마저 오지 못하는
  // 경우를 받는 마지막 그물이다. 화면 하나에 한 번만 걸어 리스너가 쌓이지 않게 한다.
  const watched = new WeakSet();

  ipcMain.on(CAPTURE.BEGIN, (e) => {
    shortcuts.beginCapture();
    if (watched.has(e.sender)) return;
    watched.add(e.sender);
    e.sender.once('destroyed', () => shortcuts.endCapture());
  });

  ipcMain.on(CAPTURE.END, () => shortcuts.endCapture());
}

module.exports = { registerIpc };
