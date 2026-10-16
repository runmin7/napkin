// 화면과 메인 프로세스 사이의 유일한 통로.
//
// 이 파일은 그대로 로드되지 않는다. esbuild가 renderer/bundle/preload.js로 묶어 주고
// 창은 그 번들을 preload로 쓴다. 번들을 거치는 이유가 있다.
//
// Electron 20부터 화면은 기본적으로 sandbox 안에서 돈다. sandbox 안의 preload는
// electron 말고 다른 모듈을 require할 수 없다. 여기서 ../shared/channels를 그대로
// require하면 "module not found"로 이 파일 전체가 죽고, window.api가 통째로 사라진다.
// 그러면 화면은 멀쩡히 떠 있는데 아무것도 동작하지 않는다.
//
// 번들이 shared/channels의 내용을 이 파일 안으로 넣어 주므로, 메인과 같은 상수를 쓰면서도
// sandbox를 끄지 않아도 된다. electron만 require로 남는다(esbuild --external:electron).
const { contextBridge, ipcRenderer } = require('electron');
const { EDITOR, NOTE, LIST, SETTINGS, CAPTURE } = require('../shared/channels');

// 파일 읽기·쓰기와 단축키 등록은 전부 메인 프로세스 안에서만 일어난다.
contextBridge.exposeInMainWorld('api', {
  editor: {
    ready: () => ipcRenderer.send(EDITOR.READY),
    draft: (content) => ipcRenderer.send(EDITOR.DRAFT, content),
    flush: () => ipcRenderer.send(EDITOR.FLUSH),
    navigate: (direction, order) => ipcRenderer.send(EDITOR.NAVIGATE, { direction, order }),
    hide: () => ipcRenderer.send(EDITOR.HIDE),
    newNote: () => ipcRenderer.send(EDITOR.NEW),
    togglePin: () => ipcRenderer.send(EDITOR.TOGGLE_PIN),
    toggleFavorite: () => ipcRenderer.invoke(EDITOR.TOGGLE_FAVORITE),
    preview: () => ipcRenderer.invoke(EDITOR.PREVIEW),
    onPin: (handler) => ipcRenderer.on(EDITOR.PIN, (_e, on) => handler(on)),
    openFolder: () => ipcRenderer.send(EDITOR.OPEN_FOLDER),
    onLoad: (handler) => ipcRenderer.on(NOTE.LOAD, (_e, payload) => handler(payload)),
    onSaved: (handler) => ipcRenderer.on(NOTE.SAVED, (_e, payload) => handler(payload)),
    onSaveFailed: (handler) => ipcRenderer.on(NOTE.SAVE_FAILED, (_e, payload) => handler(payload)),
    onMeta: (handler) => ipcRenderer.on(NOTE.META, (_e, payload) => handler(payload)),
  },

  list: {
    open: (id) => ipcRenderer.send(LIST.OPEN, id),
    toggleFavorite: (id) => ipcRenderer.send(LIST.TOGGLE_FAVORITE, id),
    toggleViewOnly: (id) => ipcRenderer.send(LIST.TOGGLE_VIEW_ONLY, id),
    search: (query) => ipcRenderer.send(LIST.SEARCH, query),
    remove: (id) => ipcRenderer.invoke(LIST.DELETE, id),
    setShortcut: (id, accelerator) => ipcRenderer.invoke(LIST.SET_SHORTCUT, { id, accelerator }),
    onData: (handler) => ipcRenderer.on(LIST.DATA, (_e, payload) => handler(payload)),
  },

  settings: {
    ready: () => ipcRenderer.send(SETTINGS.READY),
    save: (shortcuts) => ipcRenderer.invoke(SETTINGS.SAVE, shortcuts),
    clearNoteShortcut: (id) => ipcRenderer.invoke(SETTINGS.CLEAR_NOTE_SHORTCUT, id),
    close: () => ipcRenderer.send(SETTINGS.CLOSE),
    onData: (handler) => ipcRenderer.on(SETTINGS.DATA, (_e, payload) => handler(payload)),
  },

  // 키 조합을 받아내는 동안 전역 단축키를 내려놓는다. 목록 패널과 설정 창이 같은 통로를 쓴다.
  capture: {
    begin: () => ipcRenderer.send(CAPTURE.BEGIN),
    end: () => ipcRenderer.send(CAPTURE.END),
  },
});
