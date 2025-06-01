const express = require("express");
const Session = require("../models/Session");
const User = require("../models/User");
const auth = require("../middleware/auth");
const { body, query, validationResult } = require("express-validator");
const { google } = require("googleapis");
const moment = require("moment-timezone");
const cron = require("node-cron");
const { sendEmail } = require("../utils/email");
const { sendSMS } = require("../utils/sms");

const router = express.Router();

/**
 * @swagger
 * /api/sessions/book:
 *   post:
 *     summary: Book a new tutoring session
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tutor
 *               - subject
 *               - scheduledStart
 *               - scheduledEnd
 *               - type
 *             properties:
 *               tutor:
 *                 type: string
 *                 description: Tutor's user ID
 *               subject:
 *                 type: string
 *               description:
 *                 type: string
 *               scheduledStart:
 *                 type: string
 *                 format: date-time
 *               scheduledEnd:
 *                 type: string
 *                 format: date-time
 *               type:
 *                 type: string
 *                 enum: [online, offline]
 *               location:
 *                 type: object
 *               price:
 *                 type: number
 *               recurring:
 *                 type: object
 *                 properties:
 *                   isRecurring:
 *                     type: boolean
 *                   frequency:
 *                     type: string
 *                     enum: [weekly, biweekly, monthly]
 *                   endDate:
 *                     type: string
 *                     format: date
 *     responses:
 *       201:
 *         description: Session booked successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Session'
 */
router.post(
  "/book",
  auth,
  [
    body("tutor").isMongoId().withMessage("Valid tutor ID is required"),
    body("subject")
      .trim()
      .isLength({ min: 1 })
      .withMessage("Subject is required"),
    body("scheduledStart")
      .isISO8601()
      .withMessage("Valid start time is required"),
    body("scheduledEnd").isISO8601().withMessage("Valid end time is required"),
    body("type")
      .isIn(["online", "offline"])
      .withMessage("Invalid session type"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        tutor: tutorId,
        subject,
        description,
        scheduledStart,
        scheduledEnd,
        type,
        location,
        price,
        recurring,
      } = req.body;

      const studentId = req.user.id;
      const start = new Date(scheduledStart);
      const end = new Date(scheduledEnd);
      const now = new Date();

      if (start >= end) {
        return res
          .status(400)
          .json({ message: "End time must be after start time" });
      }

      if (start <= now) {
        return res
          .status(400)
          .json({ message: "Session must be scheduled for the future" });
      }

      const tutor = await User.findById(tutorId);
      if (!tutor || !["tutor", "both"].includes(tutor.role)) {
        return res.status(404).json({ message: "Tutor not found" });
      }

      const conflicts = await checkSchedulingConflicts(
        studentId,
        tutorId,
        start,
        end
      );
      if (conflicts.length > 0) {
        return res.status(409).json({
          message: "Scheduling conflict detected",
          conflicts,
        });
      }

      const isAvailable = await checkTutorAvailability(tutorId, start, end);
      if (!isAvailable) {
        return res
          .status(400)
          .json({ message: "Tutor is not available at the requested time" });
      }

      const sessionData = {
        student: studentId,
        tutor: tutorId,
        subject,
        description,
        scheduledStart: start,
        scheduledEnd: end,
        type,
        location,
        price,
      };

      const sessions = [];
      if (recurring && recurring.isRecurring) {
        sessions.push(
          ...(await createRecurringSessions(sessionData, recurring))
        );
      } else {
        const session = new Session(sessionData);
        await session.save();
        sessions.push(session);
      }

      if (type === "online") {
        for (const session of sessions) {
          session.location.meetingLink = await generateMeetingLink(session);
          await session.save();
        }
      }

      await sendBookingNotifications(sessions[0], tutor, req.user);
      await addToCalendars(sessions[0], tutor, req.user);

      res.status(201).json({
        message:
          recurring && recurring.isRecurring
            ? `${sessions.length} sessions created successfully`
            : "Session booked successfully",
        sessions: sessions.map((session) => ({
          id: session._id,
          scheduledStart: session.scheduledStart,
          scheduledEnd: session.scheduledEnd,
          status: session.status,
        })),
      });
    } catch (error) {
      console.error("Booking error:", error);
      res.status(500).json({ message: "Server error during booking" });
    }
  }
);

