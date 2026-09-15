$BOT_TOKEN = $env:TELEGRAM_BOT_TOKEN
$GROUP_CHAT_ID = $env:TELEGRAM_GROUP_CHAT_ID

if ([string]::IsNullOrWhiteSpace($BOT_TOKEN)) {
    throw "TELEGRAM_BOT_TOKEN environment variable is not set. Set it before running this script."
}
if ([string]::IsNullOrWhiteSpace($GROUP_CHAT_ID)) {
    throw "TELEGRAM_GROUP_CHAT_ID environment variable is not set. Set it to the target Telegram group ID."
}

$botInfo = Invoke-RestMethod `
    -Method Get `
    -Uri "https://api.telegram.org/bot$BOT_TOKEN/getMe"

if (-not $botInfo.ok -or [string]::IsNullOrWhiteSpace($botInfo.result.username)) {
    throw "Unable to determine the Telegram bot username."
}

$APP_LINK = "https://t.me/$($botInfo.result.username)?startapp=home"

Write-Host "Mini App launch link:"
Write-Host $APP_LINK

$templatePath = Join-Path `
    -Path $PSScriptRoot `
    -ChildPath "../templates/post.html"

$richHtml = Get-Content `
    -LiteralPath $templatePath `
    -Raw `
    -Encoding UTF8

$richHtml = $richHtml.Replace(
    "__APP_LINK__",
    $APP_LINK
)

$bodyObject = @{
    chat_id = $GROUP_CHAT_ID

    rich_message = @{
        html = $richHtml
    }
}

$body = $bodyObject | ConvertTo-Json -Depth 10

$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)

$result = Invoke-RestMethod `
    -Method Post `
    -Uri "https://api.telegram.org/bot$BOT_TOKEN/sendRichMessage" `
    -ContentType "application/json; charset=utf-8" `
    -Body $bodyBytes

$result | ConvertTo-Json -Depth 10
