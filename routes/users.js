const express = require("express");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const User = require("../models/User");
const Session = require("../models/Session");
const auth = require("../middleware/auth");
const { body, query, validationResult } = require("express-validator");

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

/**
 * @swagger
 * /api/users/profile:
 *   get:
 *     summary: Get current user's profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 */
router.get("/profile", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select("-password -mfaSecret")
      .lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({ message: "Server error retrieving profile" });
  }
});

/**
 * @swagger
 * /api/users/profile:
 *   put:
 *     summary: Update current user's profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               bio:
 *                 type: string
 *               phoneNumber:
 *                 type: string
 *               dateOfBirth:
 *                 type: string
 *                 format: date
 *               subjects:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     subject:
 *                       type: string
 *                     level:
 *                       type: string
 *                       enum: [beginner, intermediate, advanced, expert]
 *                     experience:
 *                       type: number
 *               availability:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     day:
 *                       type: string
 *                       enum: [monday, tuesday, wednesday, thursday, friday, saturday, sunday]
 *                     startTime:
 *                       type: string
 *                     endTime:
 *                       type: string
 *                     timezone:
 *                       type: string
 *               location:
 *                 type: object
 *               preferences:
 *                 type: object
 *               socialLinks:
 *                 type: object
 *     responses:
 *       200:
 *         description: Profile updated successfully
 */
router.put(
  "/profile",
  auth,
  [
    body("firstName")
      .optional()
      .trim()
      .isLength({ min: 2 })
      .withMessage("First name must be at least 2 characters"),
    body("lastName")
      .optional()
      .trim()
      .isLength({ min: 2 })
      .withMessage("Last name must be at least 2 characters"),
    body("bio")
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage("Bio must be under 500 characters"),
    body("phoneNumber")
      .optional()
      .trim()
      .isMobilePhone()
      .withMessage("Invalid phone number"),
    body("dateOfBirth")
      .optional()
      .isISO8601()
      .withMessage("Invalid date format"),
    body("subjects")
      .optional()
      .isArray()
      .withMessage("Subjects must be an array"),
    body("availability")
      .optional()
      .isArray()
      .withMessage("Availability must be an array"),
    body("location")
      .optional()
      .isObject()
      .withMessage("Location must be an object"),
    body("preferences")
      .optional()
      .isObject()
      .withMessage("Preferences must be an object"),
    body("socialLinks")
      .optional()
      .isObject()
      .withMessage("Social links must be an object"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      const updateData = req.body;

      Object.keys(updateData).forEach((key) => {
        if (updateData[key] === undefined) {
          delete updateData[key];
        }
      });

      if (updateData.subjects) {
        for (const subject of updateData.subjects) {
          if (!subject.subject || !subject.level) {
            return res.status(400).json({
              message: "Each subject must have a subject name and level",
            });
          }
        }
      }

      if (updateData.availability) {
        for (const slot of updateData.availability) {
          if (!slot.day || !slot.startTime || !slot.endTime) {
            return res.status(400).json({
              message:
                "Each availability slot must have day, startTime, and endTime",
            });
          }
        }
      }

      const user = await User.findByIdAndUpdate(userId, updateData, {
        new: true,
        runValidators: true,
      }).select("-password -mfaSecret");

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({
        message: "Profile updated successfully",
        user,
      });
    } catch (error) {
      console.error("Update profile error:", error);
      res.status(500).json({ message: "Server error updating profile" });
    }
  }
);

/**
 * @swagger
 * /api/users/upload-avatar:
 *   post:
 *     summary: Upload profile picture
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Profile picture uploaded successfully
 */
router.post(
  "/upload-avatar",
  auth,
  upload.single("avatar"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No image file provided" });
      }

      const userId = req.user.id;

      const uploadResult = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: "peer-tutoring/avatars",
            public_id: `avatar-${userId}`,
            transformation: [
              { width: 300, height: 300, crop: "fill", gravity: "face" },
              { quality: "auto", format: "auto" },
            ],
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        uploadStream.end(req.file.buffer);
      });

      const user = await User.findByIdAndUpdate(
        userId,
        { profilePicture: uploadResult.secure_url },
        { new: true }
      ).select("-password -mfaSecret");

      res.json({
        message: "Profile picture uploaded successfully",
        profilePicture: uploadResult.secure_url,
        user,
      });
    } catch (error) {
      console.error("Upload avatar error:", error);
      res.status(500).json({ message: "Server error uploading avatar" });
    }
  }
);

/**
 * @swagger
 * /api/users/{userId}:
 *   get:
 *     summary: Get public user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Public user profile
 */
