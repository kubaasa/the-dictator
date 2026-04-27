; ============================================================================
; The Dictator — Custom NSIS Installer Script
; ============================================================================
; Hooks into electron-builder's assisted installer to customize:
;   - Welcome page text
;   - "Installation Options" page (desktop shortcut + auto-start checkboxes)
;   - Shortcut/registry creation based on user choices
;   - Cleanup on uninstall
; ============================================================================

; Our include loads before electron-builder's MUI2, so we need these explicitly.
; All have include guards so re-inclusion later is harmless.
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"

; --- Variables for the custom options page (installer only) ---
!ifndef BUILD_UNINSTALLER
Var DesktopShortcutCheckbox
Var StartMenuShortcutCheckbox
Var AutoStartCheckbox
Var CreateDesktopShortcut
Var CreateStartMenuShortcut
Var CreateAutoStart
!endif

; ============================================================================
; customInstallMode — force per-user install, skip multi-user selection page
; ============================================================================
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; ============================================================================
; customHeader — runs before MUI page definitions
; ============================================================================
!macro customHeader
  ; Custom Welcome page text
  !define MUI_WELCOMEPAGE_TITLE "Welcome to The Dictator Setup"
  !define MUI_WELCOMEPAGE_TEXT "The Dictator turns your voice into text instantly:$\r$\n$\r$\n  \
    $\u2022 Global hotkey $\u2014 record from any app$\r$\n  \
    $\u2022 Local & cloud transcription (Whisper)$\r$\n  \
    $\u2022 AI-powered post-processing$\r$\n  \
    $\u2022 Auto-paste into focused window$\r$\n$\r$\n\
    Click Next to continue."
!macroend

; ============================================================================
; customPageAfterChangeDir — "Installation Options" page (after directory)
; ============================================================================
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

; ============================================================================
; customInstall — runs after files are installed
; ============================================================================
!macro customInstall
  ; Create install marker so the app knows this is the first launch after installation.
  ; The main process reads and deletes this file on startup to show the window.
  CreateDirectory "$APPDATA\The Dictator"
  FileOpen $0 "$APPDATA\The Dictator\.install-marker" w
  FileWrite $0 "1"
  FileClose $0

  ; Desktop shortcut (only if user checked the box)
  ${If} $CreateDesktopShortcut == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  ${EndIf}

  ; Start Menu shortcut (flat, directly in Programs — only if user checked the box)
  ${If} $CreateStartMenuShortcut == ${BST_CHECKED}
    CreateShortCut "$SMPROGRAMS\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  ${EndIf}

  ; Auto-start registry entry (only if user checked the box)
  ${If} $CreateAutoStart == ${BST_CHECKED}
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" \
      "The Dictator" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --autostart'
  ${EndIf}
!macroend

; ============================================================================
; customUnInstall — cleanup on uninstall
; ============================================================================
!macro customUnInstall
  ; Remove desktop shortcut
  Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"

  ; Remove Start Menu shortcut (flat layout, current scheme)
  Delete "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"

  ; Clean up legacy nested folder layout left by older installers
  ; (electron-builder's default createStartMenuShortcut put the .lnk inside a subfolder)
  Delete "$SMPROGRAMS\${SHORTCUT_NAME}\${SHORTCUT_NAME}.lnk"
  RMDir "$SMPROGRAMS\${SHORTCUT_NAME}"

  ; Remove auto-start registry entry
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "The Dictator"
!macroend
