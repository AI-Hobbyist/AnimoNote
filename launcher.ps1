<#
.SYNOPSIS
    AnimoNote - 多实例一键启动脚本
.DESCRIPTION
    同时启动中央控制台和多个角色实例。
    每个实例加载不同的模型目录，监听不同的 MIDI 通道。
.EXAMPLE
    .\launcher.ps1              # 启动控制台 + 所有配置的角色
    .\launcher.ps1 -ConsoleOnly # 仅启动控制台
#>

param(
    [switch]$ConsoleOnly = $false
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║       AnimoNote 虚拟乐队启动器           ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# 检查 node_modules
if (-not (Test-Path "$ProjectRoot\node_modules")) {
    Write-Host "⚠️  未检测到 node_modules，正在安装依赖..." -ForegroundColor Yellow
    Set-Location $ProjectRoot
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ npm install 失败！请手动运行 npm install" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ 依赖安装完成" -ForegroundColor Green
}

# 1. 启动中央控制台
Write-Host "▶ 启动中央控制台..." -ForegroundColor Green
$controlCenter = Start-Process -FilePath "npx" -ArgumentList "electron control-center/main.js" -WorkingDirectory $ProjectRoot -PassThru -NoNewWindow
Write-Host "   Control Center PID: $($controlCenter.Id)" -ForegroundColor Gray

if (-not $ConsoleOnly) {
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
                Write-Host "▶ 启动实例: $instanceId (CH $channel)..." -ForegroundColor Green
                
                $instance = Start-Process -FilePath "npx" -ArgumentList "electron . --instance-id=$instanceId --model-dir=./models/$instanceId --midi-channel=$channel" -WorkingDirectory $ProjectRoot -PassThru -NoNewWindow
                Write-Host "   $instanceId PID: $($instance.Id)" -ForegroundColor Gray
                Start-Sleep -Milliseconds 500  # 错开启动时间
            }
        }
    }
}

Write-Host ""
Write-Host "✅ 所有实例已启动！" -ForegroundColor Green
Write-Host "💡 提示: 关闭控制台窗口即可停止所有实例" -ForegroundColor Yellow
Write-Host ""

# 等待控制台进程退出
$controlCenter.WaitForExit()

# 控制台关闭后，清理所有子进程
Write-Host "🛑 正在停止所有实例..." -ForegroundColor Yellow
Get-Process -Name "electron" -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "✅ 已停止所有实例" -ForegroundColor Green
