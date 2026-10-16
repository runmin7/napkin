// 편집 창. 본문 편집기, 상태바, 그리고 오른쪽 목록 패널을 한 화면에 엮는다.

import { createEditor } from '../editor-engine.js';
import { prettyAccelerator, isCapturing } from './keycapture.js';
import { createNotePanel } from './list.js';

const starEl = document.getElementById('star');
const shortcutEl = document.getElementById('shortcut');
const viewOnlyEl = document.getElementById('view-only');
const savedEl = document.getElementById('saved');
const countEl = document.getElementById('count');
const editorEl = document.getElementById('editor');
const readerEl = document.getElementById('reader');
const mdEl = document.getElementById('md');
const previewBtn = document.getElementById('preview');

// 공백을 뺀 글자 수. 띄어쓰기·탭·줄바꿈을 모두 제외한다(한글 워드프로세서의 '공백 제외'와 같은 기준).
function updateCount(text) {
  const n = text.replace(/\s/g, '').length;
  countEl.textContent = n > 0 ? `${n.toLocaleString('ko-KR')}자` : '';
}

// 상태바 오른쪽 끝의 한 줄. 저장 시각과 저장 실패가 모두 여기로 모인다.
// 저장 실패만은 눈에 띄어야 하므로 색을 달리한다.
function setStatus(text, failed = false) {
  savedEl.textContent = text;
  savedEl.classList.toggle('failed', failed);
  if (!failed) savedEl.removeAttribute('title');
}

const panel = createNotePanel();

// 편집기는 editor-engine이 감싸고 있다. 여기서는 CodeMirror를 직접 다루지 않는다.
const editor = createEditor(editorEl, {
  placeholder: '생각나는 대로 적으세요. 저장은 알아서 됩니다.',
  onChange: (text) => {
    // 저장에 실패한 상태라면 그 표시를 지우지 않는다. 다음 저장이 성공해야 지워진다.
    if (!savedEl.classList.contains('failed')) setStatus('');
    updateCount(text);
    api.editor.draft(text);
  },
});

// 즐겨찾기도 파일이 있어야 걸 수 있다. 한 글자도 쓰지 않은 새 메모에서 누른 경우를 구분해 알린다.
const FAVORITE_MESSAGE = {
  empty: '내용을 입력하면 즐겨찾기할 수 있습니다',
  failed: '즐겨찾기하지 못했습니다',
};

async function toggleFavorite() {
  const result = await api.editor.toggleFavorite();
  // 성공하면 별 표시가 메타 갱신으로 따라오므로 따로 알리지 않는다.
  if (result !== 'ok') setStatus(FAVORITE_MESSAGE[result] || FAVORITE_MESSAGE.failed);
}

function applyMeta(payload) {
  starEl.classList.toggle('on', payload.favorite);
  starEl.textContent = payload.favorite ? '★' : '☆';
  starEl.title = payload.favorite ? '즐겨찾기 해제' : '즐겨찾기';
  if (payload.shortcut) {
    shortcutEl.hidden = false;
    shortcutEl.textContent = prettyAccelerator(payload.shortcut);
  } else {
    shortcutEl.hidden = true;
    shortcutEl.textContent = '';
  }
  // 표시만 바꾼다. 지금 무엇을 보고 있는지는 건드리지 않는다. 쓰던 메모에 목록에서 표시를
  // 걸었다고 해서 화면이 읽기 쪽으로 튀면 쓰던 자리를 잃는다. 적용은 다음에 열 때부터다.
  viewOnlyEl.hidden = !payload.viewOnly;
}

/* ---------------------------------------------------------------- 편집과 읽기 */

// 지금 렌더링된 쪽을 보고 있는가. 메모 하나를 보는 동안만 사는 상태라 저장하지 않는다.
// 메모가 바뀌면 note:load가 다시 정해 주므로 따로 되돌리는 코드가 필요 없다.
let reading = false;

