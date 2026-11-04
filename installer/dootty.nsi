; DooTTY: one per-user installer, with an explicit registry-free portable branch.
Unicode true
ManifestDPIAware true
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetDatablockOptimize on
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WordFunc.nsh"
!include "x64.nsh"
!ifndef VERSION
  !error "VERSION is required"
!endif
!ifndef PAYLOAD
  !error "PAYLOAD is required"
!endif
!ifndef OUTFILE
  !error "OUTFILE is required"
!endif
Name "DooTTY"
Caption "DooTTY ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\DooTTY"
BrandingText " "
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "DooTTY"
VIAddVersionKey "CompanyName" "DooSys"
VIAddVersionKey "FileDescription" "DooTTY setup — installed or portable"
VIAddVersionKey "FileVersion" "${VERSION}.0"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "InternalName" "DooTTY"
VIAddVersionKey "Comments" "https://github.com/DooSys/DooTTY"
VIAddVersionKey "LegalCopyright" "Copyright 2026 DooSys"
!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_BGCOLOR "FFFFFF"
!define MUI_TEXTCOLOR "202020"
!define MUI_ABORTWARNING
!define MUI_PAGE_CUSTOMFUNCTION_SHOW Layout
Page custom ModePage ModeLeave
!insertmacro MUI_PAGE_INSTFILES
Page custom FinishPage FinishLeave
UninstPage custom un.ConfirmPage un.ConfirmLeave
!define MUI_PAGE_CUSTOMFUNCTION_SHOW un.Layout
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "French"

LangString Install ${LANG_ENGLISH} "Install for me"
LangString Install ${LANG_FRENCH} "Installer pour moi"
LangString InstallHint ${LANG_ENGLISH} "Start menu shortcut, Windows uninstall and saved preferences."
LangString InstallHint ${LANG_FRENCH} "Menu Démarrer, désinstallation Windows et préférences conservées."
LangString Portable ${LANG_ENGLISH} "Portable"
LangString Portable ${LANG_FRENCH} "Portable"
LangString PortableHint ${LANG_ENGLISH} "Choose a folder. App, preferences and cache stay together."
LangString PortableHint ${LANG_FRENCH} "Choisissez un dossier : application, préférences et cache réunis."
LangString Licenses ${LANG_ENGLISH} "Licenses"
LangString Licenses ${LANG_FRENCH} "Licences"
LangString Browse ${LANG_ENGLISH} "Browse…"
LangString Browse ${LANG_FRENCH} "Parcourir…"
LangString Existing ${LANG_ENGLISH} "Installed version: $ExistingVersion — update or reinstall."
LangString Existing ${LANG_FRENCH} "Version installée : $ExistingVersion — mise à jour ou réinstallation."
LangString Remove ${LANG_ENGLISH} "Uninstall DooTTY"
LangString Remove ${LANG_FRENCH} "Désinstaller DooTTY"
LangString ChooseFolder ${LANG_ENGLISH} "Choose the DooTTY portable folder"
LangString ChooseFolder ${LANG_FRENCH} "Choisir le dossier DooTTY portable"
LangString InvalidFolder ${LANG_ENGLISH} "Choose an absolute, writable folder dedicated to DooTTY, not a drive root."
LangString InvalidFolder ${LANG_FRENCH} "Choisissez un dossier absolu dédié à DooTTY et accessible en écriture, pas la racine du disque."
LangString MixedMode ${LANG_ENGLISH} "This folder belongs to the other mode. Choose a separate portable folder."
LangString MixedMode ${LANG_FRENCH} "Ce dossier appartient à l’autre mode. Choisissez un dossier portable distinct."
LangString Downgrade ${LANG_ENGLISH} "A newer DooTTY version is already in this folder. Installation cancelled."
LangString Downgrade ${LANG_FRENCH} "Une version plus récente de DooTTY est déjà présente. Installation annulée."
LangString CloseFailed ${LANG_ENGLISH} "DooTTY is still open or busy. Finish the current operation and close it, then retry. No process was forcibly stopped."
LangString CloseFailed ${LANG_FRENCH} "DooTTY est encore ouvert ou occupé. Terminez l’opération et fermez-le, puis réessayez. Aucun processus n’a été arrêté de force."
LangString CopyFailed ${LANG_ENGLISH} "Cannot write the application or preferences. Check folder access and free space, then retry."
LangString CopyFailed ${LANG_FRENCH} "Écriture impossible. Vérifiez les droits du dossier et l’espace libre, puis réessayez."
LangString WebView ${LANG_ENGLISH} "Microsoft WebView2 is required. Open its official download page? You can run setup again after installing it."
LangString WebView ${LANG_FRENCH} "Microsoft WebView2 est nécessaire. Ouvrir sa page officielle ? Vous pourrez relancer l’installation ensuite."
LangString Ready ${LANG_ENGLISH} "DooTTY is ready"
LangString Ready ${LANG_FRENCH} "DooTTY est prêt"
LangString Desktop ${LANG_ENGLISH} "Create a desktop shortcut"
LangString Desktop ${LANG_FRENCH} "Créer un raccourci sur le bureau"
LangString Launch ${LANG_ENGLISH} "Open DooTTY"
LangString Launch ${LANG_FRENCH} "Ouvrir DooTTY"
LangString RemoveHint ${LANG_ENGLISH} "Removes DooTTY and its shortcut. Your WSL distributions and Linux files are kept."
LangString RemoveHint ${LANG_FRENCH} "Supprime DooTTY et son raccourci. Vos distributions WSL et fichiers Linux sont conservés."
LangString RemovePrefs ${LANG_ENGLISH} "Also delete my DooTTY preferences and cache"
LangString RemovePrefs ${LANG_FRENCH} "Supprimer aussi mes préférences et le cache DooTTY"
LangString CloseQuestion ${LANG_ENGLISH} "DooTTY may need to close before its files are replaced. Its normal confirmation dialogs will remain active. Continue?"
LangString CloseQuestion ${LANG_FRENCH} "DooTTY devra se fermer avant le remplacement des fichiers. Ses confirmations habituelles resteront actives. Continuer ?"
LangString Only64 ${LANG_ENGLISH} "DooTTY requires Windows 11 x64."
LangString Only64 ${LANG_FRENCH} "DooTTY nécessite Windows 11 x64."

