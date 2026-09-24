; MorseCode NSIS hooks.
;
; The app only ever talks to the LAN, but Windows Firewall blocks inbound
; connections by default, which makes discovery look broken on a fresh install.
; The installer runs perMachine (elevated), so the rules can be added here and
; removed again on uninstall. Nothing is opened to the public profile.

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Allowing MorseCode through Windows Firewall (private networks)..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="MorseCode"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="MorseCode" dir=in action=allow program="$INSTDIR\MorseCode.exe" enable=yes profile=private,domain description="MorseCode LAN file transfer (TCP 33456, UDP 33457)"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="MorseCode" dir=out action=allow program="$INSTDIR\MorseCode.exe" enable=yes profile=private,domain'
  Pop $0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="MorseCode"'
  Pop $0
!macroend
