const express = require("express");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const auth = require("../middleware/auth");
const Message = require("../models/Message");
const Session = require("../models/Session");
const User = require("../models/User");
const { body, validationResult } = require("express-validator");

const router = express.Router();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|mp4|mov|avi/;
    const extname = allowedTypes.test(file.originalname.toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Invalid file type"));
    }
  },
});

/**
 * @swagger
 * components:
 *   schemas:
 *     Message:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         sender:
 *           type: string
 *         recipient:
 *           type: string
 *         session:
 *           type: string
 *         content:
 *           type: string
 *         type:
 *           type: string
 *           enum: [text, image, file, voice]
 *         attachments:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               filename:
 *                 type: string
 *               url:
 *                 type: string
 *               type:
 *                 type: string
 *               size:
 *                 type: number
 *         readBy:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               user:
 *                 type: string
 *               readAt:
 *                 type: string
 *                 format: date-time
 *         isEdited:
 *           type: boolean
 *         editedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/communication/conversations:
 *   get:
 *     summary: Get user's conversations
 *     tags: [Communication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of conversations
 */
router.get("/conversations", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const sessions = await Session.find({
      $or: [{ student: userId }, { tutor: userId }],
      status: { $in: ["confirmed", "ongoing", "completed"] },
    })
      .populate("student", "firstName lastName profilePicture lastActive")
      .populate("tutor", "firstName lastName profilePicture lastActive")
      .sort({ updatedAt: -1 })
      .lean();

    const conversations = await Promise.all(
      sessions.map(async (session) => {
        const lastMessage = await Message.findOne({
          session: session._id,
        })
          .sort({ createdAt: -1 })
          .populate("sender", "firstName lastName")
          .lean();

        const otherParticipant =
          session.student._id.toString() === userId
            ? session.tutor
            : session.student;

        const unreadCount = await Message.countDocuments({
          session: session._id,
          sender: { $ne: userId },
          "readBy.user": { $ne: userId },
        });

        return {
          sessionId: session._id,
          participant: otherParticipant,
          subject: session.subject,
          lastMessage,
          unreadCount,
          updatedAt: lastMessage ? lastMessage.createdAt : session.updatedAt,
        };
      })
    );

    conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    res.json(conversations);
  } catch (error) {
    console.error("Get conversations error:", error);
    res.status(500).json({ message: "Server error retrieving conversations" });
  }
});

/**
 * @swagger
 * /api/communication/messages/{sessionId}:
 *   get:
 *     summary: Get messages for a session
 *     tags: [Communication]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
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
 *           default: 50
 *     responses:
 *       200:
 *         description: List of messages
 */
router.get("/messages/:sessionId", auth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { page = 1, limit = 50 } = req.query;
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

    const skip = (page - 1) * limit;
    const messages = await Message.find({ session: sessionId })
      .populate("sender", "firstName lastName profilePicture")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Message.countDocuments({ session: sessionId });

    await Message.updateMany(
      {
        session: sessionId,
        sender: { $ne: userId },
        "readBy.user": { $ne: userId },
      },
      {
        $push: {
          readBy: {
            user: userId,
            readAt: new Date(),
          },
        },
      }
    );

    res.json({
      messages: messages.reverse(),
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error("Get messages error:", error);
    res.status(500).json({ message: "Server error retrieving messages" });
  }
});

/**
 * @swagger
 * /api/communication/send-message:
 *   post:
 *     summary: Send a message
 *     tags: [Communication]
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
 *               - content
 *               - type
 *             properties:
 *               sessionId:
 *                 type: string
 *               recipient:
 *                 type: string
 *               content:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [text, image, file, voice]
 *     responses:
 *       201:
 *         description: Message sent successfully
 */
