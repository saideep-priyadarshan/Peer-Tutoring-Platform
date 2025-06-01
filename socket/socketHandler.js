const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Session = require("../models/Session");
const Message = require("../models/Message");

module.exports = (io) => {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;

      if (!token) {
        return next(new Error("Authentication error"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select("-password");

      if (!user) {
        return next(new Error("User not found"));
      }

      socket.userId = user._id.toString();
      socket.user = user;
      next();
    } catch (error) {
      next(new Error("Authentication error"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`User ${socket.user.firstName} connected: ${socket.id}`);

    socket.join(`user-${socket.userId}`);

    updateUserOnlineStatus(socket.userId, true);

    socket.on("join-session", async (sessionId) => {
      try {
        const session = await Session.findById(sessionId);

        if (!session) {
          socket.emit("error", { message: "Session not found" });
          return;
        }

        if (
          session.student.toString() !== socket.userId &&
          session.tutor.toString() !== socket.userId
        ) {
          socket.emit("error", { message: "Access denied" });
          return;
        }

        socket.join(`session-${sessionId}`);

        const otherUserId =
          session.student.toString() === socket.userId
            ? session.tutor.toString()
            : session.student.toString();

        socket.to(`user-${otherUserId}`).emit("user-joined-session", {
          sessionId,
          user: {
            id: socket.userId,
            firstName: socket.user.firstName,
            lastName: socket.user.lastName,
          },
        });

        socket.emit("joined-session", { sessionId });
      } catch (error) {
        socket.emit("error", { message: "Error joining session" });
      }
    });

    socket.on("leave-session", (sessionId) => {
      socket.leave(`session-${sessionId}`);

      socket.to(`session-${sessionId}`).emit("user-left-session", {
        sessionId,
        user: {
          id: socket.userId,
          firstName: socket.user.firstName,
          lastName: socket.user.lastName,
        },
      });
    });

    socket.on("typing-start", ({ sessionId }) => {
      socket.to(`session-${sessionId}`).emit("user-typing", {
        userId: socket.userId,
        userName: socket.user.firstName,
      });
    });

    socket.on("typing-stop", ({ sessionId }) => {
      socket.to(`session-${sessionId}`).emit("user-stopped-typing", {
        userId: socket.userId,
      });
    });

    socket.on("call-user", ({ sessionId, signal }) => {
      socket.to(`session-${sessionId}`).emit("incoming-call", {
        signal,
        from: {
          id: socket.userId,
          firstName: socket.user.firstName,
          lastName: socket.user.lastName,
          profilePicture: socket.user.profilePicture,
        },
      });
    });

    socket.on("accept-call", ({ sessionId, signal }) => {
      socket.to(`session-${sessionId}`).emit("call-accepted", {
        signal,
        from: socket.userId,
      });
    });

    socket.on("decline-call", ({ sessionId }) => {
      socket.to(`session-${sessionId}`).emit("call-declined", {
        from: socket.userId,
      });
    });

    socket.on("end-call", ({ sessionId }) => {
      socket.to(`session-${sessionId}`).emit("call-ended", {
        from: socket.userId,
      });
    });

    socket.on("start-screen-share", ({ sessionId }) => {
      socket.to(`session-${sessionId}`).emit("screen-share-started", {
        from: socket.userId,
      });
    });

    socket.on("stop-screen-share", ({ sessionId }) => {
      socket.to(`session-${sessionId}`).emit("screen-share-stopped", {
        from: socket.userId,
      });
    });

    socket.on("whiteboard-update", ({ sessionId, data }) => {
      socket.to(`session-${sessionId}`).emit("whiteboard-update", {
        data,
        from: socket.userId,
      });
    });

    socket.on("code-update", ({ sessionId, code, language }) => {
      socket.to(`session-${sessionId}`).emit("code-update", {
        code,
        language,
        from: socket.userId,
      });
    });

    socket.on("session-status-update", async ({ sessionId, status }) => {
      try {
        const session = await Session.findById(sessionId);

        if (!session) {
          socket.emit("error", { message: "Session not found" });
          return;
        }

        if (
          session.student.toString() !== socket.userId &&
          session.tutor.toString() !== socket.userId
        ) {
          socket.emit("error", { message: "Access denied" });
          return;
        }

        io.to(`session-${sessionId}`).emit("session-status-changed", {
          sessionId,
          status,
          updatedBy: socket.userId,
        });
      } catch (error) {
        socket.emit("error", { message: "Error updating session status" });
      }
    });

    socket.on("disconnect", () => {
      console.log(`User ${socket.user.firstName} disconnected: ${socket.id}`);

      updateUserOnlineStatus(socket.userId, false);

      socket.rooms.forEach((room) => {
        if (room.startsWith("session-")) {
          socket.to(room).emit("user-disconnected", {
            userId: socket.userId,
            userName: socket.user.firstName,
          });
        }
      });
    });

    socket.on("error", (error) => {
      console.error("Socket error:", error);
    });
  });

  async function updateUserOnlineStatus(userId, isOnline) {
    try {
      await User.findByIdAndUpdate(userId, {
        isActive: isOnline,
        lastActive: new Date(),
      });
    } catch (error) {
      console.error("Error updating user status:", error);
    }
  }
};
