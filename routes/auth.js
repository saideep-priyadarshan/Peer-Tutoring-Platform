const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const passport = require("passport");
const User = require("../models/User");
const auth = require("../middleware/auth");
const { body, validationResult } = require("express-validator");
const { sendEmail } = require("../utils/email");
const { sendSMS } = require("../utils/sms");
const rateLimit = require("express-rate-limit");

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many authentication attempts, please try again later.",
});

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - firstName
 *               - lastName
 *               - email
 *               - password
 *               - role
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 6
 *               role:
 *                 type: string
 *                 enum: [student, tutor, both]
 *     responses:
 *       201:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Invalid input or user already exists
 */
router.post(
  "/register",
  [
    body("firstName")
      .trim()
      .isLength({ min: 2 })
      .withMessage("First name must be at least 2 characters"),
    body("lastName")
      .trim()
      .isLength({ min: 2 })
      .withMessage("Last name must be at least 2 characters"),
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Please provide a valid email"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    body("role").isIn(["student", "tutor", "both"]).withMessage("Invalid role"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { firstName, lastName, email, password, role } = req.body;

      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res
          .status(400)
          .json({ message: "User already exists with this email" });
      }

      const user = new User({
        firstName,
        lastName,
        email,
        password,
        role,
      });

      await user.save();

      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });

      await sendEmail({
        to: email,
        subject: "Welcome to Peer Tutoring Platform",
        template: "welcome",
        data: {
          firstName,
          verificationLink: `${process.env.FRONTEND_URL}/verify-email?token=${token}`,
        },
      });

      res.status(201).json({
        token,
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          profilePicture: user.profilePicture,
          verification: user.verification,
        },
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Server error during registration" });
    }
  }
);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *               mfaToken:
 *                 type: string
 *                 description: Required if MFA is enabled
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *                 requiresMFA:
 *                   type: boolean
 *       400:
 *         description: Invalid credentials or MFA token
 */
router.post(
  "/login",
  authLimiter,
  [
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Please provide a valid email"),
    body("password").notEmpty().withMessage("Password is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password, mfaToken } = req.body;

      const user = await User.findOne({ email });
      if (!user) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      if (user.mfaEnabled) {
        if (!mfaToken) {
          return res.status(200).json({ requiresMFA: true });
        }

        const verified = speakeasy.totp.verify({
          secret: user.mfaSecret,
          encoding: "base32",
          token: mfaToken,
          window: 2,
        });

        if (!verified) {
          return res.status(400).json({ message: "Invalid MFA token" });
        }
      }

      await user.updateLastActive();

      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });

      res.json({
        token,
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          profilePicture: user.profilePicture,
          verification: user.verification,
          mfaEnabled: user.mfaEnabled,
        },
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Server error during login" });
    }
  }
);

/**
 * @swagger
 * /api/auth/google:
 *   get:
 *     summary: Initiate Google OAuth
 *     tags: [Authentication]
 *     responses:
 *       302:
 *         description: Redirect to Google OAuth
 */
router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);

/**
 * @swagger
 * /api/auth/google/callback:
 *   get:
 *     summary: Google OAuth callback
 *     tags: [Authentication]
 *     responses:
 *       302:
 *         description: Redirect to frontend with token
 */
router.get(
  "/google/callback",
  passport.authenticate("google", { session: false }),
  async (req, res) => {
    try {
      const token = jwt.sign({ id: req.user._id }, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });

      res.redirect(`${process.env.FRONTEND_URL}/auth/success?token=${token}`);
    } catch (error) {
      res.redirect(`${process.env.FRONTEND_URL}/auth/error`);
    }
  }
);

/**
 * @swagger
 * /api/auth/setup-mfa:
 *   post:
 *     summary: Setup Multi-Factor Authentication
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: MFA setup initiated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 qrCode:
 *                   type: string
 *                   description: QR code data URL
 *                 secret:
 *                   type: string
 *                   description: Manual entry secret
 */
router.post("/setup-mfa", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (user.mfaEnabled) {
      return res.status(400).json({ message: "MFA is already enabled" });
    }

    const secret = speakeasy.generateSecret({
      name: `Peer Tutoring (${user.email})`,
      issuer: "Peer Tutoring Platform",
    });

    const qrCode = await QRCode.toDataURL(secret.otpauth_url);

    user.mfaSecret = secret.base32;
    await user.save();

    res.json({
      qrCode,
      secret: secret.base32,
    });
  } catch (error) {
    console.error("MFA setup error:", error);
    res.status(500).json({ message: "Server error during MFA setup" });
  }
});

/**
 * @swagger
 * /api/auth/verify-mfa:
 *   post:
 *     summary: Verify and enable MFA
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: MFA enabled successfully
 */