router.post(
  "/send-message",
  auth,
  [
    body("sessionId").isMongoId().withMessage("Valid session ID is required"),
    body("recipient").isMongoId().withMessage("Valid recipient ID is required"),
    body("content")
      .trim()
      .isLength({ min: 1, max: 2000 })
      .withMessage(
        "Message content is required and must be under 2000 characters"
      ),
    body("type")
      .isIn(["text", "image", "file", "voice"])
      .withMessage("Invalid message type"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { sessionId, recipient, content, type } = req.body;
      const senderId = req.user.id;

      const session = await Session.findById(sessionId);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }

      if (
        session.student.toString() !== senderId &&
        session.tutor.toString() !== senderId
      ) {
        return res.status(403).json({ message: "Access denied" });
      }

      const expectedRecipient =
        session.student.toString() === senderId
          ? session.tutor.toString()
          : session.student.toString();

      if (recipient !== expectedRecipient) {
        return res.status(400).json({ message: "Invalid recipient" });
      }

      const message = new Message({
        sender: senderId,
        recipient,
        session: sessionId,
        content,
        type,
        readBy: [
          {
            user: senderId,
            readAt: new Date(),
          },
        ],
      });

      await message.save();
      await message.populate("sender", "firstName lastName profilePicture");

      const io = req.app.get("io");
      if (io) {
        io.to(`session-${sessionId}`).emit("new-message", message);
        io.to(`user-${recipient}`).emit("message-notification", {
          sessionId,
          sender: message.sender,
          preview: content.substring(0, 100),
        });
      }

      res.status(201).json(message);
    } catch (error) {
      console.error("Send message error:", error);
      res.status(500).json({ message: "Server error sending message" });
    }
  }
);

/**
 * @swagger
 * /api/communication/upload-file:
 *   post:
 *     summary: Upload file and send as message
 *     tags: [Communication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *               - recipient
 *               - file
 *             properties:
 *               sessionId:
 *                 type: string
 *               recipient:
 *                 type: string
 *               file:
 *                 type: string
 *                 format: binary
 *               caption:
 *                 type: string
 *     responses:
 *       201:
 *         description: File uploaded and message sent
 */
router.post(
  "/upload-file",
  auth,
  upload.single("file"),
  [
    body("sessionId").isMongoId().withMessage("Valid session ID is required"),
    body("recipient").isMongoId().withMessage("Valid recipient ID is required"),
    body("caption")
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage("Caption too long"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { sessionId, recipient, caption } = req.body;
      const senderId = req.user.id;

      const session = await Session.findById(sessionId);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }

      if (
        session.student.toString() !== senderId &&
        session.tutor.toString() !== senderId
      ) {
        return res.status(403).json({ message: "Access denied" });
      }

      const uploadResult = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: "peer-tutoring/messages",
            resource_type: "auto",
            public_id: `${sessionId}-${Date.now()}`,
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        uploadStream.end(req.file.buffer);
      });

      let messageType = "file";
      if (req.file.mimetype.startsWith("image/")) {
        messageType = "image";
      } else if (req.file.mimetype.startsWith("video/")) {
        messageType = "video";
      } else if (req.file.mimetype.startsWith("audio/")) {
        messageType = "voice";
      }

      const message = new Message({
        sender: senderId,
        recipient,
        session: sessionId,
        content: caption || `Shared a ${messageType}`,
        type: messageType,
        attachments: [
          {
            filename: req.file.originalname,
            url: uploadResult.secure_url,
            type: req.file.mimetype,
            size: req.file.size,
            cloudinaryId: uploadResult.public_id,
          },
        ],
        readBy: [
          {
            user: senderId,
            readAt: new Date(),
          },
        ],
      });

      await message.save();
      await message.populate("sender", "firstName lastName profilePicture");

      const io = req.app.get("io");
      if (io) {
        io.to(`session-${sessionId}`).emit("new-message", message);
        io.to(`user-${recipient}`).emit("message-notification", {
          sessionId,
          sender: message.sender,
          preview: `Shared a ${messageType}`,
        });
      }

      res.status(201).json(message);
    } catch (error) {
      console.error("Upload file error:", error);
      res.status(500).json({ message: "Server error uploading file" });
    }
  }
);

