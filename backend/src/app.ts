import express, { ErrorRequestHandler } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import { AppError } from "./errors/AppError";
import { authRouter } from "./modules/auth/auth.routes";
import { staffRouter } from "./modules/stores/staff.routes";

export const app = express();

app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

const v1 = express.Router();
v1.use("/auth", authRouter);
v1.use("/stores/:storeId/staff", staffRouter);
app.use("/api/v1", v1);

app.use((req, res) => {
  res.status(404).type("application/problem+json").json({
    type: "https://zyro.dev/errors/not-found",
    title: "Route not found",
    status: 404,
    detail: `No route for ${req.method} ${req.path}`,
  });
});

// Must be declared with 4 params for Express to treat it as an error handler.
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).type("application/problem+json").json(err.toProblem());
    return;
  }

  console.error(err);
  res.status(500).type("application/problem+json").json({
    type: "https://zyro.dev/errors/internal",
    title: "Internal server error",
    status: 500,
  });
};
app.use(errorHandler);
