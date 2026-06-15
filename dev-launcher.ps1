<#
.SYNOPSIS
    AnimoNote Dev Launcher - 一键启动 Vite 开发服务器 + Control Center（--dev）
.DESCRIPTION
    先启动 Vite 开发服务器，等待就绪后再启动 Electron（--dev 模式）。
    关闭 Control Center 窗口后自动清理 Vite 进程。
    默认不启动角色实例，仅启动 Control Center 供开发调试。
.EXAMPLE
    .\dev-launcher.ps1              # 仅启动 Vite + Control Center
    .\dev-launcher.ps1 -WithModels  # 同时启动 role 实例
#>

param(
    [switch]$WithModels = $false
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "===== AnimoNote Dev Launcher =====" -ForegroundColor Cyan
Write-Host ""

# 检查 node_modules
if (-not (Test-Path "$ProjectRoot\node_modules")) {
    Write-Host "未检测到 node_modules，正在安装依赖..." -ForegroundColor Yellow
    Set-Location $ProjectRoot
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "npm install 失败！请手动运行 npm install" -ForegroundColor Red
        exit 1
    }
    Write-Host "依赖安装完成" -ForegroundColor Green
}

# 查找 npx.cmd (Start-Process 需要可执行文件，不是 .ps1)
$npxPath = (Get-Command npx.cmd -ErrorAction SilentlyContinue).Source
if (-not $npxPath) {
    # 兜底
    $npxPath = "$env:APPDATA\npm\npx.cmd"
    if (-not (Test-Path $npxPath)) {
        Write-Host "未找到 npx.cmd，请检查 Node.js 安装" -ForegroundColor Red
        exit 1
    }
}
Write-Host "使用 npx: $npxPath" -ForegroundColor Gray

# 0. 启动 Vite 开发服务器（后台 job）
Write-Host "启动 Vite 开发服务器..." -ForegroundColor Green
$viteJob = Start-Job -ScriptBlock {
    param($root)
    Set-Location "$root\control-center"
    npx vite
} -ArgumentList $ProjectRoot

# 等待 Vite 就绪（检测 5173 端口，最长等 30 秒）
Write-Host "等待 Vite 准备就绪 " -NoNewline -ForegroundColor Yellow
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            $ready = $true
            break
        }
    } catch {
        # 尚未就绪
    }
    Start-Sleep -Seconds 1
    Write-Host "." -NoNewline -ForegroundColor Yellow
}
Write-Host ""

if (-not $ready) {
    Write-Host "Vite 服务器启动超时，请检查错误信息" -ForegroundColor Red
    Receive-Job $viteJob
    exit 1
}
Write-Host "Vite 已就绪（http://localhost:5173）" -ForegroundColor Green

# 1. 启动 Control Center（dev 模式）
Write-Host "启动 Control Center（--dev）..." -ForegroundColor Green
$controlCenter = Start-Process -FilePath $npxPath -ArgumentList "electron control-center/main.js --dev" -WorkingDirectory $ProjectRoot -PassThru -NoNewWindow
Write-Host "   Control Center PID: $($controlCenter.Id)" -ForegroundColor Gray

if ($WithModels) {
    # 2. 扫描 models/ 目录，启动所有配置的角色
    $modelsDir = Join-Path $ProjectRoot "models"
    if (Test-Path $modelsDir) {
        $modelDirs = Get-ChildItem -Path $modelsDir -Directory
        foreach ($dir in $modelDirs) {
            $configPath = Join-Path $dir.FullName "config.json"
            if (Test-Path $configPath) {
                $config = Get-Content $configPath -Raw | ConvertFrom-Json
                $instanceId = $dir.Name
                $channel = $config.midi_channel
                Write-Host "启动实例: $instanceId (CH $channel)..." -ForegroundColor Green

                $instance = Start-Process -FilePath $npxPath -ArgumentList "electron . --instance-id=$instanceId --model-dir=./models/$instanceId --midi-channel=$channel" -WorkingDirectory $ProjectRoot -PassThru -NoNewWindow
                Write-Host "   $instanceId PID: $($instance.Id)" -ForegroundColor Gray
                Start-Sleep -Milliseconds 500
            }
        }
    }
}

Write-Host ""
Write-Host "启动完成" -ForegroundColor Green
Write-Host "提示: 关闭 Control Center 窗口即可停止所有进程" -ForegroundColor Yellow
Write-Host "      Vite 开发服务器: http://localhost:5173" -ForegroundColor Gray
Write-Host ""

# 等待 Control Center 进程退出
$controlCenter.WaitForExit()

# 清理 Vite job
Write-Host "关闭 Vite 开发服务器..." -ForegroundColor Yellow
Stop-Job $viteJob -ErrorAction SilentlyContinue
Remove-Job $viteJob -Force -ErrorAction SilentlyContinue

# 清理所有 Electron 子进程
Write-Host "正在停止所有实例..." -ForegroundColor Yellow
Get-Process -Name "electron" -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "已停止" -ForegroundColor Green