/**
 * @swagger
 * /api/communication/mark-read:
 *   put:
 *     summary: Mark messages as read
 *     tags: [Communication]
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
 *             properties:
 *               sessionId:
 *                 type: string
 *               messageIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Messages marked as read
 */
router.put(
  "/mark-read",
  auth,
  [
    body("sessionId").isMongoId().withMessage("Valid session ID is required"),
    body("messageIds")
      .optional()
      .isArray()
      .withMessage("Message IDs must be an array"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { sessionId, messageIds } = req.body;
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

      let query = {
        session: sessionId,
        sender: { $ne: userId },
        "readBy.user": { $ne: userId },
      };

      if (messageIds && messageIds.length > 0) {
        query._id = { $in: messageIds };
      }

      const result = await Message.updateMany(query, {
        $push: {
          readBy: {
            user: userId,
            readAt: new Date(),
          },
        },
      });

      const io = req.app.get("io");
      if (io) {
        const otherUserId =
          session.student.toString() === userId
            ? session.tutor.toString()
            : session.student.toString();

        io.to(`user-${otherUserId}`).emit("messages-read", {
          sessionId,
          readBy: userId,
          readAt: new Date(),
        });
      }

      res.json({
        message: "Messages marked as read",
        updatedCount: result.modifiedCount,
      });
    } catch (error) {
      console.error("Mark read error:", error);
      res
        .status(500)
        .json({ message: "Server error marking messages as read" });
    }
  }
);

/**
 * @swagger
 * /api/communication/edit-message/{messageId}:
 *   put:
 *     summary: Edit a message
 *     tags: [Communication]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: messageId
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
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: Message edited successfully
 */
router.put(
  "/edit-message/:messageId",
  auth,
  [
    body("content")
      .trim()
      .isLength({ min: 1, max: 2000 })
      .withMessage(
        "Message content is required and must be under 2000 characters"
      ),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { messageId } = req.params;
      const { content } = req.body;
      const userId = req.user.id;

      const message = await Message.findById(messageId);
      if (!message) {
        return res.status(404).json({ message: "Message not found" });
      }

      if (message.sender.toString() !== userId) {
        return res
          .status(403)
          .json({ message: "Can only edit your own messages" });
      }

      const messageAge = Date.now() - message.createdAt.getTime();
      const fifteenMinutes = 15 * 60 * 1000;

      if (messageAge > fifteenMinutes) {
        return res
          .status(400)
          .json({ message: "Message can only be edited within 15 minutes" });
      }

      message.content = content;
      message.isEdited = true;
      message.editedAt = new Date();
      await message.save();

      const io = req.app.get("io");
      if (io) {
        io.to(`session-${message.session}`).emit("message-edited", {
          messageId: message._id,
          content: message.content,
          editedAt: message.editedAt,
        });
      }

      res.json({
        message: "Message edited successfully",
        editedMessage: message,
      });
    } catch (error) {
      console.error("Edit message error:", error);
      res.status(500).json({ message: "Server error editing message" });
    }
  }
);

/**
 * @swagger
 * /api/communication/delete-message/{messageId}:
 *   delete:
 *     summary: Delete a message
 *     tags: [Communication]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Message deleted successfully
 */
router.delete("/delete-message/:messageId", auth, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    if (message.sender.toString() !== userId) {
      return res
        .status(403)
        .json({ message: "Can only delete your own messages" });
    }

    message.content = "This message was deleted";
    message.type = "deleted";
    message.attachments = [];
    await message.save();

    const io = req.app.get("io");
    if (io) {
      io.to(`session-${message.session}`).emit("message-deleted", {
        messageId: message._id,
      });
    }

    res.json({ message: "Message deleted successfully" });
  } catch (error) {
    console.error("Delete message error:", error);
    res.status(500).json({ message: "Server error deleting message" });
  }
});

module.exports = router;