router.get("/:userId", auth, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId)
      .select(
        "-password -mfaSecret -email -phoneNumber -verification -socialLinks.email"
      )
      .lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (["tutor", "both"].includes(user.role)) {
      const tutorStats = await getTutorStats(userId);
      user.tutorStats = tutorStats;
    }

    res.json(user);
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ message: "Server error retrieving user" });
  }
});

/**
 * @swagger
 * /api/users/search:
 *   get:
 *     summary: Search users
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search query
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [student, tutor, both]
 *       - in: query
 *         name: subject
 *         schema:
 *           type: string
 *       - in: query
 *         name: location
 *         schema:
 *           type: string
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
 *         description: Search results
 */
router.get(
  "/search",
  auth,
  [
    query("q")
      .optional()
      .trim()
      .isLength({ min: 2 })
      .withMessage("Search query must be at least 2 characters"),
    query("role").optional().isIn(["student", "tutor", "both"]),
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("limit").optional().isInt({ min: 1, max: 50 }).toInt(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { q, role, subject, location, page = 1, limit = 20 } = req.query;

      let query = {
        isActive: true,
        _id: { $ne: req.user.id },
      };

      if (role) {
        query.role = role;
      }

      if (subject) {
        query["subjects.subject"] = { $regex: new RegExp(subject, "i") };
      }

      if (q) {
        query.$text = { $search: q };
      }

      if (location) {
        query.$or = [
          { "location.city": { $regex: new RegExp(location, "i") } },
          { "location.state": { $regex: new RegExp(location, "i") } },
          { "location.country": { $regex: new RegExp(location, "i") } },
        ];
      }

      const skip = (page - 1) * limit;
      const users = await User.find(query)
        .select(
          "firstName lastName profilePicture role subjects rating location bio stats"
        )
        .sort(q ? { score: { $meta: "textScore" } } : { "rating.average": -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      const total = await User.countDocuments(query);

      res.json({
        users,
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total,
          hasNext: page * limit < total,
          hasPrev: page > 1,
        },
      });
    } catch (error) {
      console.error("Search users error:", error);
      res.status(500).json({ message: "Server error searching users" });
    }
  }
);

/**
 * @swagger
 * /api/users/verify-credentials:
 *   post:
 *     summary: Submit credentials for verification
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [education, identity]
 *               documents:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Verification submitted successfully
 */
router.post(
  "/verify-credentials",
  auth,
  upload.array("documents", 5),
  [
    body("type")
      .isIn(["education", "identity"])
      .withMessage("Invalid verification type"),
    body("description")
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage("Description too long"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      if (!req.files || req.files.length === 0) {
        return res
          .status(400)
          .json({ message: "At least one document is required" });
      }

      const { type, description } = req.body;
      const userId = req.user.id;

      const documentUrls = await Promise.all(
        req.files.map(async (file, index) => {
          const uploadResult = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
              {
                folder: `peer-tutoring/verification/${type}`,
                public_id: `${userId}-${type}-${Date.now()}-${index}`,
                resource_type: "auto",
              },
              (error, result) => {
                if (error) reject(error);
                else resolve(result);
              }
            );
            uploadStream.end(file.buffer);
          });

          return {
            filename: file.originalname,
            url: uploadResult.secure_url,
            cloudinaryId: uploadResult.public_id,
          };
        })
      );

      console.log("Verification request:", {
        userId,
        type,
        description,
        documents: documentUrls,
      });

      res.json({
        message:
          "Verification documents submitted successfully. You will be notified once reviewed.",
        submittedDocuments: documentUrls.length,
      });
    } catch (error) {
      console.error("Verify credentials error:", error);
      res.status(500).json({ message: "Server error submitting verification" });
    }
  }
);

/**
 * @swagger
 * /api/users/dashboard:
 *   get:
 *     summary: Get user dashboard data
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard data
 */
