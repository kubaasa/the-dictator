; Our include loads before electron-builder's MUI2, so we need these explicitly.
; All have include guards so re-inclusion later is harmless.
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"

!ifndef BUILD_UNINSTALLER
Var DesktopShortcutCheckbox
Var StartMenuShortcutCheckbox
Var AutoStartCheckbox
Var CreateDesktopShortcut
Var CreateStartMenuShortcut
Var CreateAutoStart
!endif

; force per-user install, skip multi-user selection page
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customHeader
  !define MUI_WELCOMEPAGE_TITLE "Welcome to The Dictator Setup"
  !define MUI_WELCOMEPAGE_TEXT "The Dictator turns your voice into text instantly:$\r$\n$\r$\n  \
    $\u2022 Global hotkey $\u2014 record from any app$\r$\n  \
    $\u2022 Local & cloud transcription (Whisper)$\r$\n  \
    $\u2022 AI-powered post-processing$\r$\n  \
    $\u2022 Auto-paste into focused window$\r$\n$\r$\n\
    Click Next to continue."
!macroend

!macro customPageAfterChangeDir
  Page custom OptionsPageCreate OptionsPageLeave
!macroend

; Functions only needed for installer, not uninstaller
!ifndef BUILD_UNINSTALLER
Function OptionsPageCreate
  ; Set header text via dialog controls (1037=title, 1038=subtitle)
  GetDlgItem $0 $HWNDPARENT 1037
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Installation Options"
  GetDlgItem $0 $HWNDPARENT 1038
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Choose additional options for The Dictator."

  nsDialogs::Create 1018
  Pop $0

  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateCheckbox} 0 10u 100% 12u "Create desktop shortcut"
  Pop $DesktopShortcutCheckbox
  ${NSD_SetState} $DesktopShortcutCheckbox ${BST_CHECKED}

  ${NSD_CreateCheckbox} 0 30u 100% 12u "Add to Start Menu"
  Pop $StartMenuShortcutCheckbox
  ${NSD_SetState} $StartMenuShortcutCheckbox ${BST_CHECKED}

  ${NSD_CreateCheckbox} 0 50u 100% 12u "Start The Dictator with Windows"
  Pop $AutoStartCheckbox
  ${NSD_SetState} $AutoStartCheckbox ${BST_CHECKED}

  nsDialogs::Show
FunctionEnd

Function OptionsPageLeave
  ${NSD_GetState} $DesktopShortcutCheckbox $CreateDesktopShortcut
  ${NSD_GetState} $StartMenuShortcutCheckbox $CreateStartMenuShortcut
  ${NSD_GetState} $AutoStartCheckbox $CreateAutoStart
FunctionEnd
!endif

!macro customInstall
  ; Create install marker so the app knows this is the first launch after installation.
  ; The main process reads and deletes this file on startup to show the window.
  CreateDirectory "$APPDATA\The Dictator"
  FileOpen $0 "$APPDATA\The Dictator\.install-marker" w
  FileWrite $0 "1"
  FileClose $0

  ; Silent install (electron-updater auto-update) bypasses OptionsPageLeave,
  ; leaving checkbox state at 0 — without this, every auto-update would silently
  ; strip the user's shortcuts and autostart entry.
  ${If} ${Silent}
    StrCpy $CreateDesktopShortcut ${BST_CHECKED}
    StrCpy $CreateStartMenuShortcut ${BST_CHECKED}
    StrCpy $CreateAutoStart ${BST_CHECKED}
  ${EndIf}

  ${If} $CreateDesktopShortcut == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  ${EndIf}

  ; Flat layout — directly in Programs, not nested under a folder
  ${If} $CreateStartMenuShortcut == ${BST_CHECKED}
    CreateShortCut "$SMPROGRAMS\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  ${EndIf}

  ${If} $CreateAutoStart == ${BST_CHECKED}
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" \
      "The Dictator" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --autostart'
  ${EndIf}
!macroend

!macro customUnInstall
  Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"

  ; Flat layout — current scheme
  Delete "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"

  ; Clean up legacy nested folder layout left by older installers
  ; (electron-builder's default createStartMenuShortcut put the .lnk inside a subfolder)
  Delete "$SMPROGRAMS\${SHORTCUT_NAME}\${SHORTCUT_NAME}.lnk"
  RMDir "$SMPROGRAMS\${SHORTCUT_NAME}"

  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "The Dictator"
!macroend