/**
 * @swagger
 * /api/sessions/my-sessions:
 *   get:
 *     summary: Get user's sessions
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [scheduled, confirmed, ongoing, completed, cancelled, no-show]
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [student, tutor]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: List of user's sessions
 */
router.get(
  "/my-sessions",
  auth,
  [
    query("status")
      .optional()
      .isIn([
        "scheduled",
        "confirmed",
        "ongoing",
        "completed",
        "cancelled",
        "no-show",
      ]),
    query("role").optional().isIn(["student", "tutor"]),
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { status, role, page = 1, limit = 20 } = req.query;
      const userId = req.user.id;

      let query = {};

      if (role === "student") {
        query.student = userId;
      } else if (role === "tutor") {
        query.tutor = userId;
      } else {
        query.$or = [{ student: userId }, { tutor: userId }];
      }

      if (status) {
        query.status = status;
      }

      const skip = (page - 1) * limit;
      const sessions = await Session.find(query)
        .populate("student", "firstName lastName profilePicture")
        .populate("tutor", "firstName lastName profilePicture rating")
        .sort({ scheduledStart: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      const total = await Session.countDocuments(query);

      res.json({
        sessions,
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total,
          hasNext: page * limit < total,
          hasPrev: page > 1,
        },
      });
    } catch (error) {
      console.error("Get sessions error:", error);
      res.status(500).json({ message: "Server error retrieving sessions" });
    }
  }
);

/**
 * @swagger
 * /api/sessions/{id}:
 *   get:
 *     summary: Get session details
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Session details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Session'
 */
router.get("/:id", auth, async (req, res) => {
  try {
    const sessionId = req.params.id;
    const userId = req.user.id;

    const session = await Session.findById(sessionId)
      .populate(
        "student",
        "firstName lastName profilePicture email phoneNumber"
      )
      .populate(
        "tutor",
        "firstName lastName profilePicture email phoneNumber rating subjects"
      )
      .lean();

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (
      session.student._id.toString() !== userId &&
      session.tutor._id.toString() !== userId
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json(session);
  } catch (error) {
    console.error("Get session error:", error);
    res.status(500).json({ message: "Server error retrieving session" });
  }
});

/**
 * @swagger
 * /api/sessions/{id}/reschedule:
 *   put:
 *     summary: Reschedule a session
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - scheduledStart
 *               - scheduledEnd
 *             properties:
 *               scheduledStart:
 *                 type: string
 *                 format: date-time
 *               scheduledEnd:
 *                 type: string
 *                 format: date-time
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Session rescheduled successfully
 */
router.put(
  "/:id/reschedule",
  auth,
  [
    body("scheduledStart")
      .isISO8601()
      .withMessage("Valid start time is required"),
    body("scheduledEnd").isISO8601().withMessage("Valid end time is required"),
    body("reason")
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage("Reason too long"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const sessionId = req.params.id;
      const userId = req.user.id;
      const { scheduledStart, scheduledEnd, reason } = req.body;

      const session = await Session.findById(sessionId)
        .populate("student", "firstName lastName email")
        .populate("tutor", "firstName lastName email");

      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }

      if (
        session.student._id.toString() !== userId &&
        session.tutor._id.toString() !== userId
      ) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (!["scheduled", "confirmed"].includes(session.status)) {
        return res
          .status(400)
          .json({ message: "Session cannot be rescheduled" });
      }

      const newStart = new Date(scheduledStart);
      const newEnd = new Date(scheduledEnd);
      const now = new Date();

      if (newStart >= newEnd) {
        return res
          .status(400)
          .json({ message: "End time must be after start time" });
      }

      if (newStart <= now) {
        return res
          .status(400)
          .json({ message: "Session must be scheduled for the future" });
      }

      const conflicts = await checkSchedulingConflicts(
        session.student._id,
        session.tutor._id,
        newStart,
        newEnd,
        sessionId
      );

      if (conflicts.length > 0) {
        return res.status(409).json({
          message: "Scheduling conflict detected",
          conflicts,
        });
      }

      session.scheduledStart = newStart;
      session.scheduledEnd = newEnd;
      session.status = "scheduled";

      await session.save();
      await sendRescheduleNotifications(session, userId, reason);

      res.json({
        message: "Session rescheduled successfully",
        session: {
          id: session._id,
          scheduledStart: session.scheduledStart,
          scheduledEnd: session.scheduledEnd,
          status: session.status,
        },
      });
    } catch (error) {
      console.error("Reschedule error:", error);
      res.status(500).json({ message: "Server error during rescheduling" });
    }
  }
);

