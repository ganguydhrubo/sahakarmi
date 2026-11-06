; Sahkarmi uninstall: the app files always go; the owner's data stays unless they say otherwise.
; An update also runs the old uninstaller (with isUpdated set), and must never touch data.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; The update download cache belongs to the app, not to the owner.
    RMDir /r "$LOCALAPPDATA\sahkarmi-updater"
    ; A silent uninstall (/S) keeps everything; only an owner at the screen can choose removal.
    IfSilent sahkarmi_keep_data
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
      "Also delete your Sahkarmi data?$\r$\n$\r$\nThis removes your coworkers' chats, settings, browser sign-ins and downloaded AI tools from this PC. Your files in the Sahkarmi folder in your user folder are kept.$\r$\n$\r$\nChoose No to keep everything for a later reinstall." \
      /SD IDNO IDNO sahkarmi_keep_data
    RMDir /r "$APPDATA\Sahkarmi"
    sahkarmi_keep_data:
  ${endIf}
!macroend

; An update first runs the old version's uninstaller, which stops when one of its files is
; still in use (antivirus checking it, an indexer). electron-builder then shows "Failed to
; uninstall old application files" with no silent default, so even a silent update (/S, as
; Sahkarmi runs it) waited on that box forever where nobody could see it; at the next start
; the app found the installer still running, waited for it, and opened the old version again.
; Same check, but the box only appears when someone runs the installer by hand: a silent
; update ends with code 2 at once, and Sahkarmi's update helper retries it.
!macro sahkarmiUnInstallCheck
  ${If} ${Errors}
    DetailPrint `Uninstall was not successful. Not able to launch uninstaller!`
  ${ElseIf} $R0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0" /SD IDOK
    DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro customUnInstallCheck
  !insertmacro sahkarmiUnInstallCheck
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro sahkarmiUnInstallCheck
!macroend