Var Dialog
Var InstallRadio
Var PortableRadio
Var FolderEdit
Var BrowseButton
Var ExistingLabel
Var LaunchCheck
Var DesktopCheck
Var RemoveCheck
Var DeletePrefs
Var PortableMode
Var ExistingDir
Var ExistingVersion
Var PortableFolder
Var SetupMutex
Var UIFont
Var BrandDoo
Var BrandTTY

!macro OuterLayout
  ${If} $UIFont == ""
    CreateFont $UIFont "Segoe UI" 10 400
  ${EndIf}
  ; Only the native titlebar keeps the app icon. Remove MUI decoration and branding.
  !insertmacro HideOuterControl 1034
  !insertmacro HideOuterControl 1037
  !insertmacro HideOuterControl 1038
  !insertmacro HideOuterControl 1039
  !insertmacro HideOuterControl 1046
  !insertmacro HideOuterControl 1035
  !insertmacro HideOuterControl 1045
  !insertmacro HideOuterControl 1028
  !insertmacro HideOuterControl 1256
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETFONT} $UIFont 1
  GetDlgItem $0 $HWNDPARENT 2
  SendMessage $0 ${WM_SETFONT} $UIFont 1
!macroend
!macro HideOuterControl ID
  GetDlgItem $0 $HWNDPARENT ${ID}
  ShowWindow $0 ${SW_HIDE}
!macroend
Function Layout
  !insertmacro OuterLayout
FunctionEnd
Function un.Layout
  !insertmacro OuterLayout
FunctionEnd

; Use the space left by the removed MUI header, without shifting the footer buttons.
!macro CompactPage
  !insertmacro OuterLayout
  System::Alloc 16
  Pop $0
  System::Call 'user32::GetWindowRect(p $Dialog, p r0)'
  System::Call 'user32::MapWindowPoints(p 0, p $HWNDPARENT, p r0, i 2)'
  System::Call '*$0(i.r1, i.r2, i.r3, i.r4)'
  System::Free $0
  System::Call 'user32::GetDpiForWindow(p $HWNDPARENT) i.r5'
  IntOp $5 $5 * 16
  IntOp $5 $5 / 96
  IntOp $3 $3 - $1
  IntOp $4 $4 - $5
  System::Call 'user32::MoveWindow(p $Dialog, i r1, i r5, i r3, i r4, i 1)'
