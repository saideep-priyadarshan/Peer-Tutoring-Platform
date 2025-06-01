const request = require("supertest");
const { app } = require("../server");
const User = require("../models/User");
const mongoose = require("mongoose");

describe("Authentication Endpoints", () => {
  beforeAll(async () => {
    const testDbUri =
      process.env.MONGODB_TEST_URI ||
      "mongodb://localhost:27017/peer-tutoring-test";
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(testDbUri);
    }
  }, 30000);

  afterAll(async () => {
    await User.deleteMany({});
    await mongoose.connection.close();
  }, 30000);

  beforeEach(async () => {
    await User.deleteMany({});
  });

  describe("POST /api/auth/register", () => {
    it("should register a new user successfully", async () => {
      const userData = {
        firstName: "John",
        lastName: "Doe",
        email: "john.doe@example.com",
        password: "password123",
        role: "student",
      };

      const response = await request(app)
        .post("/api/auth/register")
        .send(userData)
        .expect(201);

      expect(response.body).toHaveProperty("token");
      expect(response.body.user).toMatchObject({
        firstName: "John",
        lastName: "Doe",
        email: "john.doe@example.com",
        role: "student",
      });
      expect(response.body.user).not.toHaveProperty("password");
    });

    it("should return error for invalid email", async () => {
      const userData = {
        firstName: "John",
        lastName: "Doe",
        email: "invalid-email",
        password: "password123",
        role: "student",
      };

      const response = await request(app)
        .post("/api/auth/register")
        .send(userData)
        .expect(400);

      expect(response.body).toHaveProperty("errors");
    });

    it("should return error for duplicate email", async () => {
      const userData = {
        firstName: "John",
        lastName: "Doe",
        email: "john.doe@example.com",
        password: "password123",
        role: "student",
      };

      await request(app).post("/api/auth/register").send(userData).expect(201);

      const response = await request(app)
        .post("/api/auth/register")
        .send(userData)
        .expect(400);

      expect(response.body.message).toContain("already exists");
    });
  });

  describe("POST /api/auth/login", () => {
    beforeEach(async () => {
      const user = new User({
        firstName: "John",
        lastName: "Doe",
        email: "john.doe@example.com",
        password: "password123",
        role: "student",
      });
      await user.save();
    });

    it("should login successfully with valid credentials", async () => {
      const loginData = {
        email: "john.doe@example.com",
        password: "password123",
      };

      const response = await request(app)
        .post("/api/auth/login")
        .send(loginData)
        .expect(200);

      expect(response.body).toHaveProperty("token");
      expect(response.body.user).toMatchObject({
        firstName: "John",
        lastName: "Doe",
        email: "john.doe@example.com",
        role: "student",
      });
    });

    it("should return error for invalid credentials", async () => {
      const loginData = {
        email: "john.doe@example.com",
        password: "wrongpassword",
      };

      const response = await request(app)
        .post("/api/auth/login")
        .send(loginData)
        .expect(400);

      expect(response.body.message).toContain("Invalid credentials");
    });

    it("should return error for non-existent user", async () => {
      const loginData = {
        email: "nonexistent@example.com",
        password: "password123",
      };

      const response = await request(app)
        .post("/api/auth/login")
        .send(loginData)
        .expect(400);

      expect(response.body.message).toContain("Invalid credentials");
    });
  });
});
