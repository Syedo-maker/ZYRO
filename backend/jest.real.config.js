/** Tests that call real, paid services. Run with `npm run test:real` after setting the keys in .env. */
const base = require("./jest.config");
module.exports = { ...base, testPathIgnorePatterns: ["/node_modules/"], roots: ["<rootDir>/tests/real"] };