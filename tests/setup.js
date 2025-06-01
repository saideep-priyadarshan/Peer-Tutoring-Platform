const mongoose = require("mongoose");

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.PORT = "0";
}, 30000);

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
}, 30000);

jest.setTimeout(10000);