!macroend
!macro Header
  !insertmacro CompactPage
  SetCtlColors $Dialog 202020 FFFFFF
  ${NSD_CreateLabel} 10u 0 38u 27u "Doo"
  Pop $0
  StrCpy $BrandDoo $0
  CreateFont $1 "Segoe UI" 22 700
  SendMessage $0 ${WM_SETFONT} $1 1
  SetCtlColors $0 202020 FFFFFF
  ${NSD_CreateLabel} 48u 0 75u 27u "TTY"
  Pop $0
  StrCpy $BrandTTY $0
  SendMessage $0 ${WM_SETFONT} $1 1
  SetCtlColors $0 0085B3 FFFFFF
  ${NSD_CreateLabel} 11u 28u 240u 14u "Your native WSL client."
  Pop $0
  SetCtlColors $0 606060 FFFFFF
!macroend

!macro PageFonts
  System::Call 'user32::GetWindow(p $Dialog, i 5) p.r0'
  ${DoWhile} $0 != 0
    ${If} $0 != $BrandDoo
    ${AndIf} $0 != $BrandTTY
      SendMessage $0 ${WM_SETFONT} $UIFont 1
    ${EndIf}
    System::Call 'user32::GetWindow(p r0, i 2) p.r0'
  ${Loop}
!macroend

; Prevent two setup writers; the handle is held until this process exits.
!macro SetupLock
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\DooSys.DooTTY.Setup.58D9427A") p.r1 ?e'
  Pop $0
  StrCpy $SetupMutex $1
  ${If} $0 == 183
    SetErrorLevel 12
    Quit
  ${EndIf}
  ${If} $SetupMutex == 0
    SetErrorLevel 12
    Quit
  ${EndIf}
!macroend

Function .onInit
  !insertmacro SetupLock
  SetShellVarContext current
  SetRegView 64
  StrCpy $LANGUAGE ${LANG_ENGLISH}
  System::Call 'kernel32::GetUserDefaultUILanguage() i.r0'
  IntOp $0 $0 & 0x3ff
  ${If} $0 == 12
    StrCpy $LANGUAGE ${LANG_FRENCH}
  ${EndIf}
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "$(Only64)"
    SetErrorLevel 1
    Quit
  ${EndIf}
  InitPluginsDir
  File /oname=$PLUGINSDIR\DooTTY-control.exe "${PAYLOAD}\DooTTY.exe"
  File /oname=$PLUGINSDIR\LICENSE.txt "${PAYLOAD}\LICENSE"
  File /oname=$PLUGINSDIR\default-fr.json "${PAYLOAD}\default-fr.json"
  File /oname=$PLUGINSDIR\default-en.json "${PAYLOAD}\default-en.json"
  ReadRegStr $ExistingDir HKCU "Software\DooSys\DooTTY" "InstallLocation"
  ReadRegStr $ExistingVersion HKCU "Software\DooSys\DooTTY" "Version"
  StrCpy $PortableMode 0
  StrCpy $PortableFolder "$EXEDIR\DooTTY"
  ${If} $ExistingDir != ""
    StrCpy $INSTDIR $ExistingDir
  ${EndIf}
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/PORTABLE=" $1
  ${IfNot} ${Errors}
    StrCpy $PortableMode 1
    StrCpy $INSTDIR $1
    StrCpy $PortableFolder $1
  ${EndIf}
FunctionEnd

Function ShowLicenses
  Pop $0
  ExecShell "open" "$PLUGINSDIR\LICENSE.txt"
FunctionEnd
Function BrowseFolder
  Pop $0
  nsDialogs::SelectFolderDialog "$(ChooseFolder)" "$PortableFolder"
  Pop $0
  ${If} $0 != error
    StrCpy $PortableFolder $0
    ${NSD_SetText} $FolderEdit $PortableFolder
  ${EndIf}
