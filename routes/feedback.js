const express = require("express");
const Feedback = require("../models/Feedback");
const Session = require("../models/Session");
const User = require("../models/User");
const auth = require("../middleware/auth");
const { body, query, validationResult } = require("express-validator");

const router = express.Router();

/**
 * @swagger
 * /api/feedback/submit:
 *   post:
 *     summary: Submit feedback for a session
 *     tags: [Feedback]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *               - revieweeId
 *               - ratings
 *             properties:
 *               sessionId:
 *                 type: string
 *               revieweeId:
 *                 type: string
 *               ratings:
 *                 type: object
 *                 properties:
 *                   overall:
 *                     type: number
 *                     minimum: 1
 *                     maximum: 5
 *                   communication:
 *                     type: number
 *                     minimum: 1
 *                     maximum: 5
 *                   punctuality:
 *                     type: number
 *                     minimum: 1
 *                     maximum: 5
 *                   knowledge:
 *                     type: number
 *                     minimum: 1
 *                     maximum: 5
 *                   patience:
 *                     type: number
 *                     minimum: 1
 *                     maximum: 5
 *                   preparation:
 *                     type: number
 *                     minimum: 1
 *                     maximum: 5
 *               comment:
 *                 type: string
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *               isPublic:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Feedback submitted successfully
 */
router.post(
  "/submit",
  auth,
  [
    body("sessionId").isMongoId().withMessage("Valid session ID is required"),
    body("revieweeId").isMongoId().withMessage("Valid reviewee ID is required"),
    body("ratings.overall")
      .isFloat({ min: 1, max: 5 })
      .withMessage("Overall rating must be between 1 and 5"),
    body("ratings.communication")
      .optional()
      .isFloat({ min: 1, max: 5 })
      .withMessage("Communication rating must be between 1 and 5"),
    body("ratings.punctuality")
      .optional()
      .isFloat({ min: 1, max: 5 })
      .withMessage("Punctuality rating must be between 1 and 5"),
    body("ratings.knowledge")
      .optional()
      .isFloat({ min: 1, max: 5 })
      .withMessage("Knowledge rating must be between 1 and 5"),
    body("ratings.patience")
      .optional()
      .isFloat({ min: 1, max: 5 })
      .withMessage("Patience rating must be between 1 and 5"),
    body("ratings.preparation")
      .optional()
      .isFloat({ min: 1, max: 5 })
      .withMessage("Preparation rating must be between 1 and 5"),
    body("comment")
      .optional()
      .trim()
      .isLength({ max: 1000 })
      .withMessage("Comment must be under 1000 characters"),
    body("tags").optional().isArray().withMessage("Tags must be an array"),
    body("isPublic")
      .optional()
      .isBoolean()
      .withMessage("isPublic must be a boolean"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        sessionId,
        revieweeId,
        ratings,
        comment,
        tags,
        isPublic = true,
      } = req.body;

      const reviewerId = req.user.id;

      const session = await Session.findById(sessionId);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }

      if (session.status !== "completed") {
        return res.status(400).json({
          message: "Can only provide feedback for completed sessions",
        });
      }

      if (
        session.student.toString() !== reviewerId &&
        session.tutor.toString() !== reviewerId
      ) {
        return res.status(403).json({ message: "Access denied" });
      }

      const expectedReviewee =
        session.student.toString() === reviewerId
          ? session.tutor.toString()
          : session.student.toString();

      if (revieweeId !== expectedReviewee) {
        return res.status(400).json({ message: "Invalid reviewee" });
      }

      const existingFeedback = await Feedback.findOne({
        session: sessionId,
        reviewer: reviewerId,
      });

      if (existingFeedback) {
        return res
          .status(400)
          .json({ message: "Feedback already submitted for this session" });
      }

      const type =
        session.student.toString() === reviewerId
          ? "student-to-tutor"
          : "tutor-to-student";

      const feedback = new Feedback({
        session: sessionId,
        reviewer: reviewerId,
        reviewee: revieweeId,
        type,
        ratings,
        comment,
        tags,
        isPublic,
      });

      await feedback.save();

      await updateUserRating(revieweeId);

      await feedback.populate("reviewer", "firstName lastName profilePicture");
      await feedback.populate("reviewee", "firstName lastName");

      res.status(201).json({
        message: "Feedback submitted successfully",
        feedback,
      });
    } catch (error) {
      console.error("Submit feedback error:", error);
      res.status(500).json({ message: "Server error submitting feedback" });
    }
  }
);

