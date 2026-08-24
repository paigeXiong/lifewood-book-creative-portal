param(
    [string]$BaseUrl = "http://localhost:5077"
)

$smokeSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession

$unauthorized = Invoke-WebRequest -Method Get -Uri "$BaseUrl/api/projects" -SkipHttpErrorCheck
if ($unauthorized.StatusCode -ne 401) { throw "Anonymous project access was not rejected." }

$login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/login" -WebSession $smokeSession -ContentType "application/json" -Body '{"userId":"admin-1"}'
if ($login.id -ne "admin-1") { throw "Local login returned the wrong user." }

$voices = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/voices" -WebSession $smokeSession
if (-not $voices[0].audioUrl) { throw "Enabled voices did not expose a sample URL." }
$sample = Invoke-WebRequest -Method Get -Uri "$BaseUrl$($voices[0].audioUrl)" -WebSession $smokeSession
if ($sample.StatusCode -ne 200 -or $sample.RawContentLength -le 0) { throw "Voice sample audio was not served." }

$draft = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/projects" -WebSession $smokeSession -ContentType "application/json" -Body '{}'
$saveBody = @{
    version = $draft.version
    project = @{
        clientName = "Smoke client"; contactName = "Smoke operator"; email = "smoke@example.test"
        phone = ""; brandId = "lifewood"; projectName = "Smoke project"; videoGoalId = "book-trailer"
        deadline = ""; audienceIds = @("general")
    }
    book = @{
        title = "Smoke book"; subtitle = ""; authorName = "Smoke author"; genreId = "fiction"
        sellingPoint = "Smoke test"; synopsis = "End-to-end API smoke test."
        contentLanguageId = "en-US"; videoDurationId = "30s"; publishingPlatformIds = @("website")
        sourceAssets = @()
    }
} | ConvertTo-Json -Depth 6

$saved = Invoke-RestMethod -Method Put -Uri "$BaseUrl/api/projects/$($draft.id)/draft" -WebSession $smokeSession -ContentType "application/json" -Body $saveBody
$loaded = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/projects/$($draft.id)" -WebSession $smokeSession

if ($saved.version -ne 2) { throw "Draft version did not advance." }
if ($loaded.project.projectName -ne "Smoke project") { throw "Saved project was not restored." }

