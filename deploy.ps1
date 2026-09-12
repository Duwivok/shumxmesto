[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateNotNullOrEmpty()]
    [string]$Message
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ExpectedBranch = "main"
$ExpectedOrigin = "https://github.com/Duwivok/shumxmesto.git"
$SshTarget = "zvezda-server"
$RemoteRepository = "/srv/shumxmesto"
$PublicHealthUrl = "http://186.246.18.24/"
$RepositoryPath = $PSScriptRoot.Replace('\', '/')
$GitBaseArguments = @("-c", "safe.directory=$RepositoryPath")

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [string[]]$ArgumentList = @()
    )

    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath exited with code $LASTEXITCODE."
    }
}

function Invoke-GitCommand {
    param(
        [string[]]$ArgumentList = @()
    )

    & git @GitBaseArguments @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "git exited with code $LASTEXITCODE."
    }
}

Push-Location $PSScriptRoot

try {
    Invoke-GitCommand -ArgumentList @("rev-parse", "--is-inside-work-tree")

    $branch = (& git @GitBaseArguments branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or $branch -ne $ExpectedBranch) {
        throw "Deployment is allowed only from $ExpectedBranch. Current branch: $branch"
    }

    $origin = (& git @GitBaseArguments remote get-url origin).Trim()
    if ($LASTEXITCODE -ne 0 -or $origin -ne $ExpectedOrigin) {
        throw "Unexpected origin: $origin"
    }

    Invoke-GitCommand -ArgumentList @("fetch", "origin", $ExpectedBranch)

    & git @GitBaseArguments merge-base --is-ancestor "origin/$ExpectedBranch" HEAD
    $ancestorExitCode = $LASTEXITCODE
    if ($ancestorExitCode -eq 1) {
        throw "origin/main contains changes missing locally. Synchronize the branch first."
    }
    if ($ancestorExitCode -ne 0) {
        throw "Unable to verify origin/main history."
    }

    $requiredIgnoreRules = @(
        ".env",
        ".env.*",
        "*.env",
        "!.env.example",
        "*.secret",
        "secrets/",
        ".ssh/",
        "*.pem",
        "*.key",
        "*.p12",
        "*.pfx",
        "id_rsa",
        "id_ed25519"
    )
    $ignoreRules = @(Get-Content -LiteralPath ".gitignore" -Encoding UTF8)
    foreach ($rule in $requiredIgnoreRules) {
        if ($ignoreRules -notcontains $rule) {
            throw "Required .gitignore rule is missing: $rule"
        }
    }

    Invoke-GitCommand -ArgumentList @("diff", "--check")
    Invoke-GitCommand -ArgumentList @("add", "--all")
    Invoke-GitCommand -ArgumentList @("diff", "--cached", "--check")

    $stagedFiles = @(& git @GitBaseArguments diff --cached --name-only --diff-filter=ACMRTUXB)
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to read the staged file list."
    }

    foreach ($file in $stagedFiles) {
        $normalizedPath = $file.Replace('\', '/')
        if ($normalizedPath -eq ".env.example") {
            continue
        }

        if ($normalizedPath -match '(?i)(^|/)(\.env($|\.)|[^/]*\.env$|secrets?/|\.ssh/|id_rsa(?:\.|$)|id_ed25519(?:\.|$))|\.(pem|key|p12|pfx|secret)$') {
            throw "Deployment stopped: a sensitive file is staged: $file"
        }
    }

    if ($stagedFiles.Count -gt 0) {
        $secretPatterns = @(
            ('-----' + 'BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'),
            ('gh' + '[pousr]_[A-Za-z0-9_]{20,}'),
            ('github' + '_pat_[A-Za-z0-9_]{20,}'),
            ('[0-9]' + '{8,12}:[A-Za-z0-9_-]{30,}'),
            ('(AKIA' + '|ASIA)[A-Z0-9]{16}')
        ) -join '|'

        & git @GitBaseArguments grep --cached -I -q -E -e $secretPatterns -- . ':(exclude).env.example'
        $secretScanExitCode = $LASTEXITCODE
        if ($secretScanExitCode -eq 0) {
            throw "Deployment stopped: a possible secret was found in staged content."
        }
        if ($secretScanExitCode -ne 1) {
            throw "Unable to scan staged content for secrets."
        }

        Invoke-GitCommand -ArgumentList @("commit", "-m", $Message)
    }
    else {
        Write-Host "No new changes to commit; continuing with the current HEAD."
    }

    Invoke-GitCommand -ArgumentList @("push", "origin", $ExpectedBranch)
    $expectedCommit = (& git @GitBaseArguments rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to determine the pushed commit SHA."
    }

    $remoteScript = @'
set -eu
cd /srv/shumxmesto
test -d .git
test "$(git branch --show-current)" = main
if test -n "$(git status --porcelain)"; then
  printf '%s\n' 'The server repository has local changes; pull was cancelled.' >&2
  exit 80
fi
git pull --ff-only origin main
actual_commit=$(git rev-parse HEAD)
if test "$actual_commit" != "__EXPECTED_COMMIT__"; then
  printf '%s\n' 'The server SHA does not match the pushed commit.' >&2
  exit 81
fi
nginx -t
status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' -H 'Host: 186.246.18.24' http://127.0.0.1/)
if test "$status" != 200; then
  printf 'The server health check returned HTTP %s.\n' "$status" >&2
  exit 82
fi
printf 'server_commit=%s\nserver_http=%s\n' "$actual_commit" "$status"
'@
    $remoteScript = $remoteScript.Replace("__EXPECTED_COMMIT__", $expectedCommit)
    $encodedRemoteScript = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteScript))

    Invoke-NativeCommand -FilePath "ssh" -ArgumentList @(
        "-o", "BatchMode=yes",
        "-o", "StrictHostKeyChecking=yes",
        $SshTarget,
        "echo $encodedRemoteScript | base64 -d | bash"
    )

    $response = Invoke-WebRequest -Uri $PublicHealthUrl -Method Head -UseBasicParsing
    if ([int]$response.StatusCode -ne 200) {
        throw "The external site check returned HTTP $($response.StatusCode)."
    }

    Write-Host "Deployment completed: $expectedCommit, HTTP 200"
}
finally {
    Pop-Location
}
