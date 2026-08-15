// ==========================================
// 1. FIREBASE CONFIGURATION
// (Paste your config from Firebase Console here)
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyAGsRMula6B7FKjZeZZyGjrXFDqCcSLwgk",
  authDomain: "attendants-mtu.firebaseapp.com",
  projectId: "attendants-mtu",
  storageBucket: "attendants-mtu.firebasestorage.app",
  messagingSenderId: "160991404161",
  appId: "1:160991404161:web:b34e90e242a81dee822d80",
  measurementId: "G-16EF63PSBC",
};

// ==========================================
// n8n WEBHOOK - ATTENDANCE CODE NOTIFICATION
// ==========================================
const N8N_WEBHOOK_URL =
  "https://bikram-kh.app.n8n.cloud/webhook/generated-code";

async function sendGeneratedCodeToN8n({ code, subject, duration }) {
  const payload = {
    code: code,
    subject: subject,
    duration: duration,
  };

  try {
    const response = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      mode: "cors",
    });

    if (!response.ok) {
      throw new Error(`n8n webhook returned HTTP ${response.status}`);
    }

    console.log("✅ Attendance code sent to n8n:", payload);
    return true;
  } catch (error) {
    // Attendance is already saved in Firestore, so do not block the teacher.
    console.error("❌ Failed to send attendance code to n8n:", error);
    return false;
  }
}

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const provider = new firebase.auth.GoogleAuthProvider();

// UI Elements
const uiContainer = document.getElementById("main-app-container");
const loadingScreen = document.getElementById("loading-screen");

// ==========================================
// DEVELOPER ACCESS CONTROL
// ==========================================
const DEVELOPER_EMAIL = "bikramkhundrakpam14@gmail.com"; // Change this to your email

function isDeveloper(userEmail) {
  return userEmail === DEVELOPER_EMAIL;
}

// ==========================================
// 2. CORE LOGIN & ROUTING (The Traffic Controller)
// ==========================================
function startLoginFlow() {
  // Android APK: use native Google Sign-In through the Android bridge.
  if (
    window.AndroidMTU &&
    typeof window.AndroidMTU.startGoogleSignIn === "function"
  ) {
    window.AndroidMTU.startGoogleSignIn();
    return;
  }

  // Normal web/GitHub Pages login.
  const signInBtn = document.querySelector(
    'button[onclick="startLoginFlow()"]',
  );
  if (signInBtn) signInBtn.disabled = true;

  auth
    .signInWithPopup(provider)
    .then(() => {
      if (signInBtn) signInBtn.disabled = false;
    })
    .catch((error) => {
      if (signInBtn) signInBtn.disabled = false;
      console.error("Sign-in error:", error);

      if (
        error &&
        (error.code === "auth/popup-blocked" ||
          error.code === "auth/cancelled-popup-request" ||
          error.code === "auth/popup-closed-by-user")
      ) {
        auth.signInWithRedirect(provider);
        return;
      }

      alert("Login failed: " + error.message);
    });
}

// Android supplies a Google ID token here. Firebase Web Auth then creates
// the same Firebase session used by the existing Firestore code.
window.nativeGoogleLogin = async function (idToken) {
  try {
    if (!idToken) {
      throw new Error("Android did not return a Google ID token.");
    }

    const credential = firebase.auth.GoogleAuthProvider.credential(idToken);
    await auth.signInWithCredential(credential);
    console.log("Native Android Google Sign-In connected to Firebase.");
  } catch (error) {
    console.error("Native Google Sign-In failed:", error);
    alert("Google login failed: " + (error.message || error));
  }
};

function startSignOut() {
  auth.signOut();
}

