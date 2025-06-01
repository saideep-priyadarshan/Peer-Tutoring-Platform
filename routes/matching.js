const express = require("express");
const User = require("../models/User");
const Session = require("../models/Session");
const Feedback = require("../models/Feedback");
const auth = require("../middleware/auth");
const { getRedisClient } = require("../config/redis");

const router = express.Router();

/**
 * @swagger
 * /api/matching/find-tutors:
 *   post:
 *     summary: Find matching tutors for a subject
 *     tags: [Matching]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - subject
 *             properties:
 *               subject:
 *                 type: string
 *               location:
 *                 type: object
 *                 properties:
 *                   lat:
 *                     type: number
 *                   lng:
 *                     type: number
 *                   maxDistance:
 *                     type: number
 *               availability:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     day:
 *                       type: string
 *                     startTime:
 *                       type: string
 *                     endTime:
 *                       type: string
 *               priceRange:
 *                 type: object
 *                 properties:
 *                   min:
 *                     type: number
 *                   max:
 *                     type: number
 *               learningStyle:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: List of matching tutors
 */
router.post("/find-tutors", auth, async (req, res) => {
  try {
    const {
      subject,
      location,
      availability,
      priceRange,
      learningStyle,
      sessionType,
    } = req.body;
    const userId = req.user.id;

    const userHistory = await getUserMatchingHistory(userId);

    let query = {
      _id: { $ne: userId },
      role: { $in: ["tutor", "both"] },
      isActive: true,
      "subjects.subject": { $regex: new RegExp(subject, "i") },
    };

    if (location && sessionType !== "online") {
      if (location.lat && location.lng) {
        const maxDistance = location.maxDistance || 50;
        query["location.coordinates"] = {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: [location.lng, location.lat],
            },
            $maxDistance: maxDistance * 1000,
          },
        };
      }
    }

    let tutors = await User.find(query)
      .select("-password -mfaSecret")
      .populate("subjects")
      .lean();

    const scoredTutors = await Promise.all(
      tutors.map(async (tutor) => {
        const score = await calculateMatchScore(userId, tutor, {
          subject,
          availability,
          priceRange,
          learningStyle,
          userHistory,
        });

        return { ...tutor, matchScore: score };
      })
    );

    const filteredTutors = scoredTutors
      .filter((tutor) => tutor.matchScore >= 0.3)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 20);

    const redisClient = getRedisClient();
    if (redisClient) {
      await redisClient.setex(
        `matching:${userId}:${Date.now()}`,
        3600,
        JSON.stringify({ query: req.body, results: filteredTutors.length })
      );
    }

    res.json({
      tutors: filteredTutors,
      totalFound: filteredTutors.length,
      searchCriteria: req.body,
    });
  } catch (error) {
    console.error("Find tutors error:", error);
    res.status(500).json({ message: "Server error during tutor search" });
  }
});

/**
 * @swagger
 * /api/matching/recommendations:
 *   get:
 *     summary: Get personalized tutor recommendations
 *     tags: [Matching]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Personalized recommendations based on user history
 */
router.get("/recommendations", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId).lean();
    const userHistory = await getUserMatchingHistory(userId);
    const recentSessions = await Session.find({ student: userId })
      .populate("tutor", "subjects rating")
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const recommendations = await generatePersonalizedRecommendations(
      user,
      userHistory,
      recentSessions
    );

    res.json({
      recommendations,
      basedOn: {
        previousSessions: recentSessions.length,
        subjects: user.subjects?.length || 0,
        preferences: Object.keys(user.preferences || {}).length,
      },
    });
  } catch (error) {
    console.error("Recommendations error:", error);
    res
      .status(500)
      .json({ message: "Server error generating recommendations" });
  }
});

