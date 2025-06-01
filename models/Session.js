const mongoose = require("mongoose");

/**
 * @swagger
 * components:
 *   schemas:
 *     Session:
 *       type: object
 *       required:
 *         - student
 *         - tutor
 *         - subject
 *         - scheduledStart
 *         - scheduledEnd
 *       properties:
 *         _id:
 *           type: string
 *         student:
 *           type: string
 *           description: Student user ID
 *         tutor:
 *           type: string
 *           description: Tutor user ID
 *         subject:
 *           type: string
 *           description: Subject being tutored
 *         description:
 *           type: string
 *           description: Session description or goals
 *         scheduledStart:
 *           type: string
 *           format: date-time
 *         scheduledEnd:
 *           type: string
 *           format: date-time
 *         actualStart:
 *           type: string
 *           format: date-time
 *         actualEnd:
 *           type: string
 *           format: date-time
 *         status:
 *           type: string
 *           enum: [scheduled, confirmed, ongoing, completed, cancelled, no-show]
 *         type:
 *           type: string
 *           enum: [online, offline]
 *         location:
 *           type: object
 *           properties:
 *             type:
 *               type: string
 *               enum: [online, offline]
 *             details:
 *               type: string
 *             meetingLink:
 *               type: string
 *             address:
 *               type: string
 *         price:
 *           type: number
 *         materials:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               url:
 *                 type: string
 *               type:
 *                 type: string
 *         notes:
 *           type: object
 *           properties:
 *             student:
 *               type: string
 *             tutor:
 *               type: string
 */

const sessionSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    tutor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    subject: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      maxlength: 1000,
    },
    scheduledStart: {
      type: Date,
      required: true,
    },
    scheduledEnd: {
      type: Date,
      required: true,
    },
    actualStart: {
      type: Date,
    },
    actualEnd: {
      type: Date,
    },
    status: {
      type: String,
      enum: [
        "scheduled",
        "confirmed",
        "ongoing",
        "completed",
        "cancelled",
        "no-show",
      ],
      default: "scheduled",
    },
    type: {
      type: String,
      enum: ["online", "offline"],
      required: true,
    },
    location: {
      type: {
        type: String,
        enum: ["online", "offline"],
      },
      details: String,
      meetingLink: String,
      address: String,
      coordinates: {
        lat: Number,
        lng: Number,
      },
    },
    price: {
      type: Number,
      min: 0,
    },
    materials: [
      {
        name: String,
        url: String,
        type: {
          type: String,
          enum: ["document", "image", "video", "link", "other"],
        },
        uploadedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    notes: {
      student: String,
      tutor: String,
      admin: String,
    },
    reminders: {
      sent: {
        type: Boolean,
        default: false,
      },
      sentAt: Date,
    },
    recurring: {
      isRecurring: {
        type: Boolean,
        default: false,
      },
      frequency: {
        type: String,
        enum: ["weekly", "biweekly", "monthly"],
      },
      endDate: Date,
      parentSession: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Session",
      },
    },
    cancellation: {
      cancelledBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      cancelledAt: Date,
      reason: String,
    },
  },
  {
    timestamps: true,
  }
);

sessionSchema.index({ student: 1, scheduledStart: -1 });
sessionSchema.index({ tutor: 1, scheduledStart: -1 });
sessionSchema.index({ status: 1, scheduledStart: 1 });
sessionSchema.index({ scheduledStart: 1, scheduledEnd: 1 });

sessionSchema.virtual("scheduledDuration").get(function () {
  return this.scheduledEnd - this.scheduledStart;
});

sessionSchema.virtual("actualDuration").get(function () {
  if (this.actualStart && this.actualEnd) {
    return this.actualEnd - this.actualStart;
  }
  return null;
});

module.exports = mongoose.model("Session", sessionSchema);
