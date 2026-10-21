Unicode true
!include "MUI2.nsh"
!include "WinVer.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"
!ifndef VERSION
  !define VERSION "0.5.9"
!endif
Var UpdatePID
!ifndef PAYLOAD
  !error "PAYLOAD must point to the staged application directory"
!endif
!ifndef OUTPUT
  !error "OUTPUT must point to the setup executable"
!endif
!ifdef SERVER2016
Name "Nearby — Windows Server 2016"
!else
Name "Nearby"
!endif
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Nearby"
RequestExecutionLevel user
SetCompressor /SOLID zlib
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Nearby"
VIAddVersionKey "FileDescription" "Nearby — локальная передача файлов"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
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
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/UPDATEPID=" $UpdatePID
  IfErrors no_update_wait
  IntCmpU $UpdatePID 0 bad_update_pid bad_update_pid wait_update_pid
  bad_update_pid:
    Abort
  wait_update_pid:
    ; Wait for the requesting process; never terminate an active user instance.
    System::Call 'kernel32::OpenProcess(i 0x00100000, i 0, i $UpdatePID) p .r1'
    StrCmp $1 0 no_update_wait
    System::Call 'kernel32::WaitForSingleObject(p r1, i 30000) i .r2'
    System::Call 'kernel32::CloseHandle(p r1)'
    StrCmp $2 0 no_update_wait
    MessageBox MB_OK|MB_ICONSTOP "Nearby не успел закрыться. Повторите обновление после завершения передач."
    Abort
  no_update_wait:
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "Эта сборка Nearby предназначена для 64-разрядной Windows (x64)."
    Abort
  ${EndIf}
!ifdef SERVER2016
  ${IfNot} ${AtLeastWin2016}
  ${OrIfNot} ${AtLeastBuild} 14393
    MessageBox MB_OK|MB_ICONSTOP "Эта сборка требует Windows Server 2016 или новее (x64, с рабочим столом)."
    Abort
  ${EndIf}
  SetRegView 64
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "InstallationType"
  ${If} $0 == "Server Core"
    MessageBox MB_OK|MB_ICONSTOP "Оконной версии Nearby нужен Desktop Experience. Server Core этой сборкой не поддерживается."
    Abort
  ${EndIf}
  StrCpy $0 0
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" "Release"
  ${If} $0 < 394802
    MessageBox MB_OK|MB_ICONSTOP "Для Nearby нужен .NET Framework 4.6.2 или новее. Установите компонент Microsoft и повторите установку."
    Abort
  ${EndIf}
  SetRegView 32
!else
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "Для Nearby требуется Windows 10 или Windows 11."
    Abort
  ${EndIf}
!endif
!ifndef UPDATE_TEST
  FindWindow $0 "" "Nearby"
  StrCmp $0 0 ready
  MessageBox MB_OK|MB_ICONINFORMATION "Закройте окно Nearby перед установкой обновления."
  Abort
  ready:
!endif
FunctionEnd

Section "Nearby"
  SetOutPath "$INSTDIR"
  File /r /x "*Harness.exe" /x "*Harness.exe.config" "${PAYLOAD}\*"
!ifndef UPDATE_TEST
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Nearby"
  CreateShortcut "$SMPROGRAMS\Nearby\Nearby.lnk" "$INSTDIR\Nearby.exe"
  CreateShortcut "$DESKTOP\Nearby.lnk" "$INSTDIR\Nearby.exe"
  ; Explorer invokes the existing user instance through Nearby's private pipe.
  SetRegView 64
  WriteRegStr HKCU "Software\Classes\*\shell\Nearby.Send" "" "Отправить через Nearby"
  WriteRegStr HKCU "Software\Classes\*\shell\Nearby.Send" "Icon" '$\"$INSTDIR\Nearby.exe$\",0'
  WriteRegStr HKCU "Software\Classes\*\shell\Nearby.Send" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\*\shell\Nearby.Send\command" "" '$\"$INSTDIR\Nearby.exe$\" --send $\"%1$\"'
  SetRegView 32
  CreateShortcut "$SENDTO\Nearby.lnk" "$INSTDIR\Nearby.exe" "--send"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Nearby" "DisplayName" "Nearby"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Nearby" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Nearby" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Nearby" "DisplayIcon" "$INSTDIR\Nearby.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Nearby" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Nearby" "NoRepair" 1
!endif
SectionEnd

Function .onInstSuccess
  ${If} $UpdatePID != ""
    Exec '$\"$INSTDIR\Nearby.exe$\"'
  ${EndIf}
FunctionEnd

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
  Delete "$SENDTO\Nearby.lnk"
  SetRegView 64
  DeleteRegKey HKCU "Software\Classes\*\shell\Nearby.Send"
  SetRegView 32
  Delete "$SMPROGRAMS\Nearby\Nearby.lnk"
  RMDir "$SMPROGRAMS\Nearby"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Nearby"
  RMDir /r "$INSTDIR"
SectionEnd
