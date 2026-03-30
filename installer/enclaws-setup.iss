; EnClaws Windows Installer — Inno Setup Script
; Builds a one-click offline EXE installer.
;
; Prerequisites (populated by build-installer.ps1):
;   installer/node-portable/   — portable Node.js 22 win-x64
;   installer/app-bundle/      — pre-built enclaws + production node_modules
;
; Compile:  iscc installer/enclaws-setup.iss

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{E7C1A2B3-4D5F-6789-ABCD-EF0123456789}
AppName=EnClaws
AppVersion={#AppVersion}
AppPublisher=EnClaws
AppPublisherURL=https://github.com/hashSTACS-Global/EnClaws
AppSupportURL=https://github.com/hashSTACS-Global/EnClaws/issues
DefaultDirName={localappdata}\EnClaws
PrivilegesRequired=lowest
OutputBaseFilename=EnClaws-Setup-{#AppVersion}
OutputDir=Output
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
; Simplify for one-click experience
DisableProgramGroupPage=yes
DisableReadyPage=yes
; Allow user to change install dir if they want
DisableDirPage=no
LicenseFile=..\LICENSE
SetupIconFile=assets\enclaws-icon.ico
UninstallDisplayIcon={app}\enclaws-icon.ico
; Uninstall support
UninstallDisplayName=EnClaws {#AppVersion}
; Minimum Windows 10
MinVersion=10.0
; Broadcast WM_SETTINGCHANGE after install so new terminals pick up PATH
ChangesEnvironment=yes

[Languages]
Name: "chinesesimplified"; MessagesFile: "assets\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Portable Node.js runtime
Source: "node-portable\*"; DestDir: "{app}\node"; Flags: ignoreversion recursesubdirs createallsubdirs

; EnClaws application (dist, extensions, skills, assets, node_modules, etc.)
Source: "app-bundle\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs

; CLI wrapper script (this is what gets added to PATH)
Source: "enclaws.cmd"; DestDir: "{app}"; Flags: ignoreversion

; Application icon
Source: "assets\enclaws-icon.ico"; DestDir: "{app}"; Flags: ignoreversion

; Gateway launcher (hidden window + open browser)
Source: "enclaws-gateway.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "loading.html"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userdesktop}\EnClaws"; Filename: "{app}\enclaws-gateway.vbs"; IconFilename: "{app}\enclaws-icon.ico"; Comment: "Start EnClaws"
Name: "{userprograms}\EnClaws\EnClaws"; Filename: "{app}\enclaws-gateway.vbs"; IconFilename: "{app}\enclaws-icon.ico"; Comment: "Start EnClaws"
Name: "{userprograms}\EnClaws\Uninstall EnClaws"; Filename: "{uninstallexe}"

[Run]
; Run postinstall to create ~/.enclaws/.env (if not exists)
Filename: "{app}\node\node.exe"; Parameters: """{app}\app\scripts\postinstall.js"""; StatusMsg: "Configuring EnClaws..."; Flags: runhidden waituntilterminated
; Option to launch EnClaws after install
Filename: "{app}\enclaws-gateway.vbs"; Description: "立即启动 EnClaws"; Flags: nowait postinstall shellexec skipifsilent

[UninstallDelete]
; Clean up generated files in install dir (node_modules cache, etc.)
Type: filesandordirs; Name: "{app}"

[Code]
const
  WM_SETTINGCHANGE = $001A;
  SMTO_ABORTIFHUNG = $0002;

function SendMessageTimeoutW(hWnd: Integer; Msg: Cardinal; wParam: Cardinal;
  lParam: String; fuFlags: Cardinal; uTimeout: Cardinal;
  var lpdwResult: Cardinal): Cardinal;
  external 'SendMessageTimeoutW@user32.dll stdcall';

// Broadcast WM_SETTINGCHANGE so Explorer reloads environment variables
// and new terminals pick up the updated PATH without requiring a reboot.
procedure BroadcastEnvironmentChange;
var
  Res: Cardinal;
begin
  SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, 0,
    'Environment', SMTO_ABORTIFHUNG, 5000, Res);
  Log('Broadcasted WM_SETTINGCHANGE for Environment');
end;

// Add a directory to the user-level PATH environment variable.
procedure AddToUserPath(Dir: string);
var
  CurrentPath: string;
  UpperDir: string;
  UpperPath: string;
begin
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', CurrentPath) then
    CurrentPath := '';

  UpperDir := Uppercase(Dir);
  UpperPath := Uppercase(CurrentPath);

  // Check if already present (case-insensitive)
  if Pos(UpperDir, UpperPath) > 0 then
    Exit;

  // Append
  if CurrentPath <> '' then
  begin
    // Remove trailing semicolons
    while (Length(CurrentPath) > 0) and (CurrentPath[Length(CurrentPath)] = ';') do
      CurrentPath := Copy(CurrentPath, 1, Length(CurrentPath) - 1);
    CurrentPath := CurrentPath + ';';
  end;
  CurrentPath := CurrentPath + Dir;

  RegWriteExpandStringValue(HKCU, 'Environment', 'Path', CurrentPath);
  Log('Added to user PATH: ' + Dir);
end;

// Remove a directory from the user-level PATH environment variable.
procedure RemoveFromUserPath(Dir: string);
var
  CurrentPath: string;
  UpperDir: string;
  UpperPath: string;
  StartPos: Integer;
  NewPath: string;
  BeforePart: string;
  AfterPart: string;
begin
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', CurrentPath) then
    Exit;

  UpperDir := Uppercase(Dir);
  UpperPath := Uppercase(CurrentPath);
  StartPos := Pos(UpperDir, UpperPath);

  if StartPos = 0 then
    Exit;

  // Extract the part before and after the directory
  BeforePart := Copy(CurrentPath, 1, StartPos - 1);
  AfterPart := Copy(CurrentPath, StartPos + Length(Dir), MaxInt);

  // Clean up semicolons at the junction
  while (Length(BeforePart) > 0) and (BeforePart[Length(BeforePart)] = ';') do
    BeforePart := Copy(BeforePart, 1, Length(BeforePart) - 1);
  while (Length(AfterPart) > 0) and (AfterPart[1] = ';') do
    AfterPart := Copy(AfterPart, 2, MaxInt);

  if (BeforePart <> '') and (AfterPart <> '') then
    NewPath := BeforePart + ';' + AfterPart
  else
    NewPath := BeforePart + AfterPart;

  if NewPath <> '' then
    RegWriteExpandStringValue(HKCU, 'Environment', 'Path', NewPath)
  else
    RegDeleteValue(HKCU, 'Environment', 'Path');

  Log('Removed from user PATH: ' + Dir);
end;

// Called after installation completes — add to PATH.
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    AddToUserPath(ExpandConstant('{app}'));
    BroadcastEnvironmentChange;
  end;
end;

// Called during uninstall — remove from PATH.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    RemoveFromUserPath(ExpandConstant('{app}'));
    BroadcastEnvironmentChange;
  end;
end;
