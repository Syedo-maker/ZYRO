/** Request logs name the store a request was about (lib/logger.ts), and only a real store id. */
import { tenantIdFromPath } from "../../src/lib/logger";

it.each([
  ["/api/v1/stores/cmw51a0nd0002tki88u5cibgk", "cmw51a0nd0002tki88u5cibgk"],
  ["/api/v1/stores/cmw51a0nd0002tki88u5cibgk/products?q=mug", "cmw51a0nd0002tki88u5cibgk"],
  ["/api/v1/stores/cmw51a0nd0002tki88u5cibgk/theme/draft", "cmw51a0nd0002tki88u5cibgk"],
])("%s names its store", (path, id) => {
  expect(tenantIdFromPath(path)).toBe(id);
});

it.each(["/api/v1/stores", "/api/v1/stores/categories", "/api/v1/plans", "/health", "/api/v1/stores/../etc/passwd"])("%s names no store", (path) => {
  expect(tenantIdFromPath(path)).toBeUndefined();
});
