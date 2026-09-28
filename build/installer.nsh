; Extra uninstall steps for the Windows installer (electron-builder NSIS).
; "Start with Windows" writes a Run entry named after the app ID (see APP_ID in
; src/main/main.ts); remove it so nothing is left pointing at a deleted program.
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "io.github.fahmid-juboraj.kittynextdoor"
!macroend
