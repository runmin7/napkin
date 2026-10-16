// 앱을 실제로 부팅해서 화면까지 살아 있는지 본다.  실행: npm run smoke
//
// 왜 이것이 필요한가.
//
// 2026-09-28 리팩토링에서 preload에 require를 한 줄 더했다가 앱이 통째로 먹통이 됐다.
// Electron 20부터 화면은 sandbox 안에서 돌고, 그 안의 preload는 electron 말고 아무것도
// require할 수 없다. 그런데 이 제약은 코드를 읽어서도, Node에서 require해 봐서도 드러나지
// 않는다(Node에는 sandbox가 없다). 실제로 Electron으로 띄워야만 나타난다.
//
// 게다가 증상이 조용하다. 창은 멀쩡히 뜨고 에러 창도 없다. 다만 아무것도 동작하지 않는다.
// 그래서 "띄워 보고 눈으로 확인" 마저도 대충 하면 놓친다.
//
// 이 스크립트는 그 종류의 사고만 잡는다. 기능이 올바른지는 보지 않는다 —
// 그것은 사람이 눌러 봐야 안다. 여기서 보는 것은 "앱이 살아서 첫 화면까지 왔는가"뿐이다.

const { app, BrowserWindow } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// 화면이 뜨고 메모가 실릴 때까지 기다리는 시간. 느린 기계에서는 늘려야 할 수 있다.
const SETTLE_MS = 4000;
const TIMEOUT_MS = 25000;

const problems = [];
const notes = [];

function ok(label, detail) {
  notes.push(`  OK    ${label}${detail ? '  ' + detail : ''}`);
}

function fail(label, detail) {
  problems.push(label);
  notes.push(`  실패  ${label}${detail ? '  ' + detail : ''}`);
}

let done = false;
function finish() {
  if (done) return;
  done = true;

  console.log('');
  console.log(notes.join('\n'));
  console.log('');
  if (problems.length === 0) {
    console.log('  앱이 부팅되어 첫 화면까지 왔습니다.');
    console.log('  기능이 제대로 도는지는 직접 눌러 확인하세요.');
  } else {
    console.log(`  ${problems.length}건이 걸렸습니다. 위 목록을 보세요.`);
  }
  console.log('');
  app.exit(problems.length === 0 ? 0 : 1);
}

// 앱이 이미 떠 있으면 main.js가 스스로 종료해 버려 아무것도 볼 수 없다.
if (!app.requestSingleInstanceLock()) {
  console.log('\n  빠른 메모가 이미 실행 중입니다. 트레이에서 종료한 뒤 다시 돌려 주세요.\n');
  app.exit(2);
} else {
  // main.js도 같은 잠금을 요청한다. 우리가 쥐고 있으면 그쪽이 종료되므로 돌려준 뒤 넘긴다.
  app.releaseSingleInstanceLock();

  // 점검하는 동안 창이 화면에 튀어나오지 않게 한다. 저장 흐름은 그대로 돈다.
  app.on('browser-window-created', (_e, win) => {
    win.on('show', () => win.hide());
    win.webContents.on('preload-error', (_ev, file, error) => {
      fail('preload가 죽었습니다', `${path.basename(file)} — ${error && error.message}`);
    });
    win.webContents.on('console-message', (...args) => {
      const first = args[0];
      const level = first && typeof first === 'object' ? first.level : args[1];
      const message = first && typeof first === 'object' ? first.message : args[2];
      // 화면 스크립트가 터지면 여기로 나온다. 이것이 조용한 고장의 유일한 흔적이다.
      if (level === 'error' || level === 3) fail('화면에서 에러가 났습니다', String(message).slice(0, 200));
    });
  });

  require(path.join(ROOT, 'main.js'));

  app.whenReady().then(() => {
    setTimeout(async () => {
      try {
        const wins = BrowserWindow.getAllWindows();
        if (wins.length === 0) {
          fail('창이 하나도 만들어지지 않았습니다');
          return finish();
        }
        ok('창이 만들어졌습니다');

        const win = wins[0];
        const run = (code) => win.webContents.executeJavaScript(code);

        // 이번 사고가 걸리는 자리. preload가 죽으면 여기가 undefined가 된다.
        const apiType = await run('typeof window.api');
        if (apiType !== 'object') {
          fail('window.api가 없습니다', 'preload가 통째로 죽었을 때 이렇게 된다');
        } else {
          const groups = await run('Object.keys(window.api).join(",")');
          const count = await run(
            'Object.values(window.api).reduce((n, g) => n + Object.keys(g).length, 0)'
          );
          ok('window.api', `${groups} — 통로 ${count}개`);
        }

        // 화면 스크립트가 끝까지 돌았는가. 중간에 터지면 편집기가 붙지 않는다.
        const mounted = await run("document.querySelector('#editor .cm-editor') !== null");
        if (mounted) ok('편집기가 붙었습니다');
        else fail('편집기가 붙지 않았습니다', '화면 스크립트가 도중에 멈춘 것이다');

        // 메인이 보낸 메모가 화면까지 실렸는가. 저장된 메모가 없으면 빈 것이 정상이다.
        const text = await run("document.querySelector('#editor .cm-content')?.innerText ?? ''");
        const title = win.getTitle();
        if (text.trim() !== '') ok('메모가 실렸습니다', `창 제목 "${title}"`);
        else notes.push('  참고  편집기가 비어 있습니다 (저장된 메모가 없으면 정상)');
      } catch (err) {
        fail('점검 중 예외', err.message);
      }
      finish();
    }, SETTLE_MS);
  });

  setTimeout(() => {
    fail('시간 안에 화면이 뜨지 않았습니다');
    finish();
  }, TIMEOUT_MS);
}
