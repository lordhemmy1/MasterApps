━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 STOCKDITY IMS — ANDROID APK BUILD GUIDE (Capacitor)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PREREQUISITES (do once)
─────────────────────
1. Install Node.js v18+      → https://nodejs.org
2. Install Android Studio    → https://developer.android.com/studio
   - In Android Studio: SDK Manager → install Android SDK 34
   - Install "Android SDK Build-Tools 34"
   - Set ANDROID_HOME environment variable:
       Windows: C:\Users\<you>\AppData\Local\Android\Sdk
       Mac/Linux: ~/Library/Android/sdk  OR  ~/Android/Sdk
3. Install Java JDK 17+      → https://adoptium.net

STEP 1 — Initialise npm (if no package.json yet)
──────────────────────────────────────────────────
  npm init -y

STEP 2 — Install Capacitor
──────────────────────────
  npm install @capacitor/core @capacitor/cli @capacitor/android
  npm install @capacitor/splash-screen           (optional)

STEP 3 — Place capacitor.config.json
──────────────────────────────────────
  (Already provided above — place at repo root)

STEP 4 — Add the Android platform
──────────────────────────────────
  npx cap add android
  (Creates an "android/" folder at repo root)

STEP 5 — Copy web files into the Android project
──────────────────────────────────────────────────
  npx cap sync android
  (Run this every time you update the web app)

STEP 6 — Open in Android Studio
────────────────────────────────
  npx cap open android
  (Android Studio opens the android/ project)

STEP 7 — Build the APK in Android Studio
─────────────────────────────────────────
  A. Wait for Gradle sync to complete (bottom bar)
  B. Menu: Build → Build Bundle(s) / APK(s) → Build APK(s)
  C. Click "locate" in the notification to find your APK:
       android/app/build/outputs/apk/debug/app-debug.apk

STEP 8 — Install on Android device
────────────────────────────────────
  Option A: USB
    adb install android/app/build/outputs/apk/debug/app-debug.apk

  Option B: Direct
    Copy app-debug.apk to the phone → open file manager → install
    (Enable "Install from unknown sources" in phone settings first)

  Option C: Google Play (production)
    Build → Generate Signed Bundle / APK → follow Play Console guide

STEP 9 — Subsequent updates (web app changed)
──────────────────────────────────────────────
  npx cap sync android      ← copies updated web files
  npx cap open android      ← rebuild in Android Studio

NOTES ON DATA PERSISTENCE
──────────────────────────
- IndexedDB works natively in Capacitor's WebView
- Data is stored in the app's private Android storage
- Survives app restarts, updates, and device reboots
- Cleared only if the user uninstalls or clears app data

APK SIZE
─────────────
  debug APK:   ~8–15 MB   (includes Chromium WebView — Android's built-in)
  This is MUCH smaller than Electron (.exe) because Capacitor uses
  the device's existing System WebView instead of bundling Chromium.
