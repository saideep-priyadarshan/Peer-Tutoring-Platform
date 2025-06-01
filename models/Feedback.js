const mongoose = require("mongoose");

const feedbackSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
    },
    reviewer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reviewee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["student-to-tutor", "tutor-to-student"],
      required: true,
    },
    ratings: {
      overall: {
        type: Number,
        min: 1,
        max: 5,
        required: true,
      },
      communication: {
        type: Number,
        min: 1,
        max: 5,
      },
      punctuality: {
        type: Number,
        min: 1,
        max: 5,
      },
      knowledge: {
        type: Number,
        min: 1,
        max: 5,
      },
      patience: {
        type: Number,
        min: 1,
        max: 5,
      },
      preparation: {
        type: Number,
        min: 1,
        max: 5,
      },
    },
    comment: {
      type: String,
      maxlength: 1000,
    },
    tags: [
      {
        type: String,
        enum: [
          "helpful",
          "patient",
          "knowledgeable",
          "prepared",
          "unprepared",
          "late",
          "excellent",
          "needs-improvement",
        ],
      },
    ],
    isPublic: {
      type: Boolean,
      default: true,
    },
    helpfulVotes: {
      type: Number,
      default: 0,
    },
    reportedBy: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        reason: String,
        reportedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

feedbackSchema.index({ session: 1, reviewer: 1 }, { unique: true });

module.exports = mongoose.model("Feedback", feedbackSchema);
