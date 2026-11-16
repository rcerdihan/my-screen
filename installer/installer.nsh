; electron-builder NSIS eklentisi: kurulumda sürücü/güvenlik duvarı betiğini yönetici olarak çalıştırır.

; NSIS 32-bit çalışır; "powershell.exe" 32-bit PowerShell'i açar ve SetupAPI aygıt oluşturmayı
; ERROR_IN_WOW64 (0xE0000235) ile reddeder. Sysnative üzerinden 64-bit PowerShell kullanılır.
!macro findPowerShell
  StrCpy $R9 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  IfFileExists $R9 +2 0
    StrCpy $R9 "powershell.exe"
!macroend

!macro customInstall
  !insertmacro findPowerShell
  DetailPrint "Sanal ekran sürücüsü kuruluyor, C:\VirtualDisplayDriver hazırlanıyor, güvenlik duvarına yerel ağ izni ekleniyor..."
  nsExec::ExecToLog '"$R9" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\setup\setup-driver.ps1" -Action install -ResDir "$INSTDIR\resources" -AppExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  Pop $0
  DetailPrint "Kurulum yardımcısı bitti (kod $0). Ayrıntı: %ProgramData%\MyScreen\setup.log"
!macroend

!macro customUnInstall
  ; Güncelleme sırasında eski sürüm kaldırılırken sürücüye dokunma.
  ${ifNot} ${isUpdated}
    !insertmacro findPowerShell
    nsExec::ExecToLog '"$R9" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\setup\setup-driver.ps1" -Action uninstall -ResDir "$INSTDIR\resources"'
    Pop $0
  ${endIf}
!macroend