auth.onAuthStateChanged((user) => {
  loadingScreen.classList.add("hidden");

  if (!user) {
    renderLoginScreen();
    return;
  }

  // Security Check: Must be MTU domain (testing with @gmail.com)
  if (!user.email.endsWith("@gmail.com")) {
    alert("Unauthorized. Please use @gmail.com for testing.");
    startSignOut();
    return;
  }

  // Check if user is developer
  if (isDeveloper(user.email)) {
    renderDeveloperPanel(user);
    return;
  }

  // Check Database by UID first
  db.collection("Users")
    .doc(user.uid)
    .get()
    .then((doc) => {
      if (doc.exists) {
        const userData = doc.data();
        if (userData.role === "teacher") {
          renderTeacherDashboard(userData);
        } else {
          renderStudentDashboard(userData);
        }
      } else {
        // If no UID record, check by email (in case developer created a teacher record)
        db.collection("Users")
          .where("email", "==", user.email)
          .get()
          .then((snapshot) => {
            if (!snapshot.empty) {
              const existingUser = snapshot.docs[0].data();
              if (existingUser.role === "teacher") {
                // Found existing teacher record, update UID and render
                const docId = snapshot.docs[0].id;
                db.collection("Users")
                  .doc(docId)
                  .update({ uid: user.uid })
                  .then(() => {
                    renderTeacherDashboard(existingUser);
                  });
              } else {
                renderStudentDashboard(existingUser);
              }
            } else {
              // Brand new user
              renderStudentOnboarding(user);
            }
          })
          .catch((error) => {
            console.error("Email lookup error:", error);
            renderStudentOnboarding(user);
          });
      }
    })
    .catch((error) => {
      alert("Database connection error. Check your Firestore rules.");
      console.error(error);
      startSignOut();
    });
});

// ==========================================
// GLOBAL TIMER VARIABLE
// ==========================================
let attendanceTimerInterval = null;
let timerEndTime = null;
let timerSubject = null; // Track which subject's session we're timing

// ==========================================
// LOCATION VERIFICATION (Campus-Only Attendance)
// ==========================================
const CAMPUS_LOCATION = {
  name: "Manipur Technical University - Classroom",
  latitude: 24.817,
  longitude: 93.9476,
  radiusMeters: 100, // Students must be within 100 meters of classroom
};

function calculateDistance(lat1, lon1, lat2, lon2) {
  // Haversine formula to calculate distance in meters
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getStudentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject("Geolocation not supported on this browser.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        reject(
          "Location access denied. Enable location permissions to mark attendance.",
        );
      },
    );
  });
}

