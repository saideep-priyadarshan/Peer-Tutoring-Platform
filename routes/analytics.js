const express = require("express");
const Session = require("../models/Session");
const User = require("../models/User");
const Feedback = require("../models/Feedback");
const Message = require("../models/Message");
const auth = require("../middleware/auth");
const { query, validationResult } = require("express-validator");
const moment = require("moment");

const router = express.Router();

/**
 * @swagger
 * /api/analytics/progress:
 *   get:
 *     summary: Get user's learning progress
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [week, month, quarter, year]
 *           default: month
 *       - in: query
 *         name: subject
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Learning progress data
 */
router.get(
  "/progress",
  auth,
  [
    query("period").optional().isIn(["week", "month", "quarter", "year"]),
    query("subject").optional().trim(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      const { period = "month", subject } = req.query;

      const dateRange = getDateRange(period);

      let sessionQuery = {
        student: userId,
        status: "completed",
        scheduledEnd: {
          $gte: dateRange.start,
          $lte: dateRange.end,
        },
      };

      if (subject) {
        sessionQuery.subject = { $regex: new RegExp(subject, "i") };
      }

      const progressData = await Session.aggregate([
        { $match: sessionQuery },
        {
          $group: {
            _id: {
              subject: "$subject",
              week: { $week: "$scheduledEnd" },
              year: { $year: "$scheduledEnd" },
            },
            sessionCount: { $sum: 1 },
            totalHours: {
              $sum: {
                $divide: [
                  { $subtract: ["$actualEnd", "$actualStart"] },
                  1000 * 60 * 60,
                ],
              },
            },
            sessions: { $push: "$$ROOT" },
          },
        },
        {
          $group: {
            _id: "$_id.subject",
            weeklyData: {
              $push: {
                week: "$_id.week",
                year: "$_id.year",
                sessionCount: "$sessionCount",
                totalHours: "$totalHours",
              },
            },
            totalSessions: { $sum: "$sessionCount" },
            totalHours: { $sum: "$totalHours" },
          },
        },
        { $sort: { totalSessions: -1 } },
      ]);

      const feedbackTrends = await getFeedbackTrends(userId, dateRange);

      const learningStreaks = await calculateLearningStreaks(userId);

      const subjectProgress = await getSubjectProgress(userId, dateRange);

      res.json({
        period,
        dateRange,
        progressData,
        feedbackTrends,
        learningStreaks,
        subjectProgress,
        summary: {
          totalSubjects: progressData.length,
          totalSessions: progressData.reduce(
            (sum, subject) => sum + subject.totalSessions,
            0
          ),
          totalHours: progressData.reduce(
            (sum, subject) => sum + subject.totalHours,
            0
          ),
        },
      });
    } catch (error) {
      console.error("Get progress error:", error);
      res.status(500).json({ message: "Server error retrieving progress" });
    }
  }
);

/**
 * @swagger
 * /api/analytics/performance:
 *   get:
 *     summary: Get tutor performance analytics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [week, month, quarter, year]
 *           default: month
 *     responses:
 *       200:
 *         description: Tutor performance data
 */
