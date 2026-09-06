#!/usr/bin/env bash
# Lanceur du build EAS preview (APK) — exécuté détaché via PowerShell Start-Process.
set -e
export PATH="/c/Users/leo/AppData/Roaming/npm:/c/nvm4w/nodejs:$PATH"
cd /f/projet_ia/voizy/mobile || exit 1
exec eas build -p android --profile preview > /f/projet_ia/voizy/eas-build.log 2>&1