router.get("/dashboard", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).select("role stats").lean();

    const upcomingSessions = await Session.find({
      $or: [{ student: userId }, { tutor: userId }],
      scheduledStart: { $gte: new Date() },
      status: { $in: ["scheduled", "confirmed"] },
    })
      .populate("student", "firstName lastName profilePicture")
      .populate("tutor", "firstName lastName profilePicture")
      .sort({ scheduledStart: 1 })
      .limit(5)
      .lean();

    const recentSessions = await Session.find({
      $or: [{ student: userId }, { tutor: userId }],
      status: "completed",
    })
      .populate("student", "firstName lastName profilePicture")
      .populate("tutor", "firstName lastName profilePicture")
      .sort({ scheduledEnd: -1 })
      .limit(5)
      .lean();

    let dashboardStats = {};

    if (["tutor", "both"].includes(user.role)) {
      dashboardStats.tutor = await getTutorDashboardStats(userId);
    }

    if (["student", "both"].includes(user.role)) {
      dashboardStats.student = await getStudentDashboardStats(userId);
    }

    res.json({
      user: {
        role: user.role,
        stats: user.stats,
      },
      upcomingSessions,
      recentSessions,
      dashboardStats,
    });
  } catch (error) {
    console.error("Get dashboard error:", error);
    res.status(500).json({ message: "Server error retrieving dashboard" });
  }
});

async function getTutorStats(userId) {
  try {
    const [sessionsStats, ratingStats] = await Promise.all([
      Session.aggregate([
        {
          $match: {
            tutor: mongoose.Types.ObjectId(userId),
            status: "completed",
          },
        },
        {
          $group: {
            _id: null,
            totalSessions: { $sum: 1 },
            totalHours: {
              $sum: {
                $divide: [
                  { $subtract: ["$actualEnd", "$actualStart"] },
                  1000 * 60 * 60,
                ],
              },
            },
          },
        },
      ]),

      Feedback.aggregate([
        {
          $match: {
            reviewee: mongoose.Types.ObjectId(userId),
            type: "student-to-tutor",
          },
        },
        {
          $group: {
            _id: null,
            averageRating: { $avg: "$ratings.overall" },
            totalReviews: { $sum: 1 },
          },
        },
      ]),
    ]);

    return {
      sessions: sessionsStats[0] || { totalSessions: 0, totalHours: 0 },
      ratings: ratingStats[0] || { averageRating: 0, totalReviews: 0 },
    };
  } catch (error) {
    console.error("Error getting tutor stats:", error);
    return {};
  }
}

async function getTutorDashboardStats(userId) {
  try {
    const today = new Date();
    const thisWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const stats = await Session.aggregate([
      {
        $match: {
          tutor: mongoose.Types.ObjectId(userId),
        },
      },
      {
        $group: {
          _id: null,
          totalEarnings: {
            $sum: {
              $cond: [{ $eq: ["$status", "completed"] }, "$price", 0],
            },
          },
          weeklyEarnings: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "completed"] },
                    { $gte: ["$scheduledEnd", thisWeek] },
                  ],
                },
                "$price",
                0,
              ],
            },
          },
          monthlyEarnings: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "completed"] },
                    { $gte: ["$scheduledEnd", thisMonth] },
                  ],
                },
                "$price",
                0,
              ],
            },
          },
          totalSessions: { $sum: 1 },
          completedSessions: {
            $sum: {
              $cond: [{ $eq: ["$status", "completed"] }, 1, 0],
            },
          },
        },
      },
    ]);

    return (
      stats[0] || {
        totalEarnings: 0,
        weeklyEarnings: 0,
        monthlyEarnings: 0,
        totalSessions: 0,
        completedSessions: 0,
      }
    );
  } catch (error) {
    console.error("Error getting tutor dashboard stats:", error);
    return {};
  }
}

async function getStudentDashboardStats(userId) {
  try {
    const today = new Date();
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const stats = await Session.aggregate([
      {
        $match: {
          student: mongoose.Types.ObjectId(userId),
        },
      },
      {
        $group: {
          _id: null,
          totalSpent: {
            $sum: {
              $cond: [{ $eq: ["$status", "completed"] }, "$price", 0],
            },
          },
          monthlySpent: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "completed"] },
                    { $gte: ["$scheduledEnd", thisMonth] },
                  ],
                },
                "$price",
                0,
              ],
            },
          },
          totalSessions: { $sum: 1 },
          completedSessions: {
            $sum: {
              $cond: [{ $eq: ["$status", "completed"] }, 1, 0],
            },
          },
          totalHours: {
            $sum: {
              $cond: [
                { $eq: ["$status", "completed"] },
                {
                  $divide: [
                    { $subtract: ["$actualEnd", "$actualStart"] },
                    1000 * 60 * 60,
                  ],
                },
                0,
              ],
            },
          },
        },
      },
    ]);

    return (
      stats[0] || {
        totalSpent: 0,
        monthlySpent: 0,
        totalSessions: 0,
        completedSessions: 0,
        totalHours: 0,
      }
    );
  } catch (error) {
    console.error("Error getting student dashboard stats:", error);
    return {};
  }
}

module.exports = router;
