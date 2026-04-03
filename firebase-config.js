// ── FIREBASE CONFIG ──
// 1. Go to https://console.firebase.google.com
// 2. Create a project (e.g. "studio-serena")
// 3. Click the </> Web icon to register a web app
// 4. Copy the firebaseConfig values below from your project settings
// 5. In Firebase console: enable Authentication → Email/Password
// 6. In Firebase console: enable Firestore Database (start in production mode)
// 7. In Firebase console: enable Storage (start in production mode)
// 8. Set Storage & Firestore rules (see comments below)

const firebaseConfig = {
  apiKey:            "AIzaSyBchFBZFnMJS_ocOwe7mcgG3Tf_IDEROR8",
  authDomain:        "studio-serena.firebaseapp.com",
  projectId:         "studio-serena",
  storageBucket:     "studio-serena.firebasestorage.app",
  messagingSenderId: "1035955504745",
  appId:             "1:1035955504745:web:e84349593abfa5c91204f8"
};

// ── FIRESTORE RULES (paste in Firebase Console → Firestore → Rules) ──
/*
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /gallery/{category}/media/{doc} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
*/

// ── STORAGE RULES (paste in Firebase Console → Storage → Rules) ──
/*
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /gallery/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
*/

export { firebaseConfig };