router.get(
  "/performance",
  auth,
  [query("period").optional().isIn(["week", "month", "quarter", "year"])],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      const { period = "month" } = req.query;

      const user = await User.findById(userId).select("role");
      if (!["tutor", "both"].includes(user.role)) {
        return res
          .status(403)
          .json({ message: "Access denied. Tutor role required." });
      }

      const dateRange = getDateRange(period);

      const performanceData = await Session.aggregate([
        {
          $match: {
            tutor: mongoose.Types.ObjectId(userId),
            scheduledEnd: {
              $gte: dateRange.start,
              $lte: dateRange.end,
            },
          },
        },
        {
          $group: {
            _id: {
              status: "$status",
              subject: "$subject",
              week: { $week: "$scheduledEnd" },
            },
            count: { $sum: 1 },
            totalEarnings: { $sum: "$price" },
            avgDuration: {
              $avg: {
                $divide: [
                  { $subtract: ["$actualEnd", "$actualStart"] },
                  1000 * 60 * 60,
                ],
              },
            },
          },
        },
        {
          $group: {
            _id: "$_id.subject",
            statusBreakdown: {
              $push: {
                status: "$_id.status",
                count: "$count",
                earnings: "$totalEarnings",
              },
            },
            totalSessions: { $sum: "$count" },
            totalEarnings: { $sum: "$totalEarnings" },
            avgDuration: { $avg: "$avgDuration" },
          },
        },
      ]);

      const ratingTrends = await getRatingTrends(userId, dateRange);

      const keyMetrics = await calculateTutorMetrics(userId, dateRange);

      const retentionRate = await calculateStudentRetention(userId, dateRange);

      res.json({
        period,
        dateRange,
        performanceData,
        ratingTrends,
        keyMetrics,
        retentionRate,
      });
    } catch (error) {
      console.error("Get performance error:", error);
      res
        .status(500)
        .json({ message: "Server error retrieving performance data" });
    }
  }
);

/**
 * @swagger
 * /api/analytics/engagement:
 *   get:
 *     summary: Get user engagement analytics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [week, month, quarter, year]
 *           default: month
 *     responses:
 *       200:
 *         description: User engagement data
 */
router.get(
  "/engagement",
  auth,
  [query("period").optional().isIn(["week", "month", "quarter", "year"])],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      const { period = "month" } = req.query;
      const dateRange = getDateRange(period);

      const messagingActivity = await Message.aggregate([
        {
          $match: {
            sender: mongoose.Types.ObjectId(userId),
            createdAt: {
              $gte: dateRange.start,
              $lte: dateRange.end,
            },
          },
        },
        {
          $group: {
            _id: {
              day: { $dayOfYear: "$createdAt" },
              year: { $year: "$createdAt" },
            },
            messageCount: { $sum: 1 },
            sessionsActive: { $addToSet: "$session" },
          },
        },
        {
          $project: {
            date: "$_id",
            messageCount: 1,
            activeSessionsCount: { $size: "$sessionsActive" },
          },
        },
        { $sort: { "_id.year": 1, "_id.day": 1 } },
      ]);

      const attendancePatterns = await Session.aggregate([
        {
          $match: {
            $or: [
              { student: mongoose.Types.ObjectId(userId) },
              { tutor: mongoose.Types.ObjectId(userId) },
            ],

            scheduledStart: {
              $gte: dateRange.start,
              $lte: dateRange.end,
            },
          },
        },
        {
          $group: {
            _id: {
              dayOfWeek: { $dayOfWeek: "$scheduledStart" },
              hour: { $hour: "$scheduledStart" },
              status: "$status",
            },
            count: { $sum: 1 },
          },
        },
        {
          $group: {
            _id: {
              dayOfWeek: "$_id.dayOfWeek",
              hour: "$_id.hour",
            },
            statusBreakdown: {
              $push: {
                status: "$_id.status",
                count: "$count",
              },
            },
            totalSessions: { $sum: "$count" },
          },
        },
      ]);

      const user = await User.findById(userId).select(
        "lastActive createdAt stats"
      );
      const platformUsage = {
        accountAge: moment().diff(moment(user.createdAt), "days"),
        lastActiveAgo: moment().diff(moment(user.lastActive), "hours"),
        totalStats: user.stats,
      };

      const engagementScore = calculateEngagementScore({
        messagingActivity,
        attendancePatterns,
        platformUsage,
        period,
      });

      res.json({
        period,
        dateRange,
        messagingActivity,
        attendancePatterns,
        platformUsage,
        engagementScore,
        recommendations: generateEngagementRecommendations(engagementScore),
      });
    } catch (error) {
      console.error("Get engagement error:", error);
      res
        .status(500)
        .json({ message: "Server error retrieving engagement data" });
    }
  }
);

/**
 * @swagger
 * /api/analytics/platform-stats:
 *   get:
 *     summary: Get platform-wide statistics (admin only)
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [week, month, quarter, year]
 *           default: month
 *     responses:
 *       200:
 *         description: Platform statistics
 */