$coverPath = Join-Path ([System.IO.Path]::GetTempPath()) "lifewood-smoke-cover.png"
$manuscriptPath = Join-Path ([System.IO.Path]::GetTempPath()) "lifewood-smoke-manuscript.txt"
[System.IO.File]::WriteAllBytes($coverPath, [Convert]::FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="))
[System.IO.File]::WriteAllText($manuscriptPath, "Book manuscript smoke test")
try {
    $coverUpload = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/projects/$($draft.id)/files" -WebSession $smokeSession -Form @{ version = $saved.version; categoryId = "book-cover"; file = Get-Item -LiteralPath $coverPath }
    $manuscriptUpload = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/projects/$($draft.id)/files" -WebSession $smokeSession -Form @{ version = $coverUpload.draft.version; categoryId = "manuscript"; file = Get-Item -LiteralPath $manuscriptPath }
    if ($manuscriptUpload.draft.book.sourceAssets.Count -ne 2) { throw "Book source uploads were not attached to the draft." }
    $servedCover = Invoke-WebRequest -Method Get -Uri "$BaseUrl$($coverUpload.asset.url)" -WebSession $smokeSession
    if ($servedCover.StatusCode -ne 200 -or $servedCover.Headers.'Content-Type' -notlike 'image/png*') { throw "Uploaded cover image was not served as an image." }
} finally {
    Remove-Item -LiteralPath $coverPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $manuscriptPath -Force -ErrorAction SilentlyContinue
}

$stale = Invoke-WebRequest -Method Put -Uri "$BaseUrl/api/projects/$($draft.id)/draft" -WebSession $smokeSession -ContentType "application/json" -Body $saveBody -SkipHttpErrorCheck
if ($stale.StatusCode -ne 409 -or ($stale.Content | ConvertFrom-Json).currentVersion -ne $manuscriptUpload.draft.version) { throw "Stale saves did not return the current version." }

$creativeBody = @{
    version = $manuscriptUpload.draft.version
    creative = @{
        characters = @(@{
            id = "smoke-character"; roleTypeId = "protagonist"; name = "Mara"; storyRole = "Leads the journey"
            personality = "Curious and resilient"; appearance = "Traveler with a field journal"
            ageRangeId = "young-adult"; genderId = "female"; clothing = "Layered travel clothes"
            emotion = "Cautious wonder"; voiceHint = "Warm and direct"; referenceImageUrls = @()
        })
        visualStyleId = "cinematic"; moodTagIds = @("hopeful"); imageStyleTagIds = @("natural-light")
        paceTagIds = @("slow", "measured", "dynamic", "fast"); styleReferenceImageUrls = @()
    }
} | ConvertTo-Json -Depth 8
$creativeSaved = Invoke-RestMethod -Method Put -Uri "$BaseUrl/api/projects/$($draft.id)/creative" -WebSession $smokeSession -ContentType "application/json" -Body $creativeBody
$creativeLoaded = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/projects/$($draft.id)" -WebSession $smokeSession
if ($creativeSaved.version -ne ($manuscriptUpload.draft.version + 1) -or $creativeLoaded.creative.characters[0].name -ne "Mara") { throw "Creative direction was not saved and restored." }

$invalidCreativeBody = $creativeBody | ConvertFrom-Json
$invalidCreativeBody.version = $creativeSaved.version
$invalidCreativeBody.creative.visualStyleId = "not-configured"
$invalidCreative = Invoke-WebRequest -Method Put -Uri "$BaseUrl/api/projects/$($draft.id)/creative" -WebSession $smokeSession -ContentType "application/json" -Body ($invalidCreativeBody | ConvertTo-Json -Depth 8) -SkipHttpErrorCheck
if ($invalidCreative.StatusCode -ne 400) { throw "Unknown creative option was not rejected." }

$voiceBody = @{
    version = $creativeSaved.version
    voiceAndReferences = @{
        voiceover = @{
            contentLanguageId = "en-US"; narrationToneId = "warm"; speechRateId = "medium"
            pronunciationNotes = "Read Mara clearly"; voiceGenderId = "female"; voiceAgeId = "adult"
            accentId = "neutral-us"; emotionStyleId = "warm"; selectedVoiceIds = @("warm-storyteller")
            preferredVoiceId = "warm-storyteller"; customVoiceDescription = "Natural and direct"
        }
        assets = @(); competitorUrls = @("https://example.com/reference")
        creativeDirection = @{
            coreMessage = "Choose courage over certainty"; requiredScenes = "The horizon crossing"
            authorPreferences = "Keep the ending restrained"; closingMessage = "Discover the story"
            musicMood = "Warm and spacious"; avoidContent = "No violent imagery"
        }
    }
} | ConvertTo-Json -Depth 8
$voiceSaved = Invoke-RestMethod -Method Put -Uri "$BaseUrl/api/projects/$($draft.id)/voice-and-references" -WebSession $smokeSession -ContentType "application/json" -Body $voiceBody
$voiceLoaded = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/projects/$($draft.id)" -WebSession $smokeSession
if ($voiceSaved.version -ne ($creativeSaved.version + 1) -or $voiceLoaded.voiceAndReferences.voiceover.preferredVoiceId -ne "warm-storyteller") { throw "Voice preferences were not saved and restored." }

$invalidVoiceBody = $voiceBody | ConvertFrom-Json
$invalidVoiceBody.version = $voiceSaved.version
$invalidVoiceBody.voiceAndReferences.voiceover.narrationToneId = "not-configured"
$invalidVoice = Invoke-WebRequest -Method Put -Uri "$BaseUrl/api/projects/$($draft.id)/voice-and-references" -WebSession $smokeSession -ContentType "application/json" -Body ($invalidVoiceBody | ConvertTo-Json -Depth 8) -SkipHttpErrorCheck
if ($invalidVoice.StatusCode -ne 400) { throw "Unknown voice option was not rejected." }

$uploadPath = Join-Path ([System.IO.Path]::GetTempPath()) "lifewood-smoke-reference.txt"
[System.IO.File]::WriteAllText($uploadPath, "Local upload smoke test")
try {
    $uploaded = Invoke-RestMethod -ErrorAction Stop -Method Post -Uri "$BaseUrl/api/projects/$($draft.id)/files" -WebSession $smokeSession -Form @{ version = $voiceSaved.version; categoryId = "scene-notes"; file = Get-Item -LiteralPath $uploadPath }
    if ($uploaded.asset.fileName -ne "lifewood-smoke-reference.txt" -or $uploaded.draft.version -ne ($voiceSaved.version + 1)) { throw "Reference upload did not atomically attach metadata." }
    $staleVoiceAfterUpload = Invoke-WebRequest -Method Put -Uri "$BaseUrl/api/projects/$($draft.id)/voice-and-references" -WebSession $smokeSession -ContentType "application/json" -Body $voiceBody -SkipHttpErrorCheck
    if ($staleVoiceAfterUpload.StatusCode -ne 409) { throw "Stale voice saves with changed assets did not return a version conflict." }
    $deleted = Invoke-RestMethod -Method Delete -Uri "$BaseUrl/api/projects/$($draft.id)/files/$($uploaded.asset.id)?version=$($uploaded.draft.version)" -WebSession $smokeSession
    if ($deleted.version -ne ($uploaded.draft.version + 1) -or $deleted.voiceAndReferences.assets.Count -ne 0) { throw "Reference deletion did not atomically detach metadata." }
} finally {
    Remove-Item -LiteralPath $uploadPath -Force -ErrorAction SilentlyContinue
}

$validation = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/projects/$($draft.id)/validate" -WebSession $smokeSession -ContentType "application/json" -Body (@{ version = $deleted.version } | ConvertTo-Json)
if (-not $validation.valid -or $validation.fieldErrors.Count -ne 0) { throw "Complete application did not pass preflight validation." }
$idempotencyKey = [Guid]::NewGuid().ToString("N")
$submitBody = @{ version = $deleted.version; idempotencyKey = $idempotencyKey } | ConvertTo-Json
$submitted = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/projects/$($draft.id)/submit" -WebSession $smokeSession -ContentType "application/json" -Body $submitBody
if ($submitted.status -ne "submitted" -or -not $submitted.taskNumber -or $submitted.version -ne ($deleted.version + 1)) { throw "Complete application was not submitted as a numbered receipt." }
$editSubmitted = Invoke-WebRequest -Method Put -Uri "$BaseUrl/api/projects/$($draft.id)/draft" -WebSession $smokeSession -ContentType "application/json" -Body $saveBody -SkipHttpErrorCheck
if ($editSubmitted.StatusCode -ne 409) { throw "Submitted application remained editable." }
$submitAgain = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/projects/$($draft.id)/submit" -WebSession $smokeSession -ContentType "application/json" -Body $submitBody
if ($submitAgain.version -ne $submitted.version -or $submitAgain.taskNumber -ne $submitted.taskNumber) { throw "Idempotent submission replay did not return the original receipt." }
$differentSubmit = Invoke-WebRequest -Method Post -Uri "$BaseUrl/api/projects/$($draft.id)/submit" -WebSession $smokeSession -ContentType "application/json" -Body (@{ version = $deleted.version; idempotencyKey = [Guid]::NewGuid().ToString("N") } | ConvertTo-Json) -SkipHttpErrorCheck
if ($differentSubmit.StatusCode -ne 409) { throw "A submitted application accepted a different idempotency key." }

$partial = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/projects" -WebSession $smokeSession -ContentType "application/json" -Body '{}'
$partialBody = @{ version = $partial.version; project = $partial.project; book = $partial.book } | ConvertTo-Json -Depth 6
$partialSaved = Invoke-RestMethod -Method Put -Uri "$BaseUrl/api/projects/$($partial.id)/draft" -WebSession $smokeSession -ContentType "application/json" -Body $partialBody
if ($partialSaved.version -ne 2) { throw "Incomplete drafts cannot be saved." }

$partialVoiceBody = @{ version = $partialSaved.version; requireComplete = $false; voiceAndReferences = $partialSaved.voiceAndReferences } | ConvertTo-Json -Depth 8
$partialVoiceSaved = Invoke-RestMethod -Method Put -Uri "$BaseUrl/api/projects/$($partial.id)/voice-and-references" -WebSession $smokeSession -ContentType "application/json" -Body $partialVoiceBody
if ($partialVoiceSaved.version -ne 3) { throw "Incomplete voice drafts could not be saved." }
$partialValidation = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/projects/$($partial.id)/validate" -WebSession $smokeSession -ContentType "application/json" -Body (@{ version = $partialVoiceSaved.version } | ConvertTo-Json)
if ($partialValidation.valid -or $partialValidation.fieldErrors.Count -eq 0) { throw "Incomplete application passed preflight validation." }
$partialSubmit = Invoke-WebRequest -Method Post -Uri "$BaseUrl/api/projects/$($partial.id)/submit" -WebSession $smokeSession -ContentType "application/json" -Body (@{ version = $partialVoiceSaved.version; idempotencyKey = [Guid]::NewGuid().ToString("N") } | ConvertTo-Json) -SkipHttpErrorCheck
if ($partialSubmit.StatusCode -ne 400) { throw "Incomplete application was accepted for submission." }
$requiredVoiceBody = $partialVoiceBody | ConvertFrom-Json
$requiredVoiceBody.version = $partialVoiceSaved.version
$requiredVoiceBody.requireComplete = $true
$requiredVoice = Invoke-WebRequest -Method Put -Uri "$BaseUrl/api/projects/$($partial.id)/voice-and-references" -WebSession $smokeSession -ContentType "application/json" -Body ($requiredVoiceBody | ConvertTo-Json -Depth 8) -SkipHttpErrorCheck
if ($requiredVoice.StatusCode -ne 400) { throw "Incomplete voice drafts advanced past the completion gate." }

$nullCollectionsBody = @{
    version = $partialVoiceSaved.version; requireComplete = $false
    voiceAndReferences = @{
        voiceover = @{ selectedVoiceIds = $null }
        assets = $null; competitorUrls = $null; creativeDirection = @{}
    }
} | ConvertTo-Json -Depth 8
$nullCollections = Invoke-WebRequest -Method Put -Uri "$BaseUrl/api/projects/$($partial.id)/voice-and-references" -WebSession $smokeSession -ContentType "application/json" -Body $nullCollectionsBody -SkipHttpErrorCheck
if ($nullCollections.StatusCode -ne 400) { throw "Null voice collections were not returned as validation errors." }

$nullNestedBody = @{
    version = $partialVoiceSaved.version; requireComplete = $false
    voiceAndReferences = @{
        voiceover = @{ selectedVoiceIds = @() }
        assets = @(@{ id = "00000000000000000000000000000000"; categoryId = $null; fileName = "x.txt"; contentType = "text/plain"; sizeBytes = 1; url = "/x" })
        competitorUrls = @(); creativeDirection = @{ coreMessage = $null }
    }
} | ConvertTo-Json -Depth 8
$nullNested = Invoke-WebRequest -Method Put -Uri "$BaseUrl/api/projects/$($partial.id)/voice-and-references" -WebSession $smokeSession -ContentType "application/json" -Body $nullNestedBody -SkipHttpErrorCheck
if ($nullNested.StatusCode -ne 400) { throw "Null nested voice values were not returned as validation errors." }

$invalidBody = '{"version":3,"project":null,"book":null}'
$invalid = Invoke-WebRequest -Method Put -Uri "$BaseUrl/api/projects/$($partial.id)/draft" -WebSession $smokeSession -ContentType "application/json" -Body $invalidBody -SkipHttpErrorCheck
if ($invalid.StatusCode -ne 400) { throw "Malformed draft was not rejected." }

$viewerSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/login" -WebSession $viewerSession -ContentType "application/json" -Body '{"userId":"viewer-1"}' | Out-Null
$forbidden = Invoke-WebRequest -Method Post -Uri "$BaseUrl/api/projects" -WebSession $viewerSession -ContentType "application/json" -Body '{}' -SkipHttpErrorCheck
if ($forbidden.StatusCode -ne 403) { throw "Read-only users were allowed to create tasks." }

$otherUserSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/login" -WebSession $otherUserSession -ContentType "application/json" -Body '{"userId":"admin-2"}' | Out-Null
$crossUser = Invoke-WebRequest -Method Get -Uri "$BaseUrl/api/projects/$($draft.id)" -WebSession $otherUserSession -SkipHttpErrorCheck
if ($crossUser.StatusCode -ne 404) { throw "A user could read another user's task." }

Write-Output "API smoke and negative-path tests passed for draft $($draft.id)."
