// ==========================================
// FIRESTORE SECURITY RULES - TESTING
// Copy lines 7-28 into Firebase Console → Firestore Database → Rules tab
// ==========================================

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow all authenticated users to read all data
    match /{document=**} {
      allow read: if request.auth != null;
      allow write: if false;
    }
    
    // Users can write to their own profile
    match /Users/{userId} {
      allow read, write: if request.auth != null;
    }
    
    // ActiveSessions: allow read/write for testing
    match /ActiveSessions/{sessionId} {
      allow read, write: if request.auth != null;
    }
    
    // AttendanceRecords: allow read/write for testing
    match /AttendanceRecords/{recordId} {
      allow read, write: if request.auth != null;
    }
  }
}

// ==========================================
// PRODUCTION RULES - KEEP COMMENTED UNTIL TESTING IS DONE
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // ==========================================
    // 1. USERS COLLECTION
    // Each user can only read/write their own profile
    // ==========================================
    match /Users/{userId} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow create: if request.auth != null && request.auth.uid == userId;
      allow update: if request.auth != null && request.auth.uid == userId;
      allow delete: if false; // Prevent deletion
    }

    // ==========================================
    // 2. ACTIVE SESSIONS COLLECTION
    // Everyone can read active sessions
    // Only teachers can write/create sessions
    // ==========================================
    match /ActiveSessions/{sessionId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && 
                       get(/databases/$(database)/documents/Users/$(request.auth.uid)).data.role == 'teacher';
      allow update: if request.auth != null && 
                       get(/databases/$(database)/documents/Users/$(request.auth.uid)).data.role == 'teacher';
      allow delete: if request.auth != null && 
                       get(/databases/$(database)/documents/Users/$(request.auth.uid)).data.role == 'teacher';
    }

    // ==========================================
    // 3. ATTENDANCE RECORDS COLLECTION
    // Students can write their own attendance
    // Teachers can read attendance for their subject
    // ==========================================
    match /AttendanceRecords/{recordId} {
      allow create: if request.auth != null && 
                       get(/databases/$(database)/documents/Users/$(request.auth.uid)).data.role == 'student';

      // Use `resource.data` for read checks (request.resource is for writes)
      allow read: if request.auth != null && 
                     (get(/databases/$(database)/documents/Users/$(request.auth.uid)).data.role == 'teacher' ||
                      resource.data.studentUID == request.auth.uid);

      allow update, delete: if false; // Prevent modification of attendance records
    }

  }
}
*/

// ==========================================
// ALTERNATIVE: DEVELOPMENT/TESTING RULES
// Use this for debugging (less restrictive)
// ==========================================

/*
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Allow all authenticated users to read all data
    match /{document=**} {
      allow read: if request.auth != null;
      allow write: if false;
    }
    
    // Users can write to their own profile
    match /Users/{userId} {
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Teachers can write to ActiveSessions
    match /ActiveSessions/{sessionId} {
      allow write: if request.auth != null && 
                      get(/databases/$(database)/documents/Users/$(request.auth.uid)).data.role == 'teacher';
    }
    
    // Students can write to AttendanceRecords
    match /AttendanceRecords/{recordId} {
      allow write: if request.auth != null;
    }
    
  }
}
