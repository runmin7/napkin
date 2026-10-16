// 눌린 키를 Electron이 알아듣는 단축키 문자열로 바꾼다. 목록 패널과 설정 창이 함께 쓴다.

const KEY_MAP = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ' ': 'Space',
  Enter: 'Return',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Tab: 'Tab',
  Insert: 'Insert',
};

function mainKey(e) {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;
  // 한글 입력 상태에서는 e.key가 'ㅁ'처럼 들어오므로 물리 키 위치를 먼저 본다.
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
  if (KEY_MAP[e.key]) return KEY_MAP[e.key];
  if (/^F[0-9]{1,2}$/.test(e.key)) return e.key;
  if (e.key.length === 1) return e.key.toUpperCase();
  return null;
}

// 수정키 없는 단독 키는 전역 단축키로 쓰면 다른 프로그램의 타이핑을 가로챈다.
export function toAccelerator(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super');
  if (parts.length === 0) return null;

  const key = mainKey(e);
  if (!key) return null;
  parts.push(key);
  return parts.join('+');
}

export function prettyAccelerator(accelerator) {
  if (!accelerator) return '';
  return accelerator
    .split('+')
    .map((part) => {
      if (part === 'Left') return '←';
      if (part === 'Right') return '→';
      if (part === 'Up') return '↑';
      if (part === 'Down') return '↓';
      if (part === 'Return') return 'Enter';
      return part;
    })
    .join(' + ');
}

// 키 조합을 받아내는 작은 창. 목록 패널과 설정 창이 같은 화면을 쓴다.
// verify는 실제로 등록해 보고 {ok} 또는 {ok:false, reason}을 돌려준다.
// 실패하면 창을 닫지 않고 이유를 보여 준 뒤 다시 누를 기회를 준다.
export function captureShortcut({ title, target, current, verify }) {
  return new Promise((resolve) => {
    let picked = current || null;
    // 닫는 길이 여럿이고(지정·취소·Esc·바깥 클릭) 기다리는 사이에 겹칠 수 있다.
    // 치우는 일과 전역 단축키를 되돌리는 일은 한 번만 해야 한다.
    let closed = false;

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="capture">
        <h3></h3>
        <p class="target"></p>
        <div class="keys"></div>
        <p class="error"></p>
        <div class="actions">
          <button type="button" class="cancel">취소</button>
          <button type="button" class="primary confirm">지정</button>
        </div>
      </div>`;

    const keysEl = overlay.querySelector('.keys');
    const errorEl = overlay.querySelector('.error');
    const confirmEl = overlay.querySelector('.confirm');
    overlay.querySelector('h3').textContent = title;
    overlay.querySelector('.target').textContent = target || '';

    function paint() {
      if (picked) {
        keysEl.textContent = prettyAccelerator(picked);
        keysEl.classList.remove('waiting');
      } else {
        keysEl.textContent = '원하는 키 조합을 누르세요';
        keysEl.classList.add('waiting');
      }
      confirmEl.disabled = !picked;
    }

    function onKeyDown(e) {
      e.preventDefault();
      e.stopPropagation();

      // 수정키 없는 Esc와 Enter는 조합이 될 수 없으니 창 조작으로 쓴다.
      const bare = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
      if (bare && e.key === 'Escape') {
        close(null);
        return;
      }
      if (bare && e.key === 'Enter') {
        if (picked) submit();
        return;
      }

      const accelerator = toAccelerator(e);
      if (!accelerator) return;
      picked = accelerator;
      errorEl.textContent = '';
      paint();
    }

    async function submit() {
      if (!picked) return;
      confirmEl.disabled = true;
      const result = verify ? await verify(picked) : { ok: true };
      // 기다리는 사이에 이 창이 닫혔을 수 있다(Esc, 취소, 바깥 클릭). 닫힌 창을 두고
      // 다시 내려놓으면 되돌릴 주체가 없어져 전역 단축키가 죽은 채로 남는다.
      if (closed) return;
      if (result && result.ok === false) {
        errorEl.textContent = result.reason || '지정하지 못했습니다.';
        confirmEl.disabled = false;
        // verify는 실제로 등록해 보는 쪽이라(메모별 단축키), 실패하면 원래 조합들을 되살려
        // 놓는다. 이 창은 아직 떠 있으므로 다시 내려놓아야 이어서 누르는 키를 받을 수 있다.
        api.capture.begin();
        return;
      }
      close(picked);
    }

    function close(value) {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
      overlay.remove();
      api.capture.end();
      resolve(value);
    }

    // 포커스를 잃은 창은 어차피 키를 받지 못한다. 그동안까지 전역 단축키를 내려둘 이유가
    // 없을뿐더러, 그대로 창이 숨겨지면 되돌릴 기회가 사라진다. 편집 창은 닫아도 닫히지 않고
    // 숨기만 해서(windows.js의 close 처리), 창을 닫는 것만으로는 아무 신호도 오지 않는다.
    // 그러면 이 창을 다시 불러 오버레이를 닫을 때까지 전역 단축키가 전부 죽어 있게 된다.
    function onWindowBlur() {
      api.capture.end();
    }

    // 돌아왔으면 다시 내려놓는다. 오버레이는 그 자리에 그대로 떠 있다.
    function onWindowFocus() {
      api.capture.begin();
    }

    overlay.querySelector('.cancel').addEventListener('click', () => close(null));
    confirmEl.addEventListener('click', submit);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) close(null);
    });

    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('focus', onWindowFocus);
    document.body.appendChild(overlay);
    // 이 창이 떠 있는 동안에는 전역 단축키를 내려놓는다. 그러지 않으면 OS가 키를 먼저
    // 가로채, 지금 쓰고 있는 조합은 눌러도 여기까지 닿지 않고 그 기능만 실행된다.
    api.capture.begin();
    paint();
  });
}

// 단축키를 받아내는 창이 떠 있는가. 떠 있으면 Esc나 Ctrl 조합을 그쪽이 먼저 가져간다.
export function isCapturing() {
  return document.querySelector('.overlay') !== null;
}