FunctionEnd
Function ModeChanged
  Pop $0
  ${NSD_GetState} $PortableRadio $PortableMode
  ${If} $PortableMode == ${BST_CHECKED}
    ShowWindow $FolderEdit ${SW_SHOW}
    ShowWindow $BrowseButton ${SW_SHOW}
    ShowWindow $ExistingLabel ${SW_HIDE}
  ${Else}
    ShowWindow $FolderEdit ${SW_HIDE}
    ShowWindow $BrowseButton ${SW_HIDE}
    ${If} $ExistingVersion != ""
      ShowWindow $ExistingLabel ${SW_SHOW}
    ${EndIf}
  ${EndIf}
FunctionEnd
Function RemoveExisting
  Pop $0
  IfFileExists "$ExistingDir\Uninstall.exe" 0 done
  System::Call 'kernel32::CloseHandle(p $SetupMutex)'
  ExecWait '"$ExistingDir\Uninstall.exe"' $0
  Quit
  done:
FunctionEnd
Function ModePage
  Call Layout
  nsDialogs::Create 1018
  Pop $Dialog
  !insertmacro Header
  ${NSD_CreateLink} 238u 4u 60u 12u "$(Licenses)"
  Pop $0
  SetCtlColors $0 007EA8 FFFFFF
  ${NSD_OnClick} $0 ShowLicenses
  ${NSD_CreateRadioButton} 10u 52u 280u 18u "$(Install)"
  Pop $InstallRadio
  SetCtlColors $InstallRadio 202020 FFFFFF
  ${NSD_Check} $InstallRadio
  ${NSD_OnClick} $InstallRadio ModeChanged
  ${NSD_CreateLabel} 24u 73u 266u 26u "$(InstallHint)"
  Pop $0
  SetCtlColors $0 606060 FFFFFF
  ${NSD_CreateRadioButton} 10u 103u 280u 18u "$(Portable)"
  Pop $PortableRadio
  SetCtlColors $PortableRadio 202020 FFFFFF
  ${NSD_OnClick} $PortableRadio ModeChanged
  ${NSD_CreateLabel} 24u 124u 266u 25u "$(PortableHint)"
  Pop $0
  SetCtlColors $0 606060 FFFFFF
  ${NSD_CreateDirRequest} 10u 153u 221u 16u "$PortableFolder"
  Pop $FolderEdit
  SetCtlColors $FolderEdit 202020 FFFFFF
  ${NSD_CreateBrowseButton} 237u 153u 53u 16u "$(Browse)"
  Pop $BrowseButton
  ${NSD_OnClick} $BrowseButton BrowseFolder
  ShowWindow $FolderEdit ${SW_HIDE}
  ShowWindow $BrowseButton ${SW_HIDE}
  ${NSD_CreateLabel} 10u 153u 280u 20u "$(Existing)"
  Pop $ExistingLabel
  SetCtlColors $ExistingLabel 007EA8 FFFFFF
  ${If} $ExistingVersion == ""
    ShowWindow $ExistingLabel ${SW_HIDE}
  ${Else}
    ${NSD_CreateLink} 173u 30u 125u 12u "$(Remove)"
    Pop $0
    SetCtlColors $0 606060 FFFFFF
    ${NSD_OnClick} $0 RemoveExisting
  ${EndIf}
  !insertmacro PageFonts
  nsDialogs::Show
FunctionEnd

Function CloseRunning
  IfFileExists "$INSTDIR\DooTTY.exe" 0 done
  ClearErrors
  ExecWait '"$PLUGINSDIR\DooTTY-control.exe" --installer-check "$INSTDIR\DooTTY.exe"' $0
  ${If} ${Errors}
    Goto failed
  ${EndIf}
  ${If} $0 == 0
    Goto done
  ${EndIf}
  IfSilent failed
  MessageBox MB_OKCANCEL|MB_ICONINFORMATION "$(CloseQuestion)" IDOK request
  Abort
  request:
  ClearErrors
  ExecWait '"$PLUGINSDIR\DooTTY-control.exe" --installer-close "$INSTDIR\DooTTY.exe"' $0
  ${If} ${Errors}
    Goto failed
  ${EndIf}
  ${If} $0 == 0
    Goto done
  ${EndIf}
  failed:
  IfSilent +2
  MessageBox MB_OK|MB_ICONEXCLAMATION "$(CloseFailed)"
  SetErrorLevel 10
  Abort
  done:
FunctionEnd