/**
 * @swagger
 * /api/sessions/{id}/cancel:
 *   put:
 *     summary: Cancel a session
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Session cancelled successfully
 */
router.put(
  "/:id/cancel",
  auth,
  [
    body("reason")
      .trim()
      .isLength({ min: 1, max: 500 })
      .withMessage("Cancellation reason is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const sessionId = req.params.id;
      const userId = req.user.id;
      const { reason } = req.body;

      const session = await Session.findById(sessionId)
        .populate("student", "firstName lastName email")
        .populate("tutor", "firstName lastName email");

      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }

      if (
        session.student._id.toString() !== userId &&
        session.tutor._id.toString() !== userId
      ) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (!["scheduled", "confirmed"].includes(session.status)) {
        return res.status(400).json({ message: "Session cannot be cancelled" });
      }

      const hoursUntilSession =
        (session.scheduledStart - new Date()) / (1000 * 60 * 60);
      if (hoursUntilSession < 24) {
        session.notes.admin = `Late cancellation (${hoursUntilSession.toFixed(
          1
        )} hours notice)`;
      }

      session.status = "cancelled";
      session.cancellation = {
        cancelledBy: userId,
        cancelledAt: new Date(),
        reason,
      };

      await session.save();

      await sendCancellationNotifications(session, userId, reason);

      res.json({
        message: "Session cancelled successfully",
        session: {
          id: session._id,
          status: session.status,
          cancellation: session.cancellation,
        },
      });
    } catch (error) {
      console.error("Cancel session error:", error);
      res.status(500).json({ message: "Server error during cancellation" });
    }
  }
);

/**
 * @swagger
 * /api/sessions/{id}/start:
 *   put:
 *     summary: Start a session
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Session started successfully
 */
router.put("/:id/start", auth, async (req, res) => {
  try {
    const sessionId = req.params.id;
    const userId = req.user.id;

    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (
      session.student.toString() !== userId &&
      session.tutor.toString() !== userId
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (!["scheduled", "confirmed"].includes(session.status)) {
      return res.status(400).json({ message: "Session cannot be started" });
    }

    const minutesUntilSession =
      (session.scheduledStart - new Date()) / (1000 * 60);
    if (minutesUntilSession > 15) {
      return res.status(400).json({
        message:
          "Session can only be started within 15 minutes of scheduled time",
      });
    }

    session.status = "ongoing";
    session.actualStart = new Date();
    await session.save();

    res.json({
      message: "Session started successfully",
      session: {
        id: session._id,
        status: session.status,
        actualStart: session.actualStart,
      },
    });
  } catch (error) {
    console.error("Start session error:", error);
    res.status(500).json({ message: "Server error starting session" });
  }
});

/**
 * @swagger
 * /api/sessions/{id}/end:
 *   put:
 *     summary: End a session
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Session ended successfully
 */
router.put(
  "/:id/end",
  auth,
  [
    body("notes")
      .optional()
      .trim()
      .isLength({ max: 1000 })
      .withMessage("Notes too long"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const sessionId = req.params.id;
      const userId = req.user.id;
      const { notes } = req.body;

      const session = await Session.findById(sessionId)
        .populate("student", "firstName lastName stats")
        .populate("tutor", "firstName lastName stats");

      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }

      if (
        session.student._id.toString() !== userId &&
        session.tutor._id.toString() !== userId
      ) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (session.status !== "ongoing") {
        return res.status(400).json({ message: "Session is not ongoing" });
      }

      session.status = "completed";
      session.actualEnd = new Date();

      if (notes) {
        if (session.student._id.toString() === userId) {
          session.notes.student = notes;
        } else {
          session.notes.tutor = notes;
        }
      }

      await session.save();
      await updateUserStats(session);

      res.json({
        message: "Session ended successfully",
        session: {
          id: session._id,
          status: session.status,
          actualEnd: session.actualEnd,
          duration: session.actualEnd - session.actualStart,
        },
      });
    } catch (error) {
      console.error("End session error:", error);
      res.status(500).json({ message: "Server error ending session" });
    }
  }
);

