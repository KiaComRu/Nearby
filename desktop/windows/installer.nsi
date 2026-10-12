Unicode true
!include "MUI2.nsh"
!include "WinVer.nsh"
!include "x64.nsh"
!ifndef PAYLOAD
  !error "PAYLOAD must point to the staged application directory"
!endif
!ifndef OUTPUT
  !error "OUTPUT must point to the setup executable"
!endif
Name "Nearby"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Nearby"
RequestExecutionLevel user
SetCompressor /SOLID zlib
VIProductVersion "0.2.0.0"
VIAddVersionKey "ProductName" "Nearby"
VIAddVersionKey "FileDescription" "Nearby — локальная передача файлов"
VIAddVersionKey "FileVersion" "0.2.0"
VIAddVersionKey "ProductVersion" "0.2.0"
VIAddVersionKey "LegalCopyright" ""
!define MUI_ICON "${PAYLOAD}\Nearby.ico"
!define MUI_UNICON "${PAYLOAD}\Nearby.ico"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\Nearby.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Запустить Nearby"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Russian"

Function .onInit
  SetShellVarContext current
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "Для Nearby требуется Windows 10 или Windows 11."
    Abort
  ${EndIf}
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "Эта сборка Nearby предназначена для 64-разрядной Windows (x64)."
    Abort
  ${EndIf}
  FindWindow $0 "" "Nearby"
  StrCmp $0 0 ready
  MessageBox MB_OK|MB_ICONINFORMATION "Закройте окно Nearby перед установкой обновления."
  Abort
  ready:
FunctionEnd

Section "Nearby"
  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD}\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Nearby"
  CreateShortcut "$SMPROGRAMS\Nearby\Nearby.lnk" "$INSTDIR\Nearby.exe"
  CreateShortcut "$DESKTOP\Nearby.lnk" "$INSTDIR\Nearby.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Nearby" "DisplayName" "Nearby"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Nearby" "DisplayVersion" "0.2.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Nearby" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Nearby" "DisplayIcon" "$INSTDIR\Nearby.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Nearby" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Nearby" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  FindWindow $0 "" "Nearby"
  StrCmp $0 0 closed
  MessageBox MB_OK|MB_ICONINFORMATION "Закройте окно Nearby перед удалением приложения."
  Abort
  closed:
  ; Fixed per-user install location only. User downloads and app data are outside it.
  StrCmp $INSTDIR "$LOCALAPPDATA\Programs\Nearby" safe
  MessageBox MB_OK|MB_ICONSTOP "Неожиданный путь установки. Автоматическое удаление отменено."
  Abort
  safe:
  Delete "$DESKTOP\Nearby.lnk"
  Delete "$SMPROGRAMS\Nearby\Nearby.lnk"
  RMDir "$SMPROGRAMS\Nearby"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Nearby"
  RMDir /r "$INSTDIR"
SectionEnd