// 메모에 웹이나 메일에서 복사해 온 태그가 섞여 있을 수 있다. 읽기 영역은 편집기·목록·상태바와
// 같은 문서 안에 있으므로, 메모가 들고 온 <style>이 창 전체의 생김새를 바꿔 놓을 수 있다.
// 본문에 쓰일 일이 없는 태그는 넣자마자 걷어낸다. 스크립트는 innerHTML과 CSP가 이미 막는다.
function putHtml(html) {
  mdEl.innerHTML = html;
  for (const el of mdEl.querySelectorAll('style, link, base, meta')) el.remove();
}

// html을 주면 읽기 쪽으로, 주지 않으면 편집기로 돌아간다.
function setReading(next, html) {
  reading = next;
  readerEl.hidden = !next;
  editorEl.hidden = next;
  previewBtn.classList.toggle('on', next);
  previewBtn.title = next ? '편집' : 'view';

  if (next) {
    putHtml(html);
    // 읽기 쪽으로 넘어갈 때는 맨 위부터 보여 준다. setText가 편집기에서 하는 것과 같다.
    readerEl.scrollTop = 0;
    return;
  }
  // 편집으로 돌아갈 때 비워 둔다. 숨겨 두기만 하면 메모가 들고 온 태그가 문서에 남아,
  // 글을 쓰는 동안에도 다른 메모를 보는 동안에도 계속 영향을 준다.
  mdEl.textContent = '';
}

// 숨어 있는 편집기는 커서를 받지 못한다. 읽는 중이라면 그쪽에 포커스를 둬야
// 방향키와 PageUp/PageDown으로 긴 메모를 훑을 수 있다.
function focusEditor() {
  if (reading) readerEl.focus();
  else editor.focus();
}

/* ---------------------------------------------------------------- 메인에서 오는 것 */

api.editor.onLoad((payload) => {
  // setText는 커서와 스크롤을 맨 위로 되돌린다. 메모를 열면 첫 줄부터 읽게 된다.
  editor.setText(payload.content);
  // setText는 onChange를 울리지 않으므로 글자 수는 여기서 직접 갱신한다.
  updateCount(payload.content);
  applyMeta(payload);

  // 메인이 html을 실어 보냈다면 조회 전용으로 표시한 메모다. 보고 있는 모습을 여기서
  // 다시 정하므로, 다른 메모로 갔다 오면 그 메모의 표시대로 되돌아온다.
  setReading(Boolean(payload.html), payload.html);

  panel.setCurrent(payload.id);
  setStatus(payload.id ? '' : '새 메모');

  // 목록에서 고른 경우에는 포커스를 가져오지 않는다. 목록에 머물러 있어야
  // 이어서 다른 메모를 훑거나 Delete로 지울 수 있다.
  if (!panel.containsFocus()) focusEditor();
});

api.editor.onMeta(applyMeta);

api.editor.onSaved((payload) => {
  const at = new Date(payload.at);
  setStatus(`저장됨 ${at.toLocaleTimeString('ko-KR')}`);
});

// 이 앱이 사용자와 맺은 약속은 "저장은 알아서 된다"이다. 그 약속이 깨지는 순간이
// 유일하게 반드시 알려야 하는 순간이므로 조용히 넘기지 않는다.
api.editor.onSaveFailed((payload) => {
  setStatus('저장 실패', true);
  if (payload && payload.message) savedEl.title = payload.message;
});

const pinBtn = document.getElementById('pin');

api.editor.onPin((on) => {
  pinBtn.classList.toggle('on', on);
  pinBtn.title = on ? '항상 위 고정 해제' : '항상 위에 고정';
});

/* ---------------------------------------------------------------- 상태바 버튼 */

// 다른 프로그램으로 포커스가 넘어갈 때. 메인 쪽에서도 창 blur를 잡지만,
// 여기서 한 번 더 알려 두면 저장이 늦어질 여지가 없다.
window.addEventListener('blur', () => api.editor.flush());