async function checkSchedulingConflicts(
  studentId,
  tutorId,
  start,
  end,
  excludeSessionId = null
) {
  const query = {
    $and: [
      {
        $or: [{ student: studentId }, { tutor: tutorId }],
      },
      {
        status: { $in: ["scheduled", "confirmed", "ongoing"] },
      },
      {
        $or: [
          {
            scheduledStart: { $lt: end },
            scheduledEnd: { $gt: start },
          },
        ],
      },
    ],
  };

  if (excludeSessionId) {
    query._id = { $ne: excludeSessionId };
  }

  return await Session.find(query).lean();
}

async function checkTutorAvailability(tutorId, start, end) {
  const tutor = await User.findById(tutorId).lean();
  if (!tutor || !tutor.availability) {
    return false;
  }

  const dayOfWeek = moment(start).format("dddd").toLowerCase();
  const startTime = moment(start).format("HH:mm");
  const endTime = moment(end).format("HH:mm");

  const availableSlot = tutor.availability.find(
    (slot) =>
      slot.day === dayOfWeek &&
      slot.startTime <= startTime &&
      slot.endTime >= endTime
  );

  return !!availableSlot;
}

async function createRecurringSessions(sessionData, recurring) {
  const sessions = [];
  const { frequency, endDate } = recurring;

  let currentDate = moment(sessionData.scheduledStart);
  const endMoment = moment(endDate);
  const duration = moment(sessionData.scheduledEnd).diff(
    moment(sessionData.scheduledStart)
  );

  const parentSession = new Session({
    ...sessionData,
    recurring: {
      isRecurring: true,
      frequency,
      endDate,
    },
  });
  await parentSession.save();
  sessions.push(parentSession);

  while (currentDate.isBefore(endMoment)) {
    switch (frequency) {
      case "weekly":
        currentDate.add(1, "week");
        break;
      case "biweekly":
        currentDate.add(2, "weeks");
        break;
      case "monthly":
        currentDate.add(1, "month");
        break;
    }

    if (currentDate.isBefore(endMoment)) {
      const recurringSession = new Session({
        ...sessionData,
        scheduledStart: currentDate.toDate(),
        scheduledEnd: moment(currentDate).add(duration).toDate(),
        recurring: {
          isRecurring: true,
          frequency,
          endDate,
          parentSession: parentSession._id,
        },
      });

      await recurringSession.save();
      sessions.push(recurringSession);
    }
  }
  return sessions;
}

async function generateMeetingLink(session) {
  const meetingId = `meeting-${session._id.toString().slice(-8)}`;
  return `https://meet.example.com/${meetingId}`;
}

async function sendBookingNotifications(session, tutor, student) {
  try {
    await sendEmail({
      to: tutor.email,
      subject: "New Session Booking",
      template: "session-booking-tutor",
      data: {
        tutorName: tutor.firstName,
        studentName: `${student.firstName} ${student.lastName}`,
        subject: session.subject,
        scheduledStart: session.scheduledStart,
        scheduledEnd: session.scheduledEnd,
      },
    });

    await sendEmail({
      to: student.email,
      subject: "Session Booking Confirmation",
      template: "session-booking-student",
      data: {
        studentName: student.firstName,
        tutorName: `${tutor.firstName} ${tutor.lastName}`,
        subject: session.subject,
        scheduledStart: session.scheduledStart,
        scheduledEnd: session.scheduledEnd,
      },
    });

    if (tutor.phoneNumber) {
      await sendSMS({
        to: tutor.phoneNumber,
        message: `New tutoring session booked for ${
          session.subject
        } on ${moment(session.scheduledStart).format(
          "MMM DD, YYYY at h:mm A"
        )}`,
      });
    }
  } catch (error) {
    console.error("Error sending booking notifications:", error);
  }
}

