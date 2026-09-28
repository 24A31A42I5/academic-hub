## **Academic Hub - Complete Application Overview**

### **BASICS: What Is This App?**

**Academic Hub** is an **AI-powered academic integrity platform** designed for educational institutions. Its primary purpose is to:
- Detect handwriting fraud and verify student authenticity via biometric analysis
- Streamline assignment management across entire institutions  
- Provide role-based dashboards for **3 user types**: admin, faculty, and student

The app serves ~1000+ institutions, processes 50K+ assignments, and claims 99.9% fraud detection accuracy.

---

### **ARCHITECTURE OVERVIEW**

```
Frontend (React + TypeScript)
├── Vite (Build tool)
├── React Router (Navigation)
├── TanStack Query (Data fetching)
└── Shadcn UI + Tailwind (Design system)

Backend & Database
├── Supabase (Auth + Database)
├── PostgreSQL (Data storage)
├── Supabase Storage (File uploads)
└── Edge Functions (Deno-based backend logic)

External Services
├── Lovable AI Gateway (Handwriting analysis)
├── Resend (Email notifications)
└── Twilio (SMS notifications)
```

---

### **FUNDAMENTAL CONCEPTS**

#### **1. Authentication & Roles**
- Built on **Supabase Auth** (user management)
- Three app roles: `admin`, `faculty`, `student`
- Role-based access control via RLS (Row-Level Security) policies
- Session management with auto-refresh tokens
- Profiles stored in `profiles` table; role-specific details in `student_details` and `faculty_details`

#### **2. Three-Role Ecosystem**

| Role | Responsibilities | Key Routes |
|------|------------------|-----------|
| **Admin** | Create bulk users, manage system, oversee fraud detection, view all reports | `/admin/*` |
| **Faculty** | Create assignments, review submissions, grade work, assign to sections | `/faculty/*` |
| **Student** | Submit assignments, upload handwriting profile, view grades, check submission status | `/student/*` |

#### **3. Core Data Flow**
```
Student Registers
  ↓
Uploads Handwriting Sample (one-time, locked after submission)
  ↓
Faculty Creates Assignment for Student's Section
  ↓
Student Submits Assignment (one or more pages)
  ↓
AI Extracts Handwriting Features from Each Page
  ↓
AI Verifies Against Student's Enrolled Handwriting Profile
  ↓
Risk Scores: LOW (verified) | MEDIUM (manual review) | HIGH (reupload required)
  ↓
Faculty Reviews + Grades
  ↓
Student Notified (Email + SMS)
```

---

### **INTERMEDIATE CONCEPTS**

#### **1. Handwriting Verification Pipeline**

**Stage 1: Feature Extraction** (`extract-handwriting-features` edge function)
- Converts student's handwriting sample image to Base64
- Sends to **Lovable AI Gateway** (Google Gemini 2.5 Flash model)
- AI extracts 10+ biometric features:
  - **Slant**: left_lean, right_lean, upright
  - **Stroke Weight**: thin, medium, thick
  - **Letter Spacing**: tight, normal, wide
  - **Word Spacing**: tight, normal, wide
  - **Baseline**: straight, wavy, variable
  - **Height Ratio**: short, moderate, tall
  - **Writing Style**: cursive, print, mixed
  - **Connectivity**: connected, semi_connected, disconnected
  - **Line Stability**: straight, rising, descending, erratic
  - **Letter Formations** (a, e, g, r, t, s): shapes classified as rounded, angular, looped, open, closed, simple, mixed
- Features stored as JSON blob in `handwriting_feature_embedding` column

**Stage 2: Submission Verification** (`verify-handwriting` edge function)
- Extracts features from each page of submitted assignment
- Runs 3 parallel AI attempts for consensus (improves accuracy)
- Compares against enrolled handwriting profile using weighted scoring
- Takes into account **feature statistics** (population frequency + discriminative weight)
- Generates **AI Similarity Score** (0-100%) and **Risk Level**:
  - **75+% similarity**: LOW RISK (verified ✓)
  - **50-75%**: MEDIUM RISK (manual review ⚠️)
  - **<50%**: HIGH RISK (reupload required ✗)
- Stores verification metadata: `verified_at`, `ai_risk_level`, `ai_similarity_score`, `ai_confidence_score`

**Stage 3: Manual Review**
- Faculty can override AI decisions
- Admin views comprehensive fraud reports in Verification Reports page
- Flagged sections identified for deeper inspection

#### **2. Database Schema Highlights**

