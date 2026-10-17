#Requires -Version 7.0
[CmdletBinding()]
param(
    [ValidateRange(1,30)][int]$Samples = 3,
    [ValidateRange(1,60)][int]$Interval = 2,
    [ValidateRange(3,30)][int]$SampleBudget = 12,
    [ValidateRange(1,128)][int]$MaxContainers = 32,
    [string]$Distribution = 'Ubuntu',
    [ValidateSet('C:','E:')][string]$WslBackingVolume = 'E:',
    [Parameter(Mandatory)][string]$Output
)
$ErrorActionPreference = 'Stop'
$destination = [IO.Path]::GetFullPath($Output)
if ([IO.File]::Exists($destination)) { throw 'Report destination already exists.' }
if (-not [IO.Directory]::Exists([IO.Path]::GetDirectoryName($destination))) { throw 'Report parent directory does not exist.' }

function Invoke-Bounded([string[]]$Arguments, [int]$TimeoutSeconds) {
    $info = [Diagnostics.ProcessStartInfo]::new('wsl.exe')
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.CreateNoWindow = $true
    foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            $process.Kill($true)
            throw 'collector-command-timeout'
        }
        if ($process.ExitCode -ne 0) { throw 'collector-command-unavailable' }
        return $stdout.GetAwaiter().GetResult()
    } finally { $process.Dispose() }
}

function Read-WindowsSample {
    $missing = [Collections.Generic.List[string]]::new()
    $memory = $null; $cpu = $null; $swap = $null; $logicalCpus = $null
    try {
        $os = Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 3
        $machine = Get-CimInstance Win32_ComputerSystem -OperationTimeoutSec 3
        $memory = @{ totalBytes = [long]$os.TotalVisibleMemorySize * 1024; availableBytes = [long]$os.FreePhysicalMemory * 1024 }
        $logicalCpus = [int]$machine.NumberOfLogicalProcessors
    } catch { $missing.Add('windows-memory:unavailable') }
    try {
        $cpu = [double](Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'" -OperationTimeoutSec 3).PercentProcessorTime
    } catch { $missing.Add('windows-cpu:unavailable') }
    try {
        $pages = @(Get-CimInstance Win32_PageFileUsage -OperationTimeoutSec 3)
        $swap = @{ allocatedBytes = [long](($pages | Measure-Object AllocatedBaseSize -Sum).Sum) * 1MB;
            currentUsageBytes = [long](($pages | Measure-Object CurrentUsage -Sum).Sum) * 1MB;
            peakUsageBytesSinceBoot = [long](($pages | Measure-Object PeakUsage -Sum).Sum) * 1MB }
    } catch { $missing.Add('windows-pagefile:unavailable') }
    $volumes = @()
    foreach ($drive in @('C:','E:')) {
        try {
            $volume = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$drive'" -OperationTimeoutSec 3
            if (-not $volume) { throw 'absent' }
            $volumes += @{ volume = $drive; capacityBytes = [long]$volume.Size; availableBytes = [long]$volume.FreeSpace }
        } catch { $missing.Add('windows-volume-' + $drive.Substring(0,1) + ':unavailable') }
    }
    return @{ observedAt = [DateTimeOffset]::UtcNow.ToString('o'); logicalCpus = $logicalCpus;
        memory = $memory; cpuPercentTotal = $cpu; pageFile = $swap; physicalVolumes = $volumes; unavailable = @($missing.ToArray()) }
}

# Refuse to start a stopped distribution as part of a passive observation.
$running = Invoke-Bounded @('--list','--running','--quiet') 5
if (($running.Replace([string][char]0,'') -split '\r?\n').Trim() -notcontains $Distribution) {
    throw 'Requested WSL distribution is not running; collector will not start it.'
}
$hostScript = (Join-Path $PSScriptRoot 'collect.py').Replace('\','/')
$linuxPath = (Invoke-Bounded @('-d',$Distribution,'-u','root','--exec','wslpath','-u','-a',$hostScript) 5).Trim()
$observations = @(); $previousCpu = $null
for ($index = 0; $index -lt $Samples; $index++) {
    $windows = Read-WindowsSample
    $raw = Invoke-Bounded @('-d',$Distribution,'-u','root','--exec','python3',$linuxPath,'--samples','1','--budget',"$SampleBudget",'--max-containers',"$MaxContainers") ($SampleBudget + 8)
    $linuxReport = $raw | ConvertFrom-Json -AsHashtable
    $sample = $linuxReport.samples[0]
    $ticks = $sample.linux.cpuTicksCounters
    if ($null -ne $previousCpu -and $null -ne $ticks -and $ticks.total -gt $previousCpu.total) {
        $sample.linux.cpuPercentTotalSincePreviousSample = [Math]::Round(100 * (1 - ($ticks.idle - $previousCpu.idle) / ($ticks.total - $previousCpu.total)), 2)
    }
    $previousCpu = $ticks
    $sample.windows = $windows
    $observations += $sample
    if ($index + 1 -lt $Samples) { Start-Sleep -Seconds $Interval }
}
$report = @{ schemaVersion = 1; kind = 'passive-resource-observation'; createdAt = [DateTimeOffset]::UtcNow.ToString('o');
    sampling = @{ count = $Samples; delayAfterSampleSeconds = $Interval; sampleBudgetSeconds = $SampleBudget; maxContainers = $MaxContainers };
    wslBackingPhysicalVolumeOperatorSupplied = $WslBackingVolume; samples = $observations;
    summary = @{ productionSizingReady = $false; missingWorkloadEvidence = $linuxReport.summary.missingWorkloadEvidence };
    limitations = @($linuxReport.limitations) + @('Windows and Linux observations are sequential, with their own timestamps.',
        'Windows page-file peak is since boot; Linux and container counters are cumulative.',
        'The WSL backing volume is an operator assertion; no VHD paths are collected.') }
$stream = [IO.File]::Open($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
try {
    $writer = [IO.StreamWriter]::new($stream, [Text.UTF8Encoding]::new($false))
    try { $writer.WriteLine(($report | ConvertTo-Json -Depth 30)) } finally { $writer.Dispose() }
} finally { $stream.Dispose() }
Write-Output "Passive report written. Samples: $Samples. Production sizing ready: false."
