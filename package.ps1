# Builds a .vsix without needing node/npm/vsce.
# A .vsix is just a zip with an OPC manifest alongside an extension/ folder.

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$vsix = Join-Path $root "$($pkg.name)-$($pkg.version).vsix"

$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("vsix-" + [guid]::NewGuid())
$inner = Join-Path $stage 'extension'
New-Item -ItemType Directory -Path $inner -Force | Out-Null

foreach ($f in 'package.json', 'README.md', 'logo.png') {
    Copy-Item (Join-Path $root $f) (Join-Path $inner $f)
}
Copy-Item (Join-Path $root 'LICENSE') (Join-Path $inner 'LICENSE.txt')
Copy-Item (Join-Path $root 'src') (Join-Path $inner 'src') -Recurse

$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="$($pkg.name)" Version="$($pkg.version)" Publisher="$($pkg.publisher)" />
    <DisplayName>$($pkg.displayName)</DisplayName>
    <Description xml:space="preserve">$($pkg.description)</Description>
    <Tags>qt,qml,cmake,qmake,hot-reload,refactor</Tags>
    <Categories>Other</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="$($pkg.engines.vscode)" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Services.Content.Changelog" Value="" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/logo.png" Addressable="true" />
  </Assets>
</PackageManifest>
"@

$contentTypes = @"
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".js" ContentType="application/javascript" />
  <Default Extension=".md" ContentType="text/markdown" />
  <Default Extension=".png" ContentType="image/png" />
  <Default Extension=".ps1" ContentType="text/plain" />
  <Default Extension=".qml" ContentType="text/plain" />
  <Default Extension=".cpp" ContentType="text/plain" />
  <Default Extension=".h" ContentType="text/plain" />
  <Default Extension=".txt" ContentType="text/plain" />
  <Default Extension=".cmake" ContentType="text/plain" />
  <Default Extension=".patch" ContentType="text/plain" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
</Types>
"@

# -LiteralPath matters: [Content_Types].xml contains PowerShell wildcard characters.
Set-Content -LiteralPath (Join-Path $stage 'extension.vsixmanifest') -Value $manifest -Encoding UTF8
Set-Content -LiteralPath (Join-Path $stage '[Content_Types].xml') -Value $contentTypes -Encoding UTF8

Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $vsix) { Remove-Item -LiteralPath $vsix -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $vsix)
Remove-Item -LiteralPath $stage -Recurse -Force

Write-Host "Built $vsix"
Write-Host "Install with: code --install-extension `"$vsix`""