router.get(
  "/platform-stats",
  auth,
  [query("period").optional().isIn(["week", "month", "quarter", "year"])],
  async (req, res) => {
    try {
      const { period = "month" } = req.query;
      const dateRange = getDateRange(period);

      const userGrowth = await User.aggregate([
        {
          $match: {
            createdAt: {
              $gte: dateRange.start,
              $lte: dateRange.end,
            },
          },
        },
        {
          $group: {
            _id: {
              month: { $month: "$createdAt" },
              year: { $year: "$createdAt" },
              role: "$role",
            },
            count: { $sum: 1 },
          },
        },
        {
          $group: {
            _id: {
              month: "$_id.month",
              year: "$_id.year",
            },
            roleBreakdown: {
              $push: {
                role: "$_id.role",
                count: "$count",
              },
            },
            totalUsers: { $sum: "$count" },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]);

      const sessionStats = await Session.aggregate([
        {
          $match: {
            createdAt: {
              $gte: dateRange.start,
              $lte: dateRange.end,
            },
          },
        },
        {
          $group: {
            _id: {
              month: { $month: "$createdAt" },
              year: { $year: "$createdAt" },
              status: "$status",
            },
            count: { $sum: 1 },
            totalRevenue: { $sum: "$price" },
          },
        },
        {
          $group: {
            _id: {
              month: "$_id.month",
              year: "$_id.year",
            },
            statusBreakdown: {
              $push: {
                status: "$_id.status",
                count: "$count",
                revenue: "$totalRevenue",
              },
            },
            totalSessions: { $sum: "$count" },
            totalRevenue: { $sum: "$totalRevenue" },
          },
        },
      ]);

      const popularSubjects = await Session.aggregate([
        {
          $match: {
            createdAt: {
              $gte: dateRange.start,
              $lte: dateRange.end,
            },
            status: "completed",
          },
        },
        {
          $group: {
            _id: "$subject",
            sessionCount: { $sum: 1 },
            totalRevenue: { $sum: "$price" },
            avgRating: { $avg: "$rating" },
          },
        },
        { $sort: { sessionCount: -1 } },
        { $limit: 10 },
      ]);

      const activeUsers = await User.countDocuments({
        lastActive: {
          $gte: moment().subtract(7, "days").toDate(),
        },
      });

      const totalUsers = await User.countDocuments();

      res.json({
        period,
        dateRange,
        userGrowth,
        sessionStats,
        popularSubjects,
        activeUsers,
        totalUsers,
        summary: {
          userGrowthRate:
            userGrowth.length > 1
              ? (
                  ((userGrowth[userGrowth.length - 1].totalUsers -
                    userGrowth[0].totalUsers) /
                    userGrowth[0].totalUsers) *
                  100
                ).toFixed(2) + "%"
              : "N/A",
          activeUserRate: ((activeUsers / totalUsers) * 100).toFixed(2) + "%",
          totalRevenue: sessionStats.reduce(
            (sum, month) => sum + month.totalRevenue,
            0
          ),
        },
      });
    } catch (error) {
      console.error("Get platform stats error:", error);
      res
        .status(500)
        .json({ message: "Server error retrieving platform statistics" });
    }
  }
);

function getDateRange(period) {
  const end = moment().endOf("day");
  let start;

  switch (period) {
    case "week":
      start = moment().subtract(1, "week").startOf("day");
      break;
    case "month":
      start = moment().subtract(1, "month").startOf("day");
      break;
    case "quarter":
      start = moment().subtract(3, "months").startOf("day");
      break;
    case "year":
      start = moment().subtract(1, "year").startOf("day");
      break;
    default:
      start = moment().subtract(1, "month").startOf("day");
  }

  return {
    start: start.toDate(),
    end: end.toDate(),
  };
}

async function getFeedbackTrends(userId, dateRange) {
  return await Feedback.aggregate([
    {
      $match: {
        reviewee: mongoose.Types.ObjectId(userId),
        createdAt: {
          $gte: dateRange.start,
          $lte: dateRange.end,
        },
      },
    },
    {
      $group: {
        _id: {
          week: { $week: "$createdAt" },
          year: { $year: "$createdAt" },
        },
        avgOverall: { $avg: "$ratings.overall" },
        avgCommunication: { $avg: "$ratings.communication" },
        avgKnowledge: { $avg: "$ratings.knowledge" },
        avgPatience: { $avg: "$ratings.patience" },
        count: { $sum: 1 },
      },
    },
    { $sort: { "_id.year": 1, "_id.week": 1 } },
  ]);
}

async function calculateLearningStreaks(userId) {
  const sessions = await Session.find({
    student: userId,
    status: "completed",
  })
    .select("scheduledEnd")
    .sort({ scheduledEnd: -1 })
    .lean();

  if (sessions.length === 0) {
    return { current: 0, longest: 0, lastSession: null };
  }

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 1;
  let lastSessionDate = moment(sessions[0].scheduledEnd);

  if (moment().diff(lastSessionDate, "days") <= 7) {
    currentStreak = 1;
  }

  for (let i = 1; i < sessions.length; i++) {
    const currentDate = moment(sessions[i].scheduledEnd);
    const daysDiff = lastSessionDate.diff(currentDate, "days");

    if (daysDiff <= 7) {
      tempStreak++;
      if (currentStreak > 0) currentStreak++;
    } else {
      longestStreak = Math.max(longestStreak, tempStreak);
      tempStreak = 1;
      currentStreak = 0;
    }

    lastSessionDate = currentDate;
  }

  longestStreak = Math.max(longestStreak, tempStreak);

  return {
    current: currentStreak,
    longest: longestStreak,
    lastSession: sessions[0].scheduledEnd,
  };
}

async function getSubjectProgress(userId, dateRange) {
  return await Session.aggregate([
    {
      $match: {
        student: mongoose.Types.ObjectId(userId),
        status: "completed",
        scheduledEnd: {
          $gte: dateRange.start,
          $lte: dateRange.end,
        },
      },
    },
    {
      $lookup: {
        from: "feedbacks",
        let: { sessionId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$session", "$$sessionId"] },
                  { $eq: ["$type", "tutor-to-student"] },
                ],
              },
            },
          },
        ],
        as: "feedback",
      },
    },
    {
      $group: {
        _id: "$subject",
        sessionCount: { $sum: 1 },
        totalHours: {
          $sum: {
            $divide: [
              { $subtract: ["$actualEnd", "$actualStart"] },
              1000 * 60 * 60,
            ],
          },
        },
        avgFeedback: {
          $avg: {
            $arrayElemAt: ["$feedback.ratings.overall", 0],
          },
        },
        progressTrend: {
          $push: {
            date: "$scheduledEnd",
            feedback: { $arrayElemAt: ["$feedback.ratings.overall", 0] },
          },
        },
      },
    },
  ]);
}