async function calculateMatchScore(studentId, tutor, criteria) {
  let score = 0;
  let maxScore = 0;

  const subjectWeight = 0.4;
  const subjectMatch = tutor.subjects.find((s) =>
    s.subject.toLowerCase().includes(criteria.subject.toLowerCase())
  );

  if (subjectMatch) {
    const levelScore = {
      beginner: 0.5,
      intermediate: 0.7,
      advanced: 0.9,
      expert: 1.0,
    };
    score += (levelScore[subjectMatch.level] || 0.5) * subjectWeight;
  }
  maxScore += subjectWeight;

  const ratingWeight = 0.25;
  if (tutor.rating.count > 0) {
    score += (tutor.rating.average / 5) * ratingWeight;
  } else {
    score += 0.5 * ratingWeight;
  }
  maxScore += ratingWeight;

  const availabilityWeight = 0.2;
  if (criteria.availability && tutor.availability) {
    const availabilityMatch = calculateAvailabilityMatch(
      criteria.availability,
      tutor.availability
    );
    score += availabilityMatch * availabilityWeight;
  }
  maxScore += availabilityWeight;

  const priceWeight = 0.1;
  if (criteria.priceRange && tutor.preferences?.priceRange) {
    const priceMatch = calculatePriceCompatibility(
      criteria.priceRange,
      tutor.preferences.priceRange
    );
    score += priceMatch * priceWeight;
  }
  maxScore += priceWeight;

  const historyWeight = 0.05;
  const successRate = await calculateHistoricalSuccessRate(
    studentId,
    tutor._id,
    criteria.userHistory
  );
  score += successRate * historyWeight;
  maxScore += historyWeight;

  return maxScore > 0 ? score / maxScore : 0;
}

function calculateAvailabilityMatch(studentAvailability, tutorAvailability) {
  let totalOverlap = 0;
  let totalPossible = 0;

  for (const studentSlot of studentAvailability) {
    const tutorSlot = tutorAvailability.find(
      (slot) => slot.day === studentSlot.day
    );
    if (tutorSlot) {
      const overlap = calculateTimeOverlap(
        studentSlot.startTime,
        studentSlot.endTime,
        tutorSlot.startTime,
        tutorSlot.endTime
      );
      totalOverlap += overlap;
    }
    totalPossible +=
      parseTime(studentSlot.endTime) - parseTime(studentSlot.startTime);
  }

  return totalPossible > 0 ? totalOverlap / totalPossible : 0;
}

function calculateTimeOverlap(start1, end1, start2, end2) {
  const start1Minutes = parseTime(start1);
  const end1Minutes = parseTime(end1);
  const start2Minutes = parseTime(start2);
  const end2Minutes = parseTime(end2);

  const overlapStart = Math.max(start1Minutes, start2Minutes);
  const overlapEnd = Math.min(end1Minutes, end2Minutes);

  return Math.max(0, overlapEnd - overlapStart);
}

function parseTime(timeString) {
  const [hours, minutes] = timeString.split(":").map(Number);
  return hours * 60 + minutes;
}

function calculatePriceCompatibility(studentRange, tutorRange) {
  const overlapMin = Math.max(studentRange.min, tutorRange.min);
  const overlapMax = Math.min(studentRange.max, tutorRange.max);

  if (overlapMin <= overlapMax) {
    const overlapSize = overlapMax - overlapMin;
    const studentRangeSize = studentRange.max - studentRange.min;
    const tutorRangeSize = tutorRange.max - tutorRange.min;
    const avgRangeSize = (studentRangeSize + tutorRangeSize) / 2;

    return avgRangeSize > 0 ? overlapSize / avgRangeSize : 1;
  }

  return 0;
}

async function calculateHistoricalSuccessRate(studentId, tutorId, userHistory) {
  try {
    const previousSessions = await Session.find({
      student: studentId,
      tutor: tutorId,
      status: { $in: ["completed", "cancelled"] },
    });

    if (previousSessions.length === 0) {
      const similarTutorSessions = await findSimilarTutorSessions(
        studentId,
        tutorId
      );
      return similarTutorSessions.successRate || 0.5;
    }

    const completedSessions = previousSessions.filter(
      (s) => s.status === "completed"
    );
    return completedSessions.length / previousSessions.length;
  } catch (error) {
    console.error("Error calculating success rate:", error);
    return 0.5;
  }
}

async function findSimilarTutorSessions(studentId, targetTutorId) {
  const targetTutor = await User.findById(targetTutorId).lean();
  const targetSubjects = targetTutor.subjects.map((s) => s.subject);

  const similarTutors = await User.find({
    role: { $in: ["tutor", "both"] },
    "subjects.subject": { $in: targetSubjects },
    "rating.average": {
      $gte: Math.max(0, targetTutor.rating.average - 0.5),
      $lte: targetTutor.rating.average + 0.5,
    },
  })
    .select("_id")
    .lean();

  const tutorIds = similarTutors.map((t) => t._id);

  const sessions = await Session.find({
    student: studentId,
    tutor: { $in: tutorIds },
    status: { $in: ["completed", "cancelled"] },
  });

  const completed = sessions.filter((s) => s.status === "completed").length;
  const total = sessions.length;

  return {
    successRate: total > 0 ? completed / total : 0.5,
    totalSessions: total,
  };
}

