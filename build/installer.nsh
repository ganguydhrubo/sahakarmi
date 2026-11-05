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