async function getRatingTrends(userId, dateRange) {
  return await Feedback.aggregate([
    {
      $match: {
        reviewee: mongoose.Types.ObjectId(userId),
        type: "student-to-tutor",
        createdAt: {
          $gte: dateRange.start,
          $lte: dateRange.end,
        },
      },
    },
    {
      $group: {
        _id: {
          month: { $month: "$createdAt" },
          year: { $year: "$createdAt" },
        },
        avgRating: { $avg: "$ratings.overall" },
        count: { $sum: 1 },
        ratings: { $push: "$ratings.overall" },
      },
    },
    { $sort: { "_id.year": 1, "_id.month": 1 } },
  ]);
}

async function calculateTutorMetrics(userId, dateRange) {
  const metrics = await Session.aggregate([
    {
      $match: {
        tutor: mongoose.Types.ObjectId(userId),
        scheduledStart: {
          $gte: dateRange.start,
          $lte: dateRange.end,
        },
      },
    },
    {
      $group: {
        _id: null,
        totalSessions: { $sum: 1 },
        completedSessions: {
          $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
        },
        cancelledSessions: {
          $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
        },
        noShowSessions: {
          $sum: { $cond: [{ $eq: ["$status", "no-show"] }, 1, 0] },
        },
        totalEarnings: {
          $sum: { $cond: [{ $eq: ["$status", "completed"] }, "$price", 0] },
        },
        avgSessionPrice: { $avg: "$price" },
      },
    },
  ]);

  const result = metrics[0] || {
    totalSessions: 0,
    completedSessions: 0,
    cancelledSessions: 0,
    noShowSessions: 0,
    totalEarnings: 0,
    avgSessionPrice: 0,
  };

  result.completionRate =
    result.totalSessions > 0
      ? ((result.completedSessions / result.totalSessions) * 100).toFixed(2)
      : 0;
  result.cancellationRate =
    result.totalSessions > 0
      ? ((result.cancelledSessions / result.totalSessions) * 100).toFixed(2)
      : 0;

  return result;
}

