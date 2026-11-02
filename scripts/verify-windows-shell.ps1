param(
    [string]$Executable = "",
    [switch]$InspectOnly
)

$ErrorActionPreference = "Stop"

if (-not $IsWindows) {
    throw "This check requires an interactive Windows desktop."
}

if (-not $Executable) {
    $repository = Split-Path -Parent $PSScriptRoot
    $Executable = Join-Path $repository "src-tauri/target/debug/messenger.exe"
}

$Executable = (Resolve-Path -LiteralPath $Executable -ErrorAction Stop).Path
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MessengerWindow {
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
}
'@

function Require-Control([System.Windows.Automation.AutomationElement]$Root, [string]$Name) {
    # The bundled WebViews initialize independently; inspect their UIA tree only
    # after the requested element appears.
    $condition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::NameProperty, $Name
    )
    for ($attempt = 0; $attempt -lt 25; $attempt++) {
        try {
            $items = $Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
            if ($items.Count -eq 1) { return $items.Item(0) }
            if ($items.Count -gt 1) { throw "Duplicate native control: $Name" }
        } catch {
            if ($_.Exception.Message -like "Duplicate native control:*") { throw }
        }
        Start-Sleep -Milliseconds 400
    }
    throw "Missing native control: $Name"
}

function Invoke-Control([System.Windows.Automation.AutomationElement]$Root, [string]$Name) {
    $element = Require-Control $Root $Name
    if (-not $element.Current.IsEnabled) { throw "Disabled native control: $Name" }
    $pattern = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $pattern.Invoke()
    Start-Sleep -Milliseconds 850
}

function Find-About([int]$ProcessId) {
    $condition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::NameProperty, "About Messenger"
    )
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
        [System.Windows.Automation.TreeScope]::Children, $condition
    )
    foreach ($window in $windows) {
        if ($window.Current.ProcessId -eq $ProcessId) { return $window }
    }
    return $null
}

function Wait-About([int]$ProcessId, [bool]$Present) {
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $window = Find-About $ProcessId
        if (($null -ne $window) -eq $Present) { return $window }
        Start-Sleep -Milliseconds 300
    }
    throw "About window did not reach expected state: visible=$Present"
}

$owned = $null
try {
    $owned = Start-Process -FilePath $Executable -PassThru
    $window = $null
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $window = Get-Process -Id $owned.Id -ErrorAction SilentlyContinue
        if ($window -and $window.MainWindowHandle -ne 0) { break }
        Start-Sleep -Milliseconds 400
    }
    if (-not $window -or $window.MainWindowHandle -eq 0) {
        throw "Messenger did not create a native window."
    }

    # WebView2 children are attached after the initial native frame appears.
    Start-Sleep -Seconds 4
    $window = Get-Process -Id $owned.Id -ErrorAction Stop
    $hwnd = $window.MainWindowHandle
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    $required = @(
        "Minimize window", "Maximize window", "Close window",
        "Credits", "Unread conversations", "Application version", "Connection status"
    )
    foreach ($name in $required) {
        $null = Require-Control $root $name
        Write-Output "Present: $name"
    }

    $outer = [MessengerWindow+Rect]::new()
    $client = [MessengerWindow+Rect]::new()
    if (-not [MessengerWindow]::GetWindowRect($hwnd, [ref]$outer) -or
        -not [MessengerWindow]::GetClientRect($hwnd, [ref]$client)) {
        throw "Could not measure native window bounds."
    }
    $nonClientHeight = ($outer.Bottom - $outer.Top) - ($client.Bottom - $client.Top)
    if ($nonClientHeight -gt 25) { throw "Unexpected native title bar height: $nonClientHeight" }
    Write-Output "Frameless window verified ($nonClientHeight non-client vertical pixels)."

    if (-not [MessengerWindow]::SetWindowPos($hwnd, [IntPtr]::Zero, 0, 0, 1060, 750, 0x16)) {
        throw "Native resize failed."
    }
    Start-Sleep -Milliseconds 600
    [MessengerWindow]::GetWindowRect($hwnd, [ref]$outer) | Out-Null
    if (($outer.Right - $outer.Left) -ne 1060 -or ($outer.Bottom - $outer.Top) -ne 750) {
        throw "Window size mismatch after resize."
    }
    Write-Output "Native resize verified."

    if (-not $InspectOnly) {
        Invoke-Control $root "Credits"
        $about = Wait-About $owned.Id $true
        $repository = Split-Path -Parent $PSScriptRoot
        $version = (Get-Content (Join-Path $repository "package.json") -Raw | ConvertFrom-Json).version
        $null = Require-Control $about $version
        Invoke-Control $about "Close"
        $null = Wait-About $owned.Id $false
        Write-Output "About content, version and Close button verified."

        Invoke-Control $root "Credits"
        $reopened = Wait-About $owned.Id $true
        $reopened.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close()
        $null = Wait-About $owned.Id $false
        Write-Output "About reopened and native close button verified."

        Invoke-Control $root "Maximize window"
        if (-not [MessengerWindow]::IsZoomed($hwnd)) { throw "Maximize did not complete." }

        Invoke-Control $root "Restore window"
        if ([MessengerWindow]::IsZoomed($hwnd)) { throw "Restore did not complete." }

        Invoke-Control $root "Minimize window"
        if (-not [MessengerWindow]::IsIconic($hwnd)) { throw "Minimize did not complete." }
        [MessengerWindow]::ShowWindow($hwnd, 9) | Out-Null

        Invoke-Control $root "Close window"
        $stillRunning = Get-Process -Id $owned.Id -ErrorAction SilentlyContinue
        if ($stillRunning -and [MessengerWindow]::IsWindowVisible($hwnd)) {
            throw "Close did not hide the main window."
        }
        Write-Output "Native maximize, restore, minimize and close verified."
    }
    Write-Output "PASS: Messenger shell is functional."
} finally {
    # Only terminate the process launched by this check.
    if ($owned) { Stop-Process -Id $owned.Id -Force -ErrorAction SilentlyContinue }
}