async function getUserMatchingHistory(userId) {
  const redisClient = getRedisClient();
  if (!redisClient) return {};

  try {
    const keys = await redisClient.keys(`matching:${userId}:*`);
    const history = [];

    for (const key of keys) {
      const data = await redisClient.get(key);
      if (data) {
        history.push(JSON.parse(data));
      }
    }

    return {
      searches: history,
      patterns: analyzeSearchPatterns(history),
    };
  } catch (error) {
    console.error("Error getting user history:", error);
    return {};
  }
}

function analyzeSearchPatterns(searches) {
  if (searches.length === 0) return {};

  const subjects = {};
  const timePreferences = {};
  const locationTypes = {};

  searches.forEach((search) => {
    if (search.query.subject) {
      subjects[search.query.subject] =
        (subjects[search.query.subject] || 0) + 1;
    }

    if (search.query.availability) {
      search.query.availability.forEach((slot) => {
        const key = `${slot.day}-${slot.startTime}`;
        timePreferences[key] = (timePreferences[key] || 0) + 1;
      });
    }

    if (search.query.sessionType) {
      locationTypes[search.query.sessionType] =
        (locationTypes[search.query.sessionType] || 0) + 1;
    }
  });

  return {
    preferredSubjects: Object.keys(subjects).sort(
      (a, b) => subjects[b] - subjects[a]
    ),
    preferredTimes: Object.keys(timePreferences).sort(
      (a, b) => timePreferences[b] - timePreferences[a]
    ),
    preferredSessionTypes: Object.keys(locationTypes).sort(
      (a, b) => locationTypes[b] - locationTypes[a]
    ),
  };
}

async function generatePersonalizedRecommendations(
  user,
  history,
  recentSessions
) {
  const recommendations = [];

  if (recentSessions.length > 0) {
    const successfulTutors = recentSessions
      .filter((session) => session.status === "completed")
      .map((session) => session.tutor)
      .filter((tutor) => tutor.rating.average >= 4.0);

    for (const tutor of successfulTutors) {
      const similarTutors = await findSimilarTutors(tutor, user.subjects);
      recommendations.push(
        ...similarTutors.map((t) => ({
          ...t,
          reason: `Similar to ${tutor.firstName} ${tutor.lastName} who you had great sessions with`,
          confidence: 0.8,
        }))
      );
    }
  }

  if (user.subjects && user.subjects.length > 0) {
    for (const userSubject of user.subjects) {
      const topTutors = await User.find({
        role: { $in: ["tutor", "both"] },
        "subjects.subject": { $regex: new RegExp(userSubject.subject, "i") },
        "subjects.level": { $in: ["advanced", "expert"] },
        "rating.average": { $gte: 4.0 },
        "rating.count": { $gte: 5 },
      })
        .sort({ "rating.average": -1, "rating.count": -1 })
        .limit(3)
        .lean();

      recommendations.push(
        ...topTutors.map((tutor) => ({
          ...tutor,
          reason: `Highly rated expert in ${userSubject.subject}`,
          confidence: 0.7,
        }))
      );
    }
  }

  if (user.location && user.location.coordinates) {
    const nearbyTutors = await User.find({
      role: { $in: ["tutor", "both"] },
      "location.coordinates": {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [
              user.location.coordinates.lng,
              user.location.coordinates.lat,
            ],
          },
          $maxDistance: 25000, // 25km
        },
      },
      "rating.average": { $gte: 4.0 },
    })
      .limit(5)
      .lean();

    recommendations.push(
      ...nearbyTutors.map((tutor) => ({
        ...tutor,
        reason: "Popular tutor in your area",
        confidence: 0.6,
      }))
    );
  }

  const uniqueRecommendations = recommendations
    .filter(
      (rec, index, self) =>
        index === self.findIndex((r) => r._id.toString() === rec._id.toString())
    )
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10);

  return uniqueRecommendations;
}

async function findSimilarTutors(targetTutor, userSubjects) {
  const targetSubjects = targetTutor.subjects.map((s) => s.subject);

  return await User.find({
    _id: { $ne: targetTutor._id },
    role: { $in: ["tutor", "both"] },
    "subjects.subject": { $in: targetSubjects },
    "rating.average": {
      $gte: Math.max(0, targetTutor.rating.average - 0.5),
      $lte: targetTutor.rating.average + 0.5,
    },
  })
    .limit(3)
    .lean();
}

module.exports = router;