Function ModeLeave
  ${NSD_GetState} $PortableRadio $PortableMode
  ${If} $PortableMode == ${BST_CHECKED}
    ${NSD_GetText} $FolderEdit $PortableFolder
    StrCpy $INSTDIR $PortableFolder
  ${Else}
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\DooTTY"
    ${If} $ExistingDir != ""
      StrCpy $INSTDIR $ExistingDir
    ${EndIf}
  ${EndIf}
  Call ValidateTarget
FunctionEnd

Function ValidateTarget
  ; Validate before and after normalization; neither an empty path nor a drive root is a target.
  ${GetRoot} "$INSTDIR" $0
  ${If} $0 == ""
  ${OrIf} $INSTDIR == ""
    Goto invalid_target
  ${EndIf}
  ; NSIS GetFullPathName can clear its output when the folder does not yet exist.
  ; The Win32 API canonicalizes new paths without requiring them to exist.
  System::Call 'kernel32::GetFullPathNameW(w "$INSTDIR", i ${NSIS_MAX_STRLEN}, w .r0, p 0) i.r1'
  ${If} $1 == 0
  ${OrIf} $1 >= ${NSIS_MAX_STRLEN}
  ${OrIf} $0 == ""
    Goto invalid_target
  ${EndIf}
  StrCpy $INSTDIR $0
  ${GetRoot} "$INSTDIR" $0
  ${If} $0 == ""
  ${OrIf} $INSTDIR == $0
  ${OrIf} $INSTDIR == "$0\"
    Goto invalid_target
  ${EndIf}
  ${If} $PortableMode == ${BST_CHECKED}
    ${If} ${FileExists} "$INSTDIR\Uninstall.exe"
    ${OrIf} $INSTDIR == $ExistingDir
      Goto mixed_mode
    ${EndIf}
  ${Else}
    ${If} ${FileExists} "$INSTDIR\DooTTY.portable"
      Goto mixed_mode
    ${EndIf}
  ${EndIf}
  Goto target_ok
  invalid_target:
  IfSilent +2
  MessageBox MB_OK|MB_ICONEXCLAMATION "$(InvalidFolder)"
  SetErrorLevel 1
  Abort
  mixed_mode:
  IfSilent +2
  MessageBox MB_OK|MB_ICONEXCLAMATION "$(MixedMode)"
  SetErrorLevel 1
  Abort
  target_ok:
  IfFileExists "$INSTDIR\DooTTY.exe" 0 version_ok
  ${GetFileVersion} "$INSTDIR\DooTTY.exe" $0
  ${VersionCompare} "$0" "${VERSION}.0" $1
  ${If} $1 == 1
    IfSilent +2
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(Downgrade)"
    SetErrorLevel 1
    Abort
  ${EndIf}
  version_ok:
  Call CloseRunning
  ClearErrors
  ExecWait '"$PLUGINSDIR\DooTTY-control.exe" --check-webview' $0
  ${If} ${Errors}
    SetErrorLevel 20
    Abort
  ${EndIf}
  ${If} $0 != 0
    IfSilent no_webview
    MessageBox MB_YESNO|MB_ICONINFORMATION "$(WebView)" IDNO no_webview
    ExecShell "open" "https://developer.microsoft.com/microsoft-edge/webview2/"
    no_webview:
    SetErrorLevel 20
    Abort
  ${EndIf}
FunctionEnd

