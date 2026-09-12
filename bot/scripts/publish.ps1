$BOT_TOKEN = $env:TELEGRAM_BOT_TOKEN

if ([string]::IsNullOrWhiteSpace($BOT_TOKEN)) {
    throw "TELEGRAM_BOT_TOKEN environment variable is not set. Set it before running this script."
}

$BOT_USERNAME = "sdfoihnsdipfbisdfbBot"
$CHANNEL = "@kdsjbfsbdjkfbksjbdfjkb"

$APP_LINK = "https://t.me/${BOT_USERNAME}?startapp=post_001"

Write-Host "Mini App link:"
Write-Host $APP_LINK

$templatePath = Join-Path `
    -Path $PSScriptRoot `
    -ChildPath "..\templates\post.html"

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