/**
 * @swagger
 * /api/feedback/user/{userId}:
 *   get:
 *     summary: Get feedback for a user
 *     tags: [Feedback]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [student-to-tutor, tutor-to-student]
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
 *         description: User feedback list
 */
router.get(
  "/user/:userId",
  auth,
  [
    query("type").optional().isIn(["student-to-tutor", "tutor-to-student"]),
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { userId } = req.params;
      const { type, page = 1, limit = 20 } = req.query;

      let query = {
        reviewee: userId,
        isPublic: true,
      };

      if (type) {
        query.type = type;
      }

      const skip = (page - 1) * limit;
      const feedback = await Feedback.find(query)
        .populate("reviewer", "firstName lastName profilePicture")
        .populate("session", "subject scheduledStart")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      const total = await Feedback.countDocuments(query);

      const stats = await calculateFeedbackStats(userId, type);

      res.json({
        feedback,
        stats,
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total,
          hasNext: page * limit < total,
          hasPrev: page > 1,
        },
      });
    } catch (error) {
      console.error("Get user feedback error:", error);
      res.status(500).json({ message: "Server error retrieving feedback" });
    }
  }
);

/**
 * @swagger
 * /api/feedback/session/{sessionId}:
 *   get:
 *     summary: Get feedback for a session
 *     tags: [Feedback]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Session feedback
 */
router.get("/session/:sessionId", auth, async (req, res) => {
  try {
    const { sessionId } = req.params;
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

    const feedback = await Feedback.find({ session: sessionId })
      .populate("reviewer", "firstName lastName profilePicture")
      .populate("reviewee", "firstName lastName profilePicture")
      .lean();

    res.json(feedback);
  } catch (error) {
    console.error("Get session feedback error:", error);
    res
      .status(500)
      .json({ message: "Server error retrieving session feedback" });
  }
});

/**
 * @swagger
 * /api/feedback/my-feedback:
 *   get:
 *     summary: Get current user's given and received feedback
 *     tags: [Feedback]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [given, received]
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
 *         description: User's feedback
 */
router.get(
  "/my-feedback",
  auth,
  [
    query("type").optional().isIn(["given", "received"]),
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      const { type, page = 1, limit = 20 } = req.query;

      let query = {};
      if (type === "given") {
        query.reviewer = userId;
      } else if (type === "received") {
        query.reviewee = userId;
      } else {
        query.$or = [{ reviewer: userId }, { reviewee: userId }];
      }

      const skip = (page - 1) * limit;
      const feedback = await Feedback.find(query)
        .populate("reviewer", "firstName lastName profilePicture")
        .populate("reviewee", "firstName lastName profilePicture")
        .populate("session", "subject scheduledStart")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      const total = await Feedback.countDocuments(query);

      res.json({
        feedback,
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total,
          hasNext: page * limit < total,
          hasPrev: page > 1,
        },
      });
    } catch (error) {
      console.error("Get my feedback error:", error);
      res.status(500).json({ message: "Server error retrieving feedback" });
    }
  }
);

/**
 * @swagger
 * /api/feedback/{feedbackId}/helpful:
 *   put:
 *     summary: Mark feedback as helpful
 *     tags: [Feedback]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: feedbackId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Feedback marked as helpful
 */