!include "${MANIFEST}"
Section "DooTTY"
  IfSilent 0 +2
  Call ValidateTarget
  SetShellVarContext current
  SetRegView 64
  ${If} $INSTDIR == ""
    SetErrorLevel 1
    Abort
  ${EndIf}
  ClearErrors
  CreateDirectory "$INSTDIR"
  ${If} ${Errors}
    IfSilent +2
    MessageBox MB_OK|MB_ICONSTOP "$(CopyFailed)"
    SetErrorLevel 1
    Abort
  ${EndIf}
  !insertmacro InstallPayload
  ${If} ${Errors}
    IfSilent +2
    MessageBox MB_OK|MB_ICONSTOP "$(CopyFailed)"
    SetErrorLevel 1
    Abort
  ${EndIf}
  ClearErrors
  IfFileExists "$INSTDIR\DooTTY.exe" 0 new_binary
  Delete "$INSTDIR\DooTTY.previous.exe"
  ClearErrors
  Rename "$INSTDIR\DooTTY.exe" "$INSTDIR\DooTTY.previous.exe"
  IfErrors commit_failed
  new_binary:
  Rename "$INSTDIR\DooTTY.next.exe" "$INSTDIR\DooTTY.exe"
  IfErrors restore_binary
  Delete "$INSTDIR\DooTTY.previous.exe"
  Goto binary_ready
  restore_binary:
  Rename "$INSTDIR\DooTTY.previous.exe" "$INSTDIR\DooTTY.exe"
  commit_failed:
  Delete "$INSTDIR\DooTTY.next.exe"
  IfSilent +2
  MessageBox MB_OK|MB_ICONSTOP "$(CopyFailed)"
  SetErrorLevel 1
  Abort
  binary_ready:
  ${If} $PortableMode == ${BST_CHECKED}
    FileOpen $0 "$INSTDIR\DooTTY.portable" w
    FileWrite $0 "1$\r$\n"
    FileClose $0
    CreateDirectory "$INSTDIR\data"
    StrCpy $1 "$INSTDIR\data\config.json"
  ${Else}
    WriteUninstaller "$INSTDIR\Uninstall.exe"
    WriteRegStr HKCU "Software\DooSys\DooTTY" "InstallLocation" "$INSTDIR"
    WriteRegStr HKCU "Software\DooSys\DooTTY" "Version" "${VERSION}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DooTTY" "DisplayName" "DooTTY"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DooTTY" "DisplayVersion" "${VERSION}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DooTTY" "Publisher" "DooSys"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DooTTY" "DisplayIcon" "$INSTDIR\DooTTY.exe"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DooTTY" "UninstallString" '"$INSTDIR\Uninstall.exe"'
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DooTTY" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DooTTY" "URLInfoAbout" "https://github.com/DooSys/DooTTY/"
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DooTTY" "NoModify" 1
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DooTTY" "NoRepair" 1
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DooTTY" "EstimatedSize" ${SIZE_KB}
    ExecWait '"$PLUGINSDIR\DooTTY-control.exe" --create-shortcut "$SMPROGRAMS\DooTTY.lnk" "$INSTDIR\DooTTY.exe"' $0
    ${If} $0 != 0
      SetErrors
    ${EndIf}
    CreateDirectory "$APPDATA\DooTTY"
    StrCpy $1 "$APPDATA\DooTTY\config.json"
  ${EndIf}
  ${IfNot} ${FileExists} "$1"
    ${If} $LANGUAGE == ${LANG_FRENCH}
      CopyFiles /SILENT "$PLUGINSDIR\default-fr.json" "$1"
    ${Else}
      CopyFiles /SILENT "$PLUGINSDIR\default-en.json" "$1"
    ${EndIf}
  ${EndIf}
  ${If} ${Errors}
    IfSilent +2
    MessageBox MB_OK|MB_ICONSTOP "$(CopyFailed)"
    SetErrorLevel 1
    Abort
  ${EndIf}
  !insertmacro RemoveLegacyNotices
SectionEnd

Function FinishPage
  Call Layout
  nsDialogs::Create 1018
  Pop $Dialog
  !insertmacro Header
  ${NSD_CreateLabel} 5u 53u 290u 20u "$(Ready)"
  Pop $0
  SetCtlColors $0 007EA8 FFFFFF
  ${NSD_CreateLabel} 5u 76u 290u 24u "$INSTDIR"
  Pop $0
  SetCtlColors $0 606060 FFFFFF
  ${NSD_CreateCheckbox} 5u 112u 290u 14u "$(Launch)"
  Pop $LaunchCheck
  SetCtlColors $LaunchCheck 202020 FFFFFF
  ${NSD_Check} $LaunchCheck
  ${If} $PortableMode != ${BST_CHECKED}
    ${NSD_CreateCheckbox} 5u 137u 290u 18u "$(Desktop)"
    Pop $DesktopCheck
    SetCtlColors $DesktopCheck 202020 FFFFFF
  ${EndIf}
  !insertmacro PageFonts
  nsDialogs::Show
