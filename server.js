const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
const http = require("http");
const socketIo = require("socket.io");
const passport = require("passport");
require("dotenv").config();

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const matchingRoutes = require("./routes/matching");
const sessionRoutes = require("./routes/sessions");
const feedbackRoutes = require("./routes/feedback");
const communicationRoutes = require("./routes/communication");
const analyticsRoutes = require("./routes/analytics");

require("./config/passport");
const errorHandler = require("./middleware/errorHandler");
const { connectRedis } = require("./config/redis");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

app.use(helmet());
app.use(limiter);
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(passport.initialize());

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Peer Tutoring Platform API",
      version: "1.0.0",
      description: "A comprehensive API for peer tutoring platform",
    },
    servers: [
      {
        url: process.env.API_URL || "http://localhost:5000",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  },
  apis: ["./routes/*.js", "./models/*.js"],
};

const specs = swaggerJsdoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/matching", matchingRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/communication", communicationRoutes);
app.use("/api/analytics", analyticsRoutes);

require("./socket/socketHandler")(io);

app.use(errorHandler);

mongoose
  .connect(process.env.MONGODB_URI || "mongodb://localhost:27017/peer-tutoring")
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.log("MongoDB connection error:", err));

connectRedis();

const PORT = process.env.PORT || 5000;

const serverInstance =
  process.env.NODE_ENV !== "test"
    ? app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(
          `API Documentation available at http://localhost:${PORT}/api-docs`
        );
      })
    : null;

module.exports = { app, server: serverInstance, io };