async function addToCalendars(session, tutor, student) {
  try {
    console.log("Calendar integration not implemented yet");
  } catch (error) {
    console.error("Error adding to calendars:", error);
  }
}

async function sendRescheduleNotifications(session, rescheduledBy, reason) {
  try {
    const rescheduler =
      rescheduledBy === session.student._id.toString()
        ? session.student
        : session.tutor;
    const other =
      rescheduledBy === session.student._id.toString()
        ? session.tutor
        : session.student;

    await sendEmail({
      to: other.email,
      subject: "Session Rescheduled",
      template: "session-reschedule",
      data: {
        name: other.firstName,
        reschedulerName: `${rescheduler.firstName} ${rescheduler.lastName}`,
        subject: session.subject,
        newStart: session.scheduledStart,
        newEnd: session.scheduledEnd,
        reason,
      },
    });
  } catch (error) {
    console.error("Error sending reschedule notifications:", error);
  }
}

async function sendCancellationNotifications(session, cancelledBy, reason) {
  try {
    const canceller =
      cancelledBy === session.student._id.toString()
        ? session.student
        : session.tutor;
    const other =
      cancelledBy === session.student._id.toString()
        ? session.tutor
        : session.student;

    await sendEmail({
      to: other.email,
      subject: "Session Cancelled",
      template: "session-cancellation",
      data: {
        name: other.firstName,
        cancellerName: `${canceller.firstName} ${canceller.lastName}`,
        subject: session.subject,
        scheduledStart: session.scheduledStart,
        reason,
      },
    });
  } catch (error) {
    console.error("Error sending cancellation notifications:", error);
  }
}

async function updateUserStats(session) {
  try {
    const duration =
      (session.actualEnd - session.actualStart) / (1000 * 60 * 60);

    await User.findByIdAndUpdate(session.student._id, {
      $inc: {
        "stats.totalSessions": 1,
        "stats.completedSessions": 1,
        "stats.hoursLearning": duration,
      },
    });

    await User.findByIdAndUpdate(session.tutor._id, {
      $inc: {
        "stats.totalSessions": 1,
        "stats.completedSessions": 1,
        "stats.hoursTeaching": duration,
      },
    });
  } catch (error) {
    console.error("Error updating user stats:", error);
  }
}

cron.schedule("*/15 * * * *", async () => {
  try {
    const reminderTime = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const sessionsToRemind = await Session.find({
      scheduledStart: {
        $gte: new Date(),
        $lte: reminderTime,
      },
      status: { $in: ["scheduled", "confirmed"] },
      "reminders.sent": false,
    })
      .populate("student", "firstName lastName email phoneNumber")
      .populate("tutor", "firstName lastName email phoneNumber");

    for (const session of sessionsToRemind) {
      await sendSessionReminders(session);
      session.reminders.sent = true;
      session.reminders.sentAt = new Date();
      await session.save();
    }
  } catch (error) {
    console.error("Error in reminder cron job:", error);
  }
});

async function sendSessionReminders(session) {
  try {
    const reminderData = {
      subject: session.subject,
      scheduledStart: session.scheduledStart,
      scheduledEnd: session.scheduledEnd,
      location: session.location,
    };

    await sendEmail({
      to: session.student.email,
      subject: "Upcoming Tutoring Session Reminder",
      template: "session-reminder",
      data: {
        name: session.student.firstName,
        role: "student",
        otherParty: `${session.tutor.firstName} ${session.tutor.lastName}`,
        ...reminderData,
      },
    });

    await sendEmail({
      to: session.tutor.email,
      subject: "Upcoming Tutoring Session Reminder",
      template: "session-reminder",
      data: {
        name: session.tutor.firstName,
        role: "tutor",
        otherParty: `${session.student.firstName} ${session.student.lastName}`,
        ...reminderData,
      },
    });
  } catch (error) {
    console.error("Error sending session reminders:", error);
  }
}

module.exports = router;
