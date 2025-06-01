const jwt = require("jsonwebtoken");
const User = require("../models/User");

module.exports = async (req, res, next) => {
  try {
    const token = req.header("Authorization");

    if (!token || !token.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ message: "No token provided, authorization denied" });
    }

    const jwtToken = token.slice(7);

    try {
      const decoded = jwt.verify(jwtToken, process.env.JWT_SECRET);

      const user = await User.findById(decoded.id).select(
        "-password -mfaSecret"
      );

      if (!user) {
        return res
          .status(401)
          .json({ message: "Token is not valid - user not found" });
      }

      if (!user.isActive) {
        return res
          .status(401)
          .json({ message: "Account has been deactivated" });
      }

      req.user = user;
      next();
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        return res.status(401).json({ message: "Token has expired" });
      } else if (error.name === "JsonWebTokenError") {
        return res.status(401).json({ message: "Token is not valid" });
      }
      throw error;
    }
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(500).json({ message: "Server error in authentication" });
  }
};