router.post(
  "/verify-mfa",
  auth,
  [
    body("token")
      .isLength({ min: 6, max: 6 })
      .withMessage("MFA token must be 6 digits"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { token } = req.body;
      const user = await User.findById(req.user.id);

      if (!user.mfaSecret) {
        return res.status(400).json({ message: "MFA setup not initiated" });
      }

      const verified = speakeasy.totp.verify({
        secret: user.mfaSecret,
        encoding: "base32",
        token,
        window: 2,
      });

      if (!verified) {
        return res.status(400).json({ message: "Invalid MFA token" });
      }

      user.mfaEnabled = true;
      await user.save();

      res.json({ message: "MFA enabled successfully" });
    } catch (error) {
      console.error("MFA verification error:", error);
      res.status(500).json({ message: "Server error during MFA verification" });
    }
  }
);

/**
 * @swagger
 * /api/auth/disable-mfa:
 *   post:
 *     summary: Disable Multi-Factor Authentication
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - password
 *               - token
 *             properties:
 *               password:
 *                 type: string
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: MFA disabled successfully
 */
router.post(
  "/disable-mfa",
  auth,
  [
    body("password").notEmpty().withMessage("Password is required"),
    body("token")
      .isLength({ min: 6, max: 6 })
      .withMessage("MFA token must be 6 digits"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { password, token } = req.body;
      const user = await User.findById(req.user.id);

      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return res.status(400).json({ message: "Invalid password" });
      }

      const verified = speakeasy.totp.verify({
        secret: user.mfaSecret,
        encoding: "base32",
        token,
        window: 2,
      });

      if (!verified) {
        return res.status(400).json({ message: "Invalid MFA token" });
      }

      user.mfaEnabled = false;
      user.mfaSecret = undefined;
      await user.save();

      res.json({ message: "MFA disabled successfully" });
    } catch (error) {
      console.error("MFA disable error:", error);
      res.status(500).json({ message: "Server error during MFA disable" });
    }
  }
);

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Request password reset
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Password reset email sent
 */
router.post(
  "/forgot-password",
  authLimiter,
  [
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Please provide a valid email"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email } = req.body;
      const user = await User.findOne({ email });

      if (!user) {
        return res.json({
          message:
            "If an account with that email exists, a password reset link has been sent.",
        });
      }

      const resetToken = jwt.sign(
        { id: user._id, purpose: "password-reset" },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );

      await sendEmail({
        to: email,
        subject: "Password Reset Request",
        template: "password-reset",
        data: {
          firstName: user.firstName,
          resetLink: `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`,
        },
      });

      res.json({
        message:
          "If an account with that email exists, a password reset link has been sent.",
      });
    } catch (error) {
      console.error("Forgot password error:", error);
      res
        .status(500)
        .json({ message: "Server error during password reset request" });
    }
  }
);

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Reset password with token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - password
 *             properties:
 *               token:
 *                 type: string
 *               password:
 *                 type: string
 *                 minLength: 6
 *     responses:
 *       200:
 *         description: Password reset successfully
 */
router.post(
  "/reset-password",
  [
    body("token").notEmpty().withMessage("Reset token is required"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { token, password } = req.body;

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.purpose !== "password-reset") {
        return res.status(400).json({ message: "Invalid reset token" });
      }

      const user = await User.findById(decoded.id);
      if (!user) {
        return res.status(400).json({ message: "Invalid reset token" });
      }

      user.password = password;
      await user.save();

      res.json({ message: "Password reset successfully" });
    } catch (error) {
      if (
        error.name === "JsonWebTokenError" ||
        error.name === "TokenExpiredError"
      ) {
        return res
          .status(400)
          .json({ message: "Invalid or expired reset token" });
      }
      console.error("Reset password error:", error);
      res.status(500).json({ message: "Server error during password reset" });
    }
  }
);

/**
 * @swagger
 * /api/auth/verify-email:
 *   post:
 *     summary: Verify email address
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Email verified successfully
 */
router.post(
  "/verify-email",
  [body("token").notEmpty().withMessage("Verification token is required")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { token } = req.body;

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);

      if (!user) {
        return res.status(400).json({ message: "Invalid verification token" });
      }

      user.verification.email = true;
      await user.save();

      res.json({ message: "Email verified successfully" });
    } catch (error) {
      if (
        error.name === "JsonWebTokenError" ||
        error.name === "TokenExpiredError"
      ) {
        return res
          .status(400)
          .json({ message: "Invalid or expired verification token" });
      }
      console.error("Email verification error:", error);
      res
        .status(500)
        .json({ message: "Server error during email verification" });
    }
  }
);

module.exports = router;