FunctionEnd
Function FinishLeave
  ${If} $PortableMode != ${BST_CHECKED}
    ${NSD_GetState} $DesktopCheck $0
    ${If} $0 == ${BST_CHECKED}
      ClearErrors
      ExecWait '"$PLUGINSDIR\DooTTY-control.exe" --create-shortcut "$DESKTOP\DooTTY.lnk" "$INSTDIR\DooTTY.exe"' $0
      ${If} $0 == 0
      ${AndIfNot} ${Errors}
        WriteRegDWORD HKCU "Software\DooSys\DooTTY" "DesktopShortcut" 1
      ${Else}
        MessageBox MB_OK|MB_ICONEXCLAMATION "$(CopyFailed)"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  ${NSD_GetState} $LaunchCheck $0
  ${If} $0 == ${BST_CHECKED}
    ExecShell "open" "$INSTDIR\DooTTY.exe"
  ${EndIf}
FunctionEnd

Function un.onInit
  !insertmacro SetupLock
  SetShellVarContext current
  SetRegView 64
  ReadRegStr $INSTDIR HKCU "Software\DooSys\DooTTY" "InstallLocation"
  ${If} $INSTDIR == ""
    SetErrorLevel 1
    Quit
  ${EndIf}
  StrCpy $LANGUAGE ${LANG_ENGLISH}
  System::Call 'kernel32::GetUserDefaultUILanguage() i.r0'
  IntOp $0 $0 & 0x3ff
  ${If} $0 == 12
    StrCpy $LANGUAGE ${LANG_FRENCH}
  ${EndIf}
  InitPluginsDir
  File /oname=$PLUGINSDIR\DooTTY-control.exe "${PAYLOAD}\DooTTY.exe"
  StrCpy $DeletePrefs 0
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/PURGE" $1
  ${IfNot} ${Errors}
    StrCpy $DeletePrefs 1
  ${EndIf}
FunctionEnd
Function un.ConfirmPage
  nsDialogs::Create 1018
  Pop $Dialog
  !insertmacro Header
  ${NSD_CreateLabel} 5u 50u 290u 35u "$(RemoveHint)"
  Pop $0
  SetCtlColors $0 202020 FFFFFF
  ${NSD_CreateCheckbox} 5u 105u 290u 25u "$(RemovePrefs)"
  Pop $RemoveCheck
  SetCtlColors $RemoveCheck 202020 FFFFFF
  !insertmacro PageFonts
  nsDialogs::Show
FunctionEnd
Function un.ConfirmLeave
  ${NSD_GetState} $RemoveCheck $DeletePrefs
FunctionEnd
Section "Uninstall"
  ClearErrors
  ExecWait '"$PLUGINSDIR\DooTTY-control.exe" --installer-check "$INSTDIR\DooTTY.exe"' $0
  ${If} ${Errors}
    Goto un_close_failed
  ${EndIf}
  ${If} $0 != 0
    IfSilent un_close_failed
    ExecWait '"$PLUGINSDIR\DooTTY-control.exe" --installer-close "$INSTDIR\DooTTY.exe"' $0
    ${If} $0 != 0
      Goto un_close_failed
    ${EndIf}
  ${EndIf}
  Delete "$INSTDIR\DooTTY.exe"
  IfFileExists "$INSTDIR\DooTTY.exe" un_close_failed
  !insertmacro RemovePayload
  !insertmacro RemoveLegacyNotices
  Delete "$INSTDIR\DooTTY.next.exe"
  Delete "$INSTDIR\DooTTY.previous.exe"
  Delete "$SMPROGRAMS\DooTTY.lnk"
  ReadRegDWORD $0 HKCU "Software\DooSys\DooTTY" "DesktopShortcut"
  ${If} $0 == 1
    Delete "$DESKTOP\DooTTY.lnk"
  ${EndIf}
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DooTTY"
  DeleteRegKey HKCU "Software\DooSys\DooTTY"
  ${If} $DeletePrefs == ${BST_CHECKED}
    Delete "$APPDATA\DooTTY\config.json"
    Delete "$APPDATA\DooTTY\taskbar-hint-dismissed"
    RMDir "$APPDATA\DooTTY"
    RMDir /r "$LOCALAPPDATA\com.doosys.dootty"
  ${EndIf}
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Goto un_done
  un_close_failed:
  IfSilent +2
  MessageBox MB_OK|MB_ICONEXCLAMATION "$(CloseFailed)"
  SetErrorLevel 10
  Abort
  un_done:
SectionEnd
