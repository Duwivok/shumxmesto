$BOT_TOKEN = $env:TELEGRAM_BOT_TOKEN
$MINIAPP_URL = $env:MINIAPP_URL

if ([string]::IsNullOrWhiteSpace($BOT_TOKEN)) {
    throw "TELEGRAM_BOT_TOKEN environment variable is not set. Set it before running this script."
}

if ([string]::IsNullOrWhiteSpace($MINIAPP_URL)) {
    throw "MINIAPP_URL environment variable is not set. Set it before running this script."
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

$CHANNEL = "@kdsjbfsbdjkfbksjbdfjkb"

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
    chat_id = $CHANNEL

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