router.put("/:feedbackId/helpful", auth, async (req, res) => {
  try {
    const { feedbackId } = req.params;
    const userId = req.user.id;

    const feedback = await Feedback.findById(feedbackId);
    if (!feedback) {
      return res.status(404).json({ message: "Feedback not found" });
    }

    if (!feedback.isPublic) {
      return res
        .status(403)
        .json({ message: "Cannot vote on private feedback" });
    }

    if (feedback.reviewer.toString() === userId) {
      return res
        .status(400)
        .json({ message: "Cannot vote on your own feedback" });
    }

    feedback.helpfulVotes += 1;
    await feedback.save();

    res.json({
      message: "Feedback marked as helpful",
      helpfulVotes: feedback.helpfulVotes,
    });
  } catch (error) {
    console.error("Mark helpful error:", error);
    res
      .status(500)
      .json({ message: "Server error marking feedback as helpful" });
  }
});

/**
 * @swagger
 * /api/feedback/{feedbackId}/report:
 *   post:
 *     summary: Report inappropriate feedback
 *     tags: [Feedback]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: feedbackId
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
 *         description: Feedback reported successfully
 */
router.post(
  "/:feedbackId/report",
  auth,
  [
    body("reason")
      .trim()
      .isLength({ min: 10, max: 500 })
      .withMessage("Report reason must be between 10 and 500 characters"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { feedbackId } = req.params;
      const { reason } = req.body;
      const userId = req.user.id;

      const feedback = await Feedback.findById(feedbackId);
      if (!feedback) {
        return res.status(404).json({ message: "Feedback not found" });
      }

      const existingReport = feedback.reportedBy.find(
        (report) => report.user.toString() === userId
      );

      if (existingReport) {
        return res
          .status(400)
          .json({ message: "You have already reported this feedback" });
      }

      feedback.reportedBy.push({
        user: userId,
        reason,
        reportedAt: new Date(),
      });

      await feedback.save();

      res.json({ message: "Feedback reported successfully" });
    } catch (error) {
      console.error("Report feedback error:", error);
      res.status(500).json({ message: "Server error reporting feedback" });
    }
  }
);

async function updateUserRating(userId) {
  try {
    const feedbackStats = await Feedback.aggregate([
      {
        $match: {
          reviewee: mongoose.Types.ObjectId(userId),
          isPublic: true,
        },
      },
      {
        $group: {
          _id: null,
          averageRating: { $avg: "$ratings.overall" },
          totalCount: { $sum: 1 },
        },
      },
    ]);

    if (feedbackStats.length > 0) {
      const { averageRating, totalCount } = feedbackStats[0];

      await User.findByIdAndUpdate(userId, {
        "rating.average": Math.round(averageRating * 100) / 100,
        "rating.count": totalCount,
      });
    }
  } catch (error) {
    console.error("Error updating user rating:", error);
  }
}

async function calculateFeedbackStats(userId, type) {
  try {
    let matchQuery = {
      reviewee: mongoose.Types.ObjectId(userId),
      isPublic: true,
    };

    if (type) {
      matchQuery.type = type;
    }

    const stats = await Feedback.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalFeedback: { $sum: 1 },
          averageOverall: { $avg: "$ratings.overall" },
          averageCommunication: { $avg: "$ratings.communication" },
          averagePunctuality: { $avg: "$ratings.punctuality" },
          averageKnowledge: { $avg: "$ratings.knowledge" },
          averagePatience: { $avg: "$ratings.patience" },
          averagePreparation: { $avg: "$ratings.preparation" },
        },
      },
    ]);

    const distribution = await Feedback.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: "$ratings.overall",
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const commonTags = await Feedback.aggregate([
      { $match: matchQuery },
      { $unwind: "$tags" },
      {
        $group: {
          _id: "$tags",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    return {
      summary: stats[0] || {
        totalFeedback: 0,
        averageOverall: 0,
        averageCommunication: 0,
        averagePunctuality: 0,
        averageKnowledge: 0,
        averagePatience: 0,
        averagePreparation: 0,
      },
      distribution: distribution.reduce((acc, item) => {
        acc[`${item._id}Stars`] = item.count;
        return acc;
      }, {}),
      commonTags: commonTags.map((tag) => ({
        tag: tag._id,
        count: tag.count,
      })),
    };
  } catch (error) {
    console.error("Error calculating feedback stats:", error);
    return {};
  }
}

module.exports = router;
