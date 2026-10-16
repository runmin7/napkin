// 메인 프로세스와 화면 사이를 오가는 통로 이름.
//
// 이 이름들은 preload.js와 main 쪽 ipc.js가 글자 하나까지 똑같이 적어야 이어진다.
// 한쪽에만 오타가 나면 에러도 나지 않고 그저 아무 일도 일어나지 않는다. 그런 사고는
// 찾기가 유독 어려워서, 양쪽이 같은 상수를 보게 여기 한 곳에 모아 둔다.
//
// preload.js는 CommonJS로 읽히므로 이 파일도 CommonJS여야 한다.

// 편집 창이 메인에 거는 요청.
const EDITOR = {
  READY: 'editor:ready',
  DRAFT: 'editor:draft',
  FLUSH: 'editor:flush',
  NAVIGATE: 'editor:navigate',
  HIDE: 'editor:hide',
  NEW: 'editor:new',
  TOGGLE_PIN: 'editor:toggle-pin',
  TOGGLE_FAVORITE: 'editor:toggle-favorite',
  OPEN_FOLDER: 'editor:open-folder',
  PREVIEW: 'editor:preview',
  // 메인이 편집 창에 알리는 것
  PIN: 'editor:pin',
};

// 메모 하나의 내용과 상태. 전부 메인이 편집 창에 알리는 방향이다.
const NOTE = {
  LOAD: 'note:load',
  SAVED: 'note:saved',
  SAVE_FAILED: 'note:save-failed',
  META: 'note:meta',
};

// 목록 패널. 편집 창 오른쪽에 늘 붙어 있다.
const LIST = {
  OPEN: 'list:open',
  TOGGLE_FAVORITE: 'list:toggle-favorite',
  SEARCH: 'list:search',
  DELETE: 'list:delete',
  SET_SHORTCUT: 'list:set-shortcut',
  TOGGLE_VIEW_ONLY: 'list:toggle-view-only',
  // 메인이 목록에 알리는 것
  DATA: 'list:data',
};

// 단축키 설정 창.
const SETTINGS = {
  READY: 'settings:ready',
  SAVE: 'settings:save',
  CLEAR_NOTE_SHORTCUT: 'settings:clear-note-shortcut',
  CLOSE: 'settings:close',
  DATA: 'settings:data',
};

// 키 조합을 받아내는 작은 창이 떠 있는 동안. 목록 패널과 설정 창이 함께 쓴다.
// 받아내는 쪽은 둘이지만 하는 일이 같아서, 창마다 따로 두지 않고 한 곳에 모은다.
const CAPTURE = {
  BEGIN: 'capture:begin',
  END: 'capture:end',
};

module.exports = { EDITOR, NOTE, LIST, SETTINGS, CAPTURE };