**Key Tables:**
- **`profiles`**: User account info (full_name, email, role)
- **`student_details`**: Roll number, year, branch, section, handwriting_url, handwriting_feature_embedding, handwriting_submitted_at
- **`faculty_details`**: Faculty ID
- **`assignments`**: Title, deadline, year, branch, section, faculty_profile_id
- **`submissions`**: submission files, student_profile_id, ai_risk_level, ai_similarity_score, verified_at, marks
- **`faculty_sections`**: Maps faculty to sections
- **`feature_statistics`**: Population frequencies and discriminative weights for each handwriting feature
- **`internal_secrets`**: Stores cron secret for deadline reminders

**Security Features:**
- RLS policies enforce data isolation (students see only their own data)
- Storage policies prevent students from accessing other students' files
- Privilege escalation prevented: direct role inserts blocked
- Service role (edge functions) bypass RLS for administrative operations

#### **3. Frontend State Management**
- **React Context** (`AuthContext`) manages user, session, and profile
- **TanStack Query** handles server state (assignments, submissions, student data)
- Query caching with 30-second freshness window, 5-minute retention
- Cache cleared on user logout/switch to prevent cross-user data leakage
- Protected routes check role before rendering

#### **4. Assignment Workflow**

**Faculty Creates Assignment:**
- Specifies year, branch, section (targets students in that cohort)
- Sets deadline
- Assignments auto-filtered to relevant sections

**Student Views Assignments:**
- Sees only assignments for their year/branch/section
- Can submit one or more PDF/image pages
- Files stored in `uploads/submissions/{user_id}/` bucket
- Can resubmit if flagged as HIGH RISK

**Faculty Grades:**
- Views all submissions for their assignments
- AI flags suspicious work automatically
- Can add feedback and marks
- Sends grade notifications via Resend (email) + Twilio (SMS)

---

### **ADVANCED CONCEPTS**

#### **1. AI Handwriting Verification Deep Dive**

**Similarity Scoring Algorithm:**
```
For each feature in submission:
  1. Lookup feature discriminative_weight from feature_statistics
  2. Compare against enrolled profile value
  3. If match: add weight to score
  4. If mismatch: subtract weighted penalty

Weighted Score = (matched_weights / total_possible_weights) × 100
```

**Consensus Mechanism (v7.0):**
- Runs 3 parallel AI extraction attempts per page (robust against API inconsistencies)
- Builds consensus profile using majority voting on each feature
- Averages confidence levels across attempts
- Critical features (slant, stroke_weight, letter_spacing) weighted higher

**Image Processing:**
- Supports HEIC (iPhone photos) via `heic2any` library
- Max 5MB per image
- Generates SHA-256 image hash to prevent duplicate enrollment
- Detects non-handwritten content (typed/printed)

#### **2. Notification System**

**Email Notifications** (via Resend):
- Assignment graded
- Submission flagged (with risk details, similarity score, concerns)
- Deadline reminders (24 hours before due)
- HTML templates with role-specific styling

**SMS Notifications** (via Twilio):
- Deadline reminders
- Grade notifications
- Phone numbers collected during student registration
- Country code handling (e.g., +91 for India)

**Deadline Reminder Cron Job:**
- Runs hourly via Supabase pg_cron
- Fetches assignments due in 24-25 hour window
- Identifies students who haven't submitted
- Batches SMS/email notifications
- Stored cron secret prevents unauthorized invocation

#### **3. Bulk Operations**

**Bulk Create Students** (`bulk-create-students` edge function):
- Admin uploads CSV with student data
- Batch creates up to 100 students per request
- Auto-generates secure passwords (or accepts provided ones)
- Creates profile + student_details + user_roles in transaction
- Returns success/failure report with error details
- Rate-limited to 100 per request

**Bulk Create Faculty** (`bulk-create-faculty` edge function):
- Similar pattern for faculty
- Requires faculty_id field
- Defaults to common password if not provided

#### **4. File Handling**

