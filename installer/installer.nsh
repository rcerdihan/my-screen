; electron-builder NSIS eklentisi: kurulumda sürücü/güvenlik duvarı betiğini yönetici olarak çalıştırır.

!macro customInstall
  DetailPrint "Sanal ekran sürücüsü kuruluyor, C:\VirtualDisplayDriver hazırlanıyor, güvenlik duvarına yerel ağ izni ekleniyor..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\setup\setup-driver.ps1" -Action install -ResDir "$INSTDIR\resources" -AppExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  Pop $0
  DetailPrint "Kurulum yardımcısı bitti (kod $0). Ayrıntı: %ProgramData%\MyScreen\setup.log"
!macroend

!macro customUnInstall
  ; Güncelleme sırasında eski sürüm kaldırılırken sürücüye dokunma.
  ${ifNot} ${isUpdated}
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\setup\setup-driver.ps1" -Action uninstall -ResDir "$INSTDIR\resources"'
    Pop $0
  ${endIf}
!macroend
