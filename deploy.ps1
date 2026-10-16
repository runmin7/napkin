# 빠른 메모 - 빌드해서 바탕화면에 올리는 스크립트.
#
# 배치 파일이 아니라 PowerShell로 만든 이유가 있다. cmd는 배치 파일을 시작 시점의
# 코드페이지로 읽는데, npm을 부르면 콘솔이 UTF-8로 바뀌어 버린다. 그러면 배치에 적힌
# '빠른메모.exe' 같은 한글 경로가 깨져 파일을 찾지 못한다. PowerShell은 이 문제가 없다.

$root = $PSScriptRoot
Set-Location -LiteralPath $root

function Write-Step($text) {
    Write-Host "  $text" -ForegroundColor Cyan
}

function Fail($text, $detail) {
    Write-Host ''
    Write-Host "  [실패] $text" -ForegroundColor Red
    if ($detail) { Write-Host "  $detail" -ForegroundColor DarkGray }
    Write-Host ''
    Read-Host '  Enter를 누르면 닫습니다'
    exit 1
}

Write-Host ''
Write-Host '  ==========================================' -ForegroundColor Cyan
Write-Host '    빠른 메모 - 빌드 후 바탕화면에 배포' -ForegroundColor Cyan
Write-Host '  ==========================================' -ForegroundColor Cyan
Write-Host ''
Write-Host '  실행 중인 빠른 메모를 종료하고 새로 빌드합니다.'
Write-Host '  작성 중인 메모가 있다면 다른 창을 한 번 클릭해'
Write-Host '  저장되게 한 뒤 진행해 주세요.'
Write-Host ''
Read-Host '  계속하려면 Enter' | Out-Null

# --- 1. 실행 중인 앱 종료 -------------------------------------------------
# 이름이 정확히 일치하는 것만 고른다. 다른 Electron 앱까지 끄지 않기 위해서다.
#
# npm start로 띄운 개발용 인스턴스도 함께 끈다. 그쪽은 이름이 electron.exe라 위의 두 이름에
# 걸리지 않는데, 살아 있으면 배포한 exe가 아예 뜨지 않는다. 두 인스턴스가 같은 설정 폴더
# (AppData\Roaming\quick-note)를 쓰므로 single instance lock을 다투고, 먼저 잡은 쪽이
# 이기면 바탕화면 exe는 창도 못 띄우고 그대로 꺼진다(main.js의 requestSingleInstanceLock).
# 눌러도 아무 일이 없는 것처럼 보이는 증상이 이것이다.
#
# 이 폴더에서 실행된 것만 고른다. 명령줄에 이 경로가 들어가 있는지로 가린다. 자식 프로세스
# (--type=gpu-process 등)에도 같은 경로가 들어 있지만, 부모를 끄면 함께 정리되므로 제외해
# 종료 개수가 부풀지 않게 한다.
Write-Host ''
Write-Step '[1/4] 실행 중인 빠른 메모 종료'

$rootMatch = $root.ToLower()

$running = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -eq '빠른메모.exe' -or $_.Name -eq '빠른 메모.exe' -or
        ($_.Name -eq 'electron.exe' -and $_.CommandLine -and
         $_.CommandLine.ToLower().Contains($rootMatch) -and
         $_.CommandLine -notlike '*--type=*')
    })

foreach ($proc in $running) {
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}
if ($running.Count -gt 0) {
    Write-Host "        $($running.Count)개 종료했습니다. 파일 잠금이 풀리기를 기다립니다."
    Start-Sleep -Seconds 3
} else {
    Write-Host '        실행 중인 앱이 없습니다.'
}

# --- 2. 빌드 --------------------------------------------------------------
Write-Step '[2/4] 빌드 - 몇 분 걸립니다'

& npm run build
if ($LASTEXITCODE -ne 0) {
    Fail '빌드 중 오류가 났습니다.' '위에 표시된 메시지를 확인해 주세요.'
}

$exe = Join-Path $root 'dist\빠른메모.exe'
if (-not (Test-Path -LiteralPath $exe)) {
    Fail '빌드는 끝났지만 결과 파일을 찾지 못했습니다.' $exe
}

# --- 3. 바탕화면으로 복사 --------------------------------------------------
Write-Step '[3/4] 바탕화면으로 복사'

$desktop = [Environment]::GetFolderPath('Desktop')
$dest = Join-Path $desktop '빠른메모.exe'

try {
    Copy-Item -LiteralPath $exe -Destination $dest -Force -ErrorAction Stop
} catch {
    Fail '바탕화면으로 복사하지 못했습니다.' '바탕화면의 빠른메모.exe 가 실행 중인지 확인해 주세요.'
}

$size = [math]::Round((Get-Item -LiteralPath $dest).Length / 1MB, 1)

# --- 4. 시작프로그램 등록 --------------------------------------------------
# 재부팅한 뒤에도 앱이 떠 있도록 시작프로그램 폴더에 바로가기를 둔다.
# --autostart가 붙으면 앱은 창을 띄우지 않고 트레이에만 올라간다(main.js의 startedHidden).
#
# 바로가기는 경로만 가리키므로 exe를 덮어써도 그대로 유효하다. 그런데도 매번 다시 쓰는 이유는,
# 예전에 다른 자리를 가리키거나 인자가 없던 바로가기가 남아 있을 수 있어서다.
Write-Step '[4/4] 시작프로그램 등록'

$startup = [Environment]::GetFolderPath('Startup')
$link = Join-Path $startup '빠른메모.lnk'

$autostartOk = $false

try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($link)
    $shortcut.TargetPath = $dest
    $shortcut.Arguments = '--autostart'
    $shortcut.WorkingDirectory = $desktop
    $shortcut.IconLocation = $dest
    $shortcut.Description = '빠른 메모 - 로그인할 때 트레이에 올린다'
    $shortcut.Save()
    $autostartOk = $true
    Write-Host '        등록했습니다.'
} catch {
    # 배포 자체는 이미 끝났다. 여기서 멈춰 세울 이유는 없고, 안 됐다는 사실만 알린다.
    # 다만 아래 마무리 문구가 "저절로 올라갑니다"라고 말해 버리면 재부팅해서야 알게 된다.
    Write-Host '        [실패] 시작프로그램 바로가기를 만들지 못했습니다.' -ForegroundColor Yellow
    Write-Host "        $($_.Exception.Message)" -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '  완료했습니다.' -ForegroundColor Green
Write-Host "  $dest  ($size MB)"
Write-Host ''
Write-Host '  바탕화면의 빠른메모.exe 를 실행하세요.'
if ($autostartOk) {
    Write-Host '  다음 로그인부터는 트레이에 저절로 올라갑니다.'
    Write-Host '  끄려면 Win+R 에 shell:startup 을 넣고 빠른메모.lnk 를 지우세요.'
    Write-Host '  (지워도 다음 배포 때 다시 등록됩니다.)' -ForegroundColor DarkGray
} else {
    Write-Host '  자동 실행은 등록되지 않았습니다. 위의 [실패] 줄을 확인해 주세요.' -ForegroundColor Yellow
}
Write-Host ''
Read-Host '  Enter를 누르면 닫습니다' | Out-Null
