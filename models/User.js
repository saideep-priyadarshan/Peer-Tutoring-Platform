const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       required:
 *         - email
 *         - firstName
 *         - lastName
 *       properties:
 *         _id:
 *           type: string
 *           description: Auto-generated unique identifier
 *         firstName:
 *           type: string
 *           description: User's first name
 *         lastName:
 *           type: string
 *           description: User's last name
 *         email:
 *           type: string
 *           format: email
 *           description: User's email address
 *         password:
 *           type: string
 *           description: Hashed password
 *         role:
 *           type: string
 *           enum: [student, tutor, both]
 *           description: User's role in the platform
 *         profilePicture:
 *           type: string
 *           description: URL to profile picture
 *         bio:
 *           type: string
 *           description: User's biography
 *         subjects:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               subject:
 *                 type: string
 *               level:
 *                 type: string
 *                 enum: [beginner, intermediate, advanced, expert]
 *               verified:
 *                 type: boolean
 *         availability:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               day:
 *                 type: string
 *                 enum: [monday, tuesday, wednesday, thursday, friday, saturday, sunday]
 *               startTime:
 *                 type: string
 *               endTime:
 *                 type: string
 *               timezone:
 *                 type: string
 *         location:
 *           type: object
 *           properties:
 *             type:
 *               type: string
 *               enum: [online, offline, both]
 *             address:
 *               type: string
 *             coordinates:
 *               type: object
 *               properties:
 *                 lat:
 *                   type: number
 *                 lng:
 *                   type: number
 *         preferences:
 *           type: object
 *           properties:
 *             learningStyle:
 *               type: array
 *               items:
 *                 type: string
 *                 enum: [visual, auditory, kinesthetic, reading]
 *             sessionDuration:
 *               type: number
 *             maxDistance:
 *               type: number
 *         rating:
 *           type: object
 *           properties:
 *             average:
 *               type: number
 *               minimum: 0
 *               maximum: 5
 *             count:
 *               type: number
 *         verification:
 *           type: object
 *           properties:
 *             email:
 *               type: boolean
 *             phone:
 *               type: boolean
 *             identity:
 *               type: boolean
 *             education:
 *               type: boolean
 *         mfaEnabled:
 *           type: boolean
 *         mfaSecret:
 *           type: string
 *         isActive:
 *           type: boolean
 *         lastActive:
 *           type: string
 *           format: date-time
 */

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      minlength: 6,
    },
    googleId: {
      type: String,
      sparse: true,
    },
    role: {
      type: String,
      enum: ["student", "tutor", "both"],
      default: "student",
    },
    profilePicture: {
      type: String,
      default: "",
    },
    bio: {
      type: String,
      maxlength: 500,
    },
    phoneNumber: {
      type: String,
      trim: true,
    },
    dateOfBirth: {
      type: Date,
    },
    subjects: [
      {
        subject: {
          type: String,
          required: true,
        },
        level: {
          type: String,
          enum: ["beginner", "intermediate", "advanced", "expert"],
          default: "beginner",
        },
        verified: {
          type: Boolean,
          default: false,
        },
        experience: {
          type: Number,
          default: 0,
        },
      },
    ],
    availability: [
      {
        day: {
          type: String,
          enum: [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
          ],
          required: true,
        },
        startTime: {
          type: String,
          required: true,
        },
        endTime: {
          type: String,
          required: true,
        },
        timezone: {
          type: String,
          default: "UTC",
        },
      },
    ],
    location: {
      type: {
        type: String,
        enum: ["online", "offline", "both"],
        default: "online",
      },
      address: String,
      city: String,
      state: String,
      country: String,
      coordinates: {
        lat: Number,
        lng: Number,
      },
    },
    preferences: {
      learningStyle: [
        {
          type: String,
          enum: ["visual", "auditory", "kinesthetic", "reading"],
        },
      ],
      sessionDuration: {
        type: Number,
        default: 60,
      },
      maxDistance: {
        type: Number,
        default: 50,
      },
      priceRange: {
        min: {
          type: Number,
          default: 0,
        },
        max: {
          type: Number,
          default: 100,
        },
      },
    },
    rating: {
      average: {
        type: Number,
        min: 0,
        max: 5,
        default: 0,
      },
      count: {
        type: Number,
        default: 0,
      },
    },
    verification: {
      email: {
        type: Boolean,
        default: false,
      },
      phone: {
        type: Boolean,
        default: false,
      },
      identity: {
        type: Boolean,
        default: false,
      },
      education: {
        type: Boolean,
        default: false,
      },
    },
    mfaEnabled: {
      type: Boolean,
      default: false,
    },
    mfaSecret: {
      type: String,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastActive: {
      type: Date,
      default: Date.now,
    },
    socialLinks: {
      linkedin: String,
      github: String,
      portfolio: String,
    },
    stats: {
      totalSessions: {
        type: Number,
        default: 0,
      },
      completedSessions: {
        type: Number,
        default: 0,
      },
      hoursTeaching: {
        type: Number,
        default: 0,
      },
      hoursLearning: {
        type: Number,
        default: 0,
      },
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index({ "location.coordinates": "2dsphere" });

userSchema.index({
  firstName: "text",
  lastName: "text",
  bio: "text",
  "subjects.subject": "text",
});

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

userSchema.methods.updateLastActive = function () {
  this.lastActive = new Date();
  return this.save();
};

module.exports = mongoose.model("User", userSchema);