function isStudentAtCampus(studentLocation) {
  const distance = calculateDistance(
    studentLocation.latitude,
    studentLocation.longitude,
    CAMPUS_LOCATION.latitude,
    CAMPUS_LOCATION.longitude,
  );
  return {
    isAtCampus: distance <= CAMPUS_LOCATION.radiusMeters,
    distance: distance,
    radiusMeters: CAMPUS_LOCATION.radiusMeters,
  };
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function startAttendanceTimer(durationMinutes, subject) {
  // Clear any existing timer
  if (attendanceTimerInterval) clearInterval(attendanceTimerInterval);

  timerSubject = subject; // Store subject for auto-close
  timerEndTime = Date.now() + durationMinutes * 60 * 1000;

  attendanceTimerInterval = setInterval(() => {
    const now = Date.now();
    const timeLeft = timerEndTime - now;

    if (timeLeft <= 0) {
      clearInterval(attendanceTimerInterval);
      attendanceTimerInterval = null;
      document.getElementById("timer-display").innerText = "00:00";

      // Auto-close attendance using correct subject-specific doc ID
      const todayStr = new Date().toISOString().split("T")[0];
      const sessionDocId = `${todayStr}_${timerSubject}`;

      db.collection("ActiveSessions")
        .doc(sessionDocId)
        .update({ isActive: false })
        .then(() =>
          console.log("✅ Attendance auto-closed by timer for " + timerSubject),
        )
        .catch((err) => console.error("❌ Auto-close failed:", err));
    } else {
      const totalSeconds = Math.floor(timeLeft / 1000);
      document.getElementById("timer-display").innerText =
        formatTime(totalSeconds);

      // Change color when less than 1 minute
      const timerDisplay = document.getElementById("timer-display");
      if (totalSeconds < 60) {
        timerDisplay.style.color = "#ff5722";
      }
    }
  }, 1000);
}

// ==========================================
// 3. RENDER FUNCTIONS
// ==========================================

function renderLoginScreen() {
  uiContainer.innerHTML = `
        <div class="card login-card">
            <h1>MTU Attendance Portal</h1>
            <p>Please sign in using your university email address to continue.</p>
            <button onclick="startLoginFlow()" class="btn-primary">Sign in with Google</button>
        </div>
    `;
}

// Student First-Time Setup
function renderStudentOnboarding(firebaseUser) {
  uiContainer.innerHTML = `
        <div class="card login-card">
            <h1>Complete Your Profile</h1>
            <p>Welcome! We need your details to link your attendance.</p>
            <form id="onboarding-form">
                <input type="text" id="reg-no" placeholder="Registration Number (e.g., MTU123)" required>
                <select id="department" required>
                    <option value="" disabled selected>Select your Department</option>
                    <option value="Computer Science">Computer Science</option>
                    <option value="Electronics">Electronics</option>
                    <option value="Civil Engineering">Civil Engineering</option>
                </select>
                <p style="color: #666; font-size: 0.9rem; margin: 1rem 0 0 0;">You are registering as a <strong>Student</strong></p>
                <button type="submit" id="save-btn" class="btn-primary">Save Profile</button>
            </form>
        </div>
    `;

  document
    .getElementById("onboarding-form")
    .addEventListener("submit", function (e) {
      e.preventDefault();

      const saveBtn = document.getElementById("save-btn");
      saveBtn.innerText = "Saving...";
      saveBtn.disabled = true;

      const regNo = document
        .getElementById("reg-no")
        .value.trim()
        .toUpperCase();
      const dept = document.getElementById("department").value;

      const profileData = {
        email: firebaseUser.email,
        name: firebaseUser.displayName,
        role: "student",
        department: dept,
        regNumber: regNo,
      };

      // Save using secure UID
      db.collection("Users")
        .doc(firebaseUser.uid)
        .set(profileData)
        .then(() => {
          window.location.reload(); // Refresh to trigger dashboard load
        })
        .catch((error) => {
          console.error("Save failed:", error);
          alert("Error saving profile: " + error.message);
          saveBtn.innerText = "Save Profile";
          saveBtn.disabled = false;
        });
    });
}

// Developer Admin Panel
function renderDeveloperPanel(developerUser) {
  uiContainer.innerHTML = `
        <header>
            <span>Developer Panel | ${developerUser.email}</span>
            <button onclick="startSignOut()" class="btn-secondary btn-sm">Log Out</button>
        </header>

        <div class="card">
            <h2>Add New Teacher</h2>
            <p>Create a new teacher account in the system.</p>
            <form id="add-teacher-form">
                <input type="text" id="teacher-name" placeholder="Teacher Full Name" required>
                <input type="email" id="teacher-email" placeholder="Teacher Email (e.g., name@gmail.com)" required>
                <input type="text" id="teacher-subject" placeholder="Subject/Class Name (e.g., Data Structures)" required>
                <select id="teacher-department" required>
                    <option value="" disabled selected>Department</option>
                    <option value="Computer Science">Computer Science</option>
                    <option value="Electronics">Electronics</option>
                    <option value="Civil Engineering">Civil Engineering</option>
                </select>
                <button type="submit" id="add-teacher-btn" class="btn-primary">Add Teacher</button>
            </form>
            <div id="teacher-status-message" class="hidden alert" style="margin-top: 1rem;"></div>
        </div>

        <div class="card">
            <h2>Manage Teachers</h2>
            <table>
                <thead><tr><th>Name</th><th>Email</th><th>Subject</th><th>Department</th><th>Action</th></tr></thead>
                <tbody id="teachers-tbody"></tbody>
            </table>
        </div>
    `;

  // Load all teachers
  function loadTeachers() {
    db.collection("Users")
      .where("role", "==", "teacher")
      .onSnapshot((snapshot) => {
        const tbody = document.getElementById("teachers-tbody");
        tbody.innerHTML = "";

        if (snapshot.empty) {
          tbody.innerHTML =
            '<tr><td colspan="5" style="text-align:center; color:#999;">No teachers yet</td></tr>';
          return;
        }

        snapshot.forEach((doc) => {
          const teacher = doc.data();
          tbody.innerHTML += `
                    <tr>
                        <td>${teacher.name}</td>
                        <td>${teacher.email}</td>
                        <td>${teacher.subject}</td>
                        <td>${teacher.department}</td>
                        <td><button onclick="deleteTeacher('${doc.id}')" class="btn-danger btn-sm">Delete</button></td>
                    </tr>
                `;
        });
      });
  }

  loadTeachers();

  // Add teacher form handler
  document
    .getElementById("add-teacher-form")
    .addEventListener("submit", function (e) {
      e.preventDefault();

      const addBtn = document.getElementById("add-teacher-btn");
      const statusMsg = document.getElementById("teacher-status-message");

      const teacherName = document.getElementById("teacher-name").value.trim();
      const teacherEmail = document
        .getElementById("teacher-email")
        .value.trim()
        .toLowerCase();
      const teacherSubject = document
        .getElementById("teacher-subject")
        .value.trim();
      const teacherDept = document.getElementById("teacher-department").value;

      if (!teacherEmail.endsWith("@gmail.com")) {
        statusMsg.innerText = "❌ Email must end with @gmail.com for testing";
        statusMsg.className = "alert alert-danger";
        statusMsg.classList.remove("hidden");
        return;
      }

      addBtn.innerText = "Adding...";
      addBtn.disabled = true;

      // First, check if teacher email already exists
      db.collection("Users")
        .where("email", "==", teacherEmail)
        .get()
        .then((snapshot) => {
          if (!snapshot.empty) {
            statusMsg.innerText = "❌ This email already exists in the system";
            statusMsg.className = "alert alert-danger";
            statusMsg.classList.remove("hidden");
            addBtn.innerText = "Add Teacher";
            addBtn.disabled = false;
            return;
          }

          // Create a temporary user account via Firebase Auth
          // For now, we'll just create the teacher record in Firestore
          // Note: In production, you should use Firebase Admin SDK on backend

          // Generate a temporary UID (in production, use proper backend)
          const tempUID = "teacher_" + Date.now();

          const teacherData = {
            email: teacherEmail,
            name: teacherName,
            role: "teacher",
            subject: teacherSubject,
            department: teacherDept,
            createdBy: developerUser.email,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          };

          db.collection("Users")
            .doc(tempUID)
            .set(teacherData)
            .then(() => {
              statusMsg.innerText =
                "✅ Teacher added successfully! They can now sign in with their Google account.";
              statusMsg.className = "alert alert-success";
              statusMsg.classList.remove("hidden");

              // Reset form
              document.getElementById("add-teacher-form").reset();
              addBtn.innerText = "Add Teacher";
              addBtn.disabled = false;
            })
            .catch((error) => {
              statusMsg.innerText = "❌ Error adding teacher: " + error.message;
              statusMsg.className = "alert alert-danger";
              statusMsg.classList.remove("hidden");
              addBtn.innerText = "Add Teacher";
              addBtn.disabled = false;
            });
        })
        .catch((error) => {
          statusMsg.innerText = "❌ Error checking email: " + error.message;
          statusMsg.className = "alert alert-danger";
          statusMsg.classList.remove("hidden");
          addBtn.innerText = "Add Teacher";
          addBtn.disabled = false;
        });
    });
}

// Delete teacher function
function deleteTeacher(teacherId) {
  if (confirm("Are you sure you want to delete this teacher?")) {
    db.collection("Users")
      .doc(teacherId)
      .delete()
      .then(() => {
        alert("Teacher deleted successfully");
      })
      .catch((error) => {
        alert("Error deleting teacher: " + error.message);
      });
  }
}

// Teacher Admin Panel
function renderTeacherDashboard(teacherData) {
  uiContainer.innerHTML = `
        <header>
            <span>Welcome, ${teacherData.name} (${teacherData.subject}) | Admin</span>
            <button onclick="startSignOut()" class="btn-secondary btn-sm">Log Out</button>
        </header>

        <div class="grid-2">
            <div class="card">
                <h2>Generate Today's Code</h2>
                <p style="color: #666; font-weight: 600;">Subject: ${teacherData.subject}</p>
                <div class="active-code-display hidden" id="code-display-box">
                    <p style="margin-bottom: 0;">Students enter this code:</p>
                    <span id="display-active-code">XXXXX</span>
                    <div style="margin-top: 1.5rem; padding: 1rem; background: #fff3cd; border-radius: 8px; text-align: center;">
                        <p style="margin: 0 0 0.5rem 0; font-size: 0.875rem; color: #666;">Auto-close in:</p>
                        <span id="timer-display" style="font-size: 2.5rem; font-weight: bold; color: #d32f2f; font-family: monospace;">00:00</span>
                    </div>
                    <button id="close-attendance" class="btn-danger btn-sm">Close Attendance Now</button>
                </div>
                <div id="duration-setup">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">Duration (minutes):</label>
                    <input type="number" id="duration-input" min="1" max="120" value="5" style="margin-bottom: 0.5rem;">
                    <button id="generate-code" class="btn-primary">Generate Code</button>
                </div>
            </div>
            
            <div class="card">
                <h2>Data Management</h2>
                <p>Download today's attendance to Excel (CSV format).</p>
                <button id="export-csv" class="btn-primary">Export CSV</button>
            </div>
        </div>

        <div class="card">
            <h2>Live Roster (<span id="roster-count">0</span> Present)</h2>
            <table>
                <thead><tr><th>Name</th><th>Reg. Number</th><th>Department</th><th>Time</th></tr></thead>
                <tbody id="roster-tbody"></tbody>
            </table>
        </div>
    `;

  const todayStr = new Date().toISOString().split("T")[0];
  const sessionDocId = `${todayStr}_${teacherData.subject}`;

  // Live Code Listener
  db.collection("ActiveSessions")
    .doc(sessionDocId)
    .onSnapshot((doc) => {
      const generateBtn = document.getElementById("generate-code");
      const codeDisplay = document.getElementById("code-display-box");
      const durationSetup = document.getElementById("duration-setup");

      if (doc.exists && doc.data().isActive) {
        generateBtn.classList.add("hidden");
        durationSetup.classList.add("hidden");
        codeDisplay.classList.remove("hidden");
        document.getElementById("display-active-code").innerText =
          doc.data().code;

        // Restart timer if duration exists and timer not already running
        const duration = doc.data().durationMinutes || 5;
        if (!attendanceTimerInterval || timerSubject !== teacherData.subject) {
          startAttendanceTimer(duration, teacherData.subject); // Pass subject here
        }
      } else {
        generateBtn.classList.remove("hidden");
        durationSetup.classList.remove("hidden");
        codeDisplay.classList.add("hidden");

        // Clear timer
        if (attendanceTimerInterval) {
          clearInterval(attendanceTimerInterval);
          attendanceTimerInterval = null;
        }
      }
    });

  // Live Roster Listener - Filter by Subject
  db.collection("AttendanceRecords")
    .where("date", "==", todayStr)
    .where("subject", "==", teacherData.subject)
    .orderBy("timestamp", "asc")
    .onSnapshot(
      (snapshot) => {
        document.getElementById("roster-count").innerText = snapshot.size;
        const tbody = document.getElementById("roster-tbody");
        tbody.innerHTML = "";

        snapshot.forEach((doc) => {
          const row = doc.data();
          const time = row.timestamp
            ? row.timestamp.toDate().toLocaleTimeString()
            : "Just now";
          tbody.innerHTML += `<tr><td>${row.studentName}</td><td>${row.studentRegNumber}</td><td>${row.studentDept}</td><td>${time}</td></tr>`;
        });
      },
      (error) => {
        console.error("❌ Live Roster Error:", error.code, error.message);
        document.getElementById("roster-count").innerText = "Error";
        const tbody = document.getElementById("roster-tbody");
        tbody.innerHTML = `<tr><td colspan="4" style="color:red;">Error loading roster. Check browser console.</td></tr>`;

        if (error.code === "failed-precondition") {
          alert(
            "⚠️ Firestore Index Missing:\n\nYou need to create a composite index:\n1. Go to Firebase Console\n2. Firestore → Indexes\n3. Create index for 'date' + 'subject' + 'timestamp' on AttendanceRecords\n\nThe link will appear in your browser console.",
          );
        }
      },
    );

  // Button Actions
  document.getElementById("generate-code").addEventListener("click", () => {
    const durationMinutes =
      parseInt(document.getElementById("duration-input").value) || 5;
    const newCode = Math.random().toString(36).substring(2, 7).toUpperCase();

    db.collection("ActiveSessions")
      .doc(sessionDocId)
      .set({
        code: newCode,
        date: todayStr,
        subject: teacherData.subject,
        isActive: true,
        durationMinutes: durationMinutes,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      })
      .then(async () => {
        // Start the local attendance timer.
        startAttendanceTimer(durationMinutes, teacherData.subject);

        // Send the newly generated code to n8n → Telegram.
        await sendGeneratedCodeToN8n({
          code: newCode,
          subject: teacherData.subject,
          duration: durationMinutes,
        });
      })
      .catch((error) => {
        console.error("❌ Failed to generate attendance session:", error);
        alert("Could not generate attendance code: " + error.message);
      });
  });

  document.getElementById("close-attendance").addEventListener("click", () => {
    if (attendanceTimerInterval) {
      clearInterval(attendanceTimerInterval);
      attendanceTimerInterval = null;
    }
    db.collection("ActiveSessions")
      .doc(sessionDocId)
      .update({ isActive: false });
  });

  document
    .getElementById("export-csv")
    .addEventListener("click", () =>
      exportTodayToCSV(todayStr, teacherData.subject),
    );
}

// Student Dashboard
function renderStudentDashboard(studentData) {
  uiContainer.innerHTML = `
        <header>
            <span>${studentData.name} | ${studentData.regNumber}</span>
            <button onclick="startSignOut()" class="btn-secondary btn-sm">Log Out</button>
        </header>

        <div class="card login-card">
            <h1>Mark Attendance</h1>
            <p>Select your subject and enter the 5-character code.</p>
            
            <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; text-align: left;">Select Subject/Class:</label>
            <select id="subject-select" required style="margin-bottom: 1rem;">
                <option value="" disabled selected>Loading available subjects...</option>
            </select>
            
            <input type="text" id="entry-code" maxlength="5" placeholder="Enter Code" style="text-transform:uppercase; text-align:center; font-size:1.5rem; letter-spacing: 5px;">
            <button id="submit-code" class="btn-primary">Submit Code</button>
            <div id="status-message" class="hidden alert"></div>
        </div>
    `;

  const todayStr = new Date().toISOString().split("T")[0];
  const subjectSelect = document.getElementById("subject-select");

  // Load available subjects with active attendance
  db.collection("ActiveSessions")
    .where("date", "==", todayStr)
    .where("isActive", "==", true)
    .onSnapshot((snapshot) => {
      subjectSelect.innerHTML =
        '<option value="" disabled selected>Select a subject...</option>';

      if (snapshot.empty) {
        subjectSelect.innerHTML +=
          '<option value="" disabled>No active classes right now</option>';
        return;
      }

      snapshot.forEach((doc) => {
        const data = doc.data();
        const option = document.createElement("option");
        option.value = data.subject;
        option.textContent = data.subject;
        subjectSelect.appendChild(option);
      });
    });

  document.getElementById("submit-code").addEventListener("click", () => {
    const selectedSubject = document.getElementById("subject-select").value;
    const codeInput = document
      .getElementById("entry-code")
      .value.trim()
      .toUpperCase();
    const status = document.getElementById("status-message");
    const submitBtn = document.getElementById("submit-code");

    if (!selectedSubject) {
      status.innerText = "Please select a subject.";
      status.className = "alert alert-danger";
      status.classList.remove("hidden");
      return;
    }

    if (codeInput.length !== 5) {
      status.innerText = "Code must be exactly 5 characters.";
      status.className = "alert alert-danger";
      status.classList.remove("hidden");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerText = "Checking Location...";

    // Verify student is at campus location
    getStudentLocation()
      .then((studentLocation) => {
        const locationCheck = isStudentAtCampus(studentLocation);

        if (!locationCheck.isAtCampus) {
          status.innerText = `❌ Location Error: You are ${Math.round(locationCheck.distance)}m away from campus. You must be within ${locationCheck.radiusMeters}m to mark attendance.`;
          status.className = "alert alert-danger";
          status.classList.remove("hidden");
          submitBtn.disabled = false;
          submitBtn.innerText = "Submit Code";
          return;
        }

        // Location verified, proceed with attendance submission
        submitBtn.innerText = "Verifying Code...";
        const todayStr = new Date().toISOString().split("T")[0];
        const sessionDocId = `${todayStr}_${selectedSubject}`;

        db.collection("ActiveSessions")
          .doc(sessionDocId)
          .get()
          .then((doc) => {
            if (
              doc.exists &&
              doc.data().isActive &&
              doc.data().code === codeInput
            ) {
              // Code is correct, log attendance
              db.collection("AttendanceRecords")
                .add({
                  studentUID: auth.currentUser.uid,
                  studentEmail: studentData.email,
                  studentName: studentData.name,
                  studentRegNumber: studentData.regNumber,
                  studentDept: studentData.department,
                  subject: selectedSubject,
                  date: todayStr,
                  latitude: studentLocation.latitude,
                  longitude: studentLocation.longitude,
                  timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                })
                .then(() => {
                  status.innerText =
                    "✅ Attendance marked successfully for " +
                    selectedSubject +
                    "!";
                  status.className = "alert alert-success";
                  status.classList.remove("hidden");
                  document.getElementById("entry-code").classList.add("hidden");
                  submitBtn.classList.add("hidden");
                  document
                    .getElementById("subject-select")
                    .classList.add("hidden");
                });
            } else {
              status.innerText = "Invalid or expired code for this subject.";
              status.className = "alert alert-danger";
              status.classList.remove("hidden");
              submitBtn.disabled = false;
              submitBtn.innerText = "Submit Code";
            }
          })
          .catch((err) => {
            console.error(err);
            status.innerText = "Error connecting to server.";
            status.className = "alert alert-danger";
            status.classList.remove("hidden");
            submitBtn.disabled = false;
            submitBtn.innerText = "Submit Code";
          });
      })
      .catch((error) => {
        status.innerText = error;
        status.className = "alert alert-danger";
        status.classList.remove("hidden");
        submitBtn.disabled = false;
        submitBtn.innerText = "Submit Code";
      });
  });
}

// ==========================================
// 4. CSV EXPORT LOGIC
// ==========================================
function exportTodayToCSV(todayStr, subject) {
  let query = db.collection("AttendanceRecords").where("date", "==", todayStr);

  // If subject is provided, filter by subject
  if (subject) {
    query = query.where("subject", "==", subject);
  }

  query
    .orderBy("timestamp", "asc")
    .get()
    .then((snapshot) => {
      if (snapshot.empty) {
        alert(
          "No attendance records found for today" +
            (subject ? " for " + subject : "") +
            ".",
        );
        return;
      }

      let csv = "data:text/csv;charset=utf-8,";
      csv +=
        "Date,Subject,Time,Registration Number,Student Name,Department,Email\n";

      snapshot.forEach((doc) => {
        const row = doc.data();
        const time = row.timestamp
          ? row.timestamp.toDate().toLocaleTimeString()
          : "";
        const subj = row.subject || "N/A";
        csv += `${row.date},${subj},${time},${row.studentRegNumber},${row.studentName},${row.studentDept},${row.studentEmail}\n`;
      });

      const encodedUri = encodeURI(csv);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      const filename = subject
        ? `MTU_Attendance_${todayStr}_${subject}.csv`
        : `MTU_Attendance_${todayStr}.csv`;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
}
