module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/convex/**/*.test.ts"],
  transform: {
    "^.+\\.[tj]s$": ["ts-jest", { tsconfig: "convex/tsconfig.json" }],
  },
  transformIgnorePatterns: [
    "/node_modules/",
  ],
};


