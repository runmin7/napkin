// 편집 창 오른쪽에 늘 붙어 있는 메모 목록 패널.
//
// 편집 창과 같은 문서 안에서 돌지만 서로를 직접 부르지는 않는다. 바깥에 내주는 것은
// createNotePanel이 돌려주는 객체뿐이다.

import { captureShortcut, prettyAccelerator } from './keycapture.js';

export function createNotePanel() {
  const panelEl = document.getElementById('side-list');
  const searchEl = document.getElementById('search');
  const bodyEl = document.getElementById('body');

  let data = { favorites: [], others: [], query: '' };
  let visible = [];
  let selectedId = null;
  let currentId = null;
  let menuEl = null;

  /* ------------------------------------------------------------ 그리기 */

  function formatTime(mtime) {
    const d = new Date(mtime);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    if (sameDay) return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' });
  }

  function buildRow(note) {
    const row = document.createElement('div');
    row.className = 'row';
    // 행이 포커스를 받아야 Delete 같은 키를 목록 쪽에서 해석할 수 있다.
    row.tabIndex = 0;
    if (note.id === selectedId) row.classList.add('selected');
    // 지금 편집 중인 메모는 따로 표시해 둔다. 목록만 훑다가 제자리를 잃지 않도록.
    if (note.id === currentId) row.classList.add('current');
    row.dataset.id = note.id;

    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'star' + (note.favorite ? ' on' : '');
    star.textContent = note.favorite ? '★' : '☆';
    star.title = note.favorite ? '즐겨찾기 해제' : '즐겨찾기';
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      api.list.toggleFavorite(note.id);
    });

    const main = document.createElement('div');
    main.className = 'main';

    const title = document.createElement('div');
    title.className = 'title' + (note.title ? '' : ' empty-title');
    title.textContent = note.title || '(빈 메모)';

    const meta = document.createElement('div');
    meta.className = 'meta';
    const time = document.createElement('span');
    time.textContent = formatTime(note.mtime);
    meta.appendChild(time);
    if (note.shortcut) {
      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = prettyAccelerator(note.shortcut);
      meta.appendChild(key);
    }
    if (note.viewOnly) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = '조회';
      meta.appendChild(tag);
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.textContent = '×';
    remove.title = '이 메모 삭제';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      api.list.remove(note.id);
    });

    main.append(title, meta);
    row.append(star, main, remove);

    // 한 번 클릭하면 바로 열린다. 다만 포커스는 목록에 남겨 둔다.
    // 포커스가 본문으로 넘어가면 이어서 누르는 Delete가 글자를 지워 버린다.
    row.addEventListener('click', () => open(note.id));
    row.addEventListener('keydown', onRowKey);
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      select(note.id);
      openMenu(note, e.clientX, e.clientY);
    });

    return row;
  }

  function groupLabel(text) {
    const el = document.createElement('div');
    el.className = 'group-label';
    el.textContent = text;
    return el;
  }

  function onRowKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedId) open(selectedId);
      return;
    }
    if (e.key === 'Delete') {
      e.preventDefault();
      if (selectedId) api.list.remove(selectedId);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(e.key === 'ArrowDown' ? 1 : -1, true);
    }
  }

  function render() {
    closeMenu();
    // 목록을 다시 그리면 포커스가 날아간다. 목록에서 키로 고르던 중이었다면 되돌려 준다.
    const keepFocus = bodyEl.contains(document.activeElement);
    // 검색은 메인이 마쳐서 보내 준다. 여기서는 받은 것을 그대로 그린다.
    const { favorites, others, query } = data;
    visible = [...favorites, ...others];

    // 검색이나 삭제로 고른 메모가 사라지면 첫 항목으로 옮긴다.
    if (!visible.some((n) => n.id === selectedId)) {
      selectedId = visible.length > 0 ? visible[0].id : null;
    }

    bodyEl.textContent = '';
    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = query ? '찾는 메모가 없습니다.' : '아직 메모가 없습니다.';
      bodyEl.appendChild(empty);
      return;
    }

    if (favorites.length > 0) {
      bodyEl.appendChild(groupLabel('즐겨찾기'));
      favorites.forEach((note) => bodyEl.appendChild(buildRow(note)));
    }
    if (others.length > 0) {
      bodyEl.appendChild(groupLabel(favorites.length > 0 ? '나머지' : '전체'));
      others.forEach((note) => bodyEl.appendChild(buildRow(note)));
    }

    if (keepFocus) {
      const row = bodyEl.querySelector('.row.selected');
      if (row) row.focus();
    }
  }

  function rowOf(id) {
    return bodyEl.querySelector(`.row[data-id="${CSS.escape(id)}"]`);
  }

  function select(id) {
    selectedId = id;
    for (const row of bodyEl.querySelectorAll('.row')) {
      row.classList.toggle('selected', row.dataset.id === id);
    }
  }

  function open(id) {
    select(id);
    // 포커스를 목록에 붙들어 둔다. 계속 훑거나 Delete로 지울 수 있게.
    const row = rowOf(id);
    if (row) row.focus();
    api.list.open(id);
  }

  // moveFocus는 목록 안에서 키로 옮겨 다닐 때만 켠다.
  // 검색창에서 훑는 중에는 포커스를 뺏으면 이어서 타이핑할 수 없다.
  function moveSelection(step, moveFocus) {
    if (visible.length === 0) return;
    const at = visible.findIndex((n) => n.id === selectedId);
    const next = Math.min(Math.max(at + step, 0), visible.length - 1);
    const id = visible[next].id;
    select(id);
    const row = rowOf(id);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest' });
    if (moveFocus) row.focus();
  }

  /* ------------------------------------------------------------ 우클릭 메뉴 */

  function closeMenu() {
    if (menuEl) {
      menuEl.remove();
      menuEl = null;
    }
  }

  function openMenu(note, x, y) {
    closeMenu();
    menuEl = document.createElement('div');
    menuEl.className = 'context-menu';

    const add = (label, handler, className) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      if (className) button.className = className;
      button.addEventListener('click', () => {
        closeMenu();
        handler();
      });
      menuEl.appendChild(button);
    };
    const separator = () => {
      const sep = document.createElement('div');
      sep.className = 'sep';
      menuEl.appendChild(sep);
    };

    add('열기', () => open(note.id));
    separator();
    // "열 때"가 들어가야 지금 여는 것이 아니라 다음부터 여는 방식을 정하는 것임이 드러난다.
    add(note.viewOnly ? '조회 전용 해제' : '열 때 조회 전용으로', () => api.list.toggleViewOnly(note.id));
    separator();
    add(note.shortcut ? '단축키 변경' : '단축키 지정', () => assignShortcut(note));
    if (note.shortcut) add('단축키 해제', () => api.list.setShortcut(note.id, null));
    separator();
    add('삭제', () => api.list.remove(note.id), 'danger');

    menuEl.style.visibility = 'hidden';
    document.body.appendChild(menuEl);
    // 화면 밖으로 나가지 않도록 잰 뒤에 놓는다.
    const rect = menuEl.getBoundingClientRect();
    menuEl.style.left = `${Math.min(x, window.innerWidth - rect.width - 4)}px`;
    menuEl.style.top = `${Math.min(y, window.innerHeight - rect.height - 4)}px`;
    menuEl.style.visibility = 'visible';
  }

  async function assignShortcut(note) {
    await captureShortcut({
      title: note.shortcut ? '단축키 변경' : '단축키 지정',
      target: note.title || '(빈 메모)',
      current: note.shortcut,
      verify: (accelerator) => api.list.setShortcut(note.id, accelerator),
    });
  }

  document.addEventListener('mousedown', (e) => {
    if (menuEl && !menuEl.contains(e.target)) closeMenu();
  });

  /* ------------------------------------------------------------ 입력 */

  searchEl.addEventListener('input', () => {
    // 거르는 일은 메인이 한다. 걸러진 목록이 되돌아와 다시 그려진다.
    api.list.search(searchEl.value);
  });

  searchEl.addEventListener('keydown', (e) => {
    // 검색창에서는 고르기만 하고 포커스는 그대로 둔다. 계속 검색어를 고칠 수 있어야 한다.
    // Delete는 여기서 검색어를 지우는 키이므로 건드리지 않는다.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(e.key === 'ArrowDown' ? 1 : -1, false);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedId) open(selectedId);
    }
  });

  api.list.onData((payload) => {
    data = payload;
    render();
  });

  return {
    closeMenu,
    hasMenu: () => menuEl !== null,

    // 커서가 지금 목록 안에 있는가. 편집 창이 포커스를 가져갈지 정할 때 쓴다.
    containsFocus: () => panelEl.contains(document.activeElement),

    // 검색어가 남아 있으면 지우고 true. 이미 비어 있으면 false.
    // Esc를 한 겹씩 벗겨낼 때, 검색어부터 지우고 그다음에 편집기로 돌아가기 위한 것이다.
    clearSearch() {
      if (searchEl.value === '') return false;
      searchEl.value = '';
      searchEl.dispatchEvent(new Event('input'));
      return true;
    },

    // Ctrl+PageUp/PageDown이 훑을 순서. 검색으로 걸러졌다면 걸러진 것만 담긴다.
    visibleIds: () => visible.map((note) => note.id),

    setCurrent(id) {
      currentId = id;
      selectedId = id || selectedId;
      render();
    },
  };
}
