const redis = require("redis");

let redisClient;

const connectRedis = async () => {
  try {
    redisClient = redis.createClient({
      url: process.env.REDIS_URL || "redis://localhost:6379",
    });

    await redisClient.connect();
    console.log("Redis connected successfully");
  } catch (error) {
    console.error("Redis connection error:", error);
  }
};

const getRedisClient = () => redisClient;

module.exports = { connectRedis, getRedisClient };