**Submission File Resolution** (`resolve-submission-files` edge function):
- Takes submission_id
- Generates signed URLs for submission files (valid 1 hour)
- Authorization: student (own files), faculty (assignment's submissions), admin (all)
- Handles both single file_url and multiple file_urls
- Prevents unauthorized access via policy-based URL signing

**Handwriting Sample Storage:**
- Stored in `handwriting-samples` bucket (separate from submissions)
- Locked after initial upload (admin can delete/reset)
- Signed URL generation for preview with 10-minute expiry
- File path indexed for efficient lookups

#### **5. Error Handling & Resilience**

**Session Management:**
- Custom `invokeEdgeFunction` wrapper handles token expiration
- Auto-refreshes session and retries once on 401
- Surfaces clear "session expired" error when refresh fails
- Prevents silent auth failures

**Query Resilience:**
- Single retry on transient failures
- No refetch on window focus (prevents surprise data updates)
- 30-second stale time prevents rapid repeated fetches
- Proper cache cleanup on role change

**Image Processing Robustness:**
- Consensus extraction (3 parallel attempts)
- Graceful degradation if AI confidence is low
- Image hash validation prevents re-enrollment of same image
- Non-handwritten detection prevents typed submissions

#### **6. Security Deep Dive**

**Authentication:**
- Supabase JWT tokens with auto-refresh
- Service role key used only by edge functions (never exposed to client)
- Public/anonymous key for client-side operations

**Authorization:**
- RLS policies enforce data isolation at database level
- Role-based checks in edge functions (don't trust client claims)
- Ownership verification (e.g., student can only grade own submissions)
- Admin-only operations protected by role checks

**Data Protection:**
- Storage policies prevent cross-student file access
- Signed URLs with time expiry for temporary access
- Image hash prevents duplicate handwriting enrollment
- Direct role inserts blocked (roles assigned by service role only)

**Principle of Least Privilege:**
- Students can only INSERT new submissions (not DELETE, not UPDATE others)
- Students can UPDATE only ungraded, unpaid submissions
- Faculty can view only their own assignments' submissions
- Admins get full access via service role

---

### **DEPLOYMENT & INFRASTRUCTURE**

**Hosting:**
- Frontend: Vite-built SPA, deployable on Vercel, Netlify, Lovable
- Backend: Supabase-hosted (PostgreSQL + Edge Functions on Deno)
- Storage: Supabase cloud storage buckets

**Environment Variables:**
- `VITE_SUPABASE_URL`: Supabase project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY`: Public key for client
- `SUPABASE_SERVICE_ROLE_KEY`: Secret key for edge functions
- `LOVABLE_API_KEY`: AI gateway credentials
- `RESEND_API_KEY`: Email service
- `TWILIO_*`: SMS service credentials

**Configuration:**
- Tailwind CSS for styling (theme colors for admin/faculty/student)
- ESLint for code quality
- TypeScript for type safety
- Vite dev server on port 8080

---

### **KEY PAGES & WORKFLOWS**

| Page | Role | Purpose |
|------|------|---------|
| Index | All | Landing page, product overview |
| Auth | All | Login/signup with role selection |
| Admin Dashboard | Admin | Stats: students, faculty, assignments, fraud alerts |
| Students Management | Admin | View all students, delete handwriting samples |
| Faculty Management | Admin | Manage faculty accounts |
| Handwriting Page | Admin | Review all student handwriting samples, delete if needed |
| Verification Reports | Admin | AI-flagged submissions with risk details |
| Faculty Dashboard | Faculty | Stats: assignments, pending reviews, flagged submissions |
| Faculty Assignments | Faculty | Create new assignments, view submissions |
| Faculty Submissions | Faculty | Review student submissions for their assignments |
| Faculty Reviews | Faculty | AI-flagged submissions needing review |
| Student Dashboard | Student | Stats: assignments completed, pending, overdue, handwriting status |
| Student Assignments | Student | View available assignments for the student's section |
| Submit Assignment | Student | Upload assignment pages for grading |
| Student Submissions | Student | View past submissions, status, feedback |
| Student Handwriting | Student | Upload one-time handwriting sample (critical step) |
| Student Grades | Student | View graded assignments with marks and feedback |

---

### **ADVANCED FEATURES & PATTERNS**

1. **Weighted Feature Comparison**: Discriminative weights in `feature_statistics` table allow AI to prioritize distinctive features for better fraud detection

2. **Consensus AI Extraction**: 3 parallel attempts to extract features from same image, then vote on final values—reduces API inconsistency

3. **Role-Gated Code Splitting**: Lazy loading of role-specific dashboards via React.lazy(), significantly improves landing page load time

4. **Signed URLs with Expiry**: Prevents permanent URLs from leaking; re-generation on demand ensures access control

5. **Transaction-Like Patterns**: Edge functions create user + profile + student_details in sequence; rollback not automatic but error handling designed to catch failures early

6. **Cron-Based Notifications**: Scheduled deadline reminders run hourly, query assignments in a time window, batch notifications for efficiency

---

This application represents a **modern SaaS platform** combining:
- **Frontend**: React ecosystem with component-driven UI
- **Backend**: Serverless edge functions + managed database
- **AI/ML**: Integration with third-party handwriting analysis API
- **Notifications**: Multi-channel (email + SMS)
- **Security**: Role-based access, RLS, signed URLs, JWT tokens
- **Scale**: Designed to handle thousands of institutions with millions of assignments