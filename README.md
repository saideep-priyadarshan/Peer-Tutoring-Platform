# Peer Tutoring Platform - Backend

A comprehensive backend system for a peer tutoring platform built with Node.js, Express.js, and MongoDB.

## Features

### 🔐 Authentication & Security

- JWT-based authentication with refresh tokens
- Multi-factor authentication (MFA) support
- OAuth integration (Google)
- Secure password hashing with bcrypt
- Rate limiting and security headers

### 👥 User Management

- Detailed user profiles with verification system
- Role-based access (Student, Tutor, Both)
- Profile picture uploads with Cloudinary
- Availability scheduling
- Skills and subject expertise tracking

### 🎯 Advanced Matching Algorithm

- ML-inspired tutor-student matching
- Location-based matching with geospatial queries
- Subject expertise and rating-based scoring
- User preference and history analysis
- Personalized recommendations

### 📅 Comprehensive Scheduling

- Flexible session booking and management
- Real-time availability checking
- Recurring session support
- Calendar integration ready
- Automated reminders via email/SMS

### 💬 Real-time Communication

- Socket.IO powered messaging
- File sharing with cloud storage
- Read receipts and typing indicators
- Video call integration ready
- Session-based chat rooms

### ⭐ Feedback & Rating System

- Multi-dimensional rating system
- Public and private feedback options
- Feedback aggregation and analytics
- Report system for inappropriate content
- Rating trend analysis

### 📊 Analytics & Progress Tracking

- Learning progress visualization
- Tutor performance metrics
- Engagement scoring
- Platform-wide statistics
- Custom recommendation engine

### 🔄 Additional Features

- Email notifications with custom templates
- SMS integration with Twilio
- File upload handling with Cloudinary
- Comprehensive error handling
- API documentation with Swagger
- Redis caching support
- Automated testing with Jest

## Quick Start

### Prerequisites

- Node.js (v14 or higher)
- MongoDB
- Redis (for caching)

### Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd peer-tutoring-platform
```

2. Install dependencies:

```bash
npm install
```

3. Create environment file:

```bash
new-item .env
```

4. Configure your environment variables in `.env`

5. Start the development server:

```bash
npm run dev
```

The server will start on `http://localhost:5000`

## API Documentation

Once the server is running, visit `http://localhost:5000/api-docs` for comprehensive API documentation.

## Project Structure

```
├── config/
│   ├── passport.js
│   └── redis.js            # Redis connection configuration
├── middleware/
│   ├── auth.js             # JWT authentication middleware
│   └── errorHandler.js     # Global error handling
├── models/
│   ├── User.js             # User data model
│   ├── Session.js          # Tutoring session model
│   ├── Feedback.js         # Feedback and rating model
│   └── Message.js          # Chat message model
├── routes/
│   ├── auth.js             # Authentication endpoints
│   ├── users.js            # User management endpoints
│   ├── matching.js         # Tutor matching algorithms
│   ├── sessions.js         # Session management
│   ├── communication.js    # Messaging and file sharing
│   ├── feedback.js         # Rating and feedback system
│   └── analytics.js        # Analytics and reporting
├── socket/
│   └── socketHandler.js    # Real-time communication logic
├── tests/
│   ├── auth.test.js        # Authentication tests
│   └── sessions.test.js    # Session management tests
├── utils/
│   ├── email.js            # Email utility functions
│   └── sms.js              # SMS utility functions
├── .env                    # Environment variables
├── server.js               # Main application entry point
└── README.md
```

## Environment Variables

Key environment variables you need to configure:

```bash
# Database
MONGODB_URI=mongodb://localhost:27017/peer-tutoring
REDIS_URL=redis://localhost:6379

# Security
JWT_SECRET=your-secret-key

# Email Service
SMTP_HOST=smtp.gmail.com
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# File Upload
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret

TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token

GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

## API Endpoints

### Authentication

- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/setup-mfa` - Setup multi-factor authentication
- `GET /api/auth/google` - Google OAuth login

### User Management

- `GET /api/users/profile` - Get current user profile
- `PUT /api/users/profile` - Update user profile
- `POST /api/users/upload-avatar` - Upload profile picture
- `GET /api/users/search` - Search users

### Matching & Discovery

- `POST /api/matching/find-tutors` - Find matching tutors
- `GET /api/matching/recommendations` - Get personalized recommendations

### Session Management

- `POST /api/sessions/book` - Book a tutoring session
- `GET /api/sessions/my-sessions` - Get user's sessions
- `PUT /api/sessions/:id/reschedule` - Reschedule a session
- `PUT /api/sessions/:id/cancel` - Cancel a session

### Communication

- `GET /api/communication/conversations` - Get conversations
- `GET /api/communication/messages/:sessionId` - Get session messages
- `POST /api/communication/send-message` - Send a message
- `POST /api/communication/upload-file` - Share files

### Feedback & Ratings

- `POST /api/feedback/submit` - Submit session feedback
- `GET /api/feedback/user/:userId` - Get user feedback
- `GET /api/feedback/my-feedback` - Get own feedback

### Analytics

- `GET /api/analytics/progress` - Learning progress data
- `GET /api/analytics/performance` - Tutor performance metrics
- `GET /api/analytics/engagement` - User engagement analytics

## Testing

Run the test suite:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```