document.getElementById('new-note').addEventListener('click', () => {
  api.editor.newNote();
});

pinBtn.addEventListener('click', () => api.editor.togglePin());

starEl.addEventListener('click', async () => {
  await toggleFavorite();
  // 별을 누르느라 커서가 버튼으로 옮겨 갔다. 바로 이어서 쓸 수 있게 돌려놓는다.
  focusEditor();
});

document.getElementById('open-folder').addEventListener('click', () => {
  api.editor.openFolder();
  // 폴더 창으로 포커스가 넘어가므로 입력이 이어지도록 커서를 돌려 놓는다.
  focusEditor();
});

// 미리볼 수 없는 이유마다 다른 말을 한다. 글자는 있는데 링크 참조 정의처럼 화면에 아무것도
// 내놓지 않는 문법만 적힌 메모에까지 "내용을 입력하면"이라고 하면 틀린 안내가 된다.
const PREVIEW_MESSAGE = {
  empty: '내용을 입력하면 미리볼 수 있습니다',
  nothing: '꾸며서 보여 줄 것이 없는 메모입니다',
  failed: '미리보기를 만들지 못했습니다',
};

// 편집 화면은 마크다운 기호를 글자 그대로 둔다. 표가 격자로 보이거나 제목이 실제 크기로
// 보이는 모습은 이 버튼으로 같은 자리에서 바꿔 본다. 한 번 더 누르면 편집으로 돌아온다.
previewBtn.addEventListener('click', async () => {
  if (reading) {
    setReading(false);
    editor.focus();
    return;
  }

  const result = await api.editor.preview();
  if (!result.ok) {
    setStatus(PREVIEW_MESSAGE[result.reason] || PREVIEW_MESSAGE.failed);
    editor.focus();
    return;
  }
  setReading(true, result.html);
  readerEl.focus();
});

/* ---------------------------------------------------------------- 창 안의 키 */

// Esc는 상황에 따라 한 겹씩 벗겨낸다.
// 우클릭 메뉴 → 검색어 → 편집기로 돌아가기 → 창 숨기기 순서다.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // 편집기가 이미 이 키를 썼다면(찾기 패널 닫기 등) 여기서 또 벗겨내지 않는다.
  if (e.defaultPrevented) return;
  // 단축키를 받아내는 창이 떠 있으면 그쪽이 먼저 가져간다.
  if (isCapturing()) return;

  e.preventDefault();

  if (panel.hasMenu()) {
    panel.closeMenu();
    return;
  }

  // 목록은 늘 붙어 있으므로 닫는 대신 읽거나 쓰던 자리로 돌아간다.
  if (panel.containsFocus()) {
    if (panel.clearSearch()) return;
    focusEditor();
    return;
  }

  api.editor.hide();
});

// 창 안에서만 도는 단축키. 편집기든 목록이든 커서가 어디 있어도 같게 동작한다.
// 배경에서 부르는 전역 단축키는 메인 프로세스가 따로 들고 있다.
document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
  // 편집기가 이미 가져간 키는 건드리지 않는다. Ctrl+F로 연 찾기 패널이 여기에 해당한다.
  if (e.defaultPrevented) return;
  // 단축키를 받아내는 창이 떠 있으면 그쪽이 먼저 가져간다.
  if (isCapturing()) return;

  // 목록에서 위아래로 한 칸씩. 지금 화면에 보이는 순서를 그대로 넘긴다.
  if (e.key === 'PageUp') api.editor.navigate('up', panel.visibleIds());
  else if (e.key === 'PageDown') api.editor.navigate('down', panel.visibleIds());
  // 한글 입력 상태에서는 e.key가 'ㅜ'로 들어오므로 물리 키 위치를 본다.
  else if (e.code === 'KeyN') api.editor.newNote();
  else return;

  e.preventDefault();
});

api.editor.ready();
