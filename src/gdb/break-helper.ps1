# Stops a running program for gdb, the way Qt Creator does: DebugBreakProcess makes the
# program raise a breakpoint exception in a new thread, which gdb reports as a stop.
# Started by break-helper.js and kept running; one request per line on stdin:
#
#   state <pid>   running | stopped | gone
#   break <pid>   break | stopped | gone    (a stopped program is left alone)
#
# Stopped means gdb holds the program: every thread is suspended except the one reporting
# the debug event, which waits in the kernel ("Executive"). A problem answers `error <message>`.
# The first line out is `ready`, or `error <message>` when the Windows API can't be reached.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

try {
    Add-Type -Namespace QtWorkbench -Name Native -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(int access, bool inherit, int pid);
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool DebugBreakProcess(IntPtr process);
[DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
'@
} catch {
    [Console]::Out.WriteLine('error ' + $_.Exception.Message)
    exit 1
}

# PROCESS_CREATE_THREAD | PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_QUERY_INFORMATION
$access = 0x43A

function Get-ProgramState([int]$id) {
    $program = Get-Process -Id $id -ErrorAction SilentlyContinue
    if (-not $program) { return 'gone' }
    $suspended = 0
    foreach ($thread in $program.Threads) {
        if ($thread.ThreadState -ne 'Wait') { return 'running' }
        $reason = [string]$thread.WaitReason
        if ($reason -eq 'Suspended') { $suspended++ }
        elseif ($reason -ne 'Executive') { return 'running' }
    }
    if ($suspended -gt 0) { return 'stopped' }
    return 'running'
}

[Console]::Out.WriteLine('ready')
while ($null -ne ($line = [Console]::In.ReadLine())) {
    try {
        $command, $argument = $line.Trim().Split(' ', 2)
        $id = [int]$argument
        $state = Get-ProgramState $id
        if ($command -eq 'state' -or $state -ne 'running') {
            [Console]::Out.WriteLine($state)
            continue
        }
        if ($command -ne 'break') { throw "unknown request: $line" }
        $handle = [QtWorkbench.Native]::OpenProcess($access, $false, $id)
        if ($handle -eq [IntPtr]::Zero) {
            throw "OpenProcess failed, error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
        }
        try {
            if (-not [QtWorkbench.Native]::DebugBreakProcess($handle)) {
                throw "DebugBreakProcess failed, error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
            }
        } finally {
            [void][QtWorkbench.Native]::CloseHandle($handle)
        }
        [Console]::Out.WriteLine('break')
    } catch {
        [Console]::Out.WriteLine('error ' + $_.Exception.Message)
    }
}