async function calculateStudentRetention(userId, dateRange) {
  const students = await Session.aggregate([
    {
      $match: {
        tutor: mongoose.Types.ObjectId(userId),
        status: "completed",
        scheduledEnd: {
          $gte: dateRange.start,
          $lte: dateRange.end,
        },
      },
    },
    {
      $group: {
        _id: "$student",
        sessionCount: { $sum: 1 },
        firstSession: { $min: "$scheduledEnd" },
        lastSession: { $max: "$scheduledEnd" },
      },
    },
  ]);

  const totalStudents = students.length;
  const returningStudents = students.filter((s) => s.sessionCount > 1).length;
  const retentionRate =
    totalStudents > 0
      ? ((returningStudents / totalStudents) * 100).toFixed(2)
      : 0;

  return {
    totalStudents,
    returningStudents,
    retentionRate: parseFloat(retentionRate),
    avgSessionsPerStudent:
      totalStudents > 0
        ? (
            students.reduce((sum, s) => sum + s.sessionCount, 0) / totalStudents
          ).toFixed(2)
        : 0,
  };
}

function calculateEngagementScore(data) {
  const { messagingActivity, attendancePatterns, platformUsage, period } = data;

  let score = 0;
  let maxScore = 100;

  const totalMessages = messagingActivity.reduce(
    (sum, day) => sum + day.messageCount,
    0
  );
  const messagingScore = Math.min(30, (totalMessages / 50) * 30);
  score += messagingScore;

  const totalSessions = attendancePatterns.reduce(
    (sum, pattern) => sum + pattern.totalSessions,
    0
  );
  const attendanceScore = Math.min(40, (totalSessions / 20) * 40);
  score += attendanceScore;

  const daysActive = platformUsage.lastActiveAgo < 24 ? 15 : 0;
  const accountMaturity = Math.min(15, (platformUsage.accountAge / 30) * 15);
  score += daysActive + accountMaturity;

  return {
    total: Math.round(score),
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    breakdown: {
      messaging: Math.round(messagingScore),
      attendance: Math.round(attendanceScore),
      platformUsage: Math.round(daysActive + accountMaturity),
    },
  };
}

function generateEngagementRecommendations(engagementScore) {
  const recommendations = [];

  if (engagementScore.breakdown.messaging < 20) {
    recommendations.push({
      type: "messaging",
      title: "Increase Communication",
      description:
        "Try to communicate more with your tutors/students before and after sessions",
      priority: "medium",
    });
  }

  if (engagementScore.breakdown.attendance < 30) {
    recommendations.push({
      type: "attendance",
      title: "Book More Sessions",
      description:
        "Regular sessions help maintain learning momentum and improve outcomes",
      priority: "high",
    });
  }

  if (engagementScore.breakdown.platformUsage < 20) {
    recommendations.push({
      type: "platform",
      title: "Stay Active",
      description:
        "Log in regularly to check messages, update availability, and discover new tutors",
      priority: "low",
    });
  }

  if (engagementScore.percentage >= 80) {
    recommendations.push({
      type: "achievement",
      title: "Great Engagement!",
      description: "You're making excellent use of the platform. Keep it up!",
      priority: "positive",
    });
  }

  return recommendations;
}

module.exports = router;
