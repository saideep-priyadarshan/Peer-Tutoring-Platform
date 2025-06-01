const server = require("../server");
const request = require("supertest");
const { app } = require("../server");
const User = require("../models/User");
const Session = require("../models/Session");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

describe("Session Endpoints", () => {
  let studentToken, tutorToken, studentId, tutorId;

  beforeAll(async () => {
    await mongoose.connect(
      process.env.MONGODB_TEST_URI || "mongodb://localhost:27017/peer-tutoring"
    );
  });

  afterAll(async () => {
    await User.deleteMany({});
    await Session.deleteMany({});
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await Session.deleteMany({});

    const student = new User({
      firstName: "Student",
      lastName: "User",
      email: "student@example.com",
      password: "password123",
      role: "student",
    });
    await student.save();
    studentId = student._id;
    studentToken = jwt.sign({ id: studentId }, process.env.JWT_SECRET);

    const tutor = new User({
      firstName: "Tutor",
      lastName: "User",
      email: "tutor@example.com",
      password: "password123",
      role: "tutor",
    });
    await tutor.save();
    tutorId = tutor._id;
    tutorToken = jwt.sign({ id: tutorId }, process.env.JWT_SECRET);
  });

  describe("POST /api/sessions/book", () => {
    it("should book a session successfully", async () => {
      const startTime = new Date();
      startTime.setHours(startTime.getHours() + 24);
      const endTime = new Date(startTime);
      endTime.setHours(endTime.getHours() + 1);

      const sessionData = {
        tutor: tutorId,
        subject: "Mathematics",
        scheduledStart: startTime.toISOString(),
        scheduledEnd: endTime.toISOString(),
        type: "online",
        price: 50,
      };

      const response = await request(app)
        .post("/api/sessions/book")
        .set("Authorization", `Bearer ${studentToken}`)
        .send(sessionData);

      if (response.status !== 201) {
        console.log("Session booking failed:");
        console.log("Status:", response.status);
        console.log("Body:", response.body);
      }
    });

    it("should return error for past date", async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayEnd = new Date(yesterday);
      yesterdayEnd.setHours(yesterdayEnd.getHours() + 1);

      const sessionData = {
        tutor: tutorId,
        subject: "Mathematics",
        scheduledStart: yesterday.toISOString(),
        scheduledEnd: yesterdayEnd.toISOString(),
        type: "online",
      };

      const response = await request(app)
        .post("/api/sessions/book")
        .set("Authorization", `Bearer ${studentToken}`)
        .send(sessionData)
        .expect(400);

      expect(response.body.message).toContain("future" || "past" || "time");
    });
  });

  describe("GET /api/sessions/my-sessions", () => {
    beforeEach(async () => {
      const session1 = new Session({
        student: studentId,
        tutor: tutorId,
        subject: "Mathematics",
        scheduledStart: new Date(),
        scheduledEnd: new Date(),
        type: "online",
        status: "completed",
      });
      await session1.save();

      const session2 = new Session({
        student: studentId,
        tutor: tutorId,
        subject: "Physics",
        scheduledStart: new Date(),
        scheduledEnd: new Date(),
        type: "offline",
        status: "scheduled",
      });
      await session2.save();
    });

    it("should get user sessions successfully", async () => {
      const response = await request(app)
        .get("/api/sessions/my-sessions")
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(200);

      expect(response.body.sessions).toHaveLength(2);
      expect(response.body.pagination).toHaveProperty("total", 2);
    });

    it("should filter sessions by status", async () => {
      const response = await request(app)
        .get("/api/sessions/my-sessions?status=completed")
        .set("Authorization", `Bearer ${studentToken}`)
        .expect(200);

      expect(response.body.sessions).toHaveLength(1);
      expect(response.body.sessions[0].status).toBe("completed");
    });
  });
});

afterAll((done) => {
  if (server && server.listening) {
    server.close(done);
  } else {
    done();
  }
});